import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { Building } = await import('../src/buildings.js');
const { AI } = await import('../src/ai.js');
const { Input } = await import('../src/input.js');
const { preloadModels } = await import('../src/assets.js');
const { ROLE, DEFS, BUILDING_REPAIR, buildingRepairCost, canRepairBuilding } = await import('../src/config.js');
const assert = (ok, text) => { if (!ok) throw new Error(text); console.log(`PASS ${text}`); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async url => new Response(await readFile(url));
  await preloadModels();
} finally { globalThis.fetch = originalFetch; }

function fixture(credits = 5000) {
  const events = [];
  const game = Object.assign(Object.create(Game.prototype), {
    player: 'human', spectate: false, over: false, time: 0, scene: new THREE.Scene(), buildings: [],
    teams: { human: { credits, power: { prod: 100, use: 0 } }, machine: { credits, power: { prod: 100, use: 0 } } },
    low: false, lowPower() { return this.low; }, isVisibleEntity: () => true,
    fx: { spawn() {}, smoke() {} }, audio: { play() {}, say() {} }, emit: (type, e) => events.push(e),
  });
  const add = (def, team = 'human') => { const b = new Building(game, def, team, 20, 20, true); game.buildings.push(b); return b; };
  return { game, events, add };
}
const run = (b, seconds, dt = .05) => { for (let t = 0; t < seconds - 1e-9; t += dt) b.update(dt); };

{
  const { game, events, add } = fixture(), b = add(ROLE.human.factory), T = game.teams.human;
  assert(!canRepairBuilding(b) && !game.setBuildingRepair(b, true), 'an undamaged structure cannot be put under repair');
  b.hp = b.maxHp * .4;
  assert(game.setBuildingRepair(b, true) && b.repairing, 'a damaged structure can be put under repair');
  run(b, BUILDING_REPAIR.time * .2);
  const expected = buildingRepairCost(b.def) * .2;
  assert(near(b.hp, b.maxHp * .6, 1e-3) && near(5000 - T.credits, expected, 1e-3),
    'health returns at a fixed rate and is paid as it comes');
  run(b, BUILDING_REPAIR.time);
  assert(b.hp === b.maxHp && !b.repairing && near(5000 - T.credits, buildingRepairCost(b.def) * .6, 1e-3),
    'repair stops by itself at full health and never charges past it');
  assert(events.some(e => e.kind === 'good' && e.text.includes(b.def.name)), 'the player is told the structure is repaired');
}
{
  const { game, add } = fixture(), b = add(ROLE.human.power);
  b.hp = b.maxHp * .5; game.setBuildingRepair(b, true); game.low = true;
  run(b, 5);
  assert(near(b.hp, b.maxHp * (.5 + .4 * 5 / BUILDING_REPAIR.time), 1e-3), 'low power slows repairs like production');
}
{
  const { game, add } = fixture(10), b = add(ROLE.human.barracks), T = game.teams.human;
  b.hp = b.maxHp * .5; game.setBuildingRepair(b, true);
  run(b, 5);
  const hp = b.hp;
  assert(T.credits >= 0 && b.repairWaiting && b.repairing && hp <= b.maxHp * (.5 + 10 / buildingRepairCost(b.def)) + 1e-6, 'without funds the repair waits and never goes into debt');
  T.credits = 5000; run(b, 1);
  assert(b.hp > hp && !b.repairWaiting, 'repair resumes as soon as there is money again');
  assert(game.setBuildingRepair(b, false) && !b.repairing, 'the player can stop a repair');
  const credits = T.credits; run(b, 2);
  assert(T.credits === credits && b.hp < b.maxHp, 'a stopped repair costs nothing');
}
{
  const { game, add } = fixture(), b = add(ROLE.human.refinery);
  b.hp = 1; game.setBuildingRepair(b, true); b.sell();
  assert(!b.repairing, 'selling a structure cancels its repair');
  const hq = add(ROLE.human.hq); hq.hp = hq.maxHp / 2;
  assert(game.setBuildingRepair(hq, true), 'the headquarters can be repaired even though it cannot be sold');
  const site = add(DEFS.t_mine);
  site.tech = { state: 'repairing' }; site.hp = site.maxHp / 2;
  assert(!canRepairBuilding(site), 'a tech ruin is restored through its own repair, not this one');
  site.tech.state = 'online';
  assert(canRepairBuilding(site) && buildingRepairCost(site.def) === DEFS.t_mine.repairCost * BUILDING_REPAIR.costShare,
    'an operational tech structure is repaired at a share of its restoration cost');
}
{
  const { game, add } = fixture(), a = add(ROLE.human.power), c = add(ROLE.human.factory), enemy = add(ROLE.machine.power, 'machine');
  for (const b of [a, c, enemy]) b.hp = b.maxHp / 2;
  const input = Object.assign(Object.create(Input.prototype), { game });
  input.toggleRepair([a, c, enemy]);
  assert(a.repairing && c.repairing && !enemy.repairing, 'R starts repairing every selected own damaged structure, never the enemy\'s');
  input.toggleRepair([a, c]);
  assert(!a.repairing && !c.repairing, 'R again stops them');
  game.setBuildingRepair(a, true); input.toggleRepair([a, c]);
  assert(a.repairing && c.repairing, 'a mixed selection starts the idle ones first');
  game.spectate = true; game.setBuildingRepair(a, false);
  assert(!input.toggleRepair([a]) && !a.repairing, 'spectators cannot order repairs');
}
{
  const { game, add } = fixture(1000), b = add(ROLE.machine.factory, 'machine'), light = add(ROLE.machine.power, 'machine');
  game.teamBuildings = (team) => game.buildings.filter(x => x.team === team && !x.dead);
  b.hp = b.maxHp * .5; light.hp = light.maxHp * .9;
  const ai = { g: game, team: 'machine' };
  AI.prototype.manageRepairs.call(ai);
  assert(b.repairing && !light.repairing, 'the AI repairs badly damaged structures and ignores scratches');
  game.teams.machine.credits = 100; AI.prototype.manageRepairs.call(ai);
  assert(!b.repairing, 'the AI pauses repairs when it runs short of money');
  game.teams.machine.credits = 300; AI.prototype.manageRepairs.call(ai);
  assert(!b.repairing, 'and keeps a reserve before resuming');
}
console.log('ALL PASSED');
