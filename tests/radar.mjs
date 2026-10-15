import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { Unit } = await import('../src/units.js');
const { AI } = await import('../src/ai.js');
const { Input } = await import('../src/input.js');
const { preloadModels } = await import('../src/assets.js');
const { ROLE, UNIT_ROLES, N, SIZE, DIFFICULTY, other } = await import('../src/config.js');
const assert = (ok, text) => { if (!ok) throw new Error(text); console.log(`PASS ${text}`); };
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async url => new Response(await readFile(url));
  await preloadModels();
} finally { globalThis.fetch = originalFetch; }

for (const team of ['human', 'machine']) {
  const game = Object.assign(Object.create(Game.prototype), {
    player: team, spectate: false, time: 200, units: [], buildings: [], navVersion: 1,
    scene: new THREE.Scene(), map: { grid: new Uint8Array(N * N), spawns: [[10,10],[180,180],[180,10],[10,180]] },
    starts: { [team]: [10,10] },
    fog: new Uint8Array(N * N), fogData: new Uint8Array(N * N * 4),
    fogImg: { data: new Uint8Array(N * N * 4) }, fogTex: {}, fogCtx: { putImageData() {} },
    buckets: Array.from({ length: (SIZE / 8) ** 2 }, () => []), _q: [],
    fx: { fireWeapon() { throw new Error('Unarmed radar fired'); } },
    cashCrates: { items: [], discoveredBy: () => [] }, techSites: { items: [] },
  });
  const radar = new Unit(game, ROLE[team].radar, 100, 100, team);
  game.units.push(radar);
  const enemy = new Unit(game, ROLE[other(team)].tank, 150, 100, other(team));
  game.units.push(enemy);
  assert(UNIT_ROLES.factory.includes('radar') && radar.def.sight > ROLE[team].tank.sight * 2,
    `${team}: factory radar has more than twice a tank's detection radius`);
  assert(!game.queueUnit(team, radar.def.id), `${team}: cannot queue without a factory`);
  game.buildings.push({ team, def: ROLE[team].factory, complete: true, queue: [] });
  assert(game.queueUnit(team, radar.def.id) && game.queuedCount(team, radar.def.id) === 1,
    `${team}: available from the factory production queue`);
  game.buildings.length = 0;
  game.updateFog();
  assert(game.isVisibleEntity(enemy) && !game.visibleAt(170, 100) && !game.visibleAt(150, 150),
    `${team}: detects a distant enemy within a circular, bounded radius`);
  const dish = radar.parts.dish, yaw = dish.rotation.y;
  radar.syncMesh(.5);
  assert(dish.rotation.y !== yaw, `${team}: antenna rotates while stationary`);
  radar.heading = 0; radar.syncMesh(0);
  for (let i = 0; i < 16; i++) {
    dish.rotation.y = i * Math.PI / 8;
    radar.mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(radar.mesh);
    assert(b.min.y >= -.04 && b.max.y <= radar.def.height + .16 &&
      Math.max(b.max.x-radar.x,radar.x-b.min.x,b.max.z-radar.z,radar.z-b.min.z) < 1.85,
      `${team}: rotating model fits vehicle bounds (${i})`);
  }
  radar.cmdMove(240, 100, true);
  assert(radar.order.type === 'move', `${team}: attack-move safely becomes movement for an unarmed radar`);
  let accompanying = false;
  Input.prototype.attackMoveAt.call({
    groundAt: () => ({ x: 240, z: 100 }), selUnits: () => [radar],
    orderMove(units, x, z, attackMove) { accompanying = units.includes(radar) && attackMove; },
    game: { fx: { marker() {} }, audio: { play() {} } },
  }, 0, 0);
  assert(accompanying, `${team}: player attack-move includes the radar so it accompanies selected troops`);
  for (let i = 0; i < 650; i++) { game.time += .05; game.rebuildHash(); radar.update(.05); }
  assert(Math.hypot(radar.x-240,radar.z-100) < 1, `${team}: radar reaches its destination`);
  game.updateFog();
  assert(!game.isVisibleEntity(enemy) && game.visibleAt(290,100) && game.fog[50*N+75] === 1,
    `${team}: coverage follows movement and old terrain stays explored`);
  radar.dead = true; game.updateFog();
  assert(!game.visibleAt(290,100), `${team}: destroyed radar stops providing detection`);
  radar.dead = false; radar.becomeIdle();
  const ai = new AI(game, team, DIFFICULTY.normal);
  ai.manageScout();
  assert(ai.scout === radar && radar.order.type === 'move' && !ai.armyIdle().includes(radar),
    `${team}: AI uses radar for reconnaissance without assigning it to combat waves`);
}
console.log('ALL PASSED');
