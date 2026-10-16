// Builds a full AI base on several maps and corners and checks its layout: walkways between
// buildings, clear refinery docks and producer exits, a way out for vehicles, refineries by the ore
// and turrets on the side facing the enemy.
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { GameMap, mulberry32 } = await import('../src/map.js');
const { AI, apron } = await import('../src/ai.js');
const { preloadModels } = await import('../src/assets.js');
const { N, CELL, SIZE, ROLE, DIFFICULTY, START_CREDITS, other } = await import('../src/config.js');
const { canOccupy } = await import('../src/pathfinding.js');

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async url => new Response(await readFile(url));
  await preloadModels();
} finally {
  globalThis.fetch = originalFetch;
}

const results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); results.push(`PASS ${text}`); };
const noop = () => {};
const HARV = ROLE.human.harv.radius; // the widest vehicle that has to get around the base

function fixture(seed, team, slot) {
  const newTeam = () => ({
    credits: START_CREDITS, income: 1, structQueue: null, power: { prod: 0, use: 0 },
    stats: { killed: 0, lost: 0, built: 0, earned: 0 }, lastAttacked: null,
  });
  const game = Object.assign(Object.create(Game.prototype), {
    player: 'human', spectate: true, time: 0, navVersion: 1, over: null, paused: false,
    map: new GameMap(seed), scene: new THREE.Scene(), units: [], buildings: [],
    teams: { human: newTeam(), machine: newTeam() },
    buckets: Array.from({ length: (SIZE / 8) ** 2 }, () => []), _q: [],
    fx: { update: noop, spawn: noop, marker: noop, repairBeam: noop, fireWeapon: noop },
    audio: { play: noop, say: noop }, visuals: { updateOre: noop },
    cashCrates: { items: [], update: noop, discover: noop, discoveredBy: () => [] }, updateFog: noop, fogT: 0, oreT: 0,
    techSites: { items: [], update: noop, discover: noop, foundBy: () => [] },
  });
  const slots = { [team]: slot, [other(team)]: (slot + 2) % 4 };
  game.assignStarts(slots);
  for (const side of [team, other(team)]) game.setupBase(side);
  const ai = new AI(game, team, DIFFICULTY.normal);
  game.ais = [ai];
  return { game, ai };
}

// Lets the AI order and place everything it wants, with money to spare and instant construction.
function buildOut(game, ai) {
  const T = game.teams[ai.team], initial = new Set(game.buildings);
  // Late enough in the match for every refinery the difficulty allows.
  ai.waveNo = 5; game.time = 600;
  let idle = 0;
  for (let i = 0; i < 300 && idle < 3; i++) {
    T.credits = 100000;
    ai.manageStructures();
    const q = T.structQueue;
    if (!q) { idle++; continue; }
    idle = 0;
    q.ready = true; q.progress = 1;
    for (let k = 0; k < 10 && T.structQueue; k++) ai.manageStructures();
    for (const b of game.buildings) if (b.buildT < 1) { b.buildT = 1; b.announced = true; game.onBuildingComplete(b); }
  }
  return game.teamBuildings(ai.team).filter(b => !initial.has(b));
}

const exitPoint = b => ({ x: b.def.role === 'refinery' ? b.dock.x : b.spawnPt.x, z: (apron(b).cz + apron(b).h / 2) * CELL });
const gapCells = (a, b) => Math.max(0, b.cx - (a.cx + a.w), a.cx - (b.cx + b.w), b.cz - (a.cz + a.h), a.cz - (b.cz + b.h));

// Breadth-first search, on a lattice of half cells, over the spots a harvester fits in, from a point
// until it leaves the base. Half cells let it through any walkway two cells wide.
function reachesOutside(game, from, centre, radius) {
  const grid = game.map.grid, M = 2 * N, H = CELL / 2, seen = new Uint8Array(M * M);
  const fits = (i, k) => canOccupy(grid, i * H, k * H, HARV);
  let best = null, bd = 1e9;
  const fi = Math.round(from.x / H), fk = Math.round(from.z / H);
  for (let dk = -3; dk <= 3; dk++) for (let di = -3; di <= 3; di++) {
    if (fits(fi + di, fk + dk) && Math.hypot(di, dk) < bd) { bd = Math.hypot(di, dk); best = [fi + di, fk + dk]; }
  }
  if (!best) return false;
  const queue = [best];
  seen[best[1] * M + best[0]] = 1;
  for (let q = 0; q < queue.length; q++) {
    const [i, k] = queue[q];
    if (Math.hypot(i * H - centre.x, k * H - centre.z) > radius) return true;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = i + di, z = k + dk;
      if (x < 1 || z < 1 || x >= M - 1 || z >= M - 1 || seen[z * M + x]) continue;
      seen[z * M + x] = 1;
      if (fits(x, z)) queue.push([x, z]);
    }
  }
  return false;
}

// ASCII plan of a base, printed when a check fails: letters are buildings, # terrain, ~ ore, . exits.
function plan(game, centre, radius) {
  const cr = Math.ceil(radius / CELL), hx = Math.floor(centre.x / CELL), hz = Math.floor(centre.z / CELL), rows = [];
  const at = new Map();
  for (const b of game.buildings) if (!b.dead) {
    const a = apron(b);
    if (a) for (let z = a.cz; z < a.cz + a.h; z++) for (let x = a.cx; x < a.cx + a.w; x++) at.set(z * N + x, '.');
  }
  for (const b of game.buildings) if (!b.dead) for (let z = b.cz; z < b.cz + b.h; z++) for (let x = b.cx; x < b.cx + b.w; x++) {
    at.set(z * N + x, { hq: 'H', power: 'P', refinery: 'R', barracks: 'B', factory: 'F', turret: 'T' }[b.def.role] || 'X');
  }
  for (let z = Math.max(0, hz - cr); z < Math.min(N, hz + cr); z++) {
    let row = '';
    for (let x = Math.max(0, hx - cr); x < Math.min(N, hx + cr); x++) {
      const ore = game.map.fields.some(f => Math.hypot((x + 0.5) * CELL - f.x, (z + 0.5) * CELL - f.z) < f.r);
      row += at.get(z * N + x) || (game.map.grid[z * N + x] ? '#' : ore ? '~' : ' ');
    }
    rows.push(row);
  }
  return rows.join('\n');
}

const originalRandom = Math.random;
let wide = 0, placed = 0;
try {
  const cases = [];
  for (const seed of [20260, 777, 91011]) for (let slot = 0; slot < 4; slot++) cases.push([seed, slot, (seed + slot) % 2 ? 'machine' : 'human']);
  for (const [seed, slot, team] of cases) {
    Math.random = mulberry32(seed * 7 + slot);
    const { game, ai } = fixture(seed, team, slot);
    const tag = `map ${seed}, corner ${slot}, ${team}`;
    const added = buildOut(game, ai);
    const own = game.teamBuildings(team), count = r => own.filter(b => b.def.role === r).length;
    const { prod, use } = game.teams[team].power;
    assert(count('refinery') >= 2 && count('factory') >= 2 && count('barracks') >= 2 && count('turret') >= 8 && prod >= use,
      `${tag}: the AI builds its whole base (${own.length} buildings)`);

    // Walkways: never touching, and normally wide enough for a harvester or a tank.
    for (const b of added) {
      const gap = Math.min(...game.buildings.filter(o => o !== b && !o.dead).map(o => gapCells(b, o)));
      if (gap < 1) throw new Error(`${tag}: ${b.def.role} at ${b.cx},${b.cz} touches another building`);
      placed++; if (gap >= 2) wide++;
    }
    assert(true, `${tag}: every new building keeps at least one free cell around it`);

    // Exits and docks stay clear of buildings and let a harvester stand there.
    for (const b of own) {
      const a = apron(b);
      if (!a) continue;
      for (let z = a.cz; z < a.cz + a.h; z++) for (let x = a.cx; x < a.cx + a.w; x++) {
        if (game.map.grid[z * N + x] === 2) throw new Error(`${tag}: a building covers the exit of the ${b.def.role} at ${b.cx},${b.cz}`);
      }
      // The dock and spawn point hug the wall; a harvester must fit just ahead of them.
      const p = exitPoint(b);
      if (!canOccupy(game.map.grid, p.x, p.z, HARV)) throw new Error(`${tag}: ${b.def.role} exit at ${p.x},${p.z} is blocked`);
    }
    assert(true, `${tag}: refinery docks and barracks and factory exits stay clear`);

    // A vehicle leaving any factory or refinery can drive out of the base.
    const hq = own.find(b => b.def.role === 'hq');
    const radius = Math.max(...own.map(b => Math.hypot(b.x - hq.x, b.z - hq.z) + b.radius)) + 4;
    for (const b of own.filter(b => b.def.role === 'factory' || b.def.role === 'refinery')) {
      if (!reachesOutside(game, exitPoint(b), hq, radius)) {
        console.log(plan(game, hq, radius + 8));
        throw new Error(`${tag}: no way out of the base from the ${b.def.role} at ${b.cx},${b.cz}`);
      }
    }
    assert(true, `${tag}: vehicles from the factories and refineries can leave the base`);

    // AI refineries dock next to the ore they were built for.
    for (const r of added.filter(b => b.def.role === 'refinery')) {
      const edge = Math.min(...game.map.fields.map(f => Math.hypot(f.x - r.dock.x, f.z - r.dock.z) - f.r));
      assert(edge < 24, `${tag}: refinery at ${r.cx},${r.cz} docks ${edge.toFixed(1)} from the ore`);
    }

    // Turrets stand on the side facing the enemy, ahead of the rest of the base.
    const e = ai.enemyBase || { x: SIZE / 2, z: SIZE / 2 };
    const el = Math.hypot(e.x - hq.x, e.z - hq.z), along = b => ((b.x - hq.x) * (e.x - hq.x) + (b.z - hq.z) * (e.z - hq.z)) / el;
    const mean = l => l.reduce((a, b) => a + along(b), 0) / l.length;
    const turrets = own.filter(b => b.def.role === 'turret'), rest = own.filter(b => b.def.role !== 'turret');
    assert(mean(turrets) > mean(rest) + 6, `${tag}: turrets face the enemy (${mean(turrets).toFixed(1)} vs ${mean(rest).toFixed(1)} ahead of the HQ)`);
    assert(turrets.filter(t => along(t) > 0).length >= turrets.length * 0.75, `${tag}: most turrets are in front of the HQ`);
  }
  // Cramped corner: rocks all around the base. The AI narrows its walkways instead of giving up.
  Math.random = mulberry32(5);
  const { game, ai } = fixture(20260, 'human', 0);
  const hq = game.teamBuildings('human', 'hq')[0], hcx = hq.x / CELL, hcz = hq.z / CELL;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (Math.hypot(x + 0.5 - hcx, z + 0.5 - hcz) > 11 && !game.map.grid[z * N + x]) game.map.grid[z * N + x] = 1;
  }
  let cancels = 0;
  const cancel = game.cancelStruct;
  game.cancelStruct = function (team) { cancels++; return cancel.call(this, team); };
  const added = buildOut(game, ai), count = r => added.filter(b => b.def.role === r).length;
  const gaps = added.map(b => Math.min(...game.buildings.filter(o => o !== b && !o.dead).map(o => gapCells(b, o))));
  if (process.env.PLAN) console.log(plan(game, hq, 30));
  assert(count('barracks') >= 1 && count('factory') >= 1 && count('power') >= 1 && added.length >= 10,
    `cramped base: the AI still places ${added.length} buildings (${cancels} cancelled)`);
  assert(gaps.every(g => g >= 1) && gaps.some(g => g === 1), `cramped base: walkways narrow to one cell only when room runs out`);
  for (const b of game.teamBuildings('human')) {
    const a = apron(b);
    if (a) for (let z = a.cz; z < a.cz + a.h; z++) for (let x = a.cx; x < a.cx + a.w; x++) {
      if (game.map.grid[z * N + x] === 2) throw new Error(`cramped base: a building covers the exit of the ${b.def.role}`);
    }
  }
  assert(true, 'cramped base: exits stay clear');
  assert(wide >= placed * 0.85, `walkways at least two cells wide for ${wide} of ${placed} new buildings`);
} finally {
  Math.random = originalRandom;
}
console.log(results.join('\n'));
console.log('ALL PASSED');
