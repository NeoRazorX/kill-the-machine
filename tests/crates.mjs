import { registerHooks } from 'node:module';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const { GameMap } = await import('../src/map.js');
const { CashCrates, CASH_CRATE_COUNT, generateCashCrates } = await import('../src/cash-crates.js');
const { Game } = await import('../src/game.js');
const { Input } = await import('../src/input.js');
const { N, CELL, TEAMS, DEFS } = await import('../src/config.js');
const { canOccupy, findPath } = await import('../src/pathfinding.js');
const results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); results.push(`PASS ${text}`); };

for (let seed = 20260; seed < 20276; seed++) {
  const map = new GameMap(seed), before = map.grid.slice();
  const crates = generateCashCrates(map, seed * 7);
  assert(crates.length === CASH_CRATE_COUNT, `seed ${seed}: full crate distribution`);
  for (const crate of crates) {
    if (!canOccupy(map.grid, crate.x, crate.z, 1.8)) throw new Error('Crate touches terrain');
    if (![300, 400, 500, 600, 700].includes(crate.amount)) throw new Error('Invalid reward');
    if (map.fields.some(f => Math.hypot(f.x - crate.x, f.z - crate.z) < f.r + 6)) throw new Error('Crate hidden in mineral');
    for (const team of Object.values(TEAMS)) {
      const [x, z] = team.startCell.map(v => v * CELL);
      if (Math.hypot(x - crate.x, z - crate.z) < 48) throw new Error('Reward inside starting visibility');
      const end = findPath(map.grid, x, z, crate.x, crate.z, 1.6)?.at(-1);
      if (!end || Math.hypot(end.x - crate.x, end.z - crate.z) > .01) throw new Error('Unreachable reward');
    }
    for (const other of crates) if (other !== crate && Math.hypot(other.x - crate.x, other.z - crate.z) < 24) throw new Error('Rewards clustered');
  }
  assert(map.grid.every((value, i) => value === before[i]), `seed ${seed}: crates do not block navigation`);
}
const map = new GameMap(20260);
assert(JSON.stringify(generateCashCrates(map, 77)) === JSON.stringify(generateCashCrates(map, 77)), 'same loot seed reproduces positions and rewards');
assert(JSON.stringify(generateCashCrates(map, 77)) !== JSON.stringify(generateCashCrates(map, 78)), 'a new loot seed changes rewards on the same map');

function fixture() {
  let visible = false;
  const units = [], events = [], effects = [];
  const game = {
    player: 'human', spectate: false, over: null,
    map: { grid: new Uint8Array(N * N), fields: [], blockedXZ: GameMap.prototype.blockedXZ, blockedCell: GameMap.prototype.blockedCell },
    teams: { human: { credits: 100, income: 1, stats: { earned: 0 } }, machine: { credits: 100, income: .7, stats: { earned: 0 } } },
    scene: { remove(mesh) { effects.push(mesh); } },
    fx: { marker() {} }, audio: { play() {} }, emit(type, data) { events.push({ type, data }); },
    visibleAt: () => visible, queryUnits: () => units,
  };
  const crate = { id: 0, x: 100, z: 100, amount: 500, collected: false, seen: false, mesh: { visible: false } };
  const loot = Object.assign(Object.create(CashCrates.prototype), { game, items: [crate] });
  game.cashCrates = loot;
  return { game, units, events, effects, crate, loot, reveal: value => { visible = value; } };
}
let f = fixture();
f.loot.update();
assert(!f.crate.mesh.visible && !f.loot.at(100, 100), 'unexplored rewards are hidden and cannot be targeted');
f.reveal(true); f.loot.update();
assert(f.crate.mesh.visible && f.loot.at(100, 100) === f.crate, 'exploration reveals a collectible crate');
f.reveal(false); f.loot.update();
assert(f.crate.seen && f.crate.mesh.visible, 'discovered crates remain remembered in explored fog');
f.units.push({ id: 1, team: 'human', x: 100, z: 103, radius: .7, dead: false });
f.loot.update();
assert(f.game.teams.human.credits === 100 && !f.crate.collected, 'seeing a crate or passing too far away awards nothing');
f.units[0].z = 101; f.units[0].dead = true; f.loot.update();
assert(!f.crate.collected, 'dead units cannot collect cash');
f.units[0].dead = false; f.loot.update(); f.loot.update(); f.loot.claim(f.crate, f.units[0]);
assert(f.game.teams.human.credits === 600 && f.game.teams.human.stats.earned === 500, 'pickup awards the exact cash amount once and updates income stats');
assert(f.crate.collected && !f.crate.mesh.visible && f.effects.length === 1 && !f.loot.at(100, 100), 'collected crate is removed from rendering and targeting');
assert(f.events.length === 1 && f.events[0].data.text.includes('+500'), 'player receives one reward notification');
f = fixture();
f.units.push({ id: 5, team: 'human', x: 102, z: 100, radius: 1.6 }, { id: 2, team: 'machine', x: 100, z: 100, radius: .7 });
f.loot.update();
assert(f.game.teams.machine.credits === 600 && f.game.teams.human.credits === 100 && f.events.length === 0,
  'nearest contender wins; enemy cash ignores mining difficulty and stays quiet');
f = fixture(); f.game.spectate = true; f.loot.update();
assert(f.crate.mesh.visible && !f.crate.collected, 'spectating reveals crates without claiming them');
f.game.over = {}; f.units.push({ id: 1, team: 'human', x: 100, z: 100, radius: .7 }); f.loot.update();
assert(!f.crate.collected, 'match completion stops pickups');
f = fixture(); f.crate.x = 103; f.crate.z = 101;
f.game.map.grid[50 * N + 50] = 2;
f.units.push({ id: 1, team: 'human', x: 99, z: 101, radius: 3 }); f.loot.update();
assert(!f.crate.collected, 'a wall between the unit and crate prevents pickup');

f = fixture(); f.reveal(true); f.loot.update();
const orders = [];
const input = Object.assign(Object.create(Input.prototype), { game: f.game });
const squad = Array.from({ length: 4 }, (_, id) => ({ id, x: 80 + id * 3, z: 80, radius: 1.6,
  cmdMove(x, z, attack) { orders.push({ x, z, attack }); } }));
input.orderMove(squad, 100, 100);
assert(orders.some(p => p.x === 100 && p.z === 100), 'group movement sends a collector to the crate instead of leaving formation center empty');
orders.length = 0; input.orderMove(squad, 100, 100, true);
assert(orders.every(p => p.attack) && !orders.some(p => p.x === 100 && p.z === 100), 'attack-move preserves the combat formation');

f.game.buildings = [{ team: 'human', dead: false, selling: false, rect: { x0: 88, z0: 88, x1: 94, z1: 94 } }];
assert(!Game.prototype.canPlace.call(f.game, 'human', DEFS.h_power, 49, 49), 'construction cannot bury a reward');
f.crate.collected = true;
assert(Game.prototype.canPlace.call(f.game, 'human', DEFS.h_power, 49, 49), 'collecting a crate frees its ground for construction');
console.log(results.join('\n'));
console.log('ALL PASSED');
