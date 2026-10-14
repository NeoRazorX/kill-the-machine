import * as THREE from 'three';
import { N, CELL, SIZE } from './config.js';
import { mulberry32 } from './map.js';

// Concrete pads poured under every building, as in Command & Conquer. Each pad covers the footprint
// plus one cell around it; neighbouring pads merge into one apron because they are painted into a
// per-cell mask that the ground shader blends. R = concrete, G = scorched (building destroyed).
export const SLAB_MARGIN = 1;

export class Foundations {
  constructor(game) {
    this.game = game;
    this.records = [];
    this.data = new Uint8Array(N * N * 4);
    this.mask = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat);
    this.mask.magFilter = this.mask.minFilter = THREE.LinearFilter;
    this.mask.needsUpdate = true;
    this.dirty = false;
  }

  add(b) {
    this.records.push({ b, cx: b.cx, cz: b.cz, w: b.w, h: b.h, x: b.x, z: b.z, scorched: false, seen: false });
    this.update();
  }

  // Sold buildings take their pad with them; destroyed ones leave it cracked and burnt.
  remove(b, reason) {
    const i = this.records.findIndex((r) => r.b === b);
    if (i < 0) return;
    if (reason === 'destroyed') { this.records[i].scorched = true; this.records[i].b = null; }
    else this.records.splice(i, 1);
    this.dirty = true;
    this.update();
  }

  // A pad shows once its building has been seen, like the building itself; ruins once their spot is.
  update() {
    const g = this.game;
    for (const r of this.records) {
      if (r.seen) continue;
      if (r.b ? r.b.seen : g.spectate || g.visibleAt(r.x, r.z)) r.seen = this.dirty = true;
    }
    if (this.dirty) this.rebuild();
  }

  rebuild() {
    const d = this.data;
    d.fill(0);
    const stamp = (r, fn) => {
      for (let z = r.cz - SLAB_MARGIN; z < r.cz + r.h + SLAB_MARGIN; z++) {
        for (let x = r.cx - SLAB_MARGIN; x < r.cx + r.w + SLAB_MARGIN; x++) {
          if (x >= 0 && z >= 0 && x < N && z < N) fn((z * N + x) * 4);
        }
      }
    };
    const seen = this.records.filter((r) => r.seen);
    for (const r of seen) stamp(r, (o) => { d[o] = 255; if (r.scorched) d[o + 1] = 255; });
    // A new building poured over old ruins gets fresh concrete.
    for (const r of seen) if (!r.scorched) stamp(r, (o) => { d[o + 1] = 0; });
    this.mask.needsUpdate = true;
    this.dirty = false;
  }
}

// One-cell panels with seams, tone changes, stains and hairline cracks. Alpha holds soft noise used
// to break up the pad edges, the scorch marks and the dust, so it is kept out of the colour.
let concrete = null;
export function concreteTexture() {
  if (concrete) return concrete;
  const px = 256, panels = 4, step = px / panels, rng = mulberry32(4242);
  const d = new Uint8Array(px * px * 4);
  const tone = Array.from({ length: panels * panels }, () => (rng() - .5) * 16);
  const blobs = Array.from({ length: 9 }, () => ({ x: rng() * px, y: rng() * px, r: 8 + rng() * 26, k: rng() * 14 }));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x, y, f, s) => {
    // Tileable value noise on a periodic lattice.
    const xi = Math.floor(x * f), yi = Math.floor(y * f), u = x * f - xi, v = y * f - yi;
    const h = (i, j) => { const a = Math.imul(((i % f) + f) % f, 374761393) ^ Math.imul(((j % f) + f) % f, 668265263) ^ s; return ((Math.imul(a ^ (a >>> 13), 1274126177) >>> 0) % 1000) / 1000; };
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), su), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), su), sv);
  };
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const gx = x % step, gy = y % step;
      const seam = Math.min(gx, gy, step - 1 - gx, step - 1 - gy);
      let c = 128 + tone[Math.floor(y / step) * panels + Math.floor(x / step)];
      c += (smooth(x / px, y / px, 16, 3) - .5) * 14 + (rng() - .5) * 10;
      if (seam < 1) c -= 34; else if (seam < 2.5) c -= 9;
      for (const b of blobs) {
        // Distances wrap around so stains continue across the tile edge.
        const dx = Math.min(Math.abs(x - b.x), px - Math.abs(x - b.x)), dy = Math.min(Math.abs(y - b.y), px - Math.abs(y - b.y));
        const t = 1 - Math.hypot(dx, dy) / b.r;
        if (t > 0) c -= t * t * b.k;
      }
      const o = (y * px + x) * 4;
      d[o] = c + 2; d[o + 1] = c + 1; d[o + 2] = c - 2;
      d[o + 3] = 255 * (smooth(x / px, y / px, 4, 11) * .6 + smooth(x / px, y / px, 8, 17) * .4);
    }
  }
  // Hairline cracks wandering across a few panels.
  for (let k = 0; k < 7; k++) {
    let x = rng() * px, y = rng() * px, a = rng() * Math.PI * 2;
    for (let s = 0; s < 40 + rng() * 50; s++) {
      a += (rng() - .5) * .8; x += Math.cos(a); y += Math.sin(a);
      const o = ((((Math.floor(y) % px) + px) % px) * px + (((Math.floor(x) % px) + px) % px)) * 4;
      for (let c = 0; c < 3; c++) d[o + c] = Math.max(0, d[o + c] - 30);
    }
  }
  concrete = new THREE.DataTexture(d, px, px, THREE.RGBAFormat);
  concrete.colorSpace = THREE.SRGBColorSpace;
  concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
  concrete.magFilter = THREE.LinearFilter;
  concrete.minFilter = THREE.LinearMipmapLinearFilter;
  concrete.generateMipmaps = true;
  concrete.anisotropy = 8;
  concrete.needsUpdate = true;
  return concrete;
}

// World units covered by one repeat of the concrete texture (four panels of one cell each).
export const CONCRETE_TILE = 4 * CELL;

// Blends the pads into the ground material. The theme tints the concrete and dusts it with sand or snow.
export function applySlabShader(material, mask, theme) {
  const s = theme.slab;
  const dust = new THREE.Color().setRGB(...s.dust.map((v) => v / 255), THREE.SRGBColorSpace);
  const f = (v) => v.toFixed(3);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { slabMask: { value: mask }, slabTex: { value: concreteTexture() }, slabDust: { value: dust } });
    shader.vertexShader = 'varying vec2 vSlab;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vSlab = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = 'uniform sampler2D slabMask, slabTex;\nuniform vec3 slabDust;\nvarying vec2 vSlab;\n' +
      shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec4 slabCell = texture2D(slabMask, vSlab / ${f(SIZE)});
      if (slabCell.r > 0.001) {
        vec4 conc = texture2D(slabTex, vSlab / ${f(CONCRETE_TILE)});
        float n = texture2D(slabTex, vSlab / 37.0 + 0.31).a;
        float edge = slabCell.r + (n - 0.5) * 0.35;
        float cover = smoothstep(0.42, 0.58, edge);
        vec3 c = conc.rgb * vec3(${s.tint.map(f).join(', ')});
        c *= 1.0 - (1.0 - smoothstep(0.55, 0.9, edge)) * 0.22;
        c = mix(c, slabDust, smoothstep(0.45, 0.85, n) * ${f(s.dustAmount)});
        c = mix(c, c * vec3(0.24, 0.22, 0.2), slabCell.g * smoothstep(0.15, 0.6, n * 0.6 + conc.a * 0.6));
        diffuseColor.rgb = mix(diffuseColor.rgb, c, cover);
      }`);
  };
  material.customProgramCacheKey = () => `slab:${theme.id}`;
}
