import * as THREE from 'three';
import { SIZE } from './config.js';

// No grading: the image passes through unchanged.
export const NEUTRAL_GRADE = { exposure: 1, white: 1, contrast: 1, saturation: 1, shadows: [1, 1, 1], highlights: [1, 1, 1], vignette: 0 };
// No clouds.
export const CLEAR_SKY = { shade: 0, cover: 1, size: 80, wind: [0, 0] };

// The final pass over the rendered scene. It reconstructs each visible surface in world space, so fog
// follows X/Z at any height and clouds drifting overhead can shade it, then grades the colour and tone
// maps it. The scene is drawn in half float
// so highlights keep their range and dark tones do not band before the tone mapping. The tone curve
// leaves the darks and mid tones as they are and eases the brightest light into white, reached at
// `white`, so the art keeps its colours while snow, glints and explosions stop clipping.
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
    this.material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        sceneColor: { value: this.target.texture },
        sceneDepth: { value: this.target.depthTexture },
        visibilityMap: { value: game.fogTex },
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        mapSize: { value: SIZE },
        fogAmount: { value: 1 },
        gradeExposure: { value: 1 }, gradeWhite: { value: 1 }, gradeContrast: { value: 1 }, gradeSaturation: { value: 1 }, gradeVignette: { value: 0 },
        gradeShadows: { value: new THREE.Vector3(1, 1, 1) }, gradeHighlights: { value: new THREE.Vector3(1, 1, 1) },
        cloudShade: { value: 0 }, cloudCover: { value: 1 }, cloudSize: { value: 80 },
        cloudDrift: { value: new THREE.Vector2() }, cloudSlant: { value: new THREE.Vector2() },
      },
      vertexShader: `varying vec2 screenUV;
        void main() { screenUV = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D sceneColor, sceneDepth, visibilityMap;
        uniform mat4 inverseProjection, cameraWorld;
        uniform float mapSize, fogAmount, gradeExposure, gradeWhite, gradeContrast, gradeSaturation, gradeVignette;
        uniform vec3 gradeShadows, gradeHighlights;
        uniform float cloudShade, cloudCover, cloudSize;
        uniform vec2 cloudDrift, cloudSlant;
        varying vec2 screenUV;
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
        void main() {
          vec4 color = texture2D(sceneColor, screenUV);
          float depth = texture2D(sceneDepth, screenUV).r;
          if (depth < 1.0) {
            vec4 view = inverseProjection * vec4(screenUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
            vec3 world = (cameraWorld * (view / view.w)).xyz;
            vec2 fogUV = vec2(world.x / mapSize, 1.0 - world.z / mapSize);
            float obscured = texture2D(visibilityMap, clamp(fogUV, 0.0, 1.0)).a;
            color.rgb *= 1.0 - obscured * fogAmount;
            // Cloud shadows, cast along the sunlight so tall things are shaded where the ray meets them.
            if (cloudShade > 0.0) color.rgb *= 1.0 - cloudShade * clouds((world.xz - world.y * cloudSlant) / cloudSize + cloudDrift);
          }
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
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
  }

  render(renderer, scene, camera, output = null) {
    const previous = renderer.getRenderTarget();
    const autoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    try {
      const u = this.material.uniforms;
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
      if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
      renderer.setRenderTarget(this.target);
      renderer.render(scene, camera);
      this.material.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      this.material.uniforms.cameraWorld.value.copy(camera.matrixWorld);
      renderer.setRenderTarget(output);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(previous);
      renderer.info.autoReset = autoReset;
    }
  }

  // grade: { exposure, white, contrast, saturation, shadows: [r, g, b], highlights: [r, g, b], vignette }, as in NEUTRAL_GRADE.
  setGrade(grade) {
    const u = this.material.uniforms;
    u.gradeExposure.value = grade.exposure; u.gradeWhite.value = grade.white; u.gradeContrast.value = grade.contrast; u.gradeSaturation.value = grade.saturation; u.gradeVignette.value = grade.vignette;
    u.gradeShadows.value.set(...grade.shadows); u.gradeHighlights.value.set(...grade.highlights);
  }

  // clouds: { shade: darkening under a cloud, cover: 0..1 (higher, fewer), size: world units across a
  // cloud, wind: [x, z] in world units per second }, as in CLEAR_SKY.
  setClouds(clouds) {
    const u = this.material.uniforms;
    u.cloudShade.value = clouds.shade; u.cloudCover.value = clouds.cover; u.cloudSize.value = clouds.size;
    this.wind = clouds.wind;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
