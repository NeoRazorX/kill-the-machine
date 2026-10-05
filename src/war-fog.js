import * as THREE from 'three';
import { SIZE } from './config.js';

// Reconstruct each visible surface in world space, so fog follows X/Z at any height.
export class WarFog {
  constructor(game) {
    this.game = game;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.LinearFilter;
    this.size = new THREE.Vector2();
    this.material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        sceneColor: { value: this.target.texture },
        sceneDepth: { value: this.target.depthTexture },
        visibilityMap: { value: game.fogTex },
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        mapSize: { value: SIZE },
      },
      vertexShader: `varying vec2 screenUV;
        void main() { screenUV = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D sceneColor, sceneDepth, visibilityMap;
        uniform mat4 inverseProjection, cameraWorld;
        uniform float mapSize;
        varying vec2 screenUV;
        void main() {
          vec4 color = texture2D(sceneColor, screenUV);
          float depth = texture2D(sceneDepth, screenUV).r;
          if (depth < 1.0) {
            vec4 view = inverseProjection * vec4(screenUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
            vec3 world = (cameraWorld * (view / view.w)).xyz;
            vec2 fogUV = vec2(world.x / mapSize, 1.0 - world.z / mapSize);
            float obscured = texture2D(visibilityMap, clamp(fogUV, 0.0, 1.0)).a;
            color.rgb *= 1.0 - obscured;
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
      if (this.game.spectate) {
        renderer.setRenderTarget(output);
        renderer.render(scene, camera);
        return;
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

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
