import { N, CELL } from './config.js';

const SZ = N * N;
const gCost = new Float32Array(SZ);
const parent = new Int32Array(SZ);
const seen = new Uint32Array(SZ);
const closed = new Uint32Array(SZ);
let stampN = 0;

const HCAP = SZ * 8;
const heapF = new Float32Array(HCAP);
const heapI = new Int32Array(HCAP);
let heapN = 0;

function push(f, i) {
  if (heapN >= HCAP) return;
  let k = heapN++;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heapF[p] <= f) break;
    heapF[k] = heapF[p]; heapI[k] = heapI[p]; k = p;
  }
  heapF[k] = f; heapI[k] = i;
}
function pop() {
  const top = heapI[0];
  heapN--;
  if (heapN > 0) {
    const f = heapF[heapN], i = heapI[heapN];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= heapN) break;
      if (c + 1 < heapN && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= f) break;
      heapF[k] = heapF[c]; heapI[k] = heapI[c]; k = c;
    }
    heapF[k] = f; heapI[k] = i;
  }
  return top;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

const clampCell = (v) => (v < 0 ? 0 : v >= N ? N - 1 : v);
export const cellIndex = (x, z) => clampCell(Math.floor(z / CELL)) * N + clampCell(Math.floor(x / CELL));

// Celda libre más cercana (por distancia euclídea al punto original) dentro de maxR celdas.
export function nearestFreeCell(grid, x, z, maxR = 10) {
  const cx0 = clampCell(Math.floor(x / CELL)), cz0 = clampCell(Math.floor(z / CELL));
  if (!grid[cz0 * N + cx0]) return cz0 * N + cx0;
  let best = -1, bestD = Infinity, foundAt = -1;
  for (let r = 1; r <= maxR; r++) {
    if (foundAt >= 0 && r > foundAt + 1) break;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = cx0 + dx, cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= N || cz >= N || grid[cz * N + cx]) continue;
        const d = (cx + 0.5) * CELL - x, e = (cz + 0.5) * CELL - z, dd = d * d + e * e;
        if (dd < bestD) { bestD = dd; best = cz * N + cx; if (foundAt < 0) foundAt = r; }
      }
    }
  }
  return best;
}

function blockedXZ(grid, x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  return cx < 0 || cz < 0 || cx >= N || cz >= N || grid[cz * N + cx] !== 0;
}

export function clearLine(grid, x0, z0, x1, z1, r) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  if (len < 0.01) return true;
  const steps = Math.ceil(len / 1.0);
  const nx = (-dz / len) * r, nz = (dx / len) * r;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, x = x0 + dx * t, z = z0 + dz * t;
    if (blockedXZ(grid, x, z) || blockedXZ(grid, x + nx, z + nz) || blockedXZ(grid, x - nx, z - nz)) return false;
  }
  return true;
}

// Devuelve una lista de puntos {x,z} (sin incluir el origen) o null si no hay camino.
export function findPath(grid, sx, sz, gx, gz, radius = 0.8) {
  let s = cellIndex(sx, sz);
  if (grid[s]) { s = nearestFreeCell(grid, sx, sz, 6); if (s < 0) return null; }
  let g = cellIndex(gx, gz), exact = true;
  if (grid[g]) { g = nearestFreeCell(grid, gx, gz, 14); exact = false; if (g < 0) return null; }
  if (s === g) return [exact ? { x: gx, z: gz } : { x: ((g % N) + 0.5) * CELL, z: (((g / N) | 0) + 0.5) * CELL }];

  const gcx = g % N, gcz = (g / N) | 0;
  const h = (i) => {
    const dx = Math.abs((i % N) - gcx), dz = Math.abs(((i / N) | 0) - gcz);
    return dx + dz - 0.5858 * Math.min(dx, dz);
  };

  stampN++;
  heapN = 0;
  gCost[s] = 0; seen[s] = stampN; parent[s] = -1;
  push(h(s), s);
  let best = s, bestH = h(s), expansions = 0, reached = false;

  while (heapN > 0) {
    const i = pop();
    if (closed[i] === stampN) continue;
    closed[i] = stampN;
    if (i === g) { best = g; reached = true; break; }
    const hh = h(i);
    if (hh < bestH) { bestH = hh; best = i; }
    if (++expansions > 14000) break;
    const cx = i % N, cz = (i / N) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], nz = cz + DZ[d];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (grid[ni] || closed[ni] === stampN) continue;
      let cost = 1;
      if (d >= 4) {
        if (grid[cz * N + nx] || grid[nz * N + cx]) continue;
        cost = 1.4142;
      }
      if (grid[ni - 1] | grid[ni + 1] | grid[ni - N] | grid[ni + N]) cost += 0.7;
      const ng = gCost[i] + cost;
      if (seen[ni] !== stampN || ng < gCost[ni]) {
        seen[ni] = stampN; gCost[ni] = ng; parent[ni] = i;
        push(ng + h(ni), ni);
      }
    }
  }

  const cells = [];
  for (let i = best; i !== -1; i = parent[i]) cells.push(i);
  cells.reverse();
  const pts = [];
  for (let k = 1; k < cells.length; k++) {
    const i = cells[k];
    pts.push({ x: ((i % N) + 0.5) * CELL, z: (((i / N) | 0) + 0.5) * CELL });
  }
  if (reached && exact) { if (pts.length) pts[pts.length - 1] = { x: gx, z: gz }; else pts.push({ x: gx, z: gz }); }
  if (!pts.length) return null;

  // Suavizado por línea de visión con ventana limitada
  const r = Math.min(radius, 1.0) * 0.9;
  const out = [];
  let ax = sx, az = sz, i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 14);
    while (j > i && !clearLine(grid, ax, az, pts[j].x, pts[j].z, r)) j--;
    out.push(pts[j]);
    ax = pts[j].x; az = pts[j].z;
    i = j + 1;
  }
  return out;
}
