import { registerHooks } from 'node:module';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const { findPath, clearLine, canOccupy } = await import('../src/pathfinding.js');
const { Unit } = await import('../src/units.js');
const { Game } = await import('../src/game.js');
const { N, CELL, DEFS } = await import('../src/config.js');
const { checkMap } = await import('./map.js');
const results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); results.push(`PASS ${text}`); };
const blank = () => {
  const grid = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) grid[i] = grid[(N - 1) * N + i] = grid[i * N] = grid[i * N + N - 1] = 1;
  return grid;
};
const rect = (grid, x, z, w, h) => { for (let j = z; j < z + h; j++) for (let i = x; i < x + w; i++) grid[j * N + i] = 1; };
const validRoute = (grid, path, x, z, radius) => {
  if (!path) return false;
  for (const p of path) {
    if (!clearLine(grid, x, z, p.x, p.z, radius)) return false;
    // Independently check the whole circle against every nearby obstacle at fine intervals.
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - x, p.z - z) / .05));
    for (let i = 0; i <= steps; i++) {
      const px = x + (p.x - x) * i / steps, pz = z + (p.z - z) * i / steps;
      for (let cz = Math.floor((pz - radius) / CELL); cz <= Math.floor((pz + radius) / CELL); cz++) for (let cx = Math.floor((px - radius) / CELL); cx <= Math.floor((px + radius) / CELL); cx++) {
        if (!grid[cz * N + cx]) continue;
        const qx = Math.max(cx * CELL, Math.min(px, (cx + 1) * CELL)), qz = Math.max(cz * CELL, Math.min(pz, (cz + 1) * CELL));
        if (Math.hypot(px - qx, pz - qz) <= radius - 1e-7) return false;
      }
    }
    x = p.x; z = p.z;
  }
  return true;
};
const atGoal = (path, x, z) => path && Math.hypot(path.at(-1).x - x, path.at(-1).z - z) < .01;
let grid = blank();
// A wall has a one-cell doorway, too narrow for a tank, and a wider detour.
rect(grid, 30, 1, 1, N - 2); grid[20 * N + 30] = 0;
for (let z = 40; z < 44; z++) grid[z * N + 30] = 0;
let path = findPath(grid, 51, 41, 71, 41, 1.5);
assert(atGoal(path, 71, 41) && validRoute(grid, path, 51, 41, 1.5) && path.some(p => p.z >= 80), 'tank avoids undersized doorway and takes the wide detour');
path = findPath(grid, 51, 41, 71, 41, .7);
assert(atGoal(path, 71, 41) && path.every(p => p.z < 50), 'infantry can still use the narrow doorway');
for (let z = 40; z < 44; z++) grid[z * N + 30] = 1;
path = findPath(grid, 51, 41, 71, 41, 1.5);
assert(!atGoal(path, 71, 41) && (!path || validRoute(grid, path, 51, 41, 1.5)), 'unreachable goal never produces a route through a narrow gap');
grid = blank(); rect(grid, 20, 20, 10, 10);
path = findPath(grid, 35, 50, 65, 50, 1.5);
assert(atGoal(path, 65, 50) && validRoute(grid, path, 35, 50, 1.5), 'smoothed route clears obstacle corners at full tank radius');
assert(!clearLine(grid, 38.7, 41, 38.7, 55, 1.5), 'full-radius sweep rejects wall clipping');
assert(!clearLine(grid, 39, 41, 39, 41, 1.5), 'zero-length segment still checks clearance');
path = findPath(grid, 35, 50, 39.5, 50, 1.5);
assert(path && canOccupy(grid, path.at(-1).x, path.at(-1).z, 1.5) && validRoute(grid, path, 35, 50, 1.5), 'unsafe destination is moved to a point with enough clearance');
assert(findPath(grid, 45, 45, 65, 50, 1.5) === null, 'invalid start cannot generate a path through an obstacle');

function tank(grid, x, z) {
  const game = { map: { grid }, navVersion: 1, canStand: Game.prototype.canStand };
  return Object.assign(Object.create(Unit.prototype), {
    game, def: DEFS.h_tank, radius: 1.5, x, z, heading: 0, speedMul: 1,
    path: null, dest: null, stuckCount: 0, stuckT: 0, lastPX: x, lastPZ: z,
  });
}
let u = tank(grid, 35, 50); u.pathTo(65, 50);
let arrived = false;
for (let i = 0; i < 1600; i++) {
  arrived = u.followPath(.05);
  if (!canOccupy(grid, u.x, u.z, u.radius)) throw new Error('Tank clipped an obstacle during movement');
  if (arrived) break;
}
assert(arrived && Math.hypot(u.x - 65, u.z - 50) < .6, 'tank actually drives around the corner without clipping or stalling');
grid = blank(); u = tank(grid, 30, 30); u.heading = Math.PI / 2;
u.pathTo(90, 30); u.game.canStand = () => false;
let attempts = 0; const realPathTo = u.pathTo;
u.pathTo = function(...args) { attempts++; return realPathTo.apply(this, args); };
arrived = false;
for (let i = 0; i < 150; i++) { if (u.followPath(.05)) { arrived = true; break; } }
assert(arrived && !u.path && u.stuckCount >= 7 && attempts === 2, 'permanent blockage stops after bounded recovery instead of resetting forever');
u.game.canStand = Game.prototype.canStand; u.pathTo(70, 30);
assert(u.stuckCount === 0, 'new destination resets recovery attempts');
for (let i = 0; i < 200; i++) if (u.followPath(.05)) break;
assert(Math.hypot(u.x - 70, u.z - 30) < .6, 'unit accepts a fresh move after failed recovery');
u = tank(grid, 30, 30); u.heading = Math.PI / 2; u.pathTo(70, 30); u.game.canStand = () => false;
for (let i = 0; i < 25; i++) u.followPath(.05);
u.game.canStand = Game.prototype.canStand;
for (let i = 0; i < 250; i++) if (u.followPath(.05)) break;
assert(Math.hypot(u.x - 70, u.z - 30) < .6, 'temporary blockage recovers and reaches destination');
// A newly placed building invalidates the route; navigation must plan around it.
grid = blank(); u = tank(grid, 30, 30); u.heading = Math.PI / 2; u.pathTo(90, 30);
rect(grid, 25, 10, 5, 10); u.game.navVersion++;
for (let i = 0; i < 700; i++) {
  const done = u.followPath(.05);
  if (!canOccupy(grid, u.x, u.z, u.radius)) throw new Error('Building replan clipped a wall');
  if (done) break;
}
assert(Math.hypot(u.x - 90, u.z - 30) < .6, 'building placement triggers a radius-safe replacement route');
// Real map routes for the largest ground unit, including actual steering around corners.
const { GameMap } = await import('../src/map.js');
for (const seed of [20260, 20261, 20262, 20263]) {
  const map = new GameMap(seed);
  for (const radius of [1.5, 1.6]) {
    const route = findPath(map.grid, 48, 200, 206, 54, radius);
    assert(atGoal(route, 206, 54) && validRoute(map.grid, route, 48, 200, radius), `seed ${seed}: full-size ${radius} route across quarry`);
  }
  const vehicle = tank(map.grid, 48, 200); vehicle.pathTo(206, 54);
  for (let i = 0; i < 4000; i++) if (vehicle.followPath(.05)) break;
  assert(Math.hypot(vehicle.x - 206, vehicle.z - 54) < .6, `seed ${seed}: tank reaches the other base in simulation`);
}
console.log(results.join('\n'));
console.log(checkMap());
console.log('ALL PASSED');
