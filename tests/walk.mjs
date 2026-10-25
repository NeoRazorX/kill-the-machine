// The Juggernaut keeps its planted foot in place: its walk cycle follows the ground covered, and its
// footprints land under its feet.
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { Unit } = await import('../src/units.js');
const { FX } = await import('../src/fx.js');
const { preloadModels } = await import('../src/assets.js');
const { DEFS, N, FORD_SPEED } = await import('../src/config.js');

const assert = (ok, text) => { if (!ok) throw new Error(text); console.log(`PASS ${text}`); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(await readFile(url));
await preloadModels();
globalThis.fetch = originalFetch;

// A planted foot may drift at most this share of the distance walked meanwhile.
const SLIP = 0.12;

function fixture() {
  const scene = new THREE.Scene();
  const game = Object.assign(Object.create(Game.prototype), {
    scene, time: 0, spectate: true, player: 'human', navVersion: 1, theme: { id: 'temperate' },
    map: { grid: new Uint8Array(N * N), hasWater: false }, units: [], buildings: [],
    queryUnits() { return this.units; }, findTarget() { return null; },
  });
  game.fx = new FX(game, scene);
  return game;
}

// Walks the unit east for `secs`, calling `frame` after each step.
function walk(game, u, secs, frame = () => {}, dt = 1 / 60) {
  for (let t = 0; t < secs; t += dt) { game.time += dt; u.update(dt); frame(); }
}

const foot = new THREE.Vector3();
const footOf = (u, leg) => { u.mesh.updateMatrixWorld(true); return leg.localToWorld(foot.set(0, -u.parts.hip, 0)).clone(); };

for (const id of ['h_juggernaut', 'm_juggernaut']) {
  const game = fixture(), def = DEFS[id];
  const u = new Unit(game, def, 40, 60, def.team);
  u.heading = Math.PI / 2; game.units.push(u); u.cmdMove(160, 60);
  walk(game, u, 2);   // up to speed and into the stride
  const legs = u.parts.legs;
  let slip = 0, walked = 0, x0 = u.x;
  // A leg stands for the first half of its cycle (see Unit.stomp); a margin keeps off the landing and lifting.
  const last = legs.map((l) => footOf(u, l)), phase = () => legs.map((_, i) => { const c = ((u.anim / (2 * Math.PI) + i / 2) % 1 + 1) % 1; return c > 0.03 && c < 0.47; });
  let stance = phase();
  walk(game, u, 2, () => {
    const now = legs.map((l) => footOf(u, l)), next = phase();
    // While a leg sweeps back, its foot is the one on the ground.
    legs.forEach((_, i) => { if (stance[i] && next[i]) slip += Math.hypot(now[i].x - last[i].x, now[i].z - last[i].z); });
    now.forEach((p, i) => last[i].copy(p)); stance = next;
  });
  walked = u.x - x0;
  // Each leg stands for half the time, so between them they cover the whole walk.
  const share = slip / walked;
  assert(walked > def.speed * 1.5 && share < SLIP, `${id}: the planted foot slides ${(share * 100).toFixed(0)} % of the distance walked`);
}

{
  // Footprints land under the foot that comes down, alternating sides, a step apart.
  const game = fixture(), def = DEFS.h_juggernaut;
  const u = new Unit(game, def, 40, 60, def.team);
  u.heading = Math.PI / 2; game.units.push(u); u.cmdMove(160, 60);
  const marks = game.fx.trackMarks, at = (i) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(marks.mesh.instanceMatrix.array, i * 16));
  walk(game, u, 2);
  const start = marks.count, prints = [];
  walk(game, u, 3, () => {
    while (prints.length < marks.count - start) {
      const p = at(start + prints.length);
      // The foot nearest the new print, a moment after it lands.
      const d = Math.min(...u.parts.legs.map((l) => { const f = footOf(u, l); return Math.hypot(f.x - p.x, f.z - p.z); }));
      prints.push({ p, d });
    }
  });
  const gaps = prints.slice(1).map((q, i) => q.p.x - prints[i].p.x), step = 2 * u.parts.hip * Math.sin(0.5);
  assert(prints.length >= 3 && prints.every((q) => q.d < 0.5), `juggernaut: each footprint lies under the foot that made it (${prints.length} prints)`);
  assert(prints.every((q, i) => !i || Math.sign(q.p.z - 60) === -Math.sign(prints[i - 1].p.z - 60)), 'juggernaut: footprints alternate left and right');
  assert(gaps.every((g) => Math.abs(g - step) < 0.6), `juggernaut: footprints are a step (${step.toFixed(1)}) apart`);
}

{
  // Slowed down (a ford), the legs slow down with it.
  const game = fixture(), def = DEFS.h_juggernaut;
  const u = new Unit(game, def, 40, 60, def.team);
  u.heading = Math.PI / 2; game.units.push(u); u.cmdMove(160, 60);
  walk(game, u, 2);
  const a0 = u.anim, x0 = u.x;
  walk(game, u, 1);
  const rate = (u.anim - a0) / (u.x - x0);
  u.speedMul = FORD_SPEED;
  const a1 = u.anim, x1 = u.x;
  walk(game, u, 1);
  assert(Math.abs((u.anim - a1) / (u.x - x1) - rate) < 0.05 * rate && u.x - x1 < (x1 - x0) * 0.9, 'juggernaut: wading slower, it takes the same steps more slowly');
}
console.log('ALL PASSED');
