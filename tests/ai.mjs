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
const { CELL, SIZE, TEAMS, ROLE, DIFFICULTY, START_CREDITS, other } = await import('../src/config.js');

// Load the game's real local models without requiring a browser or HTTP server.
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
function fixture(team, difficulty = 'normal', crateSeed = null) {
  const newTeam = () => ({
    credits: START_CREDITS, income: 1, structQueue: null, power: { prod: 0, use: 0 },
    stats: { killed: 0, lost: 0, built: 0, earned: 0 }, lastAttacked: null,
  });
  const game = Object.assign(Object.create(Game.prototype), {
    player: 'human', spectate: true, time: 0, navVersion: 1, over: null, paused: false,
    map: new GameMap(20260), scene: new THREE.Scene(), units: [], buildings: [],
    teams: { human: newTeam(), machine: newTeam() },
    buckets: Array.from({ length: (SIZE / 8) ** 2 }, () => []), _q: [],
    fx: { update: noop, spawn: noop, marker: noop, repairBeam: noop },
    audio: { play: noop, say: noop }, visuals: { updateOre: noop },
    cashCrates: { items: [], update: noop, discover: noop, discoveredBy: () => [] }, updateFog: noop, fogT: 0, oreT: 0,
  });
  // Como en la partida real, las cajas se reparten antes de colocar las bases.
  if (crateSeed !== null) game.cashCrates = new CashCrates(game, crateSeed);
  const ai = new AI(game, team, DIFFICULTY[difficulty]);
  game.ais = [ai];
  game.teams[team].income = DIFFICULTY[difficulty].income;
  for (const side of [team, other(team)]) {
    const [cx, cz] = TEAMS[side].startCell;
    game.placeBuilding(side, ROLE[side].hq.id, cx - 1, cz - 1, true);
  }
  return { game, ai };
}
function addStructure(game, team, role, instant = true) {
  const def = ROLE[team][role], hq = game.teamBuildings(team, 'hq')[0];
  const cx = Math.floor(hq.x / CELL), cz = Math.floor(hq.z / CELL);
  for (let z = cz - 10; z <= cz + 10; z++) for (let x = cx - 10; x <= cx + 10; x++) {
    if (game.canPlace(team, def, x, z, true)) return game.placeBuilding(team, def.id, x, z, instant);
  }
  throw new Error(`No room for ${role}`);
}

const originalRandom = Math.random;
try {
  for (const team of ['human', 'machine']) {
    for (const difficulty of Object.keys(DIFFICULTY)) {
      Math.random = mulberry32(123 + results.length);
      const { game, ai } = fixture(team, difficulty);
      ai.manageStructures();
      assert(game.teams[team].structQueue?.def.role === 'power', `${team}/${difficulty}: HQ-only opening starts with power`);
      // Real queues, placement, construction, harvesting and production on the quarry map.
      for (let i = 0; i < 1800; i++) game.update(0.1);
      const roles = game.teamBuildings(team).map(b => b.def.role);
      assert(roles.slice(0, 3).join(',') === 'hq,power,refinery', `${team}/${difficulty}: establishes income before military buildings`);
      assert(game.hasRole(team, 'barracks') && game.hasRole(team, 'factory'), `${team}/${difficulty}: unlocks infantry and vehicle production`);
      assert(game.teams[team].stats.earned > 0, `${team}/${difficulty}: free refinery harvester delivers mineral`);
    }

    let { game, ai } = fixture(team);
    const power = addStructure(game, team, 'power', false);
    ai.manageStructures();
    assert(!game.teams[team].structQueue, `${team}: waits for unfinished power without duplicating it`);
    power.buildT = 1; game.onBuildingComplete(power);
    ai.manageStructures();
    assert(game.teams[team].structQueue?.def.role === 'refinery', `${team}: existing power unlocks the first refinery without a factory`);
    game.cancelStruct(team);
    const refinery = addStructure(game, team, 'refinery', false);
    ai.manageStructures();
    assert(!game.teams[team].structQueue, `${team}: waits for unfinished refinery without duplicating it`);
    refinery.buildT = 1; game.onBuildingComplete(refinery);
    ai.manageStructures();
    assert(game.teams[team].structQueue?.def.role === 'barracks', `${team}: standard three-building start retains its barracks opening`);
    game.cancelStruct(team);
    addStructure(game, team, 'barracks'); addStructure(game, team, 'factory');
    game.removeBuilding(refinery, 'destroyed');
    ai.manageStructures();
    assert(game.teams[team].structQueue?.def.role === 'refinery', `${team}: rebuilds a lost refinery before expansion or defenses`);
    game.cancelStruct(team);
    game.removeBuilding(power, 'destroyed');
    ai.manageStructures();
    assert(game.teams[team].structQueue?.def.role === 'power', `${team}: losing both economic buildings restores power first`);

    ({ game, ai } = fixture(team));
    addStructure(game, team, 'power');
    game.teams[team].credits = ROLE[team].refinery.cost * 0.35 - 1;
    ai.manageStructures();
    assert(!game.teams[team].structQueue, `${team}: insufficient refinery funds do not trigger military construction`);
    game.teams[team].credits++;
    ai.manageStructures();
    assert(game.teams[team].structQueue?.def.role === 'refinery', `${team}: resumes the economic opening when funds reach the usual threshold`);
  }

  for (const team of ['human', 'machine']) {
    Math.random = mulberry32(7 + results.length);
    const { game, ai } = fixture(team, 'normal', 77);
    const [crate, ...rest] = game.cashCrates.items;
    for (const c of rest) { c.collected = true; game.scene.remove(c.mesh); }
    const hq = game.teamBuildings(team, 'hq')[0], R = ROLE[team];
    const slow = game.spawnUnit(R.tank, team, hq.x + 8, hq.z + 8);
    const fast = game.spawnUnit(R.inf1, team, hq.x - 8, hq.z + 8);
    ai.manageScout();
    assert(ai.scout === (fast.def.speed >= slow.def.speed ? fast : slow), `${team}: fastest idle combat unit becomes the scout`);
    assert(!ai.armyIdle().includes(ai.scout), `${team}: waves and defense do not take the scout`);
    assert(ai.scout.order.type === 'move' && (ai.scout.order.x !== crate.x || ai.scout.order.z !== crate.z), `${team}: undiscovered crates are explored for, not targeted`);

    const spotter = game.spawnUnit(R.inf1, other(team), crate.x + 4, crate.z);
    game.rebuildHash(); game.cashCrates.discover();
    assert(crate.found[other(team)] && !crate.found[team], `${team}: crates seen only by the enemy stay unknown`);
    ai.manageScout();
    assert(ai.scout.order.x !== crate.x || ai.scout.order.z !== crate.z, `${team}: AI ignores crates its enemy discovered`);
    spotter.dead = true;

    const claims = [], claim = game.cashCrates.claim;
    game.cashCrates.claim = function (c, unit) { claims.push(unit); return claim.call(this, c, unit); };
    for (let i = 0; i < 6000 && !crate.collected; i++) game.update(0.1);
    assert(crate.found[team], `${team}: scout explores the map until it discovers the crate`);
    assert(crate.collected && claims.length === 1 && claims[0] === ai.scout, `${team}: scout collects the discovered crate`);
    ai.manageScout();
    assert(!ai.scout, `${team}: scout rejoins the army when no crates remain`);
  }
} finally {
  Math.random = originalRandom;
}
console.log(results.join('\n'));
console.log('ALL PASSED');
