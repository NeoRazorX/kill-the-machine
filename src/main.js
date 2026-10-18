import * as THREE from 'three';
import { Game } from './game.js';
import { Input } from './input.js';
import { UI, makeIcons } from './ui.js';
import { SIZE, TEAMS, ROLE, PLAYER, DIFFICULTY, DEFS, TECH_IDS } from './config.js';
import { preloadModels, assetStatus } from './assets.js';
import { WarFog } from './war-fog.js';
import { THEMES, resolveTheme } from './themes.js';
import { LAYOUTS, resolveLayout } from './map.js';
import { techSelection, TECH_PICK_MAX } from './tech-sites.js';
import { GameMenu } from './game-menu.js';

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

const hemi = new THREE.HemisphereLight(0xd6e4ff, 0x40483a, 1.25);
scene.add(hemi);
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

// ?map=temperate|desert|ice|random chooses the look; ?seed=n repeats a scenery layout.
const themeEls = [...document.querySelectorAll('.theme')];
let themeChoice = THEMES[params.get('map')] ? params.get('map') : 'random';
const seedParam = parseInt(params.get('seed'), 10);
const seed = Number.isFinite(seedParam) ? seedParam : 20260 + Math.floor(Math.random() * 100000);
// Mapa (trazado): se recuerda entre partidas; ?layout=quarry|river|random lo fija solo para esa visita.
const LAYOUT_KEY = 'ktm.layout';
let layoutChoice = 'quarry';
try { const saved = localStorage.getItem(LAYOUT_KEY); if (LAYOUTS[saved] || saved === 'random') layoutChoice = saved; } catch { /* sin almacenamiento */ }
if (LAYOUTS[params.get('layout')] || params.get('layout') === 'random') layoutChoice = params.get('layout');
const game = new Game(scene, seed, resolveTheme(themeChoice), resolveLayout(layoutChoice));
window.__game = game;
const warFog = new WarFog(game);

function applyTheme(theme) {
  game.setTheme(theme);
  scene.background.setHex(theme.sky); scene.fog.color.setHex(theme.sky);
  hemi.color.setHex(theme.hemi[0]); hemi.groundColor.setHex(theme.hemi[1]); hemi.intensity = theme.hemi[2];
  sun.color.setHex(theme.sun[0]); sun.intensity = theme.sun[1];
}
function chooseTheme(choice) {
  themeChoice = choice;
  themeEls.forEach((e) => e.classList.toggle('active', e.dataset.map === choice));
  // Random draws a different theme from the one on screen, so the click always shows a change.
  const others = Object.values(THEMES).filter((t) => t !== game.theme);
  applyTheme(THEMES[choice] || others[Math.floor(Math.random() * others.length)]);
}
themeEls.forEach((el) => { el.onclick = () => chooseTheme(el.dataset.map); });
themeEls.forEach((e) => e.classList.toggle('active', e.dataset.map === themeChoice));
applyTheme(game.theme);

const layoutEls = [...document.querySelectorAll('.layout[data-layout]')];
function showLayout() {
  for (const el of layoutEls) { const on = el.dataset.layout === layoutChoice; el.classList.toggle('active', on); el.setAttribute('aria-pressed', on); }
}
function chooseLayout(choice) {
  layoutChoice = choice;
  try { localStorage.setItem(LAYOUT_KEY, choice); } catch { /* no se recuerda */ }
  // Random draws a different layout from the one on screen, so the click always shows a change.
  const others = Object.values(LAYOUTS).filter((l) => l !== game.map.layout);
  game.setLayout(LAYOUTS[choice] || others[Math.floor(Math.random() * others.length)]);
  showLayout();
}
layoutEls.forEach((el) => { el.onclick = () => chooseLayout(el.dataset.layout); });
showLayout();

// ?tech=random|none|t_silo,t_mine,… places random or chosen tech structures. The menu choice is
// remembered between matches; the address only overrides it for this visit.
const TECH_KEY = 'ktm.tech';
const techModeEls = [...document.querySelectorAll('.tech-mode')];
const techPick = document.getElementById('tech-pick'), techList = document.getElementById('tech-list'), techCount = document.getElementById('tech-count');
const tech = { mode: 'random', ids: [] };
try {
  const saved = JSON.parse(localStorage.getItem(TECH_KEY));
  if (saved && Array.isArray(saved.ids)) Object.assign(tech, { mode: saved.mode === 'pick' ? 'pick' : 'random', ids: techSelection(saved.ids) });
} catch { /* sin almacenamiento: valores por defecto */ }
{
  const p = params.get('tech'), ids = p ? techSelection(p.split(',')) : [];
  if (p === 'random') tech.mode = 'random';
  else if (p === 'none') Object.assign(tech, { mode: 'pick', ids: [] });
  else if (ids.length) Object.assign(tech, { mode: 'pick', ids });
}
const saveTech = () => { try { localStorage.setItem(TECH_KEY, JSON.stringify(tech)); } catch { /* no se recuerda */ } };
const techOpts = TECH_IDS.map((id) => {
  const el = document.createElement('button'), def = DEFS[id];
  el.className = 'tech-opt'; el.dataset.id = id; el.title = def.desc;
  el.innerHTML = `<img alt=""><span><b>${def.name}</b><small>${def.brief}</small></span>`;
  el.onclick = () => {
    tech.ids = el.classList.contains('active') ? tech.ids.filter((t) => t !== id) : techSelection([...tech.ids, id]);
    saveTech(); showTech();
  };
  techList.append(el);
  return el;
});
function showTech() {
  techModeEls.forEach((e) => e.classList.toggle('active', e.dataset.mode === tech.mode));
  techPick.hidden = tech.mode !== 'pick';
  const full = tech.ids.length >= TECH_PICK_MAX;
  for (const el of techOpts) {
    const on = tech.ids.includes(el.dataset.id);
    el.classList.toggle('active', on); el.setAttribute('aria-pressed', on);
    el.disabled = full && !on;
  }
  const n = tech.ids.length;
  techCount.textContent = n ? `${n} de ${TECH_PICK_MAX} como máximo` : `Ninguna marcada: partida sin estructuras (máximo ${TECH_PICK_MAX})`;
}
techModeEls.forEach((el) => { el.onclick = () => { tech.mode = el.dataset.mode; saveTech(); showTech(); }; });
showTech();
try {
  const icons = makeIcons(TECH_IDS.map((id) => DEFS[id]));
  for (const el of techOpts) el.querySelector('img').src = icons[el.dataset.id];
} catch { /* solo nombres si no hay WebGL */ }

const techNews = (n, team) => {
  const who = `un ${ROLE[team].engineer.name.toLowerCase()}`;
  return n === 1 ? `Hay una estructura tecnológica en ruinas: encuéntrala y captúrala con ${who}`
    : `Hay ${['dos', 'tres', 'cuatro', 'cinco', 'seis'][n - 2] ?? n} estructuras tecnológicas en ruinas: encuéntralas y captúralas con ${who}`;
};

// Bando del jugador: se recuerda entre partidas; ?side=human|machine lo fija solo para esa visita.
const SIDE_KEY = 'ktm.side';
let side = PLAYER;
try { if (TEAMS[localStorage.getItem(SIDE_KEY)]) side = localStorage.getItem(SIDE_KEY); } catch { /* sin almacenamiento */ }
if (TEAMS[params.get('side')]) side = params.get('side');
const sideEls = [...document.querySelectorAll('.side[data-side]')];
function showSide() {
  for (const el of sideEls) { const on = el.dataset.side === side; el.classList.toggle('active', on); el.setAttribute('aria-pressed', on); }
  document.getElementById('side-tag').textContent = TEAMS[side].tagline;
  document.body.dataset.side = side;   // tiñe menú y HUD con el color del bando
}
sideEls.forEach((el) => {
  el.onclick = () => { side = el.dataset.side; try { localStorage.setItem(SIDE_KEY, side); } catch { /* no se recuerda */ } showSide(); };
});
showSide();

let input = null, ui = null, started = false, speed = 1;
const diffEls = [...document.querySelectorAll('.diff[data-d]')];
// Easy is preselected; ?autostart=easy|normal|hard picks one for an automatic start.
let difficulty = 'easy';
diffEls.forEach((el) => {
  el.onclick = () => { difficulty = el.dataset.d; diffEls.forEach((e) => e.classList.toggle('active', e === el)); };
});

// ?spawn=h,m fixes the corners (0 bottom-left, then clockwise) instead of drawing them. On Río Partido
// they must be on opposite banks.
function spawnSlots() {
  const [human, machine] = (params.get('spawn') || '').split(',').map(Number);
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < game.map.spawns.length;
  return valid(human) && valid(machine) && game.map.rivalSlots(human).includes(machine) ? { human, machine } : null;
}

function begin(spectate) {
  if (started) return;
  game.start(difficulty, spectate, spawnSlots(), tech.mode === 'pick' ? tech.ids : null, side);
  [...themeEls, ...layoutEls, ...techModeEls, ...techOpts, ...sideEls].forEach((el) => { el.onclick = null; });
  document.body.dataset.side = game.player;
  input = new Input(game, camera, renderer, sun);
  ui = new UI(game, input, camera);
  input.menu = new GameMenu(game);
  window.__menu = input.menu;
  game.emit('toast', { text: game.map.name, kind: 'info' });
  if (!spectate) {
    game.emit('toast', { text: 'Se desconoce la posición enemiga: explora las otras esquinas', kind: 'warn' });
    const sites = game.techSites.items.length;
    if (sites) game.emit('toast', { text: techNews(sites, game.player), kind: 'info' });
  }
  window.__input = input; window.__ui = ui;
  const hq = game.teamBuildings(game.player, 'hq')[0];
  input.centerOn(hq.x, hq.z - (spectate ? 0 : 8));
  input.dist = spectate ? 120 : 62;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('app').classList.add('playing');
  resize();
  ui.resize();
  game.audio.init();
  game.audio.play('start');
  game.audio.startMusic();
  if (!spectate) game.audio.say(TEAMS[game.player].greeting, 0);
  started = true;
}

document.getElementById('btn-start').onclick = () => begin(false);
document.getElementById('btn-spectate').onclick = () => begin(true);

if (params.has('autostart')) {
  difficulty = DIFFICULTY[params.get('autostart')] ? params.get('autostart') : difficulty;
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
    if (!game.paused) game.audio.updateMusic(dt * speed);
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
  for (let i = 0; i < n; i++) { game.update(dt); if (input) { input.update(dt); ui.update(dt); game.audio.updateMusic(dt); } }
  warFog.render(renderer, scene, camera);
};
