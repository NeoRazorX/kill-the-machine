import * as THREE from 'three';
import { mergeGeometries } from '../lib/addons/utils/BufferGeometryUtils.js';
import { getInstanceAsset } from './assets.js';
import { N, CELL, SIZE } from './config.js';
import { THEMES } from './themes.js';
import { applySlabShader } from './foundations.js';

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

// Symmetry groups. Every start is an image of the first one, so every allowed pairing is fair.
// point maps a continuous cell position, cell a grid cell and world a world position; angle turns a heading.
// rot turns a continuous cell position 90° around the centre; mir reflects it across a corner's diagonal.
export const rot = ([x, z]) => [N - z, x];
const mir = ([x, z]) => [N - z, N - x];
const turn = (p, k) => { for (let i = 0; i < k; i++) p = rot(p); return p; };
const rotCell = (cx, cz) => [N - 1 - cz, cx];
const rotWorld = (x, z) => [SIZE - z, x];
const repeat = (f, k, a, b) => { let p = [a, b]; for (let i = 0; i < k; i++) p = f(...p); return p; };

// Four-fold rotation: four identical corners.
const QUARTER_TURNS = {
  n: 4,
  point: turn,
  cell: (cx, cz, k) => repeat(rotCell, k, cx, cz),
  world: (x, z, k) => repeat(rotWorld, k, x, z),
  angle: (r, k) => r + k * Math.PI / 2,
  rockAngle: (r, k) => r + k * 1.3,
};
// Mirror image across both axes: bit 0 of k reflects west-east, bit 1 north-south.
const flip = (v, k, bit, edge) => (k & bit ? edge - v : v);
const MIRRORS = {
  n: 4,
  point: ([x, z], k) => [flip(x, k, 1, N), flip(z, k, 2, N)],
  cell: (cx, cz, k) => [flip(cx, k, 1, N - 1), flip(cz, k, 2, N - 1)],
  world: (x, z, k) => [flip(x, k, 1, SIZE), flip(z, k, 2, SIZE)],
  angle: (r, k) => (k === 1 || k === 2 ? -r : r),
  rockAngle: (r, k) => (k === 1 || k === 2 ? -r : r),
};

// --------------------------------------------------------------- layouts
// A layout is the authored part of a map: starts, routes, ore and large obstacles, all given for one
// start and repeated by its symmetry. Trees and rocks are scattered per seed, symmetrically too.
const QUARRY_START = [28, N - 28];   // bottom-left corner; the other three are its rotations
const QUARRY_MID = [22, N / 2];      // edge clearing shared with the next corner
const QUARRY_EXPANSION = [64, N - 64];   // contested field on the road to the centre
const quarryToEdge = [QUARRY_START, [22, 140], [30, 118], QUARRY_MID];
const quarryToRing = [QUARRY_MID, [40, 112], QUARRY_EXPANSION];
const quarryHome = [QUARRY_START[0] + 20, QUARRY_START[1] - 2];
const quarryMarks = [[[42, 134], 4, 'env_cliff'], [[62, 108], 6, 'env_cliff'], [[9, 122], 5, 'env_cliff'], [[10, 146], 3, 'env_ruin']];

// Shallow crossings and the island of Río Partido, in cells from the vertical centre line.
const RIVER_FORDS = [[N / 2 - 64, 3], [N / 2, 5], [N / 2 + 64, 3]];   // [centre x, half width]
const RIVER_ISLAND = { rx: 13, rz: 5 };
const RIVER_START = [40, N - 30];

export const LAYOUTS = {
  // Four corners around a rich centre: any two corners can meet.
  quarry: {
    id: 'quarry', label: 'Cuatro Vientos',
    blurb: 'Cuatro canteras idénticas en las esquinas; cada partida sortea cuáles ocupan humanos y máquinas. Los caminos de borde enlazan esquinas vecinas, el anillo une las expansiones y el mineral central queda expuesto.',
    names: { temperate: 'Cantera de los Cuatro Vientos', desert: 'Dunas de los Cuatro Vientos', ice: 'Glaciar de los Cuatro Vientos' },
    symmetry: QUARTER_TURNS,
    spawns: [0, 1, 2, 3].map((k) => turn(QUARRY_START, k)),
    // Each corner reaches the centre, both neighbouring edge clearings and a ring that links the expansions.
    routes: [
      [QUARRY_START, [46, 146], QUARRY_EXPANSION, [80, 112], [N / 2, N / 2]],
      quarryToEdge, quarryToEdge.map(mir), quarryToRing, quarryToRing.map(mir),
    ],
    fields: [[quarryHome, 4, 6500], [mir(quarryHome), 4, 6500], [QUARRY_EXPANSION, 5, 9000], [[28, N / 2], 4, 7000], [[N / 2, N / 2], 7, 16000]],
    landmarks: [...quarryMarks.flatMap(([p, r, kind]) => [[p, r, kind], [mir(p), r, kind]]), [[9, N - 9], 5, 'env_cliff']],
    rivals: (spawns, i) => spawns.map((_, j) => j).filter((j) => j !== i),
  },
  // A river splits the map in two banks, crossed at two narrow fords and through a central island.
  // Rivals always start on opposite banks; the empty start beside each base becomes its expansion.
  river: {
    id: 'river', label: 'Río Partido',
    blurb: 'Un río separa dos orillas y los rivales empiezan siempre en orillas opuestas. Solo se cruza por dos vados laterales y por la isla central, que guarda el mineral más rico; en los vados todo avanza despacio.',
    names: { temperate: 'Vega del Río Partido', desert: 'Oasis del Río Partido', ice: 'Deshielo del Río Partido' },
    symmetry: MIRRORS,
    // South-west, then clockwise as in the quarry.
    spawns: [0, 2, 3, 1].map((k) => MIRRORS.point(RIVER_START, k)),
    routes: [
      [RIVER_START, [34, 130], [32, 104], [32, N / 2]],
      [RIVER_START, [72, 140], [90, 114], [N / 2, 104], [N / 2, N / 2]],
      [RIVER_START, [N / 2, 166]],
      [[34, 118], [62, 110], [90, 114]],
    ],
    fields: [[[62, 168], 4, 6500], [[34, 118], 4.5, 7000], [[N / 2, 166], 5, 8000], [[N / 2, N / 2], 4, 14000]],
    // Rocky spurs split each bank into three lanes towards the crossings.
    landmarks: [[[64, 124], 3, 'env_cliff'], [[64, 133], 3, 'env_cliff'], [[12, 132], 4, 'env_cliff'], [[20, 112], 3, 'env_cliff'],
      [[9, N - 9], 5, 'env_cliff'], [[78, 184], 3, 'env_ruin']],
    rivals: (spawns, i) => spawns.map((_, j) => j).filter((j) => (spawns[j][1] < N / 2) !== (spawns[i][1] < N / 2)),
    // 0 dry land, 1 deep water, 2 ford. The banks swell around the island and wander a little,
    // the same on both sides of each axis.
    water(cx, cz) {
      const dx = Math.abs(cx + .5 - N / 2), dz = Math.abs(cz + .5 - N / 2);
      const half = 5 + 3.2 * Math.exp(-((dx / 16) ** 2)) + .6 * Math.sin(dx * .19) + .3 * Math.sin(dx * .53 + 1);
      if (dz >= half) return 0;
      if ((dx / RIVER_ISLAND.rx) ** 2 + (dz / RIVER_ISLAND.rz) ** 2 < 1) return 0;
      return RIVER_FORDS.some(([x, w]) => Math.abs(cx + .5 - x) < w) ? 2 : 1;
    },
  },
};
export const LAYOUT_IDS = Object.keys(LAYOUTS);

// 'random' (or anything unknown) draws one of the layouts.
export function resolveLayout(id, rng = Math.random) {
  return LAYOUTS[id] || LAYOUTS[LAYOUT_IDS[Math.floor(rng() * LAYOUT_IDS.length)]];
}

// grid: 0 libre, 1 obstáculo estático, 2 edificio. water: 0 seco, 1 agua profunda (bloquea), 2 vado (se cruza despacio).
export class GameMap {
  constructor(seed = 20260, layout = LAYOUTS.quarry) {
    this.seed = seed;
    this.layout = typeof layout === 'string' ? resolveLayout(layout) : layout;
    this.name = this.layout.names.temperate;
    const sym = this.layout.symmetry;
    this.spawns = this.layout.spawns.map((p) => [...p]);
    this.routes = this.layout.routes.flatMap((route) => [...Array(sym.n).keys()].map((k) => route.map((p) => sym.point(p, k))));
    this.grid = new Uint8Array(N * N);
    this.water = new Uint8Array(N * N);
    this.hasWater = !!this.layout.water;
    this.trees = [];
    this.rocks = [];
    this.fields = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      this.generate(seed + attempt * 101);
      if (this.checkConnectivity()) return;
    }
    throw new Error(`Could not generate a connected ${this.layout.id} map`);
  }

  // Starts a rival may take when this one is in play.
  rivalSlots(i) { return this.layout.rivals(this.spawns, i); }

  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < N && cz < N; }
  blockedCell(cx, cz) { return cx < 0 || cz < 0 || cx >= N || cz >= N || this.grid[cz * N + cx] !== 0; }
  blockedXZ(x, z) { return this.blockedCell(Math.floor(x / CELL), Math.floor(z / CELL)); }
  // 0 dry, 1 deep water, 2 ford.
  waterXZ(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    return this.inBounds(cx, cz) ? this.water[cz * N + cx] : 0;
  }

  generate(seed) {
    const rng = mulberry32(seed), layout = this.layout, sym = layout.symmetry;
    this.grid.fill(0);
    this.water.fill(0);
    this.trees = []; this.rocks = []; this.fields = []; this.landmarks = [];
    for (let i = 0; i < N; i++) {
      this.grid[i] = this.grid[(N - 1) * N + i] = 1;
      this.grid[i * N] = this.grid[i * N + N - 1] = 1;
    }
    // Water: deep cells block every unit, fords are walked slowly. Scenery keeps off the banks.
    const wet = new Uint8Array(N * N);
    if (layout.water) {
      for (let cz = 1; cz < N - 1; cz++) for (let cx = 1; cx < N - 1; cx++) {
        const w = layout.water(cx, cz);
        if (!w) continue;
        this.water[cz * N + cx] = w;
        if (w === 1) this.grid[cz * N + cx] = 1;
        for (let z = Math.max(0, cz - 3); z <= Math.min(N - 1, cz + 3); z++) for (let x = Math.max(0, cx - 3); x <= Math.min(N - 1, cx + 3); x++) wet[z * N + x] = 1;
      }
    }
    const nearStart = (cx, cz, r) => this.spawns.some((s) => Math.hypot(cx + 0.5 - s[0], cz + 0.5 - s[1]) < r);
    const nearField = (cx, cz, m) => this.fields.some((f) => Math.hypot(cx + 0.5 - f.x / CELL, cz + 0.5 - f.z / CELL) < f.r / CELL + m);
    // Distinct images of an authored point, with the symmetry index that produced each.
    const images = (p) => {
      const seen = new Set(), out = [];
      for (let k = 0; k < sym.n; k++) {
        const q = sym.point(p, k), key = q.join();
        if (!seen.has(key)) { seen.add(key); out.push([q, k]); }
      }
      return out;
    };

    // Campos de mineral, repetidos en cada salida
    const addField = ([cx, cz], rc, amount) => {
      this.fields.push({ x: cx * CELL, z: cz * CELL, r: rc * CELL, amount, max: amount, id: this.fields.length });
    };
    for (const [p, r, a] of layout.fields) for (const [q] of images(p)) addField(q, r, a);

    const reserved = (cx, cz) => nearStart(cx, cz, 18) || nearField(cx, cz, 4) || routeDistance(cx + 0.5, cz + 0.5, this.routes) < 4 || wet[cz * N + cx] === 1;
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
    for (const [p, r, kind] of layout.landmarks) {
      for (const [q, k] of images(p)) addLandmark(q, r, kind, sym.angle((p[0] + p[1]) % 3, k));
    }

    // Decoration is repeated in every symmetric position so no start gets more cover.
    const symCells = (cx, cz) => [...Array(sym.n).keys()].map((k) => sym.cell(cx, cz, k));
    const placeTree = (cx, cz, jx, jz, s, r) => {
      const cells = symCells(cx, cz);
      if (cells.some(([a, b]) => !free(a, b) || nearField(a, b, 1.5))) return;
      if (new Set(cells.map(([a, b]) => b * N + a)).size < sym.n) return;
      const p = [(cx + 0.5 + jx) * CELL, (cz + 0.5 + jz) * CELL];
      cells.forEach(([a, b], k) => {
        this.grid[b * N + a] = 1;
        const [x, z] = sym.world(...p, k);
        this.trees.push({ x, z, s, rot: sym.angle(r, k) });
      });
    };
    const placeRock = (cx, cz, s, r) => {
      const cells = [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx + 1, cz + 1]].flatMap(([a, b]) => symCells(a, b));
      if (!cells.every(([a, b]) => free(a, b) && !nearField(a, b, 1.5))) return;
      if (new Set(cells.map(([a, b]) => b * N + a)).size < cells.length) return;
      for (const [a, b] of cells) this.grid[b * N + a] = 1;
      const p = [(cx + 1) * CELL, (cz + 1) * CELL];
      for (let k = 0; k < sym.n; k++) {
        const [x, z] = sym.world(...p, k);
        this.rocks.push({ x, z, s, rot: sym.rockAngle(r, k) });
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

// Soft water coverage per cell (0 dry .. 1 water) and the share of it that is ford, blurred so banks
// and crossings fade in instead of following the grid. at() samples both at a world position.
export function waterField(map) {
  if (!map.hasWater) return null;
  const wet = new Float32Array(N * N), ford = new Float32Array(N * N);
  let z0 = N, z1 = -1;
  for (let i = 0; i < N * N; i++) {
    if (!map.water[i]) continue;
    wet[i] = 1; ford[i] = map.water[i] === 2 ? 1 : 0;
    const z = (i / N) | 0; z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const blur = (a) => {
    const t = new Float32Array(N * N);
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        let s = 0;
        for (let d = -1; d <= 1; d++) s += a[z * N + Math.min(N - 1, Math.max(0, x + d))];
        t[z * N + x] = s / 3;
      }
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        let s = 0;
        for (let d = -1; d <= 1; d++) s += t[Math.min(N - 1, Math.max(0, z + d)) * N + x];
        a[z * N + x] = s / 3;
      }
    }
  };
  blur(wet); blur(ford);
  const sample = (a, wx, wz) => {
    const fx = Math.min(N - 1.001, Math.max(0, wx / CELL - .5)), fz = Math.min(N - 1.001, Math.max(0, wz / CELL - .5));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, o = j * N + i;
    return (a[o] * (1 - u) + a[o + 1] * u) * (1 - v) + (a[o + N] * (1 - u) + a[o + N + 1] * u) * v;
  };
  // World z range that holds water, with room for the banks.
  return { z0: Math.max(0, z0 - 4) * CELL, z1: Math.min(N, z1 + 5) * CELL, at: (wx, wz) => [sample(wet, wx, wz), sample(ford, wx, wz)] };
}
const smooth = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

export function makeGroundCanvas(map, px = 1792, margin = GROUND_MARGIN, theme = THEMES.temperate) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(px, px);
  const d = img.data;
  const { low: grass1, high: grass2, patch: dirt, ore: dark, road: dirtRoad, scree: screeCol, dust, dusk: duskCol } = theme.ground;
  const patchAt = theme.ground.patchAt, ripple = theme.ground.ripple || 0;
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
      // Wind ripples drift across dunes; the noise bends them so they never line up.
      if (ripple) t = Math.min(1, Math.max(0, t + Math.sin(wx * .55 + wz * .2 + n2 * 9) * ripple));
      let r = grass1[0] + (grass2[0] - grass1[0]) * t, g = grass1[1] + (grass2[1] - grass1[1]) * t, b = grass1[2] + (grass2[2] - grass1[2]) * t;
      const dm = Math.min(1, Math.max(0, (n2 - patchAt) * 6));
      r += (dirt[0] - r) * dm; g += (dirt[1] - g) * dm; b += (dirt[2] - b) * dm;
      // Broad dirt roads, broken shoulders and two compacted wheel tracks.
      const road = roadAt(wx, wz);
      const edge = road + (n1 - .5) * 3;
      const blend = Math.max(0, Math.min(1, (7.5 - edge) / 2.5));
      if (blend > 0) {
        const track = Math.max(0, 1 - Math.abs(road - 2.1) / .55) * 13;
        const grit = (vnoise(wx * 1.1, wz * 1.1, 21) - .5) * 14;
        r += (dirtRoad[0] + grit - track - r) * blend;
        g += (dirtRoad[1] + grit - track - g) * blend;
        b += (dirtRoad[2] + grit - track - b) * blend;
      }
      // Scree gathers at the foot of the perimeter rocks; far out it darkens into the void.
      const ox = Math.max(0, -wx, wx - SIZE), oz = Math.max(0, -wz, wz - SIZE);
      const out = ox || oz ? Math.hypot(ox, oz) : -Math.min(wx, SIZE - wx, wz, SIZE - wz);
      const scree = Math.max(0, Math.min(1, (out + 8 + (n2 - .5) * 14) / 10));
      if (scree > 0) {
        const stone = (vnoise(wx * .35, wz * .35, 31) - .5) * 26 + (vnoise(wx * 1.7, wz * 1.7, 37) - .5) * 12;
        r += (screeCol[0] + stone - r) * scree; g += (screeCol[1] + stone - g) * scree; b += (screeCol[2] + stone * .8 - b) * scree;
        const dusk = Math.max(0, Math.min(1, (out - margin + 16) / 14));
        r += (duskCol[0] - r) * dusk; g += (duskCol[1] - g) * dusk; b += (duskCol[2] - b) * dusk;
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
    if (a > 0) mix(i, a, dust[0], dust[1], dust[2]);
  });
  // suelo oscuro bajo el mineral
  for (const f of map.fields) around(f.x, f.z, f.r * 1.15, (i, wx, wz) => {
    const dd = Math.hypot(wx - f.x, wz - f.z) / (f.r * 1.15);
    if (dd < 1) mix(i, (1 - dd) * 0.8, dark[0], dark[1], dark[2]);
  });
  // Rivers: wet mud on the banks, a dark bed under deep water and pale gravel across the fords.
  const river = waterField(map);
  if (river) {
    const { bank, bed, ford } = theme.water;
    for (let y = Math.max(0, Math.floor((river.z0 + margin) / k)); y <= Math.min(px - 1, Math.ceil((river.z1 + margin) / k)); y++) {
      for (let x = 0; x < px; x++) {
        const wx = x * k - margin, wz = y * k - margin;
        if (wx < 0 || wx > SIZE) continue;
        const [w, f] = river.at(wx, wz);
        if (w < .02) continue;
        const i = y * px + x, n = vnoise(wx * .6, wz * .6, 51) - .5;
        mix(i, smooth(.02, .45, w + n * .15) * .75, bank[0], bank[1], bank[2]);
        const deep = smooth(.4, .75, w + n * .1);
        if (deep > 0) {
          const g = f / Math.max(w, .01), stone = (vnoise(wx * 1.8, wz * 1.8, 53) - .5) * 30 * g;
          mix(i, deep, bed[0] + (ford[0] - bed[0]) * g + stone, bed[1] + (ford[1] - bed[1]) * g + stone, bed[2] + (ford[2] - bed[2]) * g + stone);
        }
      }
    }
  }
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

// Saguaro built from capsules, standing in for trees in the desert. Same footprint and height range.
let cactusGeometry = null;
const cactusMaterial = new THREE.MeshStandardMaterial({ color: 0x5d7a3e, roughness: .85 });
function getCactusGeometry() {
  if (cactusGeometry) return cactusGeometry;
  const part = (r, len, x, y, rz = 0) => new THREE.CapsuleGeometry(r, len, 4, 10).rotateZ(rz).translate(x, y, 0);
  cactusGeometry = mergeGeometries([
    part(.34, 2.5, 0, 1.6),
    part(.2, .42, -.42, 1.35, Math.PI / 2), part(.2, .8, -.66, 1.8),
    part(.18, .36, .4, 1.0, Math.PI / 2), part(.18, .62, .6, 1.35),
  ]);
  return cactusGeometry;
}

// Clones a shared environment material with the theme's tint and, optionally, a cover of snow or sand
// on the surfaces that face up. Shared materials stay untouched.
function themedMaterial(base, tint, cover) {
  const m = base.clone();
  m.color.multiply(new THREE.Color(...tint));
  if (!cover) return m;
  const color = new THREE.Color().setRGB(...cover.color.map(v => v / 255), THREE.SRGBColorSpace);
  const f = (v) => v.toFixed(3);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.coverColor = { value: color };
    shader.vertexShader = 'varying float vCover;\n' + shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      vec3 coverNormal = objectNormal;
      #ifdef USE_INSTANCING
        coverNormal = mat3(instanceMatrix) * coverNormal;
      #endif
      vCover = normalize(mat3(modelMatrix) * coverNormal).y;`);
    shader.fragmentShader = 'uniform vec3 coverColor;\nvarying float vCover;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, coverColor, smoothstep(${f(cover.from)}, ${f(cover.to)}, vCover) * ${f(cover.amount)});`);
  };
  m.customProgramCacheKey = () => `cover:${cover.from}:${cover.to}:${cover.amount}`;
  return m;
}

export class MapVisuals {
  // slabMask: the Foundations mask of concrete pads to blend into the ground, if any.
  constructor(map, scene, theme = THEMES.temperate, slabMask = null) {
    this.map = map;
    this.theme = theme;
    this.materials = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    this.groundCanvas = makeGroundCanvas(map, undefined, GROUND_MARGIN, theme);
    const tex = new THREE.CanvasTexture(this.groundCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // The ground carries on beneath the perimeter rocks instead of ending at the playable edge.
    this.groundMargin = GROUND_MARGIN;
    const extent = SIZE + 2 * GROUND_MARGIN;
    const groundMaterial = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
    if (slabMask) applySlabShader(groundMaterial, slabMask, theme);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(SIZE / 2, 0, SIZE / 2);
    ground.receiveShadow = true;
    this.ground = ground;
    this.group.add(ground);

    // vacío exterior
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 6, SIZE * 6), new THREE.MeshBasicMaterial({ color: theme.sky }));
    outer.rotation.x = -Math.PI / 2; outer.position.set(SIZE / 2, -0.4, SIZE / 2);
    this.group.add(outer);

    this.border = borderDecor(map.seed);
    this.buildLandmarks();
    this.buildDecor();
    this.buildOre();
    this.buildWater();
  }

  // A sheet of water over the river bed: nearly opaque where deep, thin over the fords, with
  // ripples (or floes, in the ice theme) drifting downstream.
  buildWater() {
    const river = waterField(this.map);
    if (!river) return;
    const w = this.theme.water, PX = 4;
    const cw = N * PX, ch = Math.ceil((river.z1 - river.z0) / CELL) * PX;
    const alpha = document.createElement('canvas');
    alpha.width = cw; alpha.height = ch;
    const actx = alpha.getContext('2d'), img = actx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const [wet, ford] = river.at((x + .5) / PX * CELL, river.z0 + (y + .5) / PX * CELL);
      const shallow = ford / Math.max(wet, .01);
      const a = smooth(.42, .62, wet) * (w.opacity + (w.shallow - w.opacity) * shallow);
      const o = (y * cw + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = a * 255; img.data[o + 3] = 255;
    }
    actx.putImageData(img, 0, 0);
    const alphaMap = new THREE.CanvasTexture(alpha);
    // Ripples: a smooth tileable brightness pattern that slides along the river.
    const T = 128, rip = document.createElement('canvas'), TAU = Math.PI * 2;
    rip.width = rip.height = T;
    const rctx = rip.getContext('2d'), rimg = rctx.createImageData(T, T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const u = x / T * TAU, v0 = y / T * TAU;
      const wave = (Math.sin(u * 3 + Math.sin(v0 * 2) * 1.4) + Math.sin(u * 5 - v0 * 3 + Math.sin(u * 2) * .8) * .6 + Math.sin(v0 * 4 + u) * .4) / 4 + .5;
      const v = 1 - w.ripple + w.ripple * wave;
      const o = (y * T + x) * 4;
      rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = v * 255; rimg.data[o + 3] = 255;
    }
    rctx.putImageData(rimg, 0, 0);
    const ripples = new THREE.CanvasTexture(rip);
    ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
    ripples.colorSpace = THREE.SRGBColorSpace;
    ripples.repeat.set(SIZE / 22, (river.z1 - river.z0) / 22);
    const material = new THREE.MeshStandardMaterial({ color: w.color, map: ripples, alphaMap, transparent: true,
      depthWrite: false, roughness: .22, metalness: .05 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, river.z1 - river.z0), material);
    water.rotation.x = -Math.PI / 2;
    water.position.set(SIZE / 2, .22, (river.z0 + river.z1) / 2);
    water.receiveShadow = true;
    water.renderOrder = 1;
    water.onBeforeRender = () => { ripples.offset.x = (performance.now() / 1000 * .015) % 1; };
    this.water = water;
    this.group.add(water);
  }

  material(asset, tint) {
    const m = themedMaterial(asset.material, tint, this.theme.cover);
    this.materials.push(m);
    return m;
  }

  // Frees what this instance created; model geometries and their materials are shared and stay loaded.
  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.alphaMap?.dispose(); o.material.dispose(); }
    });
    for (const m of this.materials) m.dispose();
  }

  buildLandmarks() {
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const kind of ['env_cliff', 'env_ruin']) {
      const items = this.map.landmarks.filter(l => l.kind === kind);
      const asset = getInstanceAsset(kind);
      const mesh = new THREE.InstancedMesh(asset.geometry, this.material(asset, kind === 'env_ruin' ? this.theme.ruin : this.theme.cliff), items.length);
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
    const rim = new THREE.InstancedMesh(asset.geometry, this.material(asset, this.theme.cliff), cliffs.length);
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
    const treeAsset = getInstanceAsset('env_tree'), cactus = this.theme.tree.model === 'cactus';
    const treeMaterial = this.material(cactus ? { material: cactusMaterial } : treeAsset, this.theme.tree.tint);
    const treeMesh = new THREE.InstancedMesh(cactus ? getCactusGeometry() : treeAsset.geometry, treeMaterial, trees.length);
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot); p.set(t.x, 0, t.z); s.set(t.s, t.s * (0.9 + rng() * 0.4), t.s);
      m4.compose(p, q, s); treeMesh.setMatrixAt(i, m4);
      treeMesh.setColorAt(i, col.setScalar(0.8 + rng() * 0.2));
    });
    treeMesh.castShadow = treeMesh.receiveShadow = true;
    this.group.add(treeMesh);

    const rockAsset = getInstanceAsset('env_rock');
    const rockMesh = new THREE.InstancedMesh(rockAsset.geometry, this.material(rockAsset, this.theme.rock), rocks.length);
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
