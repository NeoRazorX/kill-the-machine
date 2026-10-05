import * as THREE from 'three';
import { WarFog } from '../src/war-fog.js';
import { N, SIZE } from '../src/config.js';
const result = document.querySelector('#results'), lines = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); lines.push(`PASS ${text}`); };
try {
  const data = new Uint8Array(N * N * 4);
  const texture = new THREE.DataTexture(data, N, N);
  const game = { fogTex: texture, spectate: false };
  const fog = new WarFog(game), renderer = new THREE.WebGLRenderer();
  renderer.setSize(128, 128);
  const target = new THREE.WebGLRenderTarget(128, 128);
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  // One instanced obstacle extends well above the former fog plane.
  const obstacle = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 40, 10), material, 1);
  obstacle.setMatrixAt(0, new THREE.Matrix4().makeTranslation(64, 20, 40));
  scene.add(obstacle);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 500);
  camera.position.set(64, 35, 85); camera.lookAt(64, 35, 40);
  const pixels = new Uint8Array(128 * 128 * 4);
  function mask(alpha) {
    for (let i = 0; i < N * N; i++) data[i * 4 + 3] = alpha;
    texture.needsUpdate = true;
  }
  function center() {
    fog.render(renderer, scene, camera, target);
    renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
    return pixels[(64 * 128 + 64) * 4];
  }
  mask(0); const visible = center();
  assert(visible > 240, 'visible tall obstacle retains its color');
  mask(255); assert(center() === 0, 'unexplored terrain hides the top of a 40-unit obstacle');
  mask(125); const explored = center();
  assert(explored > 0 && explored < visible, 'explored terrain remains dimmed at height');
  mask(255);
  // Reveal only the northern quarter. Detect flipped mask or screen-space sampling.
  for (let row = 3 * N / 4; row < N; row++) for (let x = 0; x < N; x++) data[(row * N + x) * 4 + 3] = 0;
  texture.needsUpdate = true;
  assert(center() === visible, 'mask samples the surface world position with correct Z orientation');
  camera.position.set(82, 48, 82); camera.lookAt(64, 35, 40);
  assert(center() === visible, 'visibility stays aligned when the camera moves');
  mask(255); game.spectate = true;
  assert(center() === visible, 'spectator mode bypasses war fog');
  game.spectate = false; target.setSize(96, 96);
  fog.render(renderer, scene, camera, target);
  assert(fog.target.width === 96 && fog.target.height === 96, 'depth and color targets resize together');
  assert(renderer.getRenderTarget() === null, 'render target restored');
  fog.dispose(); target.dispose(); texture.dispose(); obstacle.geometry.dispose(); material.dispose(); renderer.dispose();
  result.textContent = lines.join('\n') + '\nALL PASSED';
} catch(error) { result.textContent = lines.join('\n') + '\nFAIL ' + error.stack; }
