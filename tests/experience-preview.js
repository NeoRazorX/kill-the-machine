import * as THREE from 'three';
import { checkExperience } from './experience.js';
import { preloadModels } from '../src/assets.js';
import { Unit } from '../src/units.js';
import { UI } from '../src/ui.js';
import { DEFS } from '../src/config.js';
try {
  const results = checkExperience();
  await preloadModels();
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#18272d');
  scene.add(new THREE.HemisphereLight(0xd6e4ff, 0x40483a, 2));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.3); sun.position.set(10, 30, 20); scene.add(sun);
  const game = { scene, player: 'human', spectate: false, time: 0, emit() {}, isVisibleEntity: () => true };
  const units = [0, 3, 8].map((kills, i) => {
    const unit = new Unit(game, DEFS.h_tank, i * 8, 0, 'human');
    unit.hp *= .5; unit.heading = -.25; unit.aim = -.25;
    for (let n = 0; n < kills; n++) unit.recordKill({ kind: 'unit', team: 'machine' });
    unit.syncMesh(0); return unit;
  });
  const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#scene'), antialias: true });
  const camera = new THREE.OrthographicCamera(-12, 12, 3.75, -3.75, .1, 100);
  camera.position.set(8, 14, 21); camera.lookAt(8, 0, 0);
  const overlay = document.querySelector('#overlay'), ctx = overlay.getContext('2d');
  const input = { sel: [units[0]], project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: (v.x * .5 + .5) * overlay.width, y: (-v.y * .5 + .5) * overlay.height, z: v.z };
  }, setSelection(sel) { this.sel = sel; ui.refreshSelPanel(true); } };
  const ui = Object.assign(Object.create(UI.prototype), { game, input, ctx, icons: { h_tank: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } });
  const draw = () => {
    const width = document.querySelector('.view').clientWidth;
    renderer.setSize(width, 300, false); overlay.width = width; overlay.height = 300;
    renderer.render(scene, camera); units.forEach(u => { ui.drawEntity(u, 'bar'); ui.drawRank(u); });
  };
  draw(); ui.refreshSelPanel(true);
  // Check each rank and then promote a selected unit without rebuilding selection.
  input.sel = [units[1]]; ui.refreshSelPanel(true);
  const before = document.querySelector('.sp-experience').textContent;
  if (!before.includes('Veterana') || !before.includes('3/8')) throw new Error('Veteran selection panel');
  input.sel = [units[2]]; ui.refreshSelPanel(true);
  if (!document.querySelector('.sp-experience').textContent.includes('+10 % vida')) throw new Error('Elite selection panel');
  results.push('PASS selection panel displays rank, progress and bonuses');
  const probe = new Unit(game, DEFS.h_tank, 24, 0, 'human');
  input.sel = [probe]; ui.refreshSelPanel(true);
  for (let i = 0; i < 3; i++) probe.recordKill({ kind: 'unit', team: 'machine' });
  ui.refreshSelPanel();
  if (!document.querySelector('.sp-experience').textContent.includes('Veterana')) throw new Error('Selected promotion did not refresh');
  scene.remove(probe.mesh);
  input.sel = units; ui.refreshSelPanel(true);
  if (!document.querySelector('.sp-experience').textContent.includes('1 veteranas · 1 élite')) throw new Error('Group rank summary');
  input.sel = [units[2]]; ui.refreshSelPanel(true);
  results.push('PASS selection refreshes after promotion and summarizes mixed ranks');
  const rankProbe = new Proxy({}, { get() { return () => { throw new Error('Hidden rank badge leaked'); }; } });
  const oldContext = ui.ctx; ui.ctx = rankProbe;
  units[2].mesh.visible = false; ui.drawRank(units[2]); units[2].mesh.visible = true;
  game.isVisibleEntity = () => false; ui.drawRank(units[2]); game.isVisibleEntity = () => true;
  ui.ctx = oldContext;
  results.push('PASS rank badges respect hidden meshes and fog visibility');
  document.querySelectorAll('[data-rank]').forEach(button => { button.onclick = () => input.setSelection([units[Number(button.dataset.rank)]]); });
  window.addEventListener('resize', draw);
  document.querySelector('#results').textContent = results.join('\n') + '\nALL PASSED';
  document.querySelector('#status').textContent = `${results.length} comprobaciones superadas · humanos y máquinas`;
} catch(error) { document.querySelector('#status').textContent = `FAIL ${error.stack}`; }
