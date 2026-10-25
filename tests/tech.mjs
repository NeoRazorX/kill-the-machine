import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { GameMap, mulberry32 } = await import('../src/map.js');
const { AI } = await import('../src/ai.js');
const { preloadModels } = await import('../src/assets.js');
const { generateCashCrates, CashCrates } = await import('../src/cash-crates.js');
const { TechSites, chooseTechSites, techSelection, walkDistances, fairTolerance, TECH_MIN_START, TECH_MARGIN, TECH_PICK_MAX } = await import('../src/tech-sites.js');
const { N, CELL, SIZE, ROLE, DEFS, DIFFICULTY, START_CREDITS, TECH_IDS, TECH_SITE_COUNT, UNIT_ROLES, canCapture, other, globalRadarActive, visionRadius } = await import('../src/config.js');
const { clearLine, findPath } = await import('../src/pathfinding.js');
const { Superweapons, HQ_FLOOR, ionPath, airRun, segDist, rectSegDist } = await import('../src/superweapons.js');
const { UI } = await import('../src/ui.js');

const results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); results.push(`PASS ${text}`); };
const noop = () => {};

// ------------------------------------------------------------- definitions
assert(TECH_IDS.length === 6 && TECH_IDS.includes('t_mine') && TECH_IDS.includes('t_radar') && TECH_IDS.every((id) => DEFS[id].team === null && !DEFS[id].buildable && DEFS[id].w === 4 && DEFS[id].h === 4),
  'six neutral, unbuildable 4×4 tech structures, including the mine and strategic radar');
for (const team of ['human', 'machine']) {
  const e = ROLE[team].engineer;
  assert(e && e.engineer && !e.weapon && e.producer === 'barracks' && UNIT_ROLES.barracks.includes('engineer'), `${team}: unarmed engineer trained at the barracks`);
}

// ---------------------------------------------------------------- placement
// Every pair of corners, on several terrain seeds: the sites are fair, open and leave the map playable.
const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]];
// Checks a placement: fair, open, reachable sites that keep roads and mineral accessible, at least
// `gap` cells apart.
function checkPlacement(map, starts, crates, sites, label, gap = 40) {
  const [da, db] = starts.map((s) => walkDistances(map.grid, s));
  // Measured without vehicle clearance, so it gets a little extra room. A balanced set may lean
  // each way, as long as the leads cancel out.
  const slackOf = (s) => typeof s.fairness === 'number' ? s.fairness : s.fairness === 'balanced' ? 5 : s.fairness === 'balanced-wide' ? 10 : Infinity;
  const near = (A, B, slack) => Math.abs(A - B) <= fairTolerance(A, B) * slack + 8;
  const leads = [[], []];
  const grid = map.grid.slice();
  for (const s of sites) {
    for (let z = s.cz - TECH_MARGIN; z < s.cz + 4 + TECH_MARGIN; z++) for (let x = s.cx - TECH_MARGIN; x < s.cx + 4 + TECH_MARGIN; x++) {
      if (map.grid[z * N + x] !== 0) throw new Error(`${label}: site overlaps terrain`);
    }
    const centre = (s.cz + 2) * N + s.cx + 2, A = da[centre], B = db[centre];
    if (Math.min(A, B) < TECH_MIN_START) throw new Error(`${label}: site too close to a base`);
    leads[0].push(A - B);
    if (!near(A, B, slackOf(s))) throw new Error(`${label}: unfair site (${A.toFixed(1)} vs ${B.toFixed(1)})`);
    const rect = { x0: s.cx * CELL, z0: s.cz * CELL, x1: (s.cx + 4) * CELL, z1: (s.cz + 4) * CELL };
    for (const c of crates) if (Math.hypot(Math.max(rect.x0 - c.x, 0, c.x - rect.x1), Math.max(rect.z0 - c.z, 0, c.z - rect.z1)) < 6) throw new Error(`${label}: site covers a crate`);
    for (const f of map.fields) if (Math.hypot(Math.max(rect.x0 - f.x, 0, f.x - rect.x1), Math.max(rect.z0 - f.z, 0, f.z - rect.z1)) < f.r + 4) throw new Error(`${label}: site on mineral`);
    for (let z = s.cz; z < s.cz + 4; z++) for (let x = s.cx; x < s.cx + 4; x++) grid[z * N + x] = 2;
  }
  for (let i = 1; i < sites.length; i++) for (let j = 0; j < i; j++) if (Math.hypot(sites[i].cx - sites[j].cx, sites[i].cz - sites[j].cz) < gap) throw new Error(`${label}: sites clustered`);
  // Independent check with the game's own pathfinder: the largest vehicle reaches all four sides
  // of each site, and from each base the nearest side is about as far.
  for (const s of sites) {
    const mx = (s.cx + 2) * CELL, mz = (s.cz + 2) * CELL, off = 2 * CELL + 2, lengths = [];
    for (const [sx, sz] of starts) {
      let best = Infinity;
      for (const [fx, fz] of [[mx, mz + off], [mx, mz - off], [mx + off, mz], [mx - off, mz]]) {
        const path = findPath(grid, sx * CELL, sz * CELL, fx, fz, 1.6), end = path?.at(-1);
        if (!end || Math.hypot(end.x - fx, end.z - fz) > .01) throw new Error(`${label}: a side of the site is unreachable`);
        let len = 0, px = sx * CELL, pz = sz * CELL;
        for (const p of path) { len += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
        best = Math.min(best, len / CELL);
      }
      lengths.push(best);
    }
    leads[1].push(lengths[0] - lengths[1]);
    if (!near(...lengths, slackOf(s))) throw new Error(`${label}: routes differ (${lengths.map((l) => l.toFixed(0))})`);
  }
  // Checked on the vehicle routes, which are the ones the placement balances.
  const l = leads[1], sum = (key) => sites.reduce((t, s) => t + s[key], 0);
  if (String(sites[0].fairness).startsWith('balanced') && Math.abs(l.reduce((t, v) => t + v, 0)) > fairTolerance(sum('a'), sum('b')) + 5 * sites.length) {
    throw new Error(`${label}: balanced set does not balance (${l})`);
  }
  // Placed sites keep every mineral field reachable and every formation corridor open.
  for (const [sx, sz] of map.spawns) for (const f of map.fields) {
    const end = findPath(grid, sx * CELL, sz * CELL, f.x, f.z, 1.2)?.at(-1);
    if (!end || Math.hypot(end.x - f.x, end.z - f.z) > .01) throw new Error(`${label}: sites cut off mineral`);
  }
  for (const route of map.routes) for (let i = 1; i < route.length; i++) {
    const [ax, az] = route[i - 1], [bx, bz] = route[i];
    if (!clearLine(grid, ax * CELL, az * CELL, bx * CELL, bz * CELL, 5)) throw new Error(`${label}: site blocks a road`);
  }
}
const fairness = {};
for (let seed = 20260; seed < 20266; seed++) {
  const map = new GameMap(seed), crates = generateCashCrates(map, seed * 3);
  for (const [a, b] of pairs) {
    const starts = [map.spawns[a], map.spawns[b]], label = `seed ${seed}, corners ${a}-${b}`;
    const sites = chooseTechSites(map, starts, crates, mulberry32(seed + a * 7 + b));
    assert(sites.length === TECH_SITE_COUNT && new Set(sites.map((s) => s.id)).size === TECH_SITE_COUNT, `${label}: two different structures`);
    fairness[sites[0].fairness] = (fairness[sites[0].fairness] || 0) + 1;
    checkPlacement(map, starts, crates, sites, label);
  }
}
assert(!fairness.closest, `6 seeds × 6 corner pairs: fair (${JSON.stringify(fairness)}), open, reachable sites that keep roads and mineral accessible`);
{
  const map = new GameMap(20260), starts = [map.spawns[0], map.spawns[2]];
  const a = chooseTechSites(map, starts, [], mulberry32(5)), b = chooseTechSites(map, starts, [], mulberry32(5));
  assert(JSON.stringify(a) === JSON.stringify(b), 'same seed reproduces sites and types');
  const draws = new Set(), types = new Set();
  for (let k = 0; k < 12; k++) for (const s of chooseTechSites(map, starts, [], mulberry32(100 + k))) { draws.add(`${s.cx},${s.cz}`); types.add(s.id); }
  assert(draws.size > 6 && types.size === TECH_IDS.length, 'new matches vary positions and draw all six types');
}

// Structures chosen in the menu: exactly those types, placed by the same rules. Beyond two the
// gap between sites may shrink, never below 24 cells.
assert(techSelection(null) === null && techSelection([]).length === 0, 'no choice draws at random; an empty choice means none');
assert(JSON.stringify(techSelection(['t_mine', 'bogus', 't_mine', 't_silo'])) === '["t_mine","t_silo"]', 'a choice drops unknown and repeated ids');
assert(TECH_PICK_MAX === 4 && techSelection(TECH_IDS).length === TECH_PICK_MAX, 'at most four structures can be chosen');
{
  const choices = [['t_mine'], ['t_silo', 't_radar'], ['t_ion', 't_mammoth', 't_radar'], ['t_silo', 't_mammoth', 't_juggernaut', 't_mine']];
  const chosenFairness = {};
  for (let seed = 20260; seed < 20263; seed++) {
    const map = new GameMap(seed), crates = generateCashCrates(map, seed * 3);
    for (const [a, b] of pairs) {
      const starts = [map.spawns[a], map.spawns[b]];
      if (chooseTechSites(map, starts, crates, mulberry32(seed), []).length) throw new Error(`seed ${seed}, corners ${a}-${b}: an empty choice placed structures`);
      for (const ids of choices) {
        const label = `seed ${seed}, corners ${a}-${b}, chosen ${ids}`;
        const sites = chooseTechSites(map, starts, crates, mulberry32(seed * 11 + a + b), ids);
        if (sites.length !== ids.length || [...ids].sort().join() !== sites.map((s) => s.id).sort().join()) throw new Error(`${label}: got ${sites.map((s) => s.id)}`);
        chosenFairness[sites[0].fairness] = (chosenFairness[sites[0].fairness] || 0) + 1;
        checkPlacement(map, starts, crates, sites, label, ids.length > TECH_SITE_COUNT ? 24 : 40);
      }
    }
  }
  assert(!chosenFairness.closest, `3 seeds × 6 corner pairs: none, one, two, three and four chosen structures, exactly those, fairly placed (${JSON.stringify(chosenFairness)})`);
  const map = new GameMap(20261), starts = [map.spawns[1], map.spawns[3]], pick = ['t_mine', 't_radar', 't_ion'];
  const spots = new Set(), order = new Set();
  for (let k = 0; k < 10; k++) {
    const sites = chooseTechSites(map, starts, [], mulberry32(300 + k), pick);
    order.add(sites.map((s) => s.id).join()); spots.add(sites.map((s) => `${s.cx},${s.cz}`).sort().join(' '));
  }
  assert(spots.size > 3 && order.size > 1, 'chosen structures still land in random spots, in random order');
}

// --------------------------------------------------------------- game rules
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) => new Response(await readFile(url));
  await preloadModels();
} finally {
  globalThis.fetch = originalFetch;
}

function fixture({ slots = { human: 0, machine: 2 }, seed = 9, ai = null, spectate = true, tech = null } = {}) {
  const newTeam = () => ({
    credits: START_CREDITS, income: 1, structQueue: null, power: { prod: 0, use: 0 },
    stats: { killed: 0, lost: 0, built: 0, earned: 0 }, lastAttacked: null,
  });
  const events = [];
  const game = Object.assign(Object.create(Game.prototype), {
    player: 'human', spectate, time: 0, navVersion: 1, over: null, paused: false,
    map: new GameMap(20260), scene: new THREE.Scene(), units: [], buildings: [],
    teams: { human: newTeam(), machine: newTeam() },
    buckets: Array.from({ length: (SIZE / 8) ** 2 }, () => []), _q: [],
    fx: { update: noop, spawn: noop, marker: noop, repairBeam: noop, fireWeapon: noop, bigExplosion: noop, explosion: noop, scorch: noop, smoke: noop,
      flash: noop, beam: noop, delayed: [] },
    audio: { play: noop, say: noop }, visuals: { updateOre: noop }, emit: (type, data) => events.push({ type, data }),
    cashCrates: { items: [], update: noop, discover: noop, discoveredBy: () => [] }, updateFog: noop, fogT: 0, oreT: 0,
    fog: new Uint8Array(N * N).fill(spectate ? 2 : 0), ais: [],
  });
  game.techSites = new TechSites(game, seed);
  game.techSites.choice = tech;
  game.superweapons = new Superweapons(game);
  game.assignStarts(slots);
  game.techSites.place();
  for (const side of ['human', 'machine']) {
    const [cx, cz] = game.starts[side];
    game.placeBuilding(side, ROLE[side].hq.id, cx - 1, cz - 1, true);
  }
  if (ai) {
    game.difficulty = DIFFICULTY[ai.difficulty || 'normal'];
    game.ais.push(new AI(game, ai.team, game.difficulty));
  }
  return { game, events, sites: game.techSites.items };
}
function addStructure(game, team, role) {
  const def = ROLE[team][role], hq = game.teamBuildings(team, 'hq')[0];
  const cx = Math.floor(hq.x / CELL), cz = Math.floor(hq.z / CELL);
  for (let z = cz - 10; z <= cz + 10; z++) for (let x = cx - 10; x <= cx + 10; x++) {
    if (game.canPlace(team, def, x, z, true)) return game.placeBuilding(team, def.id, x, z, true);
  }
  throw new Error(`No room for ${role}`);
}
// A point just outside the site, on its free walkway.
const beside = (b, d = 3) => ({ x: b.x, z: b.rect.z1 + d });
const run = (game, secs, until = () => false) => { for (let t = 0; t < secs && !until(); t += 0.1) game.update(0.1); };

{
  const { game, sites } = fixture();
  assert(sites.length === 2 && sites.every((b) => b.team === null && b.tech.state === 'ruin' && b.hp === b.maxHp * b.def.ruin && game.buildings.includes(b)),
    'match starts with two neutral ruins on the map');
  assert(sites.every((b) => b.parts.wreck.visible && !b.parts.intact.visible), 'ruins show the wrecked model');
  const site = sites[0], before = site.hp;
  game.damage(site, 500, 'human');
  assert(site.hp === before, 'ruins cannot be damaged');
  const rifle = game.spawnUnit(ROLE.human.inf1, 'human', beside(site).x, beside(site).z);
  game.rebuildHash();
  assert(game.findTarget(rifle, 30) !== site, 'units never pick a ruin as a target');
  rifle.cmdAttack(site);
  assert(rifle.order.type === 'move', 'an attack order on a ruin becomes a move');
  // Construction keeps a walkway around the site and the site never extends the build radius.
  const power = ROLE.human.power;
  assert(!game.canPlace('human', power, site.cx + 4, site.cz), 'no building right next to a tech structure');
  site.team = 'human';
  assert(!game.canPlace('human', power, site.cx + 6, site.cz), 'an owned tech structure does not extend the build radius');
  site.team = null;
  // Selling is refused for tech structures.
  assert(!game.sellBuilding(site), 'tech structures cannot be sold');
}

for (const team of ['human', 'machine']) {
  const { game } = fixture();
  const site = game.techSites.items[0], p = beside(site, 14), enemy = other(team);
  const engineer = game.spawnUnit(ROLE[team].engineer, team, p.x, p.z);
  const lost = game.teams[team].stats.lost;
  engineer.cmdCapture(site);
  run(game, 30, () => site.team === team);
  assert(site.team === team && engineer.dead && !game.units.includes(engineer), `${team}: engineer walks in, captures the site and is consumed`);
  assert(game.teams[team].stats.lost === lost, `${team}: a consumed engineer does not count as a loss`);
  assert(site.tech.state === 'repairing' && site.tech.repairing, `${team}: a captured ruin starts its repair`);
  // A second engineer has nothing to do on an own structure.
  const spare = game.spawnUnit(ROLE[team].engineer, team, p.x, p.z);
  spare.cmdCapture(site);
  assert(spare.order.type === 'move' && !canCapture(spare, site), `${team}: engineers do not enter their own structures`);
  spare.dead = true;

  // Repair is paid progressively; without money it waits, when paused it stops.
  const T = game.teams[team], credits = T.credits, start = site.tech.progress;
  run(game, site.def.repairTime / 2);
  const half = site.tech.progress;
  assert(half > .45 && half < .55 && Math.abs(credits - T.credits - site.def.repairCost * (half - start)) < 1, `${team}: repair costs money in proportion to progress`);
  assert(site.parts.intact.visible && site.parts.wreck.visible && site.hp > site.maxHp * site.def.ruin, `${team}: the structure rebuilds visibly and regains health`);
  T.credits = 0; run(game, 5);
  assert(site.tech.waiting && site.tech.progress === half, `${team}: repair waits without funds`);
  T.credits = 5000; game.techSites.setRepairing(site, false); run(game, 5);
  assert(site.tech.progress === half && T.credits === 5000, `${team}: paused repair spends nothing`);
  game.techSites.setRepairing(site, true);
  run(game, site.def.repairTime, () => site.tech.state === 'online');
  assert(site.tech.state === 'online' && site.hp === site.maxHp && Math.abs(site.tech.paid - site.def.repairCost) < 1, `${team}: full repair costs exactly the repair price`);
  assert(site.parts.intact.visible && !site.parts.wreck.visible && site.parts.intact.scale.y === 1, `${team}: the repaired structure shows the intact model`);

  // The enemy fights over it: its units attack, its engineers recapture.
  const attacker = game.spawnUnit(ROLE[enemy].tank, enemy, beside(site, 8).x, beside(site, 8).z);
  attacker.cmdAttack(site);
  assert(attacker.order.type === 'attack', `${team}: enemies can attack an owned tech structure`);
  const thief = game.spawnUnit(ROLE[enemy].engineer, enemy, beside(site, 6).x, beside(site, 6).z);
  thief.cmdCapture(site);
  run(game, 20, () => site.team === enemy);
  assert(site.team === enemy && site.tech.state === 'online', `${team}: an enemy engineer captures the working structure`);
  run(game, 0.5);
  assert(attacker.order.type !== 'attack' && attacker.target !== site, `${team}: units stop firing at a structure their side now owns`);

  // Destroying it leaves ruins again, not an empty lot.
  game.damage(site, site.hp + 1, team);
  assert(!site.dead && game.buildings.includes(site) && site.team === null && site.tech.state === 'ruin' && site.tech.progress === 0,
    `${team}: a destroyed tech structure reverts to a neutral ruin`);
  assert(site.hp === site.maxHp * site.def.ruin && site.parts.wreck.visible && !site.parts.intact.visible, `${team}: the ruin is ready for another engineer`);
}

{
  // Victory ignores tech structures: losing every real building loses the match.
  const { game } = fixture();
  game.techSites.items[0].team = 'machine';
  game.kill(game.teamBuildings('machine', 'hq')[0], 'human');
  assert(game.over?.winner === 'human', 'a captured tech structure does not keep a defeated side alive');
}

{
  // Under fog, the player keeps the last state seen of a site.
  const { game, events } = fixture({ spectate: false });
  const site = game.techSites.items[0];
  const thief = game.spawnUnit(ROLE.machine.engineer, 'machine', beside(site).x, beside(site).z);
  thief.cmdCapture(site);
  run(game, 10, () => site.team === 'machine');
  assert(site.team === 'machine' && site.tech.view.team === null && site.parts.wreck.visible && !site.parts.intact.visible,
    'an enemy capture out of sight does not reveal itself');
  assert(!events.some((e) => e.type === 'toast' && /capturado/.test(e.data.text)), 'the player is not told about captures they cannot see');
  game.fog.fill(2);
  game.techSites.update(0);
  assert(site.tech.view.team === 'machine' && site.tech.view.state === 'repairing', 'seeing the site again updates owner and state');
  game.fog.fill(0);
  // Losing a site of one's own is always reported.
  site.team = null; site.tech.state = 'ruin';
  const engineer = game.spawnUnit(ROLE.human.engineer, 'human', beside(site).x, beside(site).z);
  engineer.cmdCapture(site);
  run(game, 10, () => site.team === 'human');
  const thief2 = game.spawnUnit(ROLE.machine.engineer, 'machine', beside(site).x, beside(site).z);
  thief2.cmdCapture(site);
  run(game, 10, () => site.team === 'machine');
  assert(events.some((e) => e.type === 'toast' && /enemigo ha capturado/.test(e.data.text)) && site.tech.view.team === 'machine',
    'the player learns at once that the enemy took their structure');
}

// ---------------------------------------------------------------- Mammoth
// Swaps the first site of a fixture for a ruin of the given type.
function forceSite(game, id) {
  const old = game.techSites.items[0];
  const site = game.placeBuilding(null, id, old.cx, old.cz, true);
  game.buildings.splice(game.buildings.indexOf(old), 1); game.scene.remove(old.mesh);
  site.tech = old.tech; site.hp = old.hp; site.parts.beacon.material = site.parts.beacon.material.clone();
  game.techSites.items[0] = site;
  return site;
}

// --------------------------------------------------------- Strategic radar
for (const team of ['human', 'machine']) {
  const { game } = fixture({ spectate: false }), radar = forceSite(game, 't_radar'), rival = other(team);
  game.player = team;
  Object.assign(game, {
    fogData: new Uint8Array(N*N*4), fogImg: { data: new Uint8Array(N*N*4) }, fogTex: {},
    fogCtx: { putImageData() {} }, updateFog: Game.prototype.updateFog,
  });
  const power = addStructure(game, team, 'power');
  addStructure(game, rival, 'power');
  const enemyHq = game.teamBuildings(rival, 'hq')[0];
  const enemy = game.spawnUnit(ROLE[rival].tank, rival, enemyHq.x + 4, enemyHq.z - 4);
  const crate = { x: enemyHq.x, z: enemyHq.z + 4, found: {}, seen: false, collected: false };
  game.cashCrates = Object.assign(Object.create(CashCrates.prototype), { game, items: [crate] });
  const ai = new AI(game, team, DIFFICULTY.normal);
  game.rebuildHash(); game.updateFog(); ai.updateIntel(); game.cashCrates.discover();
  assert(!globalRadarActive(radar) && !game.isVisibleEntity(enemy) && !ai.known.has(enemyHq) && !crate.found[team],
    `${team}: neutral radar provides no remote vision or intelligence`);
  const engineer = game.spawnUnit(ROLE[team].engineer, team, beside(radar).x, beside(radar).z);
  game.techSites.capture(radar, engineer);
  game.updateFog();
  assert(!globalRadarActive(radar) && !game.visibleAt(enemy.x, enemy.z) && visionRadius(radar) === radar.def.sight,
    `${team}: captured radar keeps local vision until repaired`);
  game.techSites.update(radar.def.repairTime);
  game.updateFog(); game.techSites.discover(); game.cashCrates.discover(); ai.updateIntel();
  assert(globalRadarActive(radar) && game.teams[team].power.use === 50 && game.fog.every(v => v === 2),
    `${team}: repaired powered radar reveals every map cell and consumes 50 energy`);
  assert(game.isVisibleEntity(enemy) && game.techSites.items.every(b => b.tech.found[team]) && crate.found[team],
    `${team}: full coverage reveals distant enemies, tech structures and crates`);
  assert(ai.known.has(enemyHq) && ai.corners.length === 0 && ai.enemyBase,
    `${team}: AI receives the same global building intelligence and explores all corners`);
  assert(ai.superTarget(DEFS.t_ion.superweapon), `${team}: AI can aim at enemies discovered through the radar`);
  const ui = { game, techView: b => ({ ...b.tech, team: b.team }) };
  assert(UI.prototype.techStatus.call(ui, radar).includes('Radar activo'), `${team}: panel reports active global coverage`);
  const yaw = radar.parts.dish.rotation.y;
  radar.update(.1);
  assert(radar.parts.dish.rotation.y !== yaw, `${team}: powered strategic radar rotates its antenna`);
  for (let i=0;i<16;i++) {
    radar.parts.dish.rotation.y = i*Math.PI/8;
    const bounds = new THREE.Box3().setFromObject(radar.mesh), r = radar.rect;
    assert(bounds.min.x >= r.x0 && bounds.max.x <= r.x1 && bounds.min.z >= r.z0 && bounds.max.z <= r.z1 && bounds.max.y <= radar.def.height+.16,
      `${team}: scanning antenna fits the structure footprint (${i})`);
  }
  power.buildT = 0; game.recomputePower(); game.updateFog();
  assert(!globalRadarActive(radar) && !game.isVisibleEntity(enemy) && game.fog.some(v => v === 1) && !game.fog.some(v => v === 0),
    `${team}: power loss hides remote enemies but preserves the whole explored map`);
  const stopped = radar.parts.dish.rotation.y; radar.update(.1);
  assert(radar.parts.dish.rotation.y === stopped && UI.prototype.techStatus.call(ui, radar).includes('SIN ENERGÍA'),
    `${team}: unpowered radar stops scanning and reports the power shortage`);
  power.buildT = 1; game.recomputePower(); game.updateFog();
  assert(globalRadarActive(radar) && game.isVisibleEntity(enemy), `${team}: restoring power resumes global vision`);
  const thief = game.spawnUnit(ROLE[rival].engineer, rival, beside(radar).x, beside(radar).z);
  game.techSites.capture(radar, thief); game.updateFog();
  assert(!game.isVisibleEntity(enemy), `${team}: losing the radar removes the former owner's global coverage`);
  game.player = rival; game.updateFog();
  assert(globalRadarActive(radar) && game.fog.every(v => v === 2), `${team}: capture transfers global vision to the powered new owner`);
  game.damage(radar,radar.hp+1,team); game.updateFog();
  assert(radar.tech.state === 'ruin' && !globalRadarActive(radar) && game.fog.some(v => v === 1),
    `${team}: destroying a radar restores neutral ruins and ends global coverage`);
}

// ------------------------------------------------------------- Tibero mine
for (const team of ['human', 'machine']) {
  const { game, events } = fixture(), mine = forceSite(game, 't_mine');
  const sites = game.techSites, T = game.teams[team], rival = other(team), income = mine.def.income;
  const initial = T.credits;
  sites.update(30);
  assert(T.credits === initial, `${team}: neutral mine ruins generate no income`);
  const engineer = game.spawnUnit(ROLE[team].engineer, team, beside(mine).x, beside(mine).z);
  mine.tech.found[team] = true;
  const mineAI = new AI(game, team, { ...DIFFICULTY.normal, techDelay: 0 });
  mineAI.manageTech();
  assert(engineer.order.type === 'capture' && engineer.order.target === mine, `${team}: AI assigns an engineer to a discovered mine`);
  assert(sites.capture(mine, engineer) && engineer.dead && mine.tech.state === 'repairing', `${team}: engineer captures the mine and starts repairs`);
  sites.update(mine.def.repairTime / 2);
  assert(T.credits < initial && T.stats.earned === 0, `${team}: repairing the mine spends credits and generates none`);
  sites.update(mine.def.repairTime / 2);
  assert(mine.tech.state === 'online' && mine.tech.incomeT === 0 && T.stats.earned === 0, `${team}: finishing repairs starts a fresh income interval`);
  assert(Math.abs(T.credits - (initial - mine.def.repairCost)) < 1e-6, `${team}: repairing the mine costs exactly its repair price`);
  const credits = T.credits;
  sites.update(income.interval - .1);
  assert(T.credits === credits, `${team}: no premature mine payment`);
  sites.update(.1);
  assert(T.credits === credits + income.amount && T.stats.earned === income.amount, `${team}: a full interval credits the owner and earned-income statistics`);
  const payment = events.filter(e => e.type === 'income');
  assert(payment.length === 1 && payment[0].data.amount === income.amount && payment[0].data.team === team && payment[0].data.x === mine.x,
    `${team}: exactly one floating indicator is emitted for the real payment at the mine`);
  sites.update(income.interval * 2.5);
  assert(T.credits === credits + income.amount * 3 && Math.abs(mine.tech.incomeT - income.interval / 2) < 1e-6,
    `${team}: long frames pay every completed interval and preserve the remainder`);
  sites.update(income.interval / 2);
  for (let i = 0; i < 50; i++) sites.update(.1);
  assert(T.credits === credits + income.amount * 5, `${team}: small simulation steps pay exactly on schedule`);
  const paused = T.credits;
  game.paused = true; game.update(30); game.paused = false;
  assert(T.credits === paused && mine.tech.incomeT < 1e-6, `${team}: paused games do not advance mine income`);
  const power = T.power; T.power = { prod: 0, use: 100 };
  sites.update(income.interval);
  assert(T.credits === paused + income.amount, `${team}: self-powered mine keeps producing during a power shortage`);
  T.power = power;
  T.income = 1.2; const scaled = T.credits;
  sites.update(income.interval); T.income = 1;
  assert(T.credits === scaled + income.amount * 1.2, `${team}: mine income follows the normal economy multiplier`);
  assert(events.filter(e => e.type === 'income').at(-1).data.amount === income.amount * 1.2,
    `${team}: floating payout includes the actual economy multiplier`);
  const ui = { game, techView: b => ({ ...b.tech, team: b.team }) };
  const observer = game.player; game.player = team; game.spectate = false;
  assert(UI.prototype.techStatus.call(ui, mine).includes(`+${income.amount} $`) && UI.prototype.techStatus.call(ui, mine).includes('0:05'),
    `${team}: owner panel shows the payout and next-payment countdown`);
  game.player = rival;
  assert(UI.prototype.techStatus.call(ui, mine) === 'Operativa', `${team}: enemy panel does not leak the live income timer`);
  const hiddenPayments = events.filter(e => e.type === 'income').length;
  sites.update(income.interval);
  assert(events.filter(e => e.type === 'income').length === hiddenPayments, `${team}: enemy mine payouts do not emit floating indicators for the player`);
  game.player = observer; game.spectate = true;
  sites.update(income.interval - 1);
  const thief = game.spawnUnit(ROLE[rival].engineer, rival, beside(mine).x, beside(mine).z);
  sites.capture(mine, thief);
  const oldCredits = T.credits, newCredits = game.teams[rival].credits;
  assert(mine.tech.incomeT === 0 && mine.tech.state === 'online', `${team}: enemy capture resets the timer without breaking the repaired mine`);
  sites.update(income.interval - .1);
  assert(game.teams[rival].credits === newCredits, `${team}: new owner waits a complete interval after capture`);
  sites.update(.1);
  assert(T.credits === oldCredits && game.teams[rival].credits === newCredits + income.amount, `${team}: capture transfers future income exclusively to the new owner`);
  game.damage(mine, mine.hp + 1, team);
  const destroyedCredits = game.teams[rival].credits;
  sites.update(30);
  assert(mine.team === null && mine.tech.state === 'ruin' && mine.tech.incomeT === 0 && game.teams[rival].credits === destroyedCredits,
    `${team}: destruction leaves a capturable ruin and stops all mine income`);
  const replacement = game.spawnUnit(ROLE[team].engineer, team, beside(mine).x, beside(mine).z);
  sites.capture(mine, replacement); T.credits = 5000;
  sites.update(mine.def.repairTime); const repairedCredits = T.credits;
  sites.update(income.interval);
  assert(mine.tech.state === 'online' && T.credits === repairedCredits + income.amount, `${team}: recapturing and repairing a wrecked mine resumes periodic income`);
  const rotation = mine.parts.drill.rotation.y;
  mine.update(.1);
  assert(mine.parts.drill.rotation.y !== rotation, `${team}: repaired mine animates its extraction auger`);
}

{
  for (const team of ['human', 'machine']) {
    const m = ROLE[team].mammoth;
    assert(m && m.producer === 'mammoth' && DEFS.t_mammoth.produces === 'mammoth' && m.weapon && m.selfRepair, `${team}: Mammoth built by the Mammoth factory`);
    assert(m.hp > ROLE[team].tank.hp * 3 && m.radius > ROLE[team].tank.radius * 1.3 && m.speed < ROLE[team].tank.speed, `${team}: Mammoth is bigger, tougher and slower than the main tank`);
  }
  const { game } = fixture();
  const site = forceSite(game, 't_mammoth');
  const R = ROLE.human;
  assert(!game.requirementsMet('human', R.mammoth) && !game.queueUnit('human', R.mammoth.id), 'no Mammoth from a ruined factory');
  site.team = 'human'; site.tech.state = 'repairing';
  assert(!game.requirementsMet('human', R.mammoth), 'no Mammoth while the factory is being repaired');
  site.tech.state = 'online'; site.tech.progress = 1;
  assert(game.requirementsMet('human', R.mammoth) && !game.requirementsMet('machine', ROLE.machine.mammoth), 'the repaired factory builds Mammoths for its owner only');
  // A rally point on open ground some way from the factory, wherever the draw put it.
  for (let d = 16; d < 40 && !site.rally; d += 2) for (let a = 0; a < 6.3 && !site.rally; a += .2) {
    const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
    if (game.canStand(x, z, R.mammoth.radius + 1)) site.rally = { x, z };
  }
  const credits = game.teams.human.credits = 5000;
  assert(game.queueUnit('human', R.mammoth.id), 'Mammoth queued at the factory');
  run(game, R.mammoth.time + 2, () => game.units.some((u) => u.def === R.mammoth));
  const tank = game.units.find((u) => u.def === R.mammoth);
  assert(tank && tank.team === 'human' && Math.abs(game.teams.human.credits - (credits - R.mammoth.cost)) < 1, 'Mammoth rolls out after its build time, for its price');
  assert(game.canStand(tank.x, tank.z, tank.radius) && game.distTo(tank, site) < 16, 'it leaves the factory onto free ground');
  run(game, 15);
  assert(Math.hypot(tank.x - site.rally.x, tank.z - site.rally.z) < 5, 'and drives to the factory rally point');
  // Self-repair: only out of combat and only up to half health.
  tank.hp = tank.maxHp * 0.2; tank.lastHit = game.time;
  run(game, 3);
  assert(tank.hp === tank.maxHp * 0.2, 'no self-repair right after being hit');
  run(game, 60);
  assert(Math.abs(tank.hp - tank.maxHp * tank.def.selfRepair.upTo) < 1e-6, 'self-repair stops at half health');
  // A queue in progress is lost when the factory changes hands.
  game.queueUnit('human', R.mammoth.id); run(game, 5);
  const thief = game.spawnUnit(ROLE.machine.engineer, 'machine', beside(site).x, beside(site).z);
  thief.cmdCapture(site);
  run(game, 10, () => site.team === 'machine');
  assert(site.team === 'machine' && !site.queue.length && !site.rally, 'capturing a factory discards the previous owner\'s queue and rally point');
  assert(game.requirementsMet('machine', ROLE.machine.mammoth), 'the new owner can build Mammoths at once');
}
for (let seed = 20260; seed < 20264; seed++) {
  // The super-tank fits through the map: every corner reaches every other corner and the centre.
  const map = new GameMap(seed);
  for (const [ax, az] of map.spawns) for (const [bx, bz] of [...map.spawns, [N / 2 + 10, N / 2 + 10]]) {
    if (ax === bx && az === bz) continue;
    const end = findPath(map.grid, ax * CELL, az * CELL, bx * CELL, bz * CELL, DEFS.h_mammoth.radius)?.at(-1);
    if (!end || Math.hypot(end.x - bx * CELL, end.z - bz * CELL) > 6) throw new Error(`seed ${seed}: Mammoth cannot cross the map`);
  }
}
results.push('PASS 4 seeds: the Mammoth reaches every corner and the centre');

// -------------------------------------------------------------- Juggernaut
{
  for (const team of ['human', 'machine']) {
    const j = ROLE[team].juggernaut, m = ROLE[team].mammoth;
    assert(j && j.producer === 'juggernaut' && DEFS.t_juggernaut.produces === 'juggernaut', `${team}: Juggernaut built by the Juggernaut factory`);
    assert(j.weapon.range > m.weapon.range && j.hp < m.hp && !j.fireOnMove && j.weapon.salvo === 3 && j.sight >= j.weapon.range,
      `${team}: Juggernaut outranges the Mammoth, is less armoured, stops to fire three-gun volleys and sees as far as it shoots`);
  }
  const { game } = fixture();
  const site = forceSite(game, 't_juggernaut'), R = ROLE.human;
  assert(!game.requirementsMet('human', R.juggernaut), 'no Juggernaut from a ruined factory');
  site.team = 'human'; site.tech.state = 'online'; site.tech.progress = 1;
  game.teams.human.credits = 5000;
  assert(game.queueUnit('human', R.juggernaut.id), 'Juggernaut queued at its repaired factory');
  run(game, R.juggernaut.time + 2, () => game.units.some((u) => u.def === R.juggernaut));
  const walker = game.units.find((u) => u.def === R.juggernaut);
  assert(walker && game.canStand(walker.x, walker.z, walker.radius), 'Juggernaut walks out of the factory');
  // Volleys: three shells a few tenths of a second apart, then the full reload.
  const shots = [];
  game.fx.fireWeapon = (att, target) => {
    shots.push({ att, t: game.time });
    game.impact({ x: target.x, y: 0, z: target.z, target, weapon: att.def.weapon, team: att.team, dmg: att.def.weapon.damage, splash: att.def.weapon.splash, source: att });
  };
  const ground = (x, z, r) => { for (let d = 0; d < 30; d++) for (let a = 0; a < 6.3; a += .3) { const p = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d }; if (game.canStand(p.x, p.z, r + .5)) return p; } };
  const here = ground(walker.x, walker.z, walker.radius);
  walker.x = here.x; walker.z = here.z; walker.cmdStop();
  let foe = null;
  for (let a = 0; a < 6.3 && !foe; a += .2) {
    const p = { x: here.x + Math.cos(a) * 27, z: here.z + Math.sin(a) * 27 };
    if (game.canStand(p.x, p.z, 2)) foe = game.spawnUnit(ROLE.machine.tank, 'machine', p.x, p.z);
  }
  foe.hp = foe.maxHp = 5000;
  walker.cmdAttack(foe);
  const fired = () => shots.filter((s) => s.att === walker);
  run(game, 4, () => fired().length > 0);
  run(game, 0.6);
  const mine = fired();
  assert(mine.length === 3 && mine[2].t - mine[0].t < 0.5, 'a volley is three quick shells');
  // The guns rise to the launch angle of the shells' arc before firing, about 25°, and settle afterwards.
  assert(Math.abs(walker.pitch - walker.lobPitch(foe)) < 0.05 && walker.pitch > 0.35 && walker.pitch < 0.5, 'the battery is elevated to the arc it fires');
  assert(foe.hp < 5000 && walker.hp === walker.maxHp && Math.hypot(walker.x - here.x, walker.z - here.z) < .5,
    'it shells a tank from beyond the tank\'s sight and range without moving');
  const first = mine[0].t;
  run(game, R.juggernaut.weapon.cd * 1.15, () => fired().length > 3);
  const second = fired()[3];
  assert(second && second.t - first >= R.juggernaut.weapon.cd * 0.89, 'the next volley comes after the reload');
  foe.dead = true; walker.cmdStop();
  run(game, 2);
  assert(walker.pitch < 0.01, 'with no target the guns return to level');
}

// ---------------------------------------------------------------- Artillery
for (const id of ['h_arty', 'm_siege']) {
  // Artillery raises its gun from its resting angle to the launch angle of its arc, then lowers it.
  const { game } = fixture();
  const enemy = other(DEFS[id].team), ground = (x, z, r) => { for (let d = 0; d < 40; d++) for (let a = 0; a < 6.3; a += .3) { const p = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d }; if (game.canStand(p.x, p.z, r + .4)) return p; } };
  const here = ground(SIZE / 2 + 30, SIZE / 2 + 30, 1.6);
  const gun = game.spawnUnit(DEFS[id], DEFS[id].team, here.x, here.z);
  const rest = gun.pitch;
  assert(rest > 0.2 && rest === gun.restPitch, `${id}: the gun starts at its authored elevation`);
  let foe = null;
  for (let a = 0; a < 6.3 && !foe; a += .2) {
    const p = { x: here.x + Math.cos(a) * 30, z: here.z + Math.sin(a) * 30 };
    if (game.canStand(p.x, p.z, 1.8)) foe = game.spawnUnit(ROLE[enemy].tank, enemy, p.x, p.z);
  }
  foe.hp = foe.maxHp = 9999;
  let at = null;
  game.fx.fireWeapon = (att) => { if (att === gun && at === null) at = gun.pitch; };
  gun.cmdAttack(foe);
  run(game, 6, () => at !== null);
  const deg = at * 180 / Math.PI;
  assert(at !== null && Math.abs(at - gun.lobPitch(foe)) < 0.05 && deg > 35 && deg < 50, `${id}: fires with the gun raised to its arc (${deg.toFixed(0)}°)`);
  foe.dead = true; gun.cmdStop();
  run(game, 2);
  assert(Math.abs(gun.pitch - rest) < 1e-6, `${id}: with no target the gun returns to its resting angle`);
}

// ------------------------------------------------------------ Superweapons
{
  assert(DEFS.t_silo.superweapon.kind === 'nuke' && DEFS.t_ion.superweapon.kind === 'ion' &&
    DEFS.t_silo.superweapon.radius > DEFS.t_ion.superweapon.radius && DEFS.t_silo.superweapon.delay > DEFS.t_ion.superweapon.delay &&
    DEFS.t_silo.superweapon.charge > DEFS.t_ion.superweapon.charge, 'the missile hits wider but slower and charges longer than the ion cannon');
  const r = { x0: 0, z0: 0, x1: 4, z1: 4 };
  assert(rectSegDist(r, -5, 2, 10, 2) === 0 && Math.abs(rectSegDist(r, -5, 7, 10, 7) - 3) < 1e-9 && Math.abs(rectSegDist(r, 6, 6, 9, 9) - Math.hypot(2, 2)) < 1e-9 &&
    Math.abs(rectSegDist(r, 7, -2, 7, 9) - 3) < 1e-9, 'distance from a building to a line');
  const { game, events } = fixture({ spectate: false });
  const sw = game.superweapons, site = forceSite(game, 't_ion'), W = site.def.superweapon;
  run(game, 3);
  assert(!site.tech.charge && !sw.status('human').own.length, 'a ruin does not charge');
  site.team = 'human'; site.tech.state = 'online'; site.tech.progress = 1; game.recomputePower();
  assert(game.teams.human.power.use === 60, 'the repaired weapon draws power');
  run(game, 5);
  assert(game.lowPower('human') && !site.tech.charge, 'without enough power it does not charge');
  addStructure(game, 'human', 'power');
  run(game, 10);
  assert(Math.abs(site.tech.charge - 10) < 0.2 && !sw.isReady(site) && sw.status('human').own[0]?.b === site, 'with power it charges over time');
  assert(sw.status('machine').enemy.length === 0, 'the enemy only tracks a superweapon it has discovered');
  site.tech.found.machine = true;
  assert(sw.status('machine').enemy[0]?.b === site, 'once discovered, the enemy sees its countdown');
  site.tech.charge = W.charge - 0.5;
  run(game, 1);
  assert(sw.isReady(site) && events.some((e) => e.type === 'toast' && /listo/.test(e.data.text)), 'when charged it is ready and the owner is told');
  run(game, 30);
  assert(sw.isReady(site) && site.tech.charge === W.charge, 'a ready weapon waits for its owner');
  // Aiming is limited to explored ground.
  const enemyHq = game.teamBuildings('machine', 'hq')[0];
  assert(!sw.fire(site, enemyHq.x, enemyHq.z) && sw.isReady(site), 'it cannot be aimed into unexplored ground');
  game.fog.fill(1);
  // The beam sweeps a line from its start; units at the start, further along, off to the side, and one of the firing side's own.
  const ground = (x, z, r, min = 0, ok = () => true) => { for (let d = min; d < 60; d++) for (let a = 0; a < 6.3; a += .3) { const p = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d }; if (game.canStand(p.x, p.z, r + .3) && ok(p)) return p; } };
  const at = ground(enemyHq.x, enemyHq.rect.z1 + 6, 1.5);
  const ahead = ground(at.x, at.z, 1.5, 18, (p) => Math.hypot(p.x - at.x, p.z - at.z) < 24);
  const ux = (ahead.x - at.x) / Math.hypot(ahead.x - at.x, ahead.z - at.z), uz = (ahead.z - at.z) / Math.hypot(ahead.x - at.x, ahead.z - at.z);
  const inside = game.spawnUnit(ROLE.machine.tank, 'machine', at.x, at.z), along = game.spawnUnit(ROLE.machine.tank, 'machine', ahead.x, ahead.z);
  const far = ground(at.x, at.z, 1.5, 0, (p) => segDist(p.x, p.z, at.x, at.z, at.x + ux * W.length, at.z + uz * W.length) > W.radius + 4);
  const outside = game.spawnUnit(ROLE.machine.tank, 'machine', far.x, far.z);
  const near = ground(at.x, at.z, 0.7, 1.5), friend = game.spawnUnit(ROLE.human.rifle ?? ROLE.human.inf1, 'human', near.x, near.z);
  game.rebuildHash();
  assert(sw.fire(site, at.x, at.z, at.x + ux * 80, at.z + uz * 80) && !sw.isReady(site) && site.tech.charge === 0 && sw.strikes.length === 1, 'firing spends the charge and launches a strike');
  const strike = sw.strikes[0];
  assert(Math.abs(strike.len - W.length) < 1e-6 && Math.abs(ionPath(W, 10, 10, -50, 10).x2) < 1e-6, 'the beam is cut to its length and kept on the map');
  assert(events.some((e) => e.type === 'alert'), 'a strike sets off an alert');
  run(game, W.delay * 0.8);
  assert(inside.hp === inside.maxHp, 'nothing is hit before the strike lands');
  run(game, W.delay * 0.2 + W.sweep * 0.2);
  assert((inside.dead || inside.hp < inside.maxHp * 0.2) && along.hp === along.maxHp, 'the beam wrecks its start first and has not yet reached further along');
  run(game, W.sweep * 0.9);
  assert(!sw.strikes.length && (along.dead || along.hp < along.maxHp * 0.2), 'the beam sweeps on along its line');
  assert(outside.hp === outside.maxHp, 'units beside the line are untouched');
  assert(friend.dead || friend.hp < friend.maxHp, 'the strike spares nobody, not even the side that fired');
  // Each target is hit once, however long the beam runs along it.
  const lone = game.spawnUnit(ROLE.machine.tank, 'machine', at.x, at.z);
  lone.maxHp = lone.hp = 1e6; game.rebuildHash();
  site.tech.charge = W.charge;
  sw.fire(site, at.x, at.z, at.x + ux * 0.5, at.z + uz * 0.5);
  run(game, W.delay + W.sweep + 0.5);
  assert(Math.abs(lone.maxHp - lone.hp - W.damage) < 1e-6, 'a target the beam lingers over is hit only once');
  lone.dead = true; game.rebuildHash();
  // Headquarters survive any single strike.
  enemyHq.hp = 700;
  site.tech.charge = W.charge;
  sw.fire(site, enemyHq.x, enemyHq.z);
  run(game, W.delay + W.sweep + 0.5);
  assert(!enemyHq.dead && Math.abs(enemyHq.hp - enemyHq.maxHp * HQ_FLOOR) < 1e-6 && !game.over, 'a superweapon never takes a headquarters below a quarter of its health');
  // A new owner starts charging from zero.
  site.tech.charge = W.charge;
  const thief = game.spawnUnit(ROLE.machine.engineer, 'machine', beside(site).x, beside(site).z);
  thief.cmdCapture(site);
  run(game, 10, () => site.team === 'machine');
  assert(site.team === 'machine' && site.tech.charge < 11 && !sw.isReady(site), 'capturing a superweapon restarts its charge');
}
{
  // The missile: wider and slower than the ion beam.
  const { game } = fixture();
  const sw = game.superweapons, site = forceSite(game, 't_silo'), W = site.def.superweapon;
  site.team = 'human'; site.tech.state = 'online'; site.tech.progress = 1; site.tech.charge = W.charge;
  const hq = game.teamBuildings('machine', 'hq')[0];
  const ring = [];
  for (let a = 0; a < 6.3 && ring.length < 4; a += .4) {
    const x = hq.x + Math.cos(a) * (W.radius - 2), z = hq.z + Math.sin(a) * (W.radius - 2);
    if (game.canStand(x, z, 0.8)) ring.push(game.spawnUnit(ROLE.machine.inf1, 'machine', x, z));
  }
  sw.fire(site, hq.x, hq.z);
  run(game, W.delay - 1);
  assert(ring.every((u) => u.hp === u.maxHp) && sw.strikes.length === 1, 'the missile takes its time to arrive');
  run(game, 2);
  assert(ring.length >= 2 && ring.every((u) => u.dead), 'and kills infantry well away from the centre');
}

// ------------------------------------------------------- Reconnaissance
for (const team of ['human', 'machine']) {
  const enemy = other(team), A = ROLE[team].airfield, R = A.recon;
  assert(R.kind === 'recon' && R.charge < A.superweapon.charge && R.radius > A.superweapon.radius && R.speed > A.superweapon.speed,
    `${team}: the airfield's reconnaissance charges sooner, flies faster and sees wider than its strike`);
  const { game, events } = fixture({ spectate: false });
  game.player = team;
  // The real fog of war, minus its textures.
  Object.assign(game, { fogData: new Uint8Array(N * N * 4), fogImg: { data: new Uint8ClampedArray(N * N * 4) }, fogTex: {}, fogCtx: { putImageData() {} } });
  const updateFog = () => Game.prototype.updateFog.call(game), fogAt = (x, z) => game.fog[Math.floor(z / CELL) * N + Math.floor(x / CELL)];
  const sw = game.superweapons;
  addStructure(game, team, 'power');
  const field = addStructure(game, team, 'airfield');
  game.recomputePower();
  run(game, R.charge + 0.5);
  assert(sw.isReady(field, R) && !sw.isReady(field), `${team}: reconnaissance is ready after ${R.charge} s, before the air strike`);
  assert(sw.ready(team).length === 1 && sw.ready(team)[0].sw === R, `${team}: the ready list names which power is ready`);
  const ehq = game.teamBuildings(enemy, 'hq')[0];
  updateFog();
  assert(!fogAt(ehq.x, ehq.z) && !sw.canTarget(team, ehq.x, ehq.z) && sw.canTarget(team, ehq.x, ehq.z, R),
    `${team}: reconnaissance may be sent over unexplored ground, unlike a strike`);
  const before = events.length;
  assert(sw.fire(field, ehq.x, ehq.z, undefined, undefined, R) && !sw.isReady(field, R) && sw.progress(field) > 0.5,
    `${team}: firing spends the reconnaissance charge only`);
  const flight = sw.strikes[0];
  assert(flight.planes.length === 1 && !events.slice(before).some((e) => e.type === 'alert'), `${team}: one plane, and no alert that gives its target away`);
  // On the way it sees a strip around itself.
  run(game, flight.delay / 2);
  updateFog();
  const eye = sw.spotters[0];
  assert(sw.spotters.length === 1 && fogAt(eye.x, eye.z) === 2 && !fogAt(ehq.x, ehq.z), `${team}: the plane sees the ground under it on the way`);
  // Over the target it reveals a wide circle for a while, then the ground stays explored.
  run(game, flight.delay / 2 + 0.3);
  updateFog(); game.techSites.discover(); game.cashCrates.discover?.();
  const edge = { x: ehq.x + (ehq.x < SIZE / 2 ? 1 : -1) * (R.radius - 3), z: ehq.z };
  assert(fogAt(ehq.x, ehq.z) === 2 && fogAt(edge.x, edge.z) === 2 && game.isVisibleEntity(ehq), `${team}: the target area is revealed`);
  assert(game.eyes(team).some((e) => e.kind === 'spotter' && e.def.sight === R.radius), `${team}: the revealed area counts as the side's own sight`);
  run(game, R.duration + 0.5);
  updateFog();
  assert(fogAt(ehq.x, ehq.z) === 1, `${team}: after ${R.duration} s the area goes dark but stays explored`);
  run(game, 20, () => !sw.strikes.length);
  assert(!sw.strikes.length && !sw.spotters.length && !sw.group.children.length, `${team}: the plane leaves and its vision ends with it`);
  assert(sw.canTarget(team, ehq.x, ehq.z), `${team}: strikes can now be aimed where the plane looked`);
}
{
  // An enemy flight is only announced: no marker, no hint of where it is going.
  const { game, events } = fixture({ spectate: false });
  const sw = game.superweapons, field = addStructure(game, 'machine', 'airfield'), R = field.def.recon;
  field.charging = { recon: { charge: R.charge } };
  const hq = game.teamBuildings('human', 'hq')[0];
  assert(sw.fire(field, hq.x, hq.z, undefined, undefined, R), 'the enemy sends a spy drone');
  assert(events.some((e) => e.type === 'toast' && /espía/.test(e.data.text)) && !events.some((e) => e.type === 'alert') && !sw.strikes[0].ring,
    'the player hears of an enemy spy plane but not where it is headed');
}

// ------------------------------------------------------------ Air strike
for (const team of ['human', 'machine']) {
  const enemy = other(team), A = ROLE[team].airfield, W = A.superweapon;
  assert(A.unique && A.requires.includes('factory') && !A.tech && W.kind === 'air' && W.charge < DEFS.t_ion.superweapon.charge &&
    W.radius < DEFS.t_ion.superweapon.length && W.mult.light > W.mult.armor && W.mult.armor > W.mult.building,
    `${team}: the airfield is built, one per side, and charges a strike that is weakest against buildings`);
  const { game, events } = fixture({ spectate: false });
  game.player = team;
  const sw = game.superweapons;
  addStructure(game, team, 'power'); addStructure(game, team, 'refinery'); addStructure(game, team, 'factory');
  game.teams[team].credits = 10000;
  assert(game.startStruct(team, A.id), `${team}: with a factory the airfield can be built`);
  game.cancelStruct(team);
  const field = addStructure(game, team, 'airfield');
  assert(game.atLimit(team, A) && !game.startStruct(team, A.id), `${team}: a second airfield cannot be started`);
  game.recomputePower();
  assert(sw.sites.includes(field) && sw.online(field) && !sw.isReady(field) && sw.status(team).own.map((r) => r.sw.kind).join() === 'air,recon' && sw.status(team).own[0].b === field, `${team}: a finished airfield starts charging`);
  run(game, W.charge - 1);
  assert(!sw.isReady(field), `${team}: the strike is not ready before its charge time`);
  run(game, 1.5);
  assert(sw.isReady(field) && events.some((e) => e.type === 'toast' && /listo/.test(e.data.text)), `${team}: the airfield is ready after ${W.charge} s`);
  // An enemy squad and a tank at the target, and a unit well clear of the strip.
  game.fog.fill(1);
  const ehq = game.teamBuildings(enemy, 'hq')[0];
  const ground = (x, z, r, min = 0) => { for (let d = min; d < 60; d++) for (let a = 0; a < 6.3; a += .3) { const p = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d }; if (game.canStand(p.x, p.z, r + .3)) return p; } };
  const at = ground(ehq.x, ehq.rect.z1 + 14, 1.6);
  const tank = game.spawnUnit(ROLE[enemy].tank, enemy, at.x, at.z);
  const squad = [];
  for (let a = 0; a < 6.3 && squad.length < 4; a += .5) {
    const x = at.x + Math.cos(a) * 3, z = at.z + Math.sin(a) * 3;
    if (game.canStand(x, z, 0.8)) squad.push(game.spawnUnit(ROLE[enemy].inf1, enemy, x, z));
  }
  const run0 = airRun(W, field, at.x, at.z);
  const far = ground(at.x, at.z, 0.8, W.length / 2 + run0.half + 4), clear = game.spawnUnit(ROLE[enemy].inf1, enemy, far.x, far.z);
  // Something of the airfield's side sees them.
  game.spawnUnit(ROLE[team].inf1, team, at.x, at.z + (at.z < SIZE / 2 ? 12 : -12));
  game.rebuildHash();
  assert(sw.fire(field, at.x, at.z) && !sw.isReady(field) && sw.strikes.length === 1, `${team}: firing spends the charge and sends the squadron`);
  const strike = sw.strikes[0];
  const outside = (x, z) => x < 0 || z < 0 || x > SIZE || z > SIZE;
  assert(strike.planes.length === W.planes && outside(strike.ex, strike.ez) && Math.abs(strike.delay - strike.inDist / W.speed) < 1e-9,
    `${team}: ${W.planes} aircraft fly in from beyond the map edge`);
  // The path runs from the airfield's side of the map, through the target.
  assert((at.x - field.x) * strike.dx + (at.z - field.z) * strike.dz > 0, `${team}: the squadron comes in from behind its own airfield`);
  assert(strike.lock?.unit && squad.concat(tank).includes(strike.lock.unit), `${team}: aimed at troops it can see, the squadron locks on to them`);
  run(game, strike.delay - W.length / 2 / W.speed - 0.15);
  assert(tank.hp === tank.maxHp && squad.every((u) => u.hp === u.maxHp) && strike.bombs.length > 0, `${team}: bombs are falling before the first one lands`);
  run(game, 30, () => !sw.strikes.length);
  assert(squad.length >= 2 && squad.filter((u) => u.dead).length >= squad.length - 1, `${team}: the bombs wipe out infantry`);
  assert(!tank.dead && tank.hp < tank.maxHp * 0.6, `${team}: tanks come out badly damaged but alive`);
  assert(clear.hp === clear.maxHp, `${team}: units outside the strip are untouched`);
  assert(!sw.strikes.length && !sw.group.children.length, `${team}: the squadron leaves the map and nothing is left behind`);
  // A tank that drives off across the run is followed until the squadron commits to its course.
  const start = ground(at.x, at.z, 1.6, 22), runner = game.spawnUnit(ROLE[enemy].tank, enemy, start.x, start.z);
  const across = airRun(W, field, start.x, start.z), dest = ground(start.x + across.dz * 30, start.z - across.dx * 30, 1.6);
  // Watched all the way.
  for (let k = 0; k <= 1; k += 0.25) game.spawnUnit(ROLE[team].inf1, team, start.x + (dest.x - start.x) * k + 6, start.z + (dest.z - start.z) * k);
  game.rebuildHash();
  field.charging.air.charge = W.charge;
  sw.fire(field, runner.x, runner.z);
  const chase = sw.strikes[0], aim0 = { x: chase.x, z: chase.z };
  runner.cmdMove(dest.x, dest.z);
  run(game, chase.delay - W.commit - 0.5);
  const followed = Math.hypot(chase.x - aim0.x, chase.z - aim0.z), onRunner = Math.hypot(chase.x - runner.x, chase.z - runner.z);
  assert(chase.lock?.unit === runner && followed > 5 && onRunner < 1, `${team}: the strike follows a unit that runs (${followed.toFixed(1)} away, ${onRunner.toFixed(1)} off it)`);
  run(game, 1);
  const fixed = { x: chase.x, z: chase.z };
  run(game, 0.9);
  assert(chase.x === fixed.x && chase.z === fixed.z, `${team}: ${W.commit} s out the squadron holds its course`);
  run(game, 30, () => !sw.strikes.length);
  assert(runner.hp < runner.maxHp * 0.75, `${team}: running across the strip does not save a tank`);
  // A structure in the strip loses a good share of its health, more than a scratch but far from all of it.
  const plant = addStructure(game, enemy, 'power');
  field.charging.air.charge = W.charge;
  sw.fire(field, plant.x, plant.z);
  run(game, 40, () => !sw.strikes.length);
  const lost = 1 - plant.hp / plant.maxHp;
  assert(!plant.dead && lost > 0.35 && lost < 0.8, `${team}: a power plant in the strip loses ${(lost * 100).toFixed(0)} % of its health`);
  // The farther from the airfield's edge of the map, the longer the warning.
  field.charging.air.charge = W.charge;
  sw.fire(field, field.x, field.z + (field.z < SIZE / 2 ? 40 : -40));
  const near = sw.strikes[0].delay;
  sw.strikes.splice(0).forEach((s) => sw.dispose(s));
  field.charging.air.charge = W.charge;
  sw.fire(field, at.x, at.z);
  assert(sw.strikes[0].delay > near, `${team}: a strike far from the airfield takes longer to arrive`);
}

// -------------------------------------------------------------------- AI
const originalRandom = Math.random;
try {
  for (const team of ['human', 'machine']) {
    Math.random = mulberry32(41 + (team === 'machine' ? 1 : 0));
    const { game } = fixture({ ai: { team } });
    const ai = game.ais[0], hq = game.teamBuildings(team, 'hq')[0];
    addStructure(game, team, 'power'); addStructure(game, team, 'barracks');
    const site = game.techSites.items.reduce((a, b) => Math.hypot(a.x - hq.x, a.z - hq.z) < Math.hypot(b.x - hq.x, b.z - hq.z) ? a : b);
    // Seen through a unit standing next to it, the enemy-held site is a target but not the enemy base.
    site.team = other(team);
    const eye = game.spawnUnit(ROLE[team].inf1, team, beside(site).x, beside(site).z);
    game.rebuildHash(); game.techSites.discover(); ai.updateIntel();
    assert(ai.known.has(site) && !ai.enemyBase, `${team}: an enemy-held tech site is a target but does not give away the enemy base`);
    site.team = null; ai.updateIntel();
    assert(!ai.known.has(site), `${team}: a ruin is not an attack target`);
    eye.dead = true;
    for (let i = 0; i < 4; i++) game.spawnUnit(ROLE[team].inf1, team, hq.x + 10 + i * 2, hq.z);
    game.time = game.difficulty.techDelay - 1; ai.manageTech();
    assert(!game.queuedCount(team, ROLE[team].engineer.id), `${team}: no engineer before the difficulty delay`);
    game.time = game.difficulty.techDelay;
    // Leave only the tech logic running so waves and scouting do not interfere.
    ai.update = function () { this.updateIntel(); this.manageTech(); };
    run(game, 400, () => site.team === team);
    assert(site.team === team, `${team}: AI trains an engineer, escorts it and captures a discovered site`);
    assert(game.units.some((u) => u.team === team && u.def.weapon && Math.hypot(u.x - site.x, u.z - site.z) < 20), `${team}: the escort stays to guard the site`);
    run(game, site.def.repairTime + 5);
    assert(site.tech.state === 'online', `${team}: AI pays for the repair`);
  }
  for (const team of ['human', 'machine']) {
    // With a working Mammoth factory, the AI mixes super-tanks into its production.
    Math.random = mulberry32(91 + (team === 'machine' ? 1 : 0));
    const { game } = fixture({ ai: { team } });
    const ai = game.ais[0], site = game.placeBuilding(team, 't_mammoth', 60, 60, true);
    site.tech = { state: 'online', progress: 1, found: { [team]: true }, view: {} };
    addStructure(game, team, 'power'); addStructure(game, team, 'barracks');
    game.teams[team].credits = 20000;
    for (let i = 0; i < 60; i++) { ai.manageUnits(); game.update(0.5); }
    assert(game.queuedCount(team, ROLE[team].mammoth.id) + game.units.filter((u) => u.def === ROLE[team].mammoth).length > 0, `${team}: AI builds Mammoths`);
    const plant = game.placeBuilding(team, 't_juggernaut', 60, 80, true);
    plant.tech = { state: 'online', progress: 1, found: { [team]: true }, view: {} };
    game.teams[team].credits = 20000;
    for (let i = 0; i < 80; i++) { ai.manageUnits(); game.update(0.5); }
    assert(game.queuedCount(team, ROLE[team].juggernaut.id) + game.units.filter((u) => u.def === ROLE[team].juggernaut).length > 0, `${team}: AI builds Juggernauts`);
  }
  for (const team of ['human', 'machine']) for (const id of ['t_silo', 't_ion']) {
    // A ready superweapon is aimed at the enemy's most valuable known spot, never at home.
    Math.random = mulberry32(13 + (team === 'machine' ? 1 : 0));
    const { game } = fixture({ ai: { team } });
    const ai = game.ais[0], sw = game.superweapons, enemy = other(team);
    ai.update = function () { this.updateIntel(); this.manageSuperweapons(); };
    const site = forceSite(game, id);
    site.team = team; site.tech.state = 'online'; site.tech.progress = 1; site.tech.charge = site.def.superweapon.charge;
    run(game, 2);
    assert(sw.isReady(site), `${team}: AI holds its fire without a known target`);
    const ehq = game.teamBuildings(enemy, 'hq')[0];
    for (const role of ['power', 'refinery', 'barracks']) addStructure(game, enemy, role);
    game.spawnUnit(ROLE[team].inf1, team, ehq.x, ehq.rect.z1 + 30);
    ai.corners = [];
    for (const b of game.teamBuildings(enemy)) ai.known.add(b);
    run(game, 2);
    const strike = sw.strikes[0];
    assert(strike && Math.hypot(strike.x - ehq.x, strike.z - ehq.z) < 30, `${team}: AI fires at the enemy base it has found`);
    const home = game.teamBuildings(team, 'hq')[0];
    assert(Math.hypot(strike.x - home.x, strike.z - home.z) > 60, `${team}: AI never aims at its own base`);
    if (id === 't_ion') {
      const R = site.def.superweapon.radius, crossed = game.teamBuildings(enemy).filter((b) => rectSegDist(b.rect, strike.x, strike.z, strike.x2, strike.z2) <= R);
      assert(strike.len > 10 && crossed.length >= 2, `${team}: AI lays the ion beam across several enemy buildings`);
    }
  }
  for (const team of ['human', 'machine']) {
    // Once its army is under way the AI builds an airfield, and spends the strike on armies only.
    Math.random = mulberry32(17 + (team === 'machine' ? 1 : 0));
    const { game } = fixture({ ai: { team } });
    const ai = game.ais[0], sw = game.superweapons, enemy = other(team), T = game.teams[team];
    // A base with everything the AI wants before an airfield.
    for (const role of ['power', 'power', 'power', 'refinery', 'refinery', 'barracks', 'barracks', 'factory', 'factory', 'turret', 'turret']) addStructure(game, team, role);
    game.recomputePower();
    T.credits = 3000;
    ai.manageStructures();
    assert(T.structQueue?.def.role !== 'airfield', `${team}: no airfield before the first wave`);
    game.cancelStruct(team);
    ai.waveNo = 1;
    ai.manageStructures();
    assert(T.structQueue?.def.role === 'airfield', `${team}: AI builds an airfield after its first wave`);
    game.cancelStruct(team);
    const field = addStructure(game, team, 'airfield');
    field.charging = { air: { charge: field.def.superweapon.charge } };
    ai.update = function () { this.updateIntel(); this.manageSuperweapons(); };
    for (const b of game.teamBuildings(enemy)) ai.known.add(b);
    ai.corners = [];
    run(game, 2);
    assert(sw.isReady(field) && !sw.strikes.length, `${team}: AI does not waste an air strike on buildings`);
    const ehq = game.teamBuildings(enemy, 'hq')[0], gx = ehq.x, gz = ehq.rect.z1 + 14;
    for (let i = 0; i < 5; i++) game.spawnUnit(ROLE[enemy].tank, enemy, gx + (i - 2) * 3, gz);
    game.spawnUnit(ROLE[team].inf1, team, gx, gz + 16);
    run(game, 2);
    const strike = sw.strikes[0];
    assert(strike?.sw.kind === 'air' && Math.hypot(strike.x - gx, strike.z - gz) < 8, `${team}: AI sends the air strike onto an enemy army it can see`);
  }
  for (const team of ['human', 'machine']) {
    // With the enemy base unknown, the AI sends its reconnaissance to the corner its scout will reach last.
    Math.random = mulberry32(23 + (team === 'machine' ? 1 : 0));
    const { game } = fixture({ ai: { team }, slots: { human: 0, machine: 2 } });
    const ai = game.ais[0], sw = game.superweapons, enemy = other(team);
    ai.update = function () { this.updateIntel(); this.manageSuperweapons(); };
    addStructure(game, team, 'power');
    const field = addStructure(game, team, 'airfield');
    game.recomputePower();
    field.charging = { recon: { charge: field.def.recon.charge } };
    const ehq = game.teamBuildings(enemy, 'hq')[0];
    assert(!ai.enemyBase && ai.corners.length > 1, `${team}: AI starts not knowing where the enemy is`);
    const target = ai.reconTarget(), hq = ai.hq;
    assert(ai.corners.every((c) => Math.hypot(c.x - hq.x, c.z - hq.z) <= Math.hypot(target.x - hq.x, target.z - hq.z)), `${team}: recon goes to the farthest unseen corner`);
    // Put the enemy in that corner and let the flight find it.
    const corner = ai.corners.find((c) => c === target);
    run(game, 1);
    const flight = sw.strikes.find((s) => s.sw.kind === 'recon');
    assert(flight && Math.hypot(flight.x - corner.x, flight.z - corner.z) < 1, `${team}: AI launches the reconnaissance flight`);
    run(game, flight.delay + 1.5);
    // In this layout the enemy sits in that farthest corner.
    assert(Math.hypot(ehq.x - corner.x, ehq.z - corner.z) < 30 && ai.enemyBase && Math.hypot(ai.enemyBase.x - corner.x, ai.enemyBase.z - corner.z) < 1,
      `${team}: the flight finds the enemy base`);
  }
  {
    // The scout keeps exploring while a site is still missing, even with no crates left.
    Math.random = mulberry32(77);
    const { game } = fixture({ ai: { team: 'machine' } });
    const ai = game.ais[0], hq = game.teamBuildings('machine', 'hq')[0];
    ai.enemyBase = { x: 0, z: 0 }; ai.corners = [];
    game.spawnUnit(ROLE.machine.inf1, 'machine', hq.x + 8, hq.z + 8);
    ai.manageScout();
    assert(ai.scout && ai.scout.order.type === 'move', 'AI scout goes looking for undiscovered tech structures');
    for (const b of game.techSites.items) b.tech.found.machine = true;
    ai.manageScout();
    assert(!ai.scout, 'scout stands down once every site is known and there is no loot');
  }
  {
    // A match with no structures chosen: nothing to look for, and the AI plays on regardless.
    Math.random = mulberry32(78);
    const { game, sites } = fixture({ ai: { team: 'machine' }, tech: [] });
    assert(sites.length === 0 && !game.buildings.some((b) => b.def.tech), 'an empty choice starts the match without tech structures');
    const ai = game.ais[0], hq = game.teamBuildings('machine', 'hq')[0];
    ai.enemyBase = { x: 0, z: 0 }; ai.corners = [];
    game.spawnUnit(ROLE.machine.inf1, 'machine', hq.x + 8, hq.z + 8);
    ai.manageScout();
    assert(!ai.scout, 'without tech structures or loot the scout does not go looking for them');
    game.difficulty = { ...game.difficulty, techDelay: 0 };
    ai.diff = game.difficulty;
    run(game, 120);
    assert(!game.over && game.techSites.items.length === 0 && !game.units.some((u) => u.def.engineer), 'the AI plays two minutes and never trains an engineer');
  }
  {
    // Three chosen structures, for both AIs of a spectated match.
    Math.random = mulberry32(79);
    const pick = ['t_mine', 't_radar', 't_silo'];
    const { game, sites } = fixture({ ai: { team: 'machine' }, tech: pick });
    game.ais.push(new AI(game, 'human', game.difficulty));
    assert(sites.length === 3 && pick.every((id) => sites.some((b) => b.def.id === id)) && sites.every((b) => b.tech.state === 'ruin' && !b.team),
      'the chosen structures start as neutral ruins');
    for (const b of sites) b.tech.found.machine = b.tech.found.human = true;
    for (const ai of game.ais) ai.diff = game.difficulty = { ...game.difficulty, techDelay: 0 };
    run(game, 240, () => sites.some((b) => b.team));
    assert(sites.some((b) => b.team), 'AIs send engineers to the chosen structures');
  }
} finally {
  Math.random = originalRandom;
}

console.log(results.join('\n'));
console.log('ALL PASSED');
