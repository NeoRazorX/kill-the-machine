import { registerHooks } from 'node:module';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { TrackMarks, MAX_TRACK_MARKS, TRACK_LIFE, trackStyle } = await import('../src/track-marks.js');
const { DEFS } = await import('../src/config.js');
const assert = (ok, text) => { if (!ok) throw new Error(text); console.log(`PASS ${text}`); };
const fixture = (theme = 'temperate') => {
  const game = { theme: { id: theme }, isVisibleEntity: () => true, visibleAt: () => true };
  return { game, fx: new TrackMarks(game, new THREE.Group()) };
};
const unit = (id = 'h_tank') => ({ def: DEFS[id], radius: DEFS[id].radius, moving: true, x: 10, z: 10 });
function travel(fx, u, dx = 1, dz = 0, dt = .2) {
  const x = u.x, z = u.z; u.x += dx; u.z += dz; fx.emit(u, dt, x, z);
}
const position = (fx, i) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(fx.mesh.instanceMatrix.array, i * 16));

for (const theme of ['temperate', 'desert', 'ice']) {
  const { fx } = fixture(theme), u = unit();
  travel(fx, u, 0, .5); fx.update(.01);
  assert(fx.count === 2 && fx.mesh.count === 2, `${theme}: a tank presses both treads into the ground`);
  const [a, b] = [position(fx, 0), position(fx, 1)];
  assert(Math.abs(a.z - b.z) < 1e-6 && Math.abs(Math.abs(a.x - b.x) - u.radius * 1.24) < 1e-6 && a.y < .1,
    `${theme}: treads lie flat, side by side across the direction of travel`);
  assert(fx.alpha.array[0] > .3, `${theme}: fresh marks are clearly visible`);
}
{
  const { fx } = fixture(), u = unit();
  for (let i = 0; i < 20; i++) travel(fx, u, .45);
  const count = fx.count;
  u.moving = false; travel(fx, u);
  assert(count > 10 && fx.count === count, 'marks follow movement and stop when the vehicle stops');
  fx.update(TRACK_LIFE * .4);
  const fresh = fx.alpha.array[0];
  fx.update(TRACK_LIFE * .4);
  assert(fx.alpha.array[0] < fresh && fx.alpha.array[0] > 0, 'marks fade gradually in the second half of their life');
  fx.update(TRACK_LIFE * .3);
  assert(fx.count === 0 && fx.mesh.count === 0, 'marks disappear completely after their lifetime');
}
{
  const { game, fx } = fixture(), u = unit();
  game.isVisibleEntity = () => false; travel(fx, u);
  assert(fx.count === 0, 'hidden units leave no marks');
  game.isVisibleEntity = () => true; game.visibleAt = () => false; travel(fx, u);
  assert(fx.count === 0, 'fogged ground does not reveal enemy movement');
  game.spectate = true; travel(fx, u);
  assert(fx.count > 0, 'spectators see every mark');
}
for (const id of ['h_tank', 'h_harv', 'm_harv', 'h_radar', 'h_mech', 'm_welder', 'h_mammoth', 'h_arty']) assert(trackStyle(DEFS[id]) === 'tread', `${id}: leaves tread marks`);
for (const id of ['h_juggernaut', 'm_juggernaut']) assert(trackStyle(DEFS[id]) === 'feet', `${id}: leaves footprints`);
for (const id of ['m_crusher', 'm_siege', 'm_radar']) assert(trackStyle(DEFS[id]) === 'legs', `${id}: leaves spider leg prints`);
for (const id of ['h_rifle', 'h_medic', 'm_sentinel', 'm_drone', 'm_engineer']) {
  const { fx } = fixture(); travel(fx, unit(id));
  assert(fx.count === 0, `${id}: infantry and drones leave no vehicle marks`);
}
{
  const { fx } = fixture(), u = unit('h_juggernaut');
  for (let i = 0; i < 6; i++) travel(fx, u, u.radius * .95);
  const sides = Array.from({ length: fx.count }, (_, i) => Math.sign(position(fx, i).z - 10));
  assert(fx.count === 6 && sides.every((s, i) => !i || s === -sides[i - 1]) && fx.kind.array[0] === 1, 'walker footprints alternate left and right');
}
function marks(steps) {
  const { fx } = fixture(), u = unit();
  for (let i = 0; i < steps; i++) travel(fx, u, 24 / steps, 0, 4 / steps);
  return fx.count;
}
assert(Math.abs(marks(40) - marks(160)) <= 2, 'mark density depends on distance rather than frame rate');
{
  const { fx } = fixture(), u = unit();
  for (let i = 0; i < 400; i++) { travel(fx, u, 5); fx.update(.01); }
  assert(fx.count === MAX_TRACK_MARKS && fx.mesh.count === MAX_TRACK_MARKS && fx.next < MAX_TRACK_MARKS, 'mark pool is bounded and recycles the oldest marks');
}
console.log('ALL PASSED');
