import { GameMap } from '../src/map.js';
import { N, CELL, TEAMS } from '../src/config.js';
import { clearLine, findPath } from '../src/pathfinding.js';

export function checkMap() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  for (let seed = 20260; seed < 20292; seed++) {
    const map = new GameMap(seed);
    assert(map.checkConnectivity(), `seed ${seed}: bases and resources connected`);
    assert(map.landmarks.length === 10, `seed ${seed}: authored landmarks preserved`);
    for (const route of map.routes) for (let i = 1; i < route.length; i++) {
      const [ax, az] = route[i - 1], [bx, bz] = route[i];
      assert(clearLine(map.grid, ax * CELL, az * CELL, bx * CELL, bz * CELL, 5), `seed ${seed}: formation corridor blocked`);
    }
    for (const team of Object.values(TEAMS)) {
      const [x, z] = team.startCell;
      for (const field of map.fields) {
        const path = findPath(map.grid, x * CELL, z * CELL, field.x, field.z, 1.2);
        assert(path?.length && Math.hypot(path.at(-1).x - field.x, path.at(-1).z - field.z) < .01, `seed ${seed}: unreachable mineral`);
      }
    }
    for (let i = 0; i < N; i++) assert(map.blockedCell(i, 0) && map.blockedCell(i, N - 1) && map.blockedCell(0, i) && map.blockedCell(N - 1, i), 'sealed boundary');
    for (const l of map.landmarks) assert(map.blockedXZ(l.x, l.z), 'landmark has navigation obstacle');
  }
  const a = new GameMap(20260), b = new GameMap(20260);
  assert(a.grid.every((value, i) => value === b.grid[i]), 'repeatable navigation');
  assert(JSON.stringify(a.trees) === JSON.stringify(b.trees), 'repeatable decoration');
  return 'PASS: 32 seeds; formation clearance, resource paths, boundaries, landmarks and reproducibility.';
}
