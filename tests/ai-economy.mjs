// AI economy over several minutes of AI against AI on the real quarry map: harvesters, refineries,
// ore fields worked, cash crates picked up and money earned. `node tests/ai-economy.mjs --report`
// prints the figures without checking them.
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { GameMap, mulberry32 } = await import('../src/map.js');
const { AI } = await import('../src/ai.js');
const { preloadModels } = await import('../src/assets.js');
const { CashCrates } = await import('../src/cash-crates.js');
const { TechSites } = await import('../src/tech-sites.js');
const { Superweapons } = await import('../src/superweapons.js');
const { N, SIZE, DIFFICULTY, START_CREDITS } = await import('../src/config.js');

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async url => new Response(await readFile(url));
  await preloadModels();
} finally { globalThis.fetch = originalFetch; }

const REPORT = process.argv.includes('--report');
const MINUTES = 9, DT = 0.1;
const noop = () => {};

// A match like Game.start in spectator mode: the machine plays at the given difficulty, the humans at
// Normal, as the spectator button does.
function match(seed, difficulty) {
  const newTeam = () => ({
    credits: START_CREDITS, income: 1, structQueue: null, power: { prod: 0, use: 0 },
    stats: { killed: 0, lost: 0, built: 0, earned: 0 }, lastAttacked: null, lowPowerFlag: false,
  });
  const game = Object.assign(Object.create(Game.prototype), {
    player: 'human', spectate: true, time: 0, navVersion: 1, over: null, paused: false,
    map: new GameMap(seed), scene: new THREE.Scene(), units: [], buildings: [],
    teams: { human: newTeam(), machine: newTeam() },
    buckets: Array.from({ length: (SIZE / 8) ** 2 }, () => []), _q: [],
    fx: { update: noop, spawn: noop, marker: noop, repairBeam: noop, fireWeapon: noop, bigExplosion: noop, explosion: noop,
      scorch: noop, smoke: noop, flash: noop, beam: noop, hitSpark: noop, delayed: [] },
    audio: { play: noop, say: noop }, visuals: { updateOre: noop }, emit: noop,
    updateFog: noop, fogT: 0, oreT: 0, lastAlert: -99, fog: new Uint8Array(N * N).fill(2), ais: [],
  });
  game.cashCrates = new CashCrates(game, seed * 7 + 1);
  game.techSites = new TechSites(game, seed * 3 + 1);
  game.superweapons = new Superweapons(game);
  game.difficulty = DIFFICULTY[difficulty];
  game.teams.machine.income = game.difficulty.income;
  game.assignStarts({ human: seed % 4, machine: (seed + 2) % 4 });
  game.techSites.place();
  for (const team of ['human', 'machine']) game.setupBase(team);
  game.ais.push(new AI(game, 'machine', game.difficulty), new AI(game, 'human', DIFFICULTY.normal));
  game.recomputePower();
  game.cashCrates.discover();
  return game;
}

function measure(seed, difficulty, team = 'machine') {
  Math.random = mulberry32(seed * 977 + 13);
  const game = match(seed, difficulty), T = game.teams[team];
  const seen = new Map();
  const m = { seed, harvesters: 0, refineries: 0, fields: new Set(), crates: [], firstCrate: null, earned5: 0, earned: 0, crateCash: 0, broke: 0 };
  const claim = game.cashCrates.claim;
  game.cashCrates.claim = function (c, unit) {
    if (!c.collected) { c.collectedBy = unit.team; c.collectedAt = game.time; }
    if (!c.collected && unit.team === team) { m.crates.push(game.time); m.crateCash += c.amount; }
    return claim.call(this, c, unit);
  };
  for (let i = 0; i < MINUTES * 60 / DT && !game.over; i++) {
    game.update(DT);
    if (i % 10) continue;
    for (const c of game.cashCrates.items) if (c.found[team] && !seen.has(c)) seen.set(c, game.time);
    const harv = game.units.filter((u) => u.team === team && !u.dead && u.def.harvester);
    m.harvesters = Math.max(m.harvesters, harv.length);
    m.refineries = Math.max(m.refineries, game.teamBuildings(team, 'refinery').filter((b) => b.complete).length);
    for (const u of harv) if (u.hstate === 'gather' && u.field) m.fields.add(u.field.id);
    if (game.time > 60 && T.credits < 100) m.broke++;
    if (game.time <= 300) m.earned5 = T.stats.earned;
  }
  m.earned = T.stats.earned;
  m.firstCrate = m.crates[0] ?? null;
  m.crates5 = m.crates.filter((t) => t <= 300).length;
  m.fields = m.fields.size;
  // Crates this side saw in its first four minutes, and how many of those it picked up by minute five.
  const early = [...seen].filter(([, t]) => t <= 240).map(([c]) => c);
  m.seenEarly = early.length;
  m.fetchedEarly = early.filter((c) => m.crates.length && c.collected && c.collectedBy === team && c.collectedAt <= 300).length;
  m.over = game.over ? `${game.over.winner}@${Math.round(game.over.time)}` : '';
  return m;
}

const SEEDS = [20260, 20261, 20262, 20263];
const DIFFS = process.argv.includes('--easy') ? ['easy', 'normal', 'hard'] : ['normal', 'hard'];
const originalRandom = Math.random;
const runs = {};
try {
  for (const difficulty of DIFFS) runs[difficulty] = SEEDS.map((s) => measure(s, difficulty));
} finally { Math.random = originalRandom; }

const avg = (l, k) => l.reduce((a, m) => a + m[k], 0) / l.length;
for (const [difficulty, list] of Object.entries(runs)) {
  console.log(`\n${difficulty} (machine AI, ${MINUTES} min vs Normal AI)`);
  console.log('seed   harv refs fields crates(<5min) first  seen<4/fetched  earned@5  earned  crateCash  broke(s) over');
  for (const m of list) {
    console.log(`${m.seed}  ${String(m.harvesters).padStart(4)} ${String(m.refineries).padStart(4)} ${String(m.fields).padStart(6)} ${String(m.crates.length).padStart(6)}(${m.crates5})   ${String(m.firstCrate === null ? '-' : Math.round(m.firstCrate)).padStart(5)}  ${String(m.seenEarly).padStart(6)}/${String(m.fetchedEarly).padEnd(7)} ${String(Math.round(m.earned5)).padStart(9)} ${String(Math.round(m.earned)).padStart(7)} ${String(m.crateCash).padStart(10)} ${String(m.broke).padStart(9)} ${m.over}`);
  }
  console.log(`avg    ${avg(list, 'harvesters').toFixed(1)} ${avg(list, 'refineries').toFixed(1)} ${avg(list, 'fields').toFixed(1)}   crates<5 ${avg(list, 'crates5').toFixed(1)}  earned@5 ${Math.round(avg(list, 'earned5'))}  earned ${Math.round(avg(list, 'earned'))}`);
}
if (REPORT) process.exit(0);

// Figures before this economy work (same seeds and length): Normal and Hard both stopped at
// 2 harvesters on 1 refinery working 2 fields, earning on average 11 654 $ (Normal) and 15 443 $ (Hard).
const BEFORE = { normal: { harvesters: 2, refineries: 1, fields: 2, earned: 11654 }, hard: { harvesters: 2, refineries: 1, fields: 2, earned: 15443 } };
const assert = (ok, text) => { if (!ok) throw new Error(text); console.log(`PASS ${text}`); };
console.log('');
for (const m of runs.hard) {
  const tag = `hard/${m.seed}`;
  assert(m.harvesters >= 6, `${tag}: ${m.harvesters} harvesters (was ${BEFORE.hard.harvesters})`);
  assert(m.refineries >= 3, `${tag}: ${m.refineries} refineries (was ${BEFORE.hard.refineries})`);
  assert(m.fields >= 3, `${tag}: works ${m.fields} ore fields (was ${BEFORE.hard.fields})`);
  assert(m.crates5 >= 3 && m.firstCrate < 45, `${tag}: ${m.crates5} crates before minute 5, the first at ${Math.round(m.firstCrate)} s`);
  assert(m.seenEarly > 0 && m.fetchedEarly >= m.seenEarly * 0.6, `${tag}: fetched ${m.fetchedEarly} of the ${m.seenEarly} crates it saw in the first four minutes`);
  assert(m.earned >= BEFORE.hard.earned * 1.8, `${tag}: earned ${Math.round(m.earned)} $ (was ${BEFORE.hard.earned} on average)`);
}
for (const m of runs.normal) {
  const tag = `normal/${m.seed}`;
  assert(m.harvesters >= 4 && m.refineries >= 2 && m.fields >= 3, `${tag}: ${m.harvesters} harvesters, ${m.refineries} refineries, ${m.fields} fields`);
  assert(m.earned >= BEFORE.normal.earned * 1.4, `${tag}: earned ${Math.round(m.earned)} $ (was ${BEFORE.normal.earned} on average)`);
}
console.log('ALL PASSED');
