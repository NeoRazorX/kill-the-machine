import { registerHooks } from 'node:module';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { Unit } = await import('../src/units.js');
const { DEFS, N, ROLE, UNIT_ROLES, canRepair } = await import('../src/config.js');

const results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); results.push(`PASS ${text}`); };
const beams = [];
const game = Object.assign(Object.create(Game.prototype), {
  player: 'human', spectate: true, time: 0, units: [], buildings: [], navVersion: 1,
  map: { grid: new Uint8Array(N * N) }, scene: new THREE.Scene(),
  fx: { repairBeam(src, t) { beams.push([src, t]); } },
  queryUnits() { return this.units; }, isVisibleEntity: () => true,
});
function unit(id, x = 50, z = 50) {
  const def = DEFS[id];
  const u = Object.assign(Object.create(Unit.prototype), {
    game, kind: 'unit', def, team: def.team, id: game.units.length + 1, x, z, heading: 0, aim: 0,
    hp: def.hp, maxHp: def.hp, radius: def.radius, cls: def.cls, dead: false, order: { type: 'idle' },
    guard: { x, z }, cooldown: 0, scanT: 0, repathT: 0, stuckT: 0, stuckCount: 0, lastPX: x, lastPZ: z,
    path: null, dest: null, target: null, speedMul: 1, mesh: new THREE.Group(), parts: {},
  });
  u.syncMesh = () => {};
  game.units.push(u);
  return u;
}
const run = (secs, list = game.units) => { for (let t = 0; t < secs; t += 0.05) for (const u of list) if (!u.dead) u.update(0.05); };

for (const team of ['human', 'machine']) {
  const R = ROLE[team];
  assert(R.medic && R.repair && UNIT_ROLES.barracks.includes('medic') && UNIT_ROLES.factory.includes('repair'), `${team}: healers are buildable`);
  assert(!R.medic.weapon && !R.repair.weapon, `${team}: healers are unarmed`);
  assert(R.medic.producer === 'barracks' && R.repair.producer === 'factory', `${team}: medic from barracks, repair unit from factory`);
}

// Pairing: medics heal infantry only; repair units fix vehicles only; never enemies or themselves.
const medic = unit('h_medic'), mech = unit('h_mech', 80, 80);
const rifle = unit('h_rifle', 52, 50), tank = unit('h_tank', 84, 80), drone = unit('m_drone', 50, 53);
assert(canRepair(medic, rifle) && !canRepair(medic, tank) && !canRepair(medic, drone) && !canRepair(medic, medic), 'medic heals only allied infantry');
assert(canRepair(mech, tank) && !canRepair(mech, rifle), 'repair unit fixes only allied vehicles');
assert(canRepair(unit('m_nanite', 10, 10), unit('m_sentinel', 12, 10)) && canRepair(unit('m_welder', 10, 20), unit('m_crusher', 12, 20)), 'machine healers mirror the human pairing');
game.units.length = 0;

// Idle medic finds the wounded rifleman nearby and heals him to full, without overshooting.
game.units.push(medic, rifle);
rifle.hp = 20; medic.order = { type: 'idle' }; medic.target = null;
run(3, [medic]);
assert(rifle.hp > 20 && rifle.hp < rifle.maxHp, 'idle medic auto-heals nearby wounded infantry over time');
run(10, [medic]);
assert(rifle.hp === rifle.maxHp && beams.length > 0, 'healing stops exactly at max health');
assert(medic.target === null, 'medic releases a fully healed patient');

// Explicit order: repair truck drives to a distant tank and repairs it, then idles.
game.units.length = 0; game.units.push(mech, tank);
tank.x = 100; tank.z = 80; tank.hp = 100;
mech.cmdRepair(tank);
run(20, [mech]);
assert(tank.hp === tank.maxHp && mech.order.type === 'idle', 'ordered repair unit travels to the vehicle and repairs it');
assert(Math.hypot(mech.x - tank.x, mech.z - tank.z) < 12, 'repair unit closed the distance to its patient');

// Invalid order (vehicle healer → infantry) degrades to a move.
const r2 = unit('h_rifle', 90, 90); r2.hp = 10;
mech.cmdRepair(r2);
assert(mech.order.type === 'move', 'repair order on incompatible unit becomes a move');

// Veteran max health is respected.
tank.maxHp = tank.def.hp * 1.1; tank.hp = tank.def.hp; mech.cmdRepair(tank);
run(10, [mech]);
assert(Math.abs(tank.hp - tank.maxHp) < 1e-9, 'repair reaches veteran max health');

console.log(results.join('\n'));
console.log('ALL PASSED');
