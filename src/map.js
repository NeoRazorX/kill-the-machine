import * as THREE from 'three';
import { getInstanceAsset } from './assets.js';
import { N, CELL, SIZE } from './config.js';

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

// Four-fold rotational symmetry: every corner has an identical start, so any pairing is fair.
// rot turns a continuous cell position 90° around the centre; mir reflects it across a corner's diagonal.
export const rot = ([x, z]) => [N - z, x];
const mir = ([x, z]) => [N - z, N - x];
const turn = (p, k) => { for (let i = 0; i < k; i++) p = rot(p); return p; };
const rotations = (p) => [0, 1, 2, 3].map(k => turn(p, k));
const rotCell = (cx, cz) => [N - 1 - cz, cx];

// Bottom-left corner; the other three are its rotations.
const START = [28, N - 28];
const MID = [22, N / 2];          // edge clearing shared with the next corner
const EXPANSION = [64, N - 64];   // contested field on the road to the centre

// grid: 0 libre, 1 obstáculo estático, 2 edificio
export class GameMap {
  constructor(seed = 20260) {
    this.seed = seed;
    this.name = 'Cantera de los Cuatro Vientos';
    this.spawns = rotations(START);
    // Each corner reaches the centre, both neighbouring edge clearings and a ring that links the expansions.
    const toEdge = [START, [22, 140], [30, 118], MID];
    const toRing = [MID, [40, 112], EXPANSION];
    const quarter = [
      [START, [46, 146], EXPANSION, [80, 112], [N / 2, N / 2]],
      toEdge, toEdge.map(mir), toRing, toRing.map(mir),
    ];
    this.routes = quarter.flatMap(route => [0, 1, 2, 3].map(k => route.map(p => turn(p, k))));
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
    const nearStart = (cx, cz, r) => this.spawns.some((s) => Math.hypot(cx + 0.5 - s[0], cz + 0.5 - s[1]) < r);
    const nearField = (cx, cz, m) => this.fields.some((f) => Math.hypot(cx + 0.5 - f.x / CELL, cz + 0.5 - f.z / CELL) < f.r / CELL + m);

    // Campos de mineral, repetidos en las cuatro esquinas
    const addField = ([cx, cz], rc, amount) => {
      this.fields.push({ x: cx * CELL, z: cz * CELL, r: rc * CELL, amount, max: amount, id: this.fields.length });
    };
    const home = [START[0] + 20, START[1] - 2];
    const specs = [[home, 4, 6500], [mir(home), 4, 6500], [EXPANSION, 5, 9000], [[28, N / 2], 4, 7000]];
    for (const [p, r, a] of specs) for (const q of rotations(p)) addField(q, r, a);
    addField([N / 2, N / 2], 7, 16000);

    const reserved = (cx, cz) => nearStart(cx, cz, 18) || nearField(cx, cz, 4) || routeDistance(cx + 0.5, cz + 0.5, this.routes) < 4;
    const free = (cx, cz) => !this.blockedCell(cx, cz) && !reserved(cx, cz);
    // Large authored obstacles define the battlefield; their entire visual footprint is blocked.
    const addLandmark = ([cx, cz], radius, kind, rotation = 0) => {
      const cells = [];
      for (let z = Math.floor(cz - radius - 1); z <= Math.ceil(cz + radius); z++) {
        for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius); x++) {
          if (Math.hypot(x + .5 - cx, z + .5 - cz) > radius + .7) continue;
          if (!this.inBounds(x, z) || reserved(x, z) || this.blockedCell(x, z)) return;
          cells.push([x, z]);
        }
      }
      for (const [x, z] of cells) this.grid[z * N + x] = 1;
      this.landmarks.push({ x: cx * CELL, z: cz * CELL, radius: radius * CELL, kind, rot: rotation });
    };
    const landmarks = [[[42, 134], 4, 'env_cliff'], [[62, 108], 6, 'env_cliff'], [[9, 122], 5, 'env_cliff'], [[10, 146], 3, 'env_ruin']];
    const quarterMarks = landmarks.flatMap(([p, r, kind]) => [[p, r, kind], [mir(p), r, kind]]);
    quarterMarks.push([[9, N - 9], 5, 'env_cliff']);
    for (const [p, r, kind] of quarterMarks) {
      rotations(p).forEach((q, k) => addLandmark(q, r, kind, k * Math.PI / 2 + (p[0] + p[1]) % 3));
    }

    // Decoration is repeated in the four rotated positions so no corner gets more cover.
    const rotCells = (cx, cz) => {
      const out = [[cx, cz]];
      for (let k = 1; k < 4; k++) out.push(rotCell(...out[k - 1]));
      return out;
    };
    const rotWorld = (x, z) => [SIZE - z, x];
    const placeTree = (cx, cz, jx, jz, s, r) => {
      const cells = rotCells(cx, cz);
      if (cells.some(([a, b]) => !free(a, b) || nearField(a, b, 1.5))) return;
      if (new Set(cells.map(([a, b]) => b * N + a)).size < 4) return;
      let p = [(cx + 0.5 + jx) * CELL, (cz + 0.5 + jz) * CELL];
      cells.forEach(([a, b], k) => {
        this.grid[b * N + a] = 1;
        this.trees.push({ x: p[0], z: p[1], s, rot: r + k * Math.PI / 2 });
        p = rotWorld(...p);
      });
    };
    const placeRock = (cx, cz, s, r) => {
      const cells = [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx + 1, cz + 1]].flatMap(([a, b]) => rotCells(a, b));
      if (!cells.every(([a, b]) => free(a, b) && !nearField(a, b, 1.5))) return;
      if (new Set(cells.map(([a, b]) => b * N + a)).size < cells.length) return;
      for (const [a, b] of cells) this.grid[b * N + a] = 1;
      let p = [(cx + 1) * CELL, (cz + 1) * CELL];
      for (let k = 0; k < 4; k++) {
        this.rocks.push({ x: p[0], z: p[1], s, rot: r + k * 1.3 });
        p = rotWorld(...p);
      }
    };

    for (let k = 0; k < 75; k++) {
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
    const [ax, az] = this.spawns[0];
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
    if (!this.spawns.every(([x, z]) => seen[z * N + x])) return false;
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

// The ground texture continues this far past the playable edge, under the perimeter rocks.
export const GROUND_MARGIN = 40;

export function makeGroundCanvas(map, px = 1792, margin = GROUND_MARGIN) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(px, px);
  const d = img.data;
  const grass1 = [57, 72, 51], grass2 = [90, 105, 65], dirt = [133, 116, 86], dark = [57, 56, 49];
  const pave = [104, 107, 108];
  const k = (SIZE + 2 * margin) / px;
  const R = new Float32Array(px * px), G = new Float32Array(px * px), B = new Float32Array(px * px);
  // Road distance sampled once per world unit and interpolated per pixel.
  const RN = SIZE + 2 * margin + 1, roads = new Float32Array(RN * RN);
  for (let j = 0; j < RN; j++) for (let i = 0; i < RN; i++) roads[j * RN + i] = routeDistance((i - margin) / CELL, (j - margin) / CELL, map.routes) * CELL;
  const roadAt = (wx, wz) => {
    const fx = wx + margin, fz = wz + margin;
    const i = Math.min(RN - 2, Math.floor(fx)), j = Math.min(RN - 2, Math.floor(fz)), u = fx - i, v = fz - j, o = j * RN + i;
    return (roads[o] * (1 - u) + roads[o + 1] * u) * (1 - v) + (roads[o + RN] * (1 - u) + roads[o + RN + 1] * u) * v;
  };
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const wx = x * k - margin, wz = y * k - margin;
      const n1 = fbm(wx * 0.045, wz * 0.045, 1), n2 = fbm(wx * 0.02 + 40, wz * 0.02, 2);
      let t = Math.min(1, Math.max(0, (n1 - 0.25) * 2.2));
      let r = grass1[0] + (grass2[0] - grass1[0]) * t, g = grass1[1] + (grass2[1] - grass1[1]) * t, b = grass1[2] + (grass2[2] - grass1[2]) * t;
      const dm = Math.min(1, Math.max(0, (n2 - 0.52) * 6));
      r += (dirt[0] - r) * dm; g += (dirt[1] - g) * dm; b += (dirt[2] - b) * dm;
      // Broad dirt roads, broken shoulders and two compacted wheel tracks.
      const road = roadAt(wx, wz);
      const edge = road + (n1 - .5) * 3;
      const blend = Math.max(0, Math.min(1, (7.5 - edge) / 2.5));
      if (blend > 0) {
        const track = Math.max(0, 1 - Math.abs(road - 2.1) / .55) * 13;
        const grit = (vnoise(wx * 1.1, wz * 1.1, 21) - .5) * 14;
        r += (139 + grit - track - r) * blend;
        g += (120 + grit - track - g) * blend;
        b += (88 + grit - track - b) * blend;
      }
      // Scree gathers at the foot of the perimeter rocks; far out it darkens into the void.
      const ox = Math.max(0, -wx, wx - SIZE), oz = Math.max(0, -wz, wz - SIZE);
      const out = ox || oz ? Math.hypot(ox, oz) : -Math.min(wx, SIZE - wx, wz, SIZE - wz);
      const scree = Math.max(0, Math.min(1, (out + 8 + (n2 - .5) * 14) / 10));
      if (scree > 0) {
        const stone = (vnoise(wx * .35, wz * .35, 31) - .5) * 26 + (vnoise(wx * 1.7, wz * 1.7, 37) - .5) * 12;
        r += (108 + stone - r) * scree; g += (104 + stone - g) * scree; b += (90 + stone * .8 - b) * scree;
        const dusk = Math.max(0, Math.min(1, (out - margin + 16) / 14));
        r += (34 - r) * dusk; g += (38 - g) * dusk; b += (38 - b) * dusk;
      }
      const i = y * px + x;
      R[i] = r; G[i] = g; B[i] = b;
    }
  }
  // Features only shade the pixels within their reach, in the same order as before.
  const around = (cx, cz, reach, shade) => {
    const x0 = Math.max(0, Math.floor((cx - reach + margin) / k)), x1 = Math.min(px - 1, Math.ceil((cx + reach + margin) / k));
    const y0 = Math.max(0, Math.floor((cz - reach + margin) / k)), y1 = Math.min(px - 1, Math.ceil((cz + reach + margin) / k));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) shade(y * px + x, x * k - margin, y * k - margin);
  };
  const mix = (i, a, r, g, b) => { R[i] += (r - R[i]) * a; G[i] += (g - G[i]) * a; B[i] += (b - B[i]) * a; };
  // Stone dust integrates the cliff bases with the ground.
  for (const l of map.landmarks) around(l.x, l.z, l.radius + 5, (i, wx, wz) => {
    const a = Math.max(0, Math.min(.8, (5 - Math.hypot(wx - l.x, wz - l.z) + l.radius) / 7)) * .8;
    if (a > 0) mix(i, a, 112, 109, 94);
  });
  // Every start is paved the same, so the ground never gives away an occupied corner.
  for (const [sx, sz] of map.spawns) around(sx * CELL, sz * CELL, 15 * CELL, (i, wx, wz) => {
    const dd = Math.hypot(wx - sx * CELL, wz - sz * CELL) / CELL;
    if (dd >= 15) return;
    const a = Math.min(1, (15 - dd) / 3) * 0.85;
    const seam = wx % 6 < .12 || wz % 6 < .12;
    const tile = seam ? -23 : (hash2(Math.floor(wx / 6), Math.floor(wz / 6), 9) - .5) * 13;
    mix(i, a, pave[0] + tile, pave[1] + tile, pave[2] + tile);
  });
  // suelo oscuro bajo el mineral
  for (const f of map.fields) around(f.x, f.z, f.r * 1.15, (i, wx, wz) => {
    const dd = Math.hypot(wx - f.x, wz - f.z) / (f.r * 1.15);
    if (dd < 1) mix(i, (1 - dd) * 0.8, dark[0], dark[1], dark[2]);
  });
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const grain = (hash2(x, y, 5) - 0.5) * 8;
      const i = y * px + x, o = i * 4;
      d[o] = R[i] + grain; d[o + 1] = G[i] + grain; d[o + 2] = B[i] + grain; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// Scenery outside the playable square: a broken inner row of rock, a taller row behind it,
// scree at their feet and patches of woodland. Purely visual and reproducible per seed.
export function borderDecor(seed) {
  const rng = mulberry32(seed + 709), cliffs = [], rocks = [], trees = [];
  // side 0..3 = west, east, north, south; t runs along the side and o is the distance outside it.
  const at = (side, t, o) => side === 0 ? [-o, t] : side === 1 ? [SIZE + o, t] : side === 2 ? [t, -o] : [t, SIZE + o];
  const reach = 36;
  for (let side = 0; side < 4; side++) {
    for (const row of [{ step: 10, o: 11, spread: 5, r: 8, rr: 5, h: .55 }, { step: 15, o: 25, spread: 8, r: 13, rr: 7, h: .7 }]) {
      for (let t = -reach + rng() * row.step; t < SIZE + reach; t += row.step * (.75 + rng() * .5)) {
        const o = row.o + rng() * row.spread, r = Math.min(row.r + rng() * row.rr, o - 2);
        const [x, z] = at(side, t, o);
        cliffs.push({ x, z, r, h: r * (row.h + rng() * .55), d: .85 + rng() * .3, rot: rng() * Math.PI * 2, shade: .78 + rng() * .22 });
      }
    }
    for (let t = rng() * 5; t < SIZE; t += 3 + rng() * 5) {
      if (rng() < .35) continue;
      const s = .8 + rng() * 1.2, [x, z] = at(side, t, 1 + s * 1.3 + rng() * 4);
      rocks.push({ x, z, s, rot: rng() * 6.28 });
    }
    // Woodland comes in stretches, so the edge alternates between forest and bare rock.
    for (let t = rng() * 4; t < SIZE; t += 2.5 + rng() * 2.5) {
      if (vnoise(t * .025, side * 7.3, 41) < .5 || rng() < .3) continue;
      const [x, z] = at(side, t, 2 + rng() * 8);
      trees.push({ x, z, s: .85 + rng() * .6, rot: rng() * 6.28 });
    }
  }
  return { cliffs, rocks, trees };
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
    // The ground carries on beneath the perimeter rocks instead of ending at the playable edge.
    this.groundMargin = GROUND_MARGIN;
    const extent = SIZE + 2 * GROUND_MARGIN;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(SIZE / 2, 0, SIZE / 2);
    ground.receiveShadow = true;
    this.ground = ground;
    this.group.add(ground);

    // vacío exterior
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 6, SIZE * 6), new THREE.MeshBasicMaterial({ color: 0x14181c }));
    outer.rotation.x = -Math.PI / 2; outer.position.set(SIZE / 2, -0.4, SIZE / 2);
    this.group.add(outer);

    this.border = borderDecor(map.seed);
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
    // Two staggered rows of rock close the map, outside the playable grid.
    const asset = getInstanceAsset('env_cliff'), cliffs = this.border.cliffs;
    const rim = new THREE.InstancedMesh(asset.geometry, asset.material, cliffs.length);
    const col = new THREE.Color();
    cliffs.forEach((c, i) => {
      q.setFromAxisAngle(up, c.rot);
      matrix.compose(new THREE.Vector3(c.x, -1, c.z), q, new THREE.Vector3(c.r, c.h, c.r * c.d));
      rim.setMatrixAt(i, matrix);
      rim.setColorAt(i, col.setScalar(c.shade));
    });
    rim.castShadow = rim.receiveShadow = true;
    this.group.add(rim);
  }

  buildDecor() {
    const trees = [...this.map.trees, ...this.border.trees], rocks = [...this.map.rocks, ...this.border.rocks];
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
