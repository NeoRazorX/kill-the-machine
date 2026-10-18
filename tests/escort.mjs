// Group orders: armour leads the formation, and unarmed support escorts the attackers from behind.
import { registerHooks } from 'node:module';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { Unit } = await import('../src/units.js');
const { Input } = await import('../src/input.js');
const { DEFS, N } = await import('../src/config.js');

const results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); results.push(`PASS ${text}`); };
const game = Object.assign(Object.create(Game.prototype), {
  player: 'human', spectate: true, time: 0, units: [], buildings: [], navVersion: 1,
  map: { grid: new Uint8Array(N * N), blockedXZ: () => false }, scene: new THREE.Scene(),
  fx: { repairBeam() {}, marker() {}, fireWeapon() {} }, audio: { play() {} }, cashCrates: { at: () => null },
  queryUnits() { return this.units; }, isVisibleEntity: () => true,
});
function unit(id, x, z) {
  const def = DEFS[id];
  const u = Object.assign(Object.create(Unit.prototype), {
    game, kind: 'unit', def, team: def.team, id: game.units.length + 1, x, z, heading: 0, aim: 0,
    hp: def.hp, maxHp: def.hp, radius: def.radius, cls: def.cls, dead: false, order: { type: 'idle' },
    guard: { x, z }, cooldown: 0, scanT: 0, repathT: 0, stuckT: 0, stuckCount: 0, lastPX: x, lastPZ: z,
    path: null, dest: null, target: null, speedMul: 1, attackMoveDefault: false, mesh: new THREE.Group(), parts: {},
  });
  u.syncMesh = () => {};
  game.units.push(u);
  return u;
}
const input = Object.assign(Object.create(Input.prototype), { game });
const toward = (o, gx, gz) => { const l = Math.hypot(gx - o.x, gz - o.z); return (p) => ((p.x - o.x) * (gx - o.x) + (p.z - o.z) * (gz - o.z)) / l; };

// A mixed column on the move, with the radar and the repairer leading it towards the goal.
function column() {
  game.units.length = 0;
  const radar = unit('h_radar', 60, 70), mech = unit('h_mech', 64, 68);
  const tanks = [unit('h_tank', 60, 60), unit('h_tank', 64, 60), unit('h_tank', 68, 60)];
  const arty = [unit('h_arty', 60, 52), unit('h_arty', 64, 52), unit('h_arty', 68, 52)];
  return { radar, mech, tanks, arty, all: [radar, mech, ...tanks, ...arty] };
}

// Formation: the plain move order keeps everyone in the block, armour in front, support at the back.
{
  const { radar, mech, tanks, arty, all } = column();
  const slots = input.formation(all, 64, 140);
  const c = { x: all.reduce((a, u) => a + u.x, 0) / all.length, z: all.reduce((a, u) => a + u.z, 0) / all.length };
  const fwd = toward(c, 64, 140), f = (u) => fwd(slots[all.indexOf(u)]);
  const front = Math.max(...slots.map(fwd));
  assert(tanks.every((t) => Math.abs(f(t) - front) < 1e-6), 'tanks take the front row');
  assert(Math.max(f(radar), f(mech)) < Math.min(...tanks.map(f)) && Math.max(f(radar), f(mech)) <= Math.min(...arty.map(f)) + 1e-6,
    'support takes the rear row, behind armour and artillery');
  const row = tanks.slice().sort((a, b) => a.x - b.x).map((t) => slots[all.indexOf(t)].x);
  assert(row[0] < row[1] && row[1] < row[2], 'units keep their side within a row, so paths do not cross');
  input.orderMove(all, 64, 140);
  assert(all.every((u) => u.order.type === 'move'), 'a plain move keeps support in the formation');
}

// Attack-move: support no longer takes a place up front, it escorts the armed units.
{
  const { radar, mech, tanks, arty } = column();
  input.orderMove([radar, mech, ...tanks, ...arty], 64, 140, true);
  assert([...tanks, ...arty].every((u) => u.order.type === 'attackmove'), 'armed units attack-move');
  assert(radar.order.type === 'escort' && mech.order.type === 'escort' && radar.order.group.length === 6,
    'radar and repairer escort the armed units on attack-move');
  assert(radar.order.slot !== mech.order.slot, 'escorts take separate places behind the group');
}

// Right click on an enemy: the armed units attack it, the support follows them instead of driving at it.
{
  const { radar, mech, tanks, arty } = column();
  const enemy = unit('m_crusher', 64, 150);
  const sel = [radar, mech, ...tanks, ...arty];
  Object.assign(input, { selUnits: () => sel, groundAt: () => ({ x: 64, z: 150 }), pickEntity: () => enemy });
  input.commandAt(0, 0);
  assert([...tanks, ...arty].every((u) => u.order.type === 'attack' && u.order.target === enemy), 'armed units attack the target');
  assert(radar.order.type === 'escort' && radar.order.goal === enemy && mech.order.type === 'escort', 'support escorts instead of attacking');
  const alone = unit('h_radar', 30, 30);
  Object.assign(input, { selUnits: () => [alone] });
  input.commandAt(0, 0);
  assert(alone.order.type === 'move', 'a radar ordered at an enemy on its own still drives there');
  enemy.dead = true; alone.dead = true;

  // Simulate the advance: the radar is the fastest and starts ahead, yet ends behind every tank.
  const moving = [...tanks, ...arty];
  moving.forEach((u, i) => u.cmdMove(56 + (i % 3) * 8, 120 - Math.floor(i / 3) * 8));
  radar.cmdEscort(moving, { x: 64, z: 150 }, 0, 2); mech.cmdEscort(moving, { x: 64, z: 150 }, 1, 2);
  const fwd = toward({ x: 64, z: 56 }, 64, 150);
  let ahead = 0;
  for (let t = 0; t < 30; t += 0.05) {
    game.time = t;
    for (const u of game.units) if (!u.dead) u.update(0.05);
    if (t > 6 && fwd(radar) > Math.min(...moving.map(fwd))) ahead++;
  }
  const rear = Math.min(...moving.map(fwd));
  assert(ahead === 0, 'after falling back the radar never moves ahead of the group');
  assert(fwd(radar) < rear - 8 && fwd(mech) < rear - 3, `support settles behind the rearmost unit (radar ${(rear - fwd(radar)).toFixed(1)}, repairer ${(rear - fwd(mech)).toFixed(1)})`);
  assert(Math.hypot(radar.x - mech.x, radar.z - mech.z) > 2, 'the escorts do not stack on one spot');
  assert(fwd(radar) > rear - 30, 'the radar keeps up with the group');

  // A wounded tank gets repaired by its escort, which then returns to its place.
  tanks[0].hp = 200;
  for (let t = 0; t < 30 && tanks[0].hp < tanks[0].maxHp; t += 0.05) for (const u of game.units) if (!u.dead) u.update(0.05);
  assert(tanks[0].hp === tanks[0].maxHp && mech.order.type === 'escort', 'the escorting repairer fixes the wounded and keeps escorting');

  for (const u of moving) u.dead = true;
  for (const u of [radar, mech]) u.update(0.05);
  assert(radar.order.type === 'idle' && mech.order.type === 'idle', 'escorts stop when the whole group is gone');
}

console.log(results.join('\n'));
console.log('ALL PASSED');
