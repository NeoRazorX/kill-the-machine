import * as THREE from 'three';
import { SIZE } from './config.js';
import { mulberry32 } from './map.js';

// Fine detail laid over the painted ground, which is one image stretched over the whole map and so
// turns soft up close. A tileable texture adds grain, tufts of grass, pebbles and wind ripples; the
// shader picks them by what the ground below looks like (tufts only where it is green), brightens or
// darkens the colour with them and bends the normal so they catch the sun.
// R = grain, G = grass blades, B = pebbles, A = ripples.
const PX = 512;
// World units covered by one repeat of the detail texture.
export const DETAIL_TILE = 14;

let detail = null;
export function detailTexture() {
  if (detail) return detail;
  const rng = mulberry32(9137);
  const hash = (i, j, s) => {
    let a = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 1442695041);
    a = Math.imul(a ^ (a >>> 13), 1274126177);
    return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
  };
  // Value noise on a lattice of f cells across the tile, wrapping at its edge.
  const noise = (u, v, f, s) => {
    const x = u * f, y = v * f, xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
    const h = (i, j) => hash(((i % f) + f) % f, ((j % f) + f) % f, s);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * sx, b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
  const grain = new Float32Array(PX * PX), blades = new Float32Array(PX * PX), stones = new Float32Array(PX * PX);
  const wrap = (x, y) => ((((y | 0) % PX) + PX) % PX) * PX + ((((x | 0) % PX) + PX) % PX);
  const d = new Uint8Array(PX * PX * 4);
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) {
    const u = x / PX, v = y / PX;
    // Stretched to the full range: summed octaves cluster around the middle.
    const n = noise(u, v, 128, 1) * .35 + noise(u, v, 64, 2) * .3 + noise(u, v, 24, 3) * .2 + rng() * .15;
    grain[y * PX + x] = Math.min(1, Math.max(0, .5 + (n - .5) * 3));
  }
  // Tufts: a few blades fanning out from a root, thicker in patches.
  for (let k = 0; k < 9000; k++) {
    const cx = rng() * PX, cy = rng() * PX;
    if (rng() > .25 + noise(cx / PX, cy / PX, 6, 5) * .9) continue;
    const n = 3 + Math.floor(rng() * 4), lean = rng() * Math.PI * 2;
    for (let b = 0; b < n; b++) {
      const a = lean + (rng() - .5) * 2.2, len = 3 + rng() * 7;
      for (let s = 0; s <= len; s++) {
        const i = wrap(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
        blades[i] = Math.max(blades[i], .45 + .55 * s / len);
      }
    }
  }
  // Pebbles: small rounded domes.
  for (let k = 0; k < 520; k++) {
    const cx = rng() * PX, cy = rng() * PX, r = 1.2 + rng() * rng() * 4, squash = .6 + rng() * .4, rot = rng() * Math.PI;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const ex = (dx * c + dy * s) / r, ey = (-dx * s + dy * c) / (r * squash), t = 1 - ex * ex - ey * ey;
      if (t <= 0) continue;
      const i = wrap(cx + dx, cy + dy);
      stones[i] = Math.max(stones[i], Math.sqrt(t));
    }
  }
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) {
    const u = x / PX, v = y / PX, i = y * PX + x, o = i * 4;
    // Ripples: whole waves across the tile so they wrap, bent by noise so they never run straight.
    const ripple = .5 + .5 * Math.sin(Math.PI * 2 * (18 * v + 2 * u + noise(u, v, 4, 7) * 1.6 + noise(u, v, 12, 8) * .25));
    d[o] = grain[i] * 255; d[o + 1] = blades[i] * 255; d[o + 2] = stones[i] * 255; d[o + 3] = ripple * 255;
  }
  detail = new THREE.DataTexture(d, PX, PX, THREE.RGBAFormat);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.magFilter = THREE.LinearFilter;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.anisotropy = 8;
  detail.needsUpdate = true;
  return detail;
}

// Adds the detail to the ground material, after whatever shader it already has (the concrete pads).
// Pads keep their own texture, so slabMask, when given, keeps the detail off them.
export function applyGroundDetail(material, theme, slabMask = null) {
  const g = theme.ground.detail, f = (v) => v.toFixed(3);
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, { groundDetail: { value: detailTexture() }, groundSlab: { value: slabMask } });
    shader.vertexShader = 'varying vec2 vGround;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vGround = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = `uniform sampler2D groundDetail, groundSlab;
      varying vec2 vGround;
      // Detail height at p: grain everywhere, blades where the ground is green, pebbles and ripples elsewhere.
      // A second, larger and turned copy of the grain hides the repeat.
      float groundHeight(vec2 p, float green) {
        vec4 a = texture2D(groundDetail, p / ${f(DETAIL_TILE)});
        float b = texture2D(groundDetail, mat2(.8, .6, -.6, .8) * p / ${f(DETAIL_TILE * 2.7)} + .37).r;
        return ((a.r - .5) + (b - .5) * .7) * ${f(g.grain)} + (a.g - .25) * ${f(g.tufts)} * green
          + (a.b - .02) * ${f(g.pebbles)} * (1.0 - green) + (a.a - .5) * ${f(g.ripples)} * (1.0 - green);
      }
      ` + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Grass reads as green over red and blue in the painted ground; dirt, sand, snow and roads do not.
        float gGreen = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 30.0, 0.0, 1.0);
        float gBare = ${slabMask ? `1.0 - smoothstep(.3, .6, texture2D(groundSlab, vGround / ${f(SIZE)}).r)` : '1.0'};
        float gH = groundHeight(vGround, gGreen);
        diffuseColor.rgb *= 1.0 + gH * gBare * ${f(g.contrast)};`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Slopes measured over at least a screen pixel, so far away the relief flattens instead of shimmering.
        float gE = max(${f(DETAIL_TILE / PX)}, length(fwidth(vGround)) * .7);
        vec2 gSlope = vec2(groundHeight(vGround + vec2(gE, 0.0), gGreen) - gH, groundHeight(vGround + vec2(0.0, gE), gGreen) - gH) / gE;
        gSlope *= ${f(g.relief * .08)} * gBare;
        normal = normalize((viewMatrix * vec4(normalize(vec3(-gSlope.x, 1.0, -gSlope.y)), 0.0)).xyz);`);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}:detail:${theme.id}`;
}
