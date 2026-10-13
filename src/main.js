import * as THREE from 'three';
import { Game } from './game.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { SIZE, TEAMS, DIFFICULTY } from './config.js';
import { preloadModels, assetStatus } from './assets.js';
import { WarFog } from './war-fog.js';

const params = new URLSearchParams(location.search);
const startButton = document.getElementById('btn-start');
const spectateButton = document.getElementById('btn-spectate');
const loadMessage = document.getElementById('model-status');
const retryButton = document.getElementById('btn-retry-models');
startButton.disabled = spectateButton.disabled = true;
// Keep the menu usable on failure, with an explicit retry instead of substitute models.
while (true) {
  retryButton.hidden = true;
  startButton.textContent = 'CARGANDO MODELOS…';
  try {
    await preloadModels((done, total) => { loadMessage.textContent = `Cargando gráficos: ${done} / ${total}`; });
    break;
  } catch {
    startButton.textContent = 'COMENZAR MISIÓN';
    loadMessage.textContent = 'No se han podido cargar los gráficos. Comprueba la conexión y vuelve a intentarlo.';
    retryButton.hidden = false;
    await new Promise(resolve => { retryButton.onclick = resolve; });
  }
}
retryButton.onclick = null;
loadMessage.textContent = '';
startButton.textContent = 'COMENZAR MISIÓN';
startButton.disabled = spectateButton.disabled = false;
const canvas = document.getElementById('gl');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Read-only graphics diagnostics.
window.__graphics = () => ({ ...assetStatus, calls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1216);
scene.fog = new THREE.Fog(0x0e1216, 170, 340);

const camera = new THREE.PerspectiveCamera(45, 1, 1, 600);

scene.add(new THREE.HemisphereLight(0xd6e4ff, 0x40483a, 1.25));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 1; sc.far = 260;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
scene.add(sun); scene.add(sun.target);

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const game = new Game(scene, 20260);
window.__game = game;
const warFog = new WarFog(game);

let input = null, ui = null, started = false, speed = 1;
const diffEls = [...document.querySelectorAll('.diff')];
let difficulty = 'normal';
diffEls.forEach((el) => {
  el.onclick = () => { difficulty = el.dataset.d; diffEls.forEach((e) => e.classList.toggle('active', e === el)); };
});

// ?spawn=h,m fixes the corners (0 bottom-left, then clockwise) instead of drawing them.
function spawnSlots() {
  const [human, machine] = (params.get('spawn') || '').split(',').map(Number);
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < game.map.spawns.length;
  return valid(human) && valid(machine) && human !== machine ? { human, machine } : null;
}

function begin(spectate) {
  if (started) return;
  game.start(difficulty, spectate, spawnSlots());
  input = new Input(game, camera, renderer, sun);
  ui = new UI(game, input, camera);
  if (!spectate) game.emit('toast', { text: 'Se desconoce la posición enemiga: explora las otras esquinas', kind: 'warn' });
  window.__input = input; window.__ui = ui;
  const hq = game.teamBuildings(spectate ? 'human' : game.player, 'hq')[0];
  input.centerOn(hq.x, hq.z - (spectate ? 0 : 8));
  input.dist = spectate ? 120 : 62;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('app').classList.add('playing');
  resize();
  ui.resize();
  game.audio.init();
  game.audio.play('start');
  if (!spectate) game.audio.say('Comandante, la base está operativa. Destruye a las máquinas.', 0);
  started = true;
}

document.getElementById('btn-start').onclick = () => begin(false);
document.getElementById('btn-spectate').onclick = () => begin(true);

if (params.has('autostart')) {
  difficulty = DIFFICULTY[params.get('autostart')] ? params.get('autostart') : 'normal';
  begin(params.has('spectate'));
}
speed = Math.max(1, Math.min(20, parseInt(params.get('speed') || '1', 10)));

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (started) {
    for (let i = 0; i < speed; i++) game.update(dt);
    input.update(dt);
    ui.update(dt);
  } else {
    // cámara de demostración sobre el mapa
    const t = now / 1000 * 0.05;
    camera.position.set(SIZE / 2 + Math.cos(t) * 90, 70, SIZE / 2 + Math.sin(t) * 90);
    camera.lookAt(SIZE / 2, 0, SIZE / 2);
    sun.position.set(SIZE / 2 + 45, 90, SIZE / 2 + 30);
    sun.target.position.set(SIZE / 2, 0, SIZE / 2);
    game.fx.update(dt);
  }
  warFog.render(renderer, scene, camera);
}
requestAnimationFrame(frame);

// Utilidad de pruebas: avanza la simulación y renderiza aunque la pestaña esté oculta.
window.__step = (n = 1, dt = 0.05) => {
  for (let i = 0; i < n; i++) { game.update(dt); if (input) { input.update(dt); ui.update(dt); } }
  warFog.render(renderer, scene, camera);
};
