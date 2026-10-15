import { registerHooks } from 'node:module';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { GroundTrails, MAX_GROUND_PARTICLES } = await import('../src/ground-trails.js');
const { Unit } = await import('../src/units.js');
const { DEFS } = await import('../src/config.js');
const assert = (ok, text) => { if (!ok) throw new Error(text); console.log(`PASS ${text}`); };
const fixture = (theme = 'desert') => {
  const game = { theme: { id: theme }, isVisibleEntity: () => true, visibleAt: () => true };
  return { game, fx: new GroundTrails(game, new THREE.Group()) };
};
function unit(id = 'h_tank') {
  const def = DEFS[id];
  return { def, radius: def.radius, moving: true, x: 10, z: 10 };
}
function travel(fx, u, dx = 1, dz = 0, dt = .2) {
  const x = u.x, z = u.z; u.x += dx; u.z += dz; fx.emit(u, dt, x, z);
}
for (const theme of ['desert', 'ice']) {
  const { game, fx } = fixture(theme), u = unit();
  travel(fx, u);
  assert(fx.n === 2, `${theme}: moving tank emits at both ground contact sides`);
  assert(fx.particles.slice(0, fx.n).every(p => p.x < u.x && p.y < .3), `${theme}: particles originate behind the vehicle at ground level`);
  const p = fx.particles[0], y = p.y;
  fx.update(.1);
  assert(p.y > y && fx.mesh.count === fx.n && fx.alpha.array[0] > 0, `${theme}: particles lift and become visible`);
  assert(p.snow === (theme === 'ice') && (theme === 'ice' ? p.gravity > 0 && p.life < 1 : p.gravity < 0 && p.life > 1),
    `${theme}: snow falls quickly while dust expands and lingers`);
  const count = fx.n;
  u.moving = false; travel(fx, u);
  assert(fx.n === count, `${theme}: stopping suppresses emission even when separation shifts the unit`);
  fx.update(3);
  assert(fx.n === 0 && fx.mesh.count === 0, `${theme}: particles expire completely`);
  u.moving = true;
  game.isVisibleEntity = () => false; travel(fx, u);
  assert(fx.n === 0, `${theme}: hidden units emit nothing`);
  game.isVisibleEntity = () => true; game.visibleAt = () => false; travel(fx, u);
  assert(fx.n === 0, `${theme}: hidden ground cannot show a trail`);
  game.spectate = true; travel(fx, u);
  assert(fx.n > 0, `${theme}: spectators see movement effects`);
  game.spectate = false; fx.update(.01);
  assert(fx.n === 0, `${theme}: existing trails disappear when visibility is lost`);
}
for (const id of ['h_harv', 'm_harv', 'h_radar', 'm_radar', 'h_mech', 'm_welder', 'h_mammoth', 'm_juggernaut']) {
  const { fx } = fixture(); travel(fx, unit(id));
  assert(fx.n > 0, `${id}: ground vehicle emits a trail`);
}
for (const id of ['h_rifle', 'h_medic', 'm_sentinel', 'm_drone', 'm_engineer']) {
  const { fx } = fixture(); travel(fx, unit(id));
  assert(fx.n === 0, `${id}: infantry and hovering drones do not emit vehicle trails`);
}
assert((() => { const { fx } = fixture('temperate'); travel(fx, unit()); return fx.n === 0; })(), 'temperate map keeps its existing appearance');
function emissions(steps, id = 'h_tank') {
  const { fx } = fixture(), u = unit(id);
  for (let i = 0; i < steps; i++) travel(fx, u, 24 / steps, 0, 4 / steps);
  return fx.n;
}
assert(Math.abs(emissions(40) - emissions(160)) <= 2, 'emission depends on distance rather than frame rate');
assert(emissions(80, 'h_mammoth') > emissions(80), 'larger vehicles lift more particles over the same distance');
const { fx } = fixture(), u = unit(), pool = new Set(fx.particles);
for (let i = 0; i < 200; i++) travel(fx, u, 10);
assert(fx.n === MAX_GROUND_PARTICLES && fx.particles.every(p => pool.has(p)), 'particle count is capped and uses the preallocated pool');
fx.update(3); travel(fx, u);
assert(fx.n > 0 && fx.particles.every(p => pool.has(p)), 'expired particle slots are reused');

let emitted = 0;
const moving = Object.assign(Object.create(Unit.prototype), {
  x: 0, z: 0, cooldown: 0, def: {}, heading: 0,
  game: { fx: { groundTrails: { emit(u, dt, x) { if (u.moving && u.x > x) emitted++; } } } },
  updateCombat() { this.x += 1; this.moving = true; }, separate() {}, syncMesh() {},
});
moving.update(.1);
moving.updateCombat = () => {}; moving.separate = () => { moving.x += 1; };
moving.update(.1);
assert(emitted === 1, 'unit simulation emits for real travel and excludes stationary separation');
console.log('ALL PASSED');
