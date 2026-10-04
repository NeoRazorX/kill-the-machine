import * as THREE from 'three';
import { N, CELL, SIZE, TEAMS } from './config.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// grid: 0 libre, 1 obstáculo estático, 2 edificio
export class GameMap {
  constructor(seed = 20260) {
    this.grid = new Uint8Array(N * N);
    this.trees = [];
    this.rocks = [];
    this.fields = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      this.generate(seed + attempt * 101);
      if (this.checkConnectivity()) break;
    }
  }

  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < N && cz < N; }
  blockedCell(cx, cz) { return cx < 0 || cz < 0 || cx >= N || cz >= N || this.grid[cz * N + cx] !== 0; }
  blockedXZ(x, z) { return this.blockedCell(Math.floor(x / CELL), Math.floor(z / CELL)); }

  generate(seed) {
    const rng = mulberry32(seed);
    this.grid.fill(0);
    this.trees = []; this.rocks = []; this.fields = [];
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

    const free = (cx, cz) => !this.blockedCell(cx, cz) && !nearStart(cx, cz, 17);
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

    for (let k = 0; k < 46; k++) {
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
  const grass1 = [76, 94, 58], grass2 = [101, 116, 66], dirt = [122, 104, 76], dark = [62, 52, 42];
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
      // pavimento en las bases
      for (const tm of ['human', 'machine']) {
        const s = TEAMS[tm].startCell;
        const dd = Math.hypot(wx - s[0] * CELL, wz - s[1] * CELL) / CELL;
        if (dd < 15) {
          const a = Math.min(1, (15 - dd) / 3) * 0.85;
          const tile = ((Math.floor(wx / 4) + Math.floor(wz / 4)) & 1) ? 0 : 3;
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

    // vacío exterior
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 6, SIZE * 6), new THREE.MeshBasicMaterial({ color: 0x14181c }));
    outer.rotation.x = -Math.PI / 2; outer.position.set(SIZE / 2, -0.4, SIZE / 2);
    this.group.add(outer);

    this.buildDecor();
    this.buildOre();
  }

  buildDecor() {
    const { trees, rocks } = this.map;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const trunkG = new THREE.CylinderGeometry(0.14, 0.2, 1, 5).translate(0, 0.5, 0);
    const c1G = new THREE.ConeGeometry(1.0, 1.9, 6).translate(0, 1.7, 0);
    const c2G = new THREE.ConeGeometry(0.72, 1.5, 6).translate(0, 2.6, 0);
    const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x5b4330, flatShading: true }), trees.length);
    const c1 = new THREE.InstancedMesh(c1G, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), trees.length);
    const c2 = new THREE.InstancedMesh(c2G, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), trees.length);
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot); p.set(t.x, 0, t.z); s.set(t.s, t.s * (0.9 + Math.random() * 0.4), t.s);
      m4.compose(p, q, s);
      trunk.setMatrixAt(i, m4); c1.setMatrixAt(i, m4); c2.setMatrixAt(i, m4);
      col.setHSL(0.27 + Math.random() * 0.05, 0.38, 0.2 + Math.random() * 0.08);
      c1.setColorAt(i, col); c2.setColorAt(i, col.offsetHSL(0, 0, 0.04));
    });
    for (const mesh of [trunk, c1, c2]) { mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh); }

    const rockG = new THREE.DodecahedronGeometry(1.7, 0);
    const rockM = new THREE.InstancedMesh(rockG, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 }), Math.max(1, rocks.length));
    rocks.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(Math.random() * 0.3, r.rot, Math.random() * 0.3));
      p.set(r.x, 0.5, r.z); s.set(r.s * 1.05, r.s * 0.75, r.s);
      m4.compose(p, q, s); rockM.setMatrixAt(i, m4);
      rockM.setColorAt(i, col.setHSL(0.08, 0.06, 0.33 + Math.random() * 0.1));
    });
    rockM.castShadow = true; rockM.receiveShadow = true;
    this.group.add(rockM);
  }

  buildOre() {
    const fields = this.map.fields;
    const geo = new THREE.OctahedronGeometry(0.55, 0);
    geo.scale(0.7, 1.7, 0.7); geo.translate(0, 0.9, 0);
    const per = (f) => Math.round(f.r * 2.4);
    const total = fields.reduce((a, f) => a + per(f), 0);
    this.ore = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x17806a, emissiveIntensity: 0.9, flatShading: true, roughness: 0.35, metalness: 0.2,
    }), total);
    this.ore.castShadow = true;
    this.oreData = [];
    const col = new THREE.Color();
    let idx = 0;
    for (const f of fields) {
      f.crystalStart = idx; f.crystalCount = per(f); f.drawnFrac = -1;
      for (let i = 0; i < f.crystalCount; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * f.r * 0.92;
        this.oreData.push({ x: f.x + Math.cos(a) * d, z: f.z + Math.sin(a) * d, s: 0.7 + Math.random() * 0.9, rot: Math.random() * 6.28, tilt: (Math.random() - 0.5) * 0.4 });
        this.ore.setColorAt(idx, col.setHSL(0.44 + Math.random() * 0.06, 0.7, 0.45 + Math.random() * 0.18));
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
