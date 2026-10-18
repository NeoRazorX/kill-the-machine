import { GameMap, borderDecor, LAYOUTS } from '../src/map.js';
import { N, CELL, SIZE } from '../src/config.js';
import { clearLine, findPath } from '../src/pathfinding.js';

export function checkMap() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  for (let seed = 20260; seed < 20292; seed++) {
    const map = new GameMap(seed);
    assert(map.checkConnectivity(), `seed ${seed}: bases and resources connected`);
    assert(map.landmarks.length === 36, `seed ${seed}: authored landmarks preserved`);
    assert(map.spawns.length === 4, `seed ${seed}: four starting corners`);
    // Each corner is the rotation of the previous one, so every pairing of starts is fair.
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      assert(map.grid[z * N + x] === map.grid[x * N + N - 1 - z], `seed ${seed}: terrain has four-fold symmetry`);
    }
    for (const route of map.routes) for (let i = 1; i < route.length; i++) {
      const [ax, az] = route[i - 1], [bx, bz] = route[i];
      assert(clearLine(map.grid, ax * CELL, az * CELL, bx * CELL, bz * CELL, 5), `seed ${seed}: formation corridor blocked`);
    }
    for (const [x, z] of map.spawns) {
      for (const field of map.fields) {
        const path = findPath(map.grid, x * CELL, z * CELL, field.x, field.z, 1.2);
        assert(path?.length && Math.hypot(path.at(-1).x - field.x, path.at(-1).z - field.z) < .01, `seed ${seed}: unreachable mineral`);
      }
    }
    for (let i = 0; i < N; i++) assert(map.blockedCell(i, 0) && map.blockedCell(i, N - 1) && map.blockedCell(0, i) && map.blockedCell(N - 1, i), 'sealed boundary');
    for (const l of map.landmarks) assert(map.blockedXZ(l.x, l.z), 'landmark has navigation obstacle');
  }
  // Perimeter scenery is decoration only: nothing may stand inside the playable square.
  const outside = (x, z, r) => Math.max(-x, x - SIZE, -z, z - SIZE) >= r;
  const border = borderDecor(20260);
  assert(border.cliffs.every(c => outside(c.x, c.z, c.r)), 'perimeter rock stays outside the playable area');
  assert([...border.rocks, ...border.trees].every(e => outside(e.x, e.z, 1)), 'perimeter scree and trees stay outside the playable area');
  assert(JSON.stringify(borderDecor(20260)) === JSON.stringify(border), 'repeatable perimeter scenery');
  const a = new GameMap(20260), b = new GameMap(20260);
  assert(a.grid.every((value, i) => value === b.grid[i]), 'repeatable navigation');
  assert(JSON.stringify(a.trees) === JSON.stringify(b.trees), 'repeatable decoration');
  assert(!a.hasWater && a.water.every((w) => w === 0), 'the quarry has no water');
  const river = checkRiver(), pass = checkPass();
  return `PASS: 32 seeds; four-fold symmetry, formation clearance, resource paths from every start, boundaries, landmarks, perimeter scenery and reproducibility. ${river} ${pass}`;
}

// Río Partido: mirror symmetry on both axes, rivals on opposite banks, and the river crossed only at fords.
export function checkRiver() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  for (let seed = 20260; seed < 20276; seed++) {
    const map = new GameMap(seed, LAYOUTS.river);
    assert(map.checkConnectivity(), `river ${seed}: bases and resources connected`);
    assert(map.spawns.length === 4 && map.landmarks.length === 24, `river ${seed}: four starts and every authored landmark`);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x, v = map.grid[i], w = map.water[i];
      assert(v === map.grid[z * N + N - 1 - x] && v === map.grid[(N - 1 - z) * N + x], `river ${seed}: terrain mirrored on both axes`);
      assert(w === map.water[z * N + N - 1 - x] && w === map.water[(N - 1 - z) * N + x], `river ${seed}: water mirrored on both axes`);
      assert(w !== 1 || v === 1, `river ${seed}: deep water blocks movement`);
      assert(w !== 2 || v === 0, `river ${seed}: fords stay open`);
    }
    // Rivals start on opposite banks; a base's neighbour on its own bank is never a rival.
    map.spawns.forEach(([, z], i) => {
      const rivals = map.rivalSlots(i);
      assert(rivals.length === 2 && rivals.every((j) => (map.spawns[j][1] < N / 2) !== (z < N / 2)), `river ${seed}: rivals across the river`);
    });
    for (const route of map.routes) for (let i = 1; i < route.length; i++) {
      const [ax, az] = route[i - 1], [bx, bz] = route[i];
      assert(clearLine(map.grid, ax * CELL, az * CELL, bx * CELL, bz * CELL, 5), `river ${seed}: formation corridor blocked`);
    }
    // Every crossing from one bank to the other wades through a ford.
    const [sx, sz] = map.spawns[0], [tx, tz] = map.spawns[2];
    const path = findPath(map.grid, sx * CELL, sz * CELL, tx * CELL, tz * CELL, 1.6);
    assert(path?.length, `river ${seed}: the banks are connected`);
    let wades = false, px = sx * CELL, pz = sz * CELL;
    for (const p of path) {
      const steps = Math.ceil(Math.hypot(p.x - px, p.z - pz));
      for (let s = 0; s <= steps; s++) wades ||= map.waterXZ(px + (p.x - px) * s / steps, pz + (p.z - pz) * s / steps) === 2;
      px = p.x; pz = p.z;
    }
    assert(wades, `river ${seed}: the path across wades a ford`);
    for (const [x, z] of map.spawns) for (const field of map.fields) {
      const route = findPath(map.grid, x * CELL, z * CELL, field.x, field.z, 1.6);
      assert(route?.length && Math.hypot(route.at(-1).x - field.x, route.at(-1).z - field.z) < .01, `river ${seed}: unreachable mineral`);
    }
    for (const t of map.trees) assert(!map.waterXZ(t.x, t.z), `river ${seed}: no trees in the water`);
  }
  return 'River: 16 seeds; mirror symmetry, deep water blocks and fords stay open, rivals across the river, crossings through fords, resources reachable.';
}

// Duelo del Paso: two opposite corners, a ridge sealed from corner to corner and three passes through it.
export function checkPass() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const passes = [48, N / 2, N - 48];
  for (let seed = 20260; seed < 20276; seed++) {
    const map = new GameMap(seed, LAYOUTS.pass);
    assert(map.checkConnectivity(), `pass ${seed}: bases and resources connected`);
    assert(map.spawns.length === 2 && map.rivalSlots(0).join() === '1' && map.rivalSlots(1).join() === '0', `pass ${seed}: two starts that always face each other`);
    assert(map.landmarks.length === 40, `pass ${seed}: every authored landmark, the whole ridge included`);
    assert(!map.hasWater, `pass ${seed}: no water`);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const v = map.grid[z * N + x];
      assert(v === map.grid[x * N + z] && v === map.grid[(N - 1 - z) * N + N - 1 - x], `pass ${seed}: terrain symmetric about both diagonals`);
    }
    for (const route of map.routes) for (let i = 1; i < route.length; i++) {
      const [ax, az] = route[i - 1], [bx, bz] = route[i];
      assert(clearLine(map.grid, ax * CELL, az * CELL, bx * CELL, bz * CELL, 5), `pass ${seed}: formation corridor blocked`);
    }
    // Sealing each pass in turn leaves the others open; sealing all three cuts the map in two.
    const reach = (sealed) => {
      const grid = map.grid.slice();
      for (const t of sealed) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        if (Math.abs(x + .5 - (z + .5)) < 20 && Math.abs((x + z + 1) / 2 - t) < 12) grid[z * N + x] = 1;
      }
      // Flood fill over every free cell, diagonals only between two free sides, as units move.
      const [[ax, az], [bx, bz]] = map.spawns, seen = new Uint8Array(N * N), queue = [az * N + ax];
      const free = (x, z) => x >= 0 && z >= 0 && x < N && z < N && !grid[z * N + x];
      seen[queue[0]] = 1;
      for (let h = 0; h < queue.length; h++) {
        const x = queue[h] % N, z = (queue[h] / N) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const i = (z + dz) * N + x + dx;
          if ((!dx && !dz) || !free(x + dx, z + dz) || seen[i] || (dx && dz && (!free(x + dx, z) || !free(x, z + dz)))) continue;
          seen[i] = 1; queue.push(i);
        }
      }
      return seen[bz * N + bx] === 1;
    };
    assert(!reach(passes), `pass ${seed}: the ridge can only be crossed at its three passes`);
    for (const open of passes) assert(reach(passes.filter((t) => t !== open)), `pass ${seed}: the pass at ${open} crosses the ridge`);
    for (const [x, z] of map.spawns) for (const field of map.fields) {
      const route = findPath(map.grid, x * CELL, z * CELL, field.x, field.z, 1.6);
      assert(route?.length && Math.hypot(route.at(-1).x - field.x, route.at(-1).z - field.z) < .01, `pass ${seed}: unreachable mineral`);
    }
  }
  return 'Pass: 16 seeds; symmetry about both diagonals, ridge crossed only at its three passes, each pass open, resources reachable.';
}
