import * as THREE from 'three';
import { getInstanceAsset } from './assets.js';
import { N, CELL, SIZE, TEAMS } from './config.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distances in cells. These authored corridors also reserve space for formations.
export function routeDistance(x, z, routes) {
  let best = Infinity;
  for (const route of routes) for (let i = 1; i < route.length; i++) {
    const [ax, az] = route[i - 1], [bx, bz] = route[i];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// grid: 0 libre, 1 obstáculo estático, 2 edificio
export class GameMap {
  constructor(seed = 20260) {
    this.seed = seed;
    this.name = 'Cantera del Umbral';
    const halfRoutes = [
      [[24, 100], [40, 94], [48, 80], [64, 64]],
      [[24, 100], [27, 79], [34, 66], [20, 52], [25, 33], [48, 27], [64, 24]],
      [[34, 66], [48, 66], [64, 64]],
      [[27, 79], [48, 80]],
    ];
    this.routes = [...halfRoutes, ...halfRoutes.map(r => r.map(([x, z]) => [N - x, N - z]))];
    this.routes.push([[64, 24], [88, 34], [104, 28]], [[64, 104], [40, 94], [24, 100]]);
    this.grid = new Uint8Array(N * N);
    this.trees = [];
    this.rocks = [];
    this.fields = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      this.generate(seed + attempt * 101);
      if (this.checkConnectivity()) return;
    }
    throw new Error('Could not generate a connected quarry map');
  }

  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < N && cz < N; }
  blockedCell(cx, cz) { return cx < 0 || cz < 0 || cx >= N || cz >= N || this.grid[cz * N + cx] !== 0; }
  blockedXZ(x, z) { return this.blockedCell(Math.floor(x / CELL), Math.floor(z / CELL)); }

  generate(seed) {
    const rng = mulberry32(seed);
    this.grid.fill(0);
    this.trees = []; this.rocks = []; this.fields = []; this.landmarks = [];
    for (let i = 0; i < N; i++) {
      this.grid[i] = this.grid[(N - 1) * N + i] = 1;
      this.grid[i * N] = this.grid[i * N + N - 1] = 1;
    }
    const starts = [TEAMS.human.startCell, TEAMS.machine.startCell];
    const nearStart = (cx, cz, r) => starts.some((s) => Math.hypot(cx - s[0], cz - s[1]) < r);
    const nearField = (cx, cz, m) => this.fields.some((f) => Math.hypot(cx + 0.5 - f.x / CELL, cz + 0.5 - f.z / CELL) < f.r / CELL + m);

    // Campos de mineral (simétricos respecto al centro)
    const addField = (cx, cz, rc, amount) => {
      this.fields.push({ x: cx * CELL, z: cz * CELL, r: rc * CELL, amount, max: amount, id: this.fields.length });
    };
    const hs = TEAMS.human.startCell;
    const specs = [
      [hs[0] + 16, hs[1] - 6, 5, 7000],
      [hs[0] + 3, hs[1] - 21, 4, 6000],
      [34, 66, 5, 9000],
      [20, 52, 4, 7000],
    ];
    for (const [cx, cz, r, a] of specs) { addField(cx, cz, r, a); addField(N - cx, N - cz, r, a); }
    addField(N / 2, N / 2, 6, 14000);

    const reserved = (cx, cz) => nearStart(cx, cz, 18) || nearField(cx, cz, 4) || routeDistance(cx + 0.5, cz + 0.5, this.routes) < 4;
    const free = (cx, cz) => !this.blockedCell(cx, cz) && !reserved(cx, cz);
    // Large authored obstacles define the battlefield; their entire visual footprint is blocked.
    const addLandmark = (cx, cz, radius, kind, rotation = 0) => {
      const cells = [];
      for (let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++) {
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
          if (Math.hypot(x + .5 - cx, z + .5 - cz) > radius + .7) continue;
          if (!this.inBounds(x, z) || reserved(x, z) || this.blockedCell(x, z)) return;
          cells.push([x, z]);
        }
      }
      for (const [x, z] of cells) this.grid[z * N + x] = 1;
      this.landmarks.push({ x: cx * CELL, z: cz * CELL, radius: radius * CELL, kind, rot: rotation });
    };
    for (const [x, z, r, kind] of [[51, 49, 8, 'env_cliff'], [12, 72, 5, 'env_cliff'], [43, 14, 7, 'env_cliff'], [8, 23, 5, 'env_cliff'], [43, 39, 3, 'env_ruin']]) {
      addLandmark(x, z, r, kind, 0);
      addLandmark(N - x, N - z, r, kind, Math.PI);
    }
    const mirrorCell = (cx, cz) => [N - 1 - cx, N - 1 - cz];

    const placeTree = (cx, cz, jx, jz, s, rot) => {
      const [mx, mz] = mirrorCell(cx, cz);
      if (!free(cx, cz) || !free(mx, mz) || nearField(cx, cz, 1.5) || nearField(mx, mz, 1.5)) return;
      if (cx === mx && cz === mz) return;
      this.grid[cz * N + cx] = 1; this.grid[mz * N + mx] = 1;
      this.trees.push({ x: (cx + 0.5 + jx) * CELL, z: (cz + 0.5 + jz) * CELL, s, rot });
      this.trees.push({ x: SIZE - (cx + 0.5 + jx) * CELL, z: SIZE - (cz + 0.5 + jz) * CELL, s, rot: rot + Math.PI });
    };
    const placeRock = (cx, cz, s, rot) => {
      const cells = [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx + 1, cz + 1]];
      const mcells = cells.map(([a, b]) => mirrorCell(a, b));
      if (![...cells, ...mcells].every(([a, b]) => free(a, b) && !nearField(a, b, 1.5))) return;
      if (cells.some(([a, b]) => mcells.some(([c, d]) => a === c && b === d))) return;
      for (const [a, b] of [...cells, ...mcells]) this.grid[b * N + a] = 1;
      this.rocks.push({ x: (cx + 1) * CELL, z: (cz + 1) * CELL, s, rot });
      this.rocks.push({ x: SIZE - (cx + 1) * CELL, z: SIZE - (cz + 1) * CELL, s, rot: rot + 1.3 });
    };

    for (let k = 0; k < 65; k++) {
      const ccx = 4 + Math.floor(rng() * (N - 8));
      const ccz = 4 + Math.floor(rng() * (N - 8));
      if (rng() < 0.62) {
        const n = 10 + Math.floor(rng() * 16), R = 3 + rng() * 3;
        for (let i = 0; i < n; i++) {
          const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * R;
          placeTree(Math.round(ccx + Math.cos(a) * d), Math.round(ccz + Math.sin(a) * d),
            (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6, 0.85 + rng() * 0.6, rng() * 6.28);
        }
      } else {
        const n = 2 + Math.floor(rng() * 4);
        for (let i = 0; i < n; i++) {
          const a = rng() * Math.PI * 2, d = rng() * 5;
          placeRock(Math.round(ccx + Math.cos(a) * d), Math.round(ccz + Math.sin(a) * d), 0.85 + rng() * 0.5, rng() * 6.28);
        }
      }
    }
  }

  checkConnectivity() {
    const [ax, az] = TEAMS.human.startCell, [bx, bz] = TEAMS.machine.startCell;
    const seen = new Uint8Array(N * N);
    const q = [az * N + ax]; seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], cx = i % N, cz = (i / N) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (this.blockedCell(nx, nz) || seen[nz * N + nx]) continue;
        if (dx && dz && (this.blockedCell(cx + dx, cz) || this.blockedCell(cx, cz + dz))) continue;
        seen[nz * N + nx] = 1; q.push(nz * N + nx);
      }
    }
    if (!seen[bz * N + bx]) return false;
    return this.fields.every((f) => seen[Math.floor(f.z / CELL) * N + Math.floor(f.x / CELL)]);
  }
}

// ---------------------------------------------------------------- visuales
function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s) { return vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15; }

export function makeGroundCanvas(map, px = 1024) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(px, px);
  const d = img.data;
  const grass1 = [57, 72, 51], grass2 = [90, 105, 65], dirt = [133, 116, 86], dark = [57, 56, 49];
  const pave = { human: [128, 132, 134], machine: [58, 60, 70] };
  const k = SIZE / px;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const wx = x * k, wz = y * k;
      const n1 = fbm(wx * 0.045, wz * 0.045, 1), n2 = fbm(wx * 0.02 + 40, wz * 0.02, 2);
      let t = Math.min(1, Math.max(0, (n1 - 0.25) * 2.2));
      let r = grass1[0] + (grass2[0] - grass1[0]) * t, g = grass1[1] + (grass2[1] - grass1[1]) * t, b = grass1[2] + (grass2[2] - grass1[2]) * t;
      const dm = Math.min(1, Math.max(0, (n2 - 0.52) * 6));
      r += (dirt[0] - r) * dm; g += (dirt[1] - g) * dm; b += (dirt[2] - b) * dm;
      // Broad dirt roads, broken shoulders and two compacted wheel tracks.
      const road = routeDistance(wx / CELL, wz / CELL, map.routes) * CELL;
      const edge = road + (n1 - .5) * 3;
      const blend = Math.max(0, Math.min(1, (7.5 - edge) / 2.5));
      const track = Math.max(0, 1 - Math.abs(road - 2.1) / .55) * 13;
      const grit = (vnoise(wx * 1.1, wz * 1.1, 21) - .5) * 14;
      r += (139 + grit - track - r) * blend;
      g += (120 + grit - track - g) * blend;
      b += (88 + grit - track - b) * blend;
      // Stone dust integrates the cliff bases with the ground.
      for (const l of map.landmarks) {
        const dd = Math.hypot(wx - l.x, wz - l.z) - l.radius;
        const a = Math.max(0, Math.min(.8, (5 - dd) / 7)) * .8;
        r += (112 - r) * a; g += (109 - g) * a; b += (94 - b) * a;
      }
      // pavimento en las bases
      for (const tm of ['human', 'machine']) {
        const s = TEAMS[tm].startCell;
        const dd = Math.hypot(wx - s[0] * CELL, wz - s[1] * CELL) / CELL;
        if (dd < 15) {
          const a = Math.min(1, (15 - dd) / 3) * 0.85;
          const seam = wx % 6 < .12 || wz % 6 < .12;
          const tile = seam ? -23 : (hash2(Math.floor(wx / 6), Math.floor(wz / 6), 9) - .5) * 13;
          const pv = pave[tm];
          r += (pv[0] + tile - r) * a; g += (pv[1] + tile - g) * a; b += (pv[2] + tile - b) * a;
        }
      }
      // suelo oscuro bajo el mineral
      for (const f of map.fields) {
        const dd = Math.hypot(wx - f.x, wz - f.z) / (f.r * 1.15);
        if (dd < 1) { const a = (1 - dd) * 0.8; r += (dark[0] - r) * a; g += (dark[1] - g) * a; b += (dark[2] - b) * a; }
      }
      const grain = (hash2(x, y, 5) - 0.5) * 8;
      const i = (y * px + x) * 4;
      d[i] = r + grain; d[i + 1] = g + grain; d[i + 2] = b + grain; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export class MapVisuals {
  constructor(map, scene) {
    this.map = map;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.groundCanvas = makeGroundCanvas(map);
    const tex = new THREE.CanvasTexture(this.groundCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(SIZE / 2, 0, SIZE / 2);
    ground.receiveShadow = true;
    this.ground = ground;
    this.group.add(ground);

    // Rock apron carries the playable ground out beneath the perimeter cliffs.
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 48, SIZE + 48), new THREE.MeshStandardMaterial({ color: 0x626753, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2; apron.position.set(SIZE / 2, -.15, SIZE / 2);
    apron.receiveShadow = true;
    this.group.add(apron);

    // vacío exterior
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 6, SIZE * 6), new THREE.MeshBasicMaterial({ color: 0x14181c }));
    outer.rotation.x = -Math.PI / 2; outer.position.set(SIZE / 2, -0.4, SIZE / 2);
    this.group.add(outer);

    this.buildLandmarks();
    this.buildDecor();
    this.buildOre();
  }

  buildLandmarks() {
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const kind of ['env_cliff', 'env_ruin']) {
      const items = this.map.landmarks.filter(l => l.kind === kind);
      const asset = getInstanceAsset(kind);
      const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, items.length);
      items.forEach((l, i) => {
        q.setFromAxisAngle(up, l.rot);
        matrix.compose(new THREE.Vector3(l.x, 0, l.z), q, new THREE.Vector3(l.radius, l.radius * .7, l.radius));
        mesh.setMatrixAt(i, matrix);
      });
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // A rock rim replaces the abrupt edge into empty space, outside the playable grid.
    const asset = getInstanceAsset('env_cliff');
    const rim = new THREE.InstancedMesh(asset.geometry, asset.material, 4 * 22);
    let index = 0;
    for (let side = 0; side < 4; side++) for (let i = 0; i < 22; i++) {
      const t = i * SIZE / 21, h = 7 + hash2(i, side, 11) * 10;
      const x = side === 0 ? -16 : side === 1 ? SIZE + 16 : t;
      const z = side === 2 ? -16 : side === 3 ? SIZE + 16 : t;
      q.setFromAxisAngle(up, side * Math.PI / 2 + hash2(i, side, 17) * 2);
      matrix.compose(new THREE.Vector3(x, -1, z), q, new THREE.Vector3(14 + hash2(i, side, 13) * 3, h, 13));
      rim.setMatrixAt(index++, matrix);
    }
    rim.castShadow = rim.receiveShadow = true;
    this.group.add(rim);
  }

  buildDecor() {
    const { trees, rocks } = this.map;
    const rng = mulberry32(this.map.seed + 301);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const treeAsset = getInstanceAsset('env_tree');
    const treeMesh = new THREE.InstancedMesh(treeAsset.geometry, treeAsset.material, trees.length);
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot); p.set(t.x, 0, t.z); s.set(t.s, t.s * (0.9 + rng() * 0.4), t.s);
      m4.compose(p, q, s); treeMesh.setMatrixAt(i, m4);
      treeMesh.setColorAt(i, col.setScalar(0.8 + rng() * 0.2));
    });
    treeMesh.castShadow = treeMesh.receiveShadow = true;
    this.group.add(treeMesh);

    const rockAsset = getInstanceAsset('env_rock');
    const rockMesh = new THREE.InstancedMesh(rockAsset.geometry, rockAsset.material, rocks.length);
    rocks.forEach((r, i) => {
      q.setFromAxisAngle(up, r.rot);
      p.set(r.x, 0, r.z); s.set(r.s * 1.05, r.s * 0.75, r.s);
      m4.compose(p, q, s); rockMesh.setMatrixAt(i, m4);
      rockMesh.setColorAt(i, col.setScalar(0.75 + rng() * 0.25));
    });
    rockMesh.castShadow = rockMesh.receiveShadow = true;
    this.group.add(rockMesh);
  }

  buildOre() {
    const fields = this.map.fields;
    const rng = mulberry32(this.map.seed + 503);
    const oreAsset = getInstanceAsset('env_ore');
    const per = (f) => Math.round(f.r * 2.4);
    const total = fields.reduce((a, f) => a + per(f), 0);
    this.ore = new THREE.InstancedMesh(oreAsset.geometry, oreAsset.material, total);
    this.ore.castShadow = true;
    this.oreData = [];
    const col = new THREE.Color();
    let idx = 0;
    for (const f of fields) {
      f.crystalStart = idx; f.crystalCount = per(f); f.drawnFrac = -1;
      for (let i = 0; i < f.crystalCount; i++) {
        const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * f.r * 0.92;
        this.oreData.push({ x: f.x + Math.cos(a) * d, z: f.z + Math.sin(a) * d, s: 0.7 + rng() * 0.9, rot: rng() * 6.28, tilt: (rng() - 0.5) * 0.4 });
        this.ore.setColorAt(idx, col.setScalar(0.75 + rng() * 0.25));
        idx++;
      }
    }
    this.group.add(this.ore);
    this.updateOre();
  }

  updateOre() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const e = new THREE.Euler();
    let dirty = false;
    for (const f of this.map.fields) {
      const frac = Math.max(0, f.amount / f.max);
      if (Math.abs(frac - f.drawnFrac) < 0.015 && f.drawnFrac >= 0) continue;
      f.drawnFrac = frac; dirty = true;
      for (let i = 0; i < f.crystalCount; i++) {
        const o = this.oreData[f.crystalStart + i];
        const vis = (i + 1) / f.crystalCount <= frac + 0.02;
        const k = vis ? o.s * (0.55 + 0.45 * Math.min(1, frac * 1.5)) : 0.0001;
        e.set(o.tilt, o.rot, -o.tilt); q.setFromEuler(e);
        p.set(o.x, 0, o.z); s.set(k, k, k);
        m4.compose(p, q, s); this.ore.setMatrixAt(f.crystalStart + i, m4);
      }
    }
    if (dirty) this.ore.instanceMatrix.needsUpdate = true;
  }
}
