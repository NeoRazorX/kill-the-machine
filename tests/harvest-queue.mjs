import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { Building } = await import('../src/buildings.js');
const { Unit } = await import('../src/units.js');
const { preloadModels } = await import('../src/assets.js');
const { ROLE, N, SIZE } = await import('../src/config.js');
const assert = (ok, text) => { if (!ok) throw new Error(text); console.log(`PASS ${text}`); };
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async url => new Response(await readFile(url));
  await preloadModels();
} finally { globalThis.fetch = originalFetch; }

const team = 'human', CAP = ROLE[team].harv.capacity;

function fixture() {
  const grid = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) grid[i] = grid[(N - 1) * N + i] = grid[i * N] = grid[i * N + N - 1] = 1;
  const game = Object.assign(Object.create(Game.prototype), {
    player: team, spectate: false, over: false, time: 0, units: [], buildings: [], navVersion: 1,
    scene: new THREE.Scene(),
    // A distant field so emptied harvesters drive away from the dock, as they do in a match.
    map: { grid, fields: [{ x: 124, z: 330, r: 8, amount: 1e6 }] },
    teams: { [team]: { credits: 0, income: 1, stats: { earned: 0 } } },
    buckets: Array.from({ length: (SIZE / 8) ** 2 }, () => []), _q: [],
    fx: { spawn() {} },
  });
  const refinery = (cx, cz) => {
    const b = new Building(game, ROLE[team].refinery, team, cx, cz, true);
    game.buildings.push(b); game.setCells(b, 2); game.navVersion++;
    return b;
  };
  const harvester = (x, z) => {
    const u = new Unit(game, ROLE[team].harv, x, z, team);
    u.load = CAP; u.hstate = 'return';
    game.units.push(u);
    return u;
  };
  // Like the game loop: refresh the spatial hash, then step every live unit.
  const step = (dt = 1 / 30) => {
    game.time += dt; game.rebuildHash();
    for (const u of game.units) if (!u.dead) u.update(dt);
  };
  return { game, refinery, harvester, step };
}

// Watches a run: who is unloading where, whether two share a dock, whether the unloader gets shoved.
function watch(refineries, units) {
  const s = { maxUnloading: 0, maxOnDock: 0, shoved: 0, done: new Map(), unloadPos: new Map() };
  s.sample = (time) => {
    for (const r of refineries) {
      const unloading = units.filter(u => !u.dead && u.hstate === 'unload' && u.refinery === r);
      s.maxUnloading = Math.max(s.maxUnloading, unloading.length);
      const onDock = units.filter(u => !u.dead && Math.hypot(u.x - r.dock.x, u.z - r.dock.z) < u.radius);
      s.maxOnDock = Math.max(s.maxOnDock, onDock.length);
    }
    for (const u of units) {
      if (u.dead) continue;
      if (u.hstate === 'unload') {
        const p = s.unloadPos.get(u);
        if (!p) s.unloadPos.set(u, { x: u.x, z: u.z });
        else s.shoved = Math.max(s.shoved, Math.hypot(u.x - p.x, u.z - p.z));
      } else s.unloadPos.delete(u);
      if (!s.done.has(u) && u.load === 0) s.done.set(u, { time, refinery: u.lastRefinery });
    }
  };
  return s;
}
// Remembers the refinery each harvester last delivered to, for the sharing check.
const remember = (units) => { for (const u of units) if (u.hstate === 'unload' && u.refinery) u.lastRefinery = u.refinery; };

// --- Four loaded harvesters converge on a single refinery.
{
  const { game, refinery, harvester, step } = fixture();
  const r = refinery(60, 60);
  const units = [harvester(112, 166), harvester(120, 170), harvester(130, 168), harvester(138, 164)];
  const w = watch([r], units);
  let t = 0;
  while (t < 90 && w.done.size < units.length) { step(); t += 1 / 30; remember(units); w.sample(t); }
  assert(w.done.size === units.length, `all four harvesters unloaded (${w.done.size}/4 after ${t.toFixed(1)}s)`);
  assert(Math.abs(game.teams[team].credits - 4 * CAP) < 1, 'every load was credited');
  assert(w.maxUnloading === 1, `only one harvester unloads at the dock at a time (max ${w.maxUnloading})`);
  assert(w.maxOnDock === 1, `harvesters never overlap on the dock (max ${w.maxOnDock})`);
  assert(w.shoved < 0.25, `the unloading harvester is not shoved off the dock (${w.shoved.toFixed(2)})`);
  assert(t < 45, `the queue clears in reasonable time (${t.toFixed(1)}s)`);
  const order = [...w.done.values()].map(d => d.time).sort((a, b) => a - b);
  assert(order.every((v, i) => i === 0 || v - order[i - 1] > 1.5), 'they unload one after another, by turns');
}

// --- A second refinery close by takes part of the traffic.
{
  const { refinery, harvester, step } = fixture();
  const a = refinery(56, 60), b = refinery(66, 60);
  const units = [harvester(108, 166), harvester(116, 170), harvester(124, 170), harvester(132, 166)];
  const w = watch([a, b], units);
  let t = 0;
  while (t < 90 && w.done.size < units.length) { step(); t += 1 / 30; remember(units); w.sample(t); }
  const used = new Set([...w.done.values()].map(d => d.refinery));
  assert(w.done.size === 4 && used.size === 2, 'harvesters split between two nearby refineries');
  assert(w.maxUnloading === 1 && w.maxOnDock === 1, 'each dock still serves one harvester at a time');
}

// --- A far refinery is not worth the trip: they queue at the near one.
{
  const { refinery, harvester, step } = fixture();
  const near = refinery(60, 60); refinery(20, 150);
  const units = [harvester(116, 166), harvester(130, 166)];
  const w = watch([near], units);
  let t = 0;
  while (t < 60 && w.done.size < units.length) { step(); t += 1 / 30; remember(units); w.sample(t); }
  assert([...w.done.values()].every(d => d.refinery === near), 'a much farther refinery is not used to skip a short queue');
}

// --- Nothing stays stuck: dead dock user, destroyed or sold refinery, player orders.
{
  const { refinery, harvester, step } = fixture();
  const a = refinery(60, 60);
  const units = [harvester(112, 166), harvester(120, 170), harvester(130, 168)];
  const run = (secs, until = () => false) => { for (let t = 0; t < secs && !until(); t += 1 / 30) step(); };
  run(40, () => units.some(u => u.hstate === 'unload'));
  const first = units.find(u => u.hstate === 'unload');
  assert(!!first && units.some(u => u !== first && u.hstate === 'queued'), 'others wait in the queue while one unloads');
  first.dead = true;
  run(20, () => units.some(u => !u.dead && u.hstate === 'unload'));
  const second = units.find(u => !u.dead && u.hstate === 'unload');
  assert(!!second, 'the next one takes the dock when the unloading harvester dies');
  const waiting = units.find(u => !u.dead && u !== second);
  waiting.cmdMove(100, 180);
  run(30, () => waiting.order.type === 'idle');
  assert(waiting.order.type === 'idle' && Math.hypot(waiting.x - 100, waiting.z - 180) < 2,
    'a manual move order takes a harvester out of the queue');
  waiting.cmdHarvest(null);
  // The refinery is sold while one harvester unloads and another drives back to it.
  refinery(30, 60);
  a.sell();
  run(60, () => units.every(u => u.dead || u.load === 0));
  assert(units.every(u => u.dead || u.load === 0), 'harvesters re-route to another refinery when theirs is sold');
}
{
  const { game, refinery, harvester, step } = fixture();
  game.foundations = null; game.recomputePower = () => {}; game.checkVictory = () => {};
  const a = refinery(60, 60);
  const units = [harvester(112, 166), harvester(120, 170)];
  for (let t = 0; t < 40 && !units.some(u => u.hstate === 'queued'); t += 1 / 30) step();
  game.removeBuilding(a, 'destroyed');
  for (let t = 0; t < 5; t += 1 / 30) step();
  assert(units.every(u => u.hstate === 'noref' || u.hstate === 'return'), 'with no refinery left they stop and wait instead of queuing');
  refinery(30, 60);
  for (let t = 0; t < 60 && !units.every(u => u.load === 0); t += 1 / 30) step();
  assert(units.every(u => u.load === 0), 'a new refinery is used as soon as it exists');
}
console.log('ALL PASSED');
