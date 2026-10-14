import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { GameMap, mulberry32 } = await import('../src/map.js');
const { AI } = await import('../src/ai.js');
const { preloadModels } = await import('../src/assets.js');
const { generateCashCrates } = await import('../src/cash-crates.js');
const { TechSites, chooseTechSites, walkDistances, fairTolerance, TECH_MIN_START, TECH_MARGIN } = await import('../src/tech-sites.js');
const { N, CELL, SIZE, ROLE, DEFS, DIFFICULTY, START_CREDITS, TECH_IDS, TECH_SITE_COUNT, UNIT_ROLES, canCapture, other } = await import('../src/config.js');
const { clearLine, findPath } = await import('../src/pathfinding.js');
const { Superweapons, HQ_FLOOR } = await import('../src/superweapons.js');

const results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); results.push(`PASS ${text}`); };
const noop = () => {};

// ------------------------------------------------------------- definitions
assert(TECH_IDS.length === 4 && TECH_IDS.every((id) => DEFS[id].team === null && !DEFS[id].buildable && DEFS[id].w === 4 && DEFS[id].h === 4),
  'four neutral, unbuildable 4×4 tech structures');
for (const team of ['human', 'machine']) {
  const e = ROLE[team].engineer;
  assert(e && e.engineer && !e.weapon && e.producer === 'barracks' && UNIT_ROLES.barracks.includes('engineer'), `${team}: unarmed engineer trained at the barracks`);
}

// ---------------------------------------------------------------- placement
// Every pair of corners, on several terrain seeds: the sites are fair, open and leave the map playable.
const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]];
const fairness = {};
for (let seed = 20260; seed < 20266; seed++) {
  const map = new GameMap(seed), crates = generateCashCrates(map, seed * 3);
  for (const [a, b] of pairs) {
    const starts = [map.spawns[a], map.spawns[b]], label = `seed ${seed}, corners ${a}-${b}`;
    const sites = chooseTechSites(map, starts, crates, mulberry32(seed + a * 7 + b));
    assert(sites.length === TECH_SITE_COUNT && new Set(sites.map((s) => s.id)).size === TECH_SITE_COUNT, `${label}: two different structures`);
    const [da, db] = starts.map((s) => walkDistances(map.grid, s));
    // Measured without vehicle clearance, so it gets a little extra room. A balanced pair may lean
    // each way, as long as the leads cancel out.
    const slackOf = (s) => typeof s.fairness === 'number' ? s.fairness : s.fairness === 'balanced' ? 5 : Infinity;
    const near = (A, B, slack) => Math.abs(A - B) <= fairTolerance(A, B) * slack + 8;
    fairness[sites[0].fairness] = (fairness[sites[0].fairness] || 0) + 1;
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
    for (let i = 1; i < sites.length; i++) if (Math.hypot(sites[i].cx - sites[0].cx, sites[i].cz - sites[0].cz) < 40) throw new Error(`${label}: sites clustered`);
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
    const l = leads[1];
    if (sites[0].fairness === 'balanced' && Math.abs(l[0] + l[1]) > fairTolerance(sites[0].a + sites[1].a, sites[0].b + sites[1].b) + 10) {
      throw new Error(`${label}: balanced pair does not balance (${l})`);
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
}
assert(!fairness.closest, `6 seeds × 6 corner pairs: fair (${JSON.stringify(fairness)}), open, reachable sites that keep roads and mineral accessible`);
{
  const map = new GameMap(20260), starts = [map.spawns[0], map.spawns[2]];
  const a = chooseTechSites(map, starts, [], mulberry32(5)), b = chooseTechSites(map, starts, [], mulberry32(5));
  assert(JSON.stringify(a) === JSON.stringify(b), 'same seed reproduces sites and types');
  const draws = new Set(), types = new Set();
  for (let k = 0; k < 12; k++) for (const s of chooseTechSites(map, starts, [], mulberry32(100 + k))) { draws.add(`${s.cx},${s.cz}`); types.add(s.id); }
  assert(draws.size > 6 && types.size === TECH_IDS.length, 'new matches vary positions and draw all four types');
}

// --------------------------------------------------------------- game rules
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) => new Response(await readFile(url));
  await preloadModels();
} finally {
  globalThis.fetch = originalFetch;
}

function fixture({ slots = { human: 0, machine: 2 }, seed = 9, ai = null, spectate = true } = {}) {
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
  assert(Math.abs(site.tech.charge - 10) < 0.2 && !sw.isReady(site) && sw.status('human').own[0] === site, 'with power it charges over time');
  assert(sw.status('machine').enemy.length === 0, 'the enemy only tracks a superweapon it has discovered');
  site.tech.found.machine = true;
  assert(sw.status('machine').enemy[0] === site, 'once discovered, the enemy sees its countdown');
  site.tech.charge = W.charge - 0.5;
  run(game, 1);
  assert(sw.isReady(site) && events.some((e) => e.type === 'toast' && /listo/.test(e.data.text)), 'when charged it is ready and the owner is told');
  run(game, 30);
  assert(sw.isReady(site) && site.tech.charge === W.charge, 'a ready weapon waits for its owner');
  // Aiming is limited to explored ground.
  const enemyHq = game.teamBuildings('machine', 'hq')[0];
  assert(!sw.fire(site, enemyHq.x, enemyHq.z) && sw.isReady(site), 'it cannot be aimed into unexplored ground');
  game.fog.fill(1);
  // Units around the target: enemies inside, enemies outside, and one of the firing side's own.
  const ground = (x, z, r, min = 0) => { for (let d = min; d < 40; d++) for (let a = 0; a < 6.3; a += .3) { const p = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d }; if (game.canStand(p.x, p.z, r + .3)) return p; } };
  const at = ground(enemyHq.x, enemyHq.rect.z1 + 6, 1.5);
  const inside = game.spawnUnit(ROLE.machine.tank, 'machine', at.x, at.z);
  const far = ground(at.x, at.z, 1.5, W.radius + 8), outside = game.spawnUnit(ROLE.machine.tank, 'machine', far.x, far.z);
  const near = ground(at.x, at.z, 0.7, 1.5), friend = game.spawnUnit(ROLE.human.rifle ?? ROLE.human.inf1, 'human', near.x, near.z);
  game.rebuildHash();
  assert(sw.fire(site, at.x, at.z) && !sw.isReady(site) && site.tech.charge === 0 && sw.strikes.length === 1, 'firing spends the charge and launches a strike');
  assert(events.some((e) => e.type === 'alert'), 'a strike sets off an alert');
  run(game, W.delay * 0.8);
  assert(inside.hp === inside.maxHp, 'nothing is hit before the strike lands');
  run(game, W.delay * 0.4);
  assert(!sw.strikes.length && (inside.dead || inside.hp < inside.maxHp * 0.2), 'the ion beam wrecks what stands at its centre');
  assert(outside.hp === outside.maxHp, 'units beyond the radius are untouched');
  assert(friend.dead || friend.hp < friend.maxHp, 'the strike spares nobody, not even the side that fired');
  // Headquarters survive any single strike.
  enemyHq.hp = 700;
  site.tech.charge = W.charge;
  sw.fire(site, enemyHq.x, enemyHq.z);
  run(game, W.delay + 0.5);
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

// -------------------------------------------------------------------- AI
const originalRandom = Math.random;
try {
  for (const team of ['human', 'machine']) {
    Math.random = mulberry32(41 + results.length);
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
    Math.random = mulberry32(91 + results.length);
    const { game } = fixture({ ai: { team } });
    const ai = game.ais[0], site = game.placeBuilding(team, 't_mammoth', 60, 60, true);
    site.tech = { state: 'online', progress: 1, found: { [team]: true }, view: {} };
    addStructure(game, team, 'power'); addStructure(game, team, 'barracks');
    game.teams[team].credits = 20000;
    for (let i = 0; i < 60; i++) { ai.manageUnits(); game.update(0.5); }
    assert(game.queuedCount(team, ROLE[team].mammoth.id) + game.units.filter((u) => u.def === ROLE[team].mammoth).length > 0, `${team}: AI builds Mammoths`);
    const plant = game.placeBuilding(team, 't_juggernaut', 60, 80, true);
    plant.tech = { state: 'online', progress: 1, found: { [team]: true }, view: {} };
    for (let i = 0; i < 80; i++) { ai.manageUnits(); game.update(0.5); }
    assert(game.queuedCount(team, ROLE[team].juggernaut.id) + game.units.filter((u) => u.def === ROLE[team].juggernaut).length > 0, `${team}: AI builds Juggernauts`);
  }
  for (const team of ['human', 'machine']) {
    // A ready superweapon is aimed at the enemy's most valuable known spot, never at home.
    Math.random = mulberry32(13 + results.length);
    const { game } = fixture({ ai: { team } });
    const ai = game.ais[0], sw = game.superweapons, enemy = other(team);
    ai.update = function () { this.updateIntel(); this.manageSuperweapons(); };
    const site = forceSite(game, 't_silo');
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
} finally {
  Math.random = originalRandom;
}

console.log(results.join('\n'));
console.log('ALL PASSED');
