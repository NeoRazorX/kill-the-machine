import * as THREE from 'three';
import { SIZE } from './config.js';

// No grading: the image passes through unchanged.
export const NEUTRAL_GRADE = { exposure: 1, white: 1, contrast: 1, saturation: 1, shadows: [1, 1, 1], highlights: [1, 1, 1], vignette: 0, bloom: 0, threshold: 1 };
// No clouds.
export const CLEAR_SKY = { shade: 0, cover: 1, size: 80, wind: [0, 0] };

// Halvings of the bloom chain below the half-resolution bright pass: each one spreads the glow wider.
const BLOOM_LEVELS = 5;

// Each visible surface rebuilt in world space, so fog follows X/Z at any height and clouds drifting
// overhead can shade it. Shared by the bright pass of the bloom and the final pass, so nothing hidden
// by the fog glows.
const SURFACE = `
  uniform sampler2D sceneColor, sceneDepth, visibilityMap;
  uniform mat4 inverseProjection, cameraWorld;
  uniform float mapSize, fogAmount, cloudShade, cloudCover, cloudSize;
  uniform vec2 cloudDrift, cloudSlant;
  float cloudHash(vec2 p) { vec3 q = fract(p.xyx * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float cloudNoise(vec2 x) {
    vec2 i = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // How much cloud stands over p (in cloud sizes): a few octaves of noise, warped so the puffs
  // are irregular, with a soft threshold so the shadows have no hard edge.
  float clouds(vec2 p) {
    p += vec2(cloudNoise(p * .7 + 3.1), cloudNoise(p * .7 + 9.7)) * .8;
    float n = cloudNoise(p) * .55 + cloudNoise(p * 2.03 + 1.7) * .28 + cloudNoise(p * 4.1 + 5.3) * .17;
    return smoothstep(cloudCover, cloudCover + .22, n);
  }
  // How much of the surface at uv shows: 1 in the open, less under fog and clouds.
  float surfaceLight(vec2 uv) {
    float depth = texture2D(sceneDepth, uv).r;
    if (depth >= 1.0) return 1.0;
    vec4 view = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 world = (cameraWorld * (view / view.w)).xyz;
    vec2 fogUV = vec2(world.x / mapSize, 1.0 - world.z / mapSize);
    float light = 1.0 - texture2D(visibilityMap, clamp(fogUV, 0.0, 1.0)).a * fogAmount;
    // Cloud shadows, cast along the sunlight so tall things are shaded where the ray meets them.
    if (cloudShade > 0.0) light *= 1.0 - cloudShade * clouds((world.xz - world.y * cloudSlant) / cloudSize + cloudDrift);
    return light;
  }`;

const QUAD_VERTEX = `varying vec2 screenUV;
  void main() { screenUV = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// The final pass over the rendered scene: fog and clouds, bloom, then the colour grade and the tone
// curve. The scene is drawn in half float so highlights keep their range and dark tones do not band
// before the tone mapping. The tone curve leaves the darks and mid tones as they are and eases the
// brightest light into white, reached at `white`, so the art keeps its colours while snow, glints and
// explosions stop clipping. Light above `threshold` (fire, sparks, flashes, beams, the ore's glow,
// glints on the water) also spills a soft halo around itself: the bloom.
export class WarFog {
  constructor(game) {
    this.game = game;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, type: THREE.HalfFloatType, samples: 4 });
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.LinearFilter;
    this.size = new THREE.Vector2();
    // The light the clouds block, if any; main sets it.
    this.sun = null;
    this.wind = [0, 0];
    this.slant = new THREE.Vector3();
    this.bloom = Array.from({ length: BLOOM_LEVELS + 1 }, () => new THREE.WebGLRenderTarget(1, 1,
      { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    // Uniforms shared by every pass that reads the scene.
    this.surface = {
      sceneColor: { value: this.target.texture },
      sceneDepth: { value: this.target.depthTexture },
      visibilityMap: { value: game.fogTex },
      inverseProjection: { value: new THREE.Matrix4() },
      cameraWorld: { value: new THREE.Matrix4() },
      mapSize: { value: SIZE },
      fogAmount: { value: 1 },
      cloudShade: { value: 0 }, cloudCover: { value: 1 }, cloudSize: { value: 80 },
      cloudDrift: { value: new THREE.Vector2() }, cloudSlant: { value: new THREE.Vector2() },
    };
    this.material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        ...this.surface,
        bloomTexture: { value: this.bloom[0].texture }, bloomStrength: { value: 0 },
        gradeExposure: { value: 1 }, gradeWhite: { value: 1 }, gradeContrast: { value: 1 }, gradeSaturation: { value: 1 }, gradeVignette: { value: 0 },
        gradeShadows: { value: new THREE.Vector3(1, 1, 1) }, gradeHighlights: { value: new THREE.Vector3(1, 1, 1) },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: SURFACE + `
        uniform sampler2D bloomTexture;
        uniform float bloomStrength, gradeExposure, gradeWhite, gradeContrast, gradeSaturation, gradeVignette;
        uniform vec3 gradeShadows, gradeHighlights;
        varying vec2 screenUV;
        void main() {
          vec4 color = texture2D(sceneColor, screenUV);
          color.rgb *= surfaceLight(screenUV);
          if (bloomStrength > 0.0) color.rgb += texture2D(bloomTexture, screenUV).rgb * bloomStrength;
          // Grading in linear light: saturation, contrast around mid grey, a tint for the shadows and
          // another for the highlights, and a soft darkening towards the corners.
          color.rgb *= gradeExposure;
          float luma = dot(color.rgb, vec3(.2126, .7152, .0722));
          color.rgb = max(mix(vec3(luma), color.rgb, gradeSaturation), 0.0);
          color.rgb = pow(color.rgb / .18, vec3(gradeContrast)) * .18;
          color.rgb *= mix(gradeShadows, gradeHighlights, smoothstep(.02, .5, luma));
          vec2 corner = screenUV - .5;
          color.rgb *= 1.0 - gradeVignette * smoothstep(.2, .75, dot(corner, corner) * 2.0);
          // Shoulder on the brightest channel, so hues hold as they roll off: a cubic ease from the knee
          // to white whose slope starts at 1, which puts the knee at (3 - white) / 2.
          float peak = max(color.r, max(color.g, color.b)), knee = (3.0 - gradeWhite) * .5;
          if (gradeWhite > 1.0 && peak > knee) {
            float t = min((peak - knee) / (gradeWhite - knee), 1.0);
            color.rgb *= (knee + (1.0 - knee) * (1.0 - pow(1.0 - t, 3.0))) / peak;
          }
          gl_FragColor = color;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    // Bright pass at half resolution: four scene texels averaged, each weighted down by its own
    // brightness so a single hot pixel cannot flicker into a big halo, then the light above the
    // threshold, with a soft knee so the glow fades in.
    this.brightMaterial = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { ...this.surface, texel: { value: new THREE.Vector2() }, threshold: { value: 1 } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: SURFACE + `
        uniform vec2 texel;
        uniform float threshold;
        varying vec2 screenUV;
        void main() {
          vec3 sum = vec3(0.0); float weight = 0.0;
          for (int i = 0; i < 4; i++) {
            vec3 c = texture2D(sceneColor, screenUV + texel * (vec2(i % 2, i / 2) - .5)).rgb;
            float w = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
            sum += c * w; weight += w;
          }
          vec3 c = sum / weight * surfaceLight(screenUV);
          float peak = max(c.r, max(c.g, c.b)), knee = threshold * .2;
          float soft = clamp(peak - threshold + knee, 0.0, 2.0 * knee);
          float over = max(soft * soft / (4.0 * knee + 1e-4), peak - threshold);
          gl_FragColor = vec4(c * over / max(peak, 1e-4), 1.0);
        }`,
    });
    // Dual filter: each halving takes the centre and four diagonal taps, each doubling a tent of eight.
    const blur = (body) => new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { source: { value: null }, texel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: `uniform sampler2D source;
        uniform vec2 texel;
        varying vec2 screenUV;
        vec3 at(vec2 o) { return texture2D(source, screenUV + o * texel).rgb; }
        void main() { gl_FragColor = vec4(${body}, 1.0); }`,
    });
    this.downMaterial = blur('(at(vec2(0.0)) * 4.0 + at(vec2(-1.0, -1.0)) + at(vec2(1.0, -1.0)) + at(vec2(-1.0, 1.0)) + at(vec2(1.0, 1.0))) / 8.0');
    this.upMaterial = blur(`(at(vec2(-2.0, 0.0)) + at(vec2(2.0, 0.0)) + at(vec2(0.0, -2.0)) + at(vec2(0.0, 2.0))
      + (at(vec2(-1.0, -1.0)) + at(vec2(1.0, -1.0)) + at(vec2(-1.0, 1.0)) + at(vec2(1.0, 1.0))) * 2.0) / 12.0`);
    // Going back up, each level adds onto the one above, so the top ends up holding every width.
    this.upMaterial.blending = THREE.AdditiveBlending;
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
  }

  pass(renderer, material, output) {
    this.quad.material = material;
    renderer.setRenderTarget(output);
    renderer.render(this.scene, this.camera);
  }

  render(renderer, scene, camera, output = null) {
    const previous = renderer.getRenderTarget();
    const autoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    try {
      const u = this.surface;
      u.fogAmount.value = this.game.spectate ? 0 : 1;
      // The clouds drift on the wind in real time, paused or not, like the water.
      const t = performance.now() / 1000;
      u.cloudDrift.value.set(this.wind[0] * t / u.cloudSize.value % 1000, this.wind[1] * t / u.cloudSize.value % 1000);
      if (this.sun) {
        const d = this.slant.subVectors(this.sun.position, this.sun.target.position);
        u.cloudSlant.value.set(d.x / d.y, d.z / d.y);
      }
      if (output) this.size.set(output.width, output.height);
      else renderer.getDrawingBufferSize(this.size);
      if (this.target.width !== this.size.x || this.target.height !== this.size.y) {
        this.target.setSize(this.size.x, this.size.y);
        this.bloom.forEach((b, i) => b.setSize(Math.max(1, this.size.x >> (i + 1)), Math.max(1, this.size.y >> (i + 1))));
      }
      renderer.setRenderTarget(this.target);
      renderer.render(scene, camera);
      u.inverseProjection.value.copy(camera.projectionMatrixInverse);
      u.cameraWorld.value.copy(camera.matrixWorld);
      if (this.material.uniforms.bloomStrength.value > 0) this.renderBloom(renderer);
      this.pass(renderer, this.material, output);
    } finally {
      renderer.setRenderTarget(previous);
      renderer.info.autoReset = autoReset;
    }
  }

  renderBloom(renderer) {
    const b = this.bloom;
    this.brightMaterial.uniforms.texel.value.set(1 / this.size.x, 1 / this.size.y);
    this.pass(renderer, this.brightMaterial, b[0]);
    for (let i = 1; i < b.length; i++) {
      this.downMaterial.uniforms.source.value = b[i - 1].texture;
      this.downMaterial.uniforms.texel.value.set(1 / b[i - 1].width, 1 / b[i - 1].height);
      this.pass(renderer, this.downMaterial, b[i]);
    }
    // Adding onto each level, so it must not be cleared first.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      for (let i = b.length - 1; i > 0; i--) {
        this.upMaterial.uniforms.source.value = b[i].texture;
        this.upMaterial.uniforms.texel.value.set(.5 / b[i].width, .5 / b[i].height);
        this.pass(renderer, this.upMaterial, b[i - 1]);
      }
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  // grade: { exposure, white, contrast, saturation, shadows: [r, g, b], highlights: [r, g, b], vignette,
  // bloom: strength of the glow, threshold: light it starts at }, as in NEUTRAL_GRADE.
  setGrade(grade) {
    const u = this.material.uniforms;
    u.gradeExposure.value = grade.exposure; u.gradeWhite.value = grade.white; u.gradeContrast.value = grade.contrast; u.gradeSaturation.value = grade.saturation; u.gradeVignette.value = grade.vignette;
    u.gradeShadows.value.set(...grade.shadows); u.gradeHighlights.value.set(...grade.highlights);
    u.bloomStrength.value = grade.bloom ?? 0;
    this.brightMaterial.uniforms.threshold.value = grade.threshold ?? 1;
  }

  // clouds: { shade: darkening under a cloud, cover: 0..1 (higher, fewer), size: world units across a
  // cloud, wind: [x, z] in world units per second }, as in CLEAR_SKY.
  setClouds(clouds) {
    const u = this.surface;
    u.cloudShade.value = clouds.shade; u.cloudCover.value = clouds.cover; u.cloudSize.value = clouds.size;
    this.wind = clouds.wind;
  }

  dispose() {
    this.target.dispose();
    for (const b of this.bloom) b.dispose();
    for (const m of [this.material, this.brightMaterial, this.downMaterial, this.upMaterial]) m.dispose();
    this.quad.geometry.dispose();
  }
}
