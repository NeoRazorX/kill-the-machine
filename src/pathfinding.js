import { N, CELL, SIZE } from './config.js';

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
export function nearestFreeCell(grid, x, z, maxR = 10, radius = 0) {
  const cx0 = clampCell(Math.floor(x / CELL)), cz0 = clampCell(Math.floor(z / CELL));
  if (!grid[cz0 * N + cx0] && (!radius || canOccupy(grid, (cx0 + .5) * CELL, (cz0 + .5) * CELL, radius))) return cz0 * N + cx0;
  let best = -1, bestD = Infinity, foundAt = -1;
  for (let r = 1; r <= maxR; r++) {
    if (foundAt >= 0 && r > foundAt + 1) break;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = cx0 + dx, cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= N || cz >= N || grid[cz * N + cx]) continue;
        if (radius && !canOccupy(grid, (cx + .5) * CELL, (cz + .5) * CELL, radius)) continue;
        const d = (cx + 0.5) * CELL - x, e = (cz + 0.5) * CELL - z, dd = d * d + e * e;
        if (dd < bestD) { bestD = dd; best = cz * N + cx; if (foundAt < 0) foundAt = r; }
      }
    }
  }
  return best;
}

// Shared circle-versus-cell clearance for planning and actual movement.
export function canOccupy(grid, x, z, radius) {
  if (!Number.isFinite(x + z + radius) || radius < 0 || x - radius < 0 || z - radius < 0 || x + radius > SIZE || z + radius > SIZE) return false;
  const x0 = Math.max(0, Math.floor((x - radius) / CELL)), x1 = Math.min(N - 1, Math.floor((x + radius) / CELL));
  const z0 = Math.max(0, Math.floor((z - radius) / CELL)), z1 = Math.min(N - 1, Math.floor((z + radius) / CELL));
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    if (!grid[cz * N + cx]) continue;
    const dx = Math.max(cx * CELL - x, 0, x - (cx + 1) * CELL);
    const dz = Math.max(cz * CELL - z, 0, z - (cz + 1) * CELL);
    if (dx * dx + dz * dz <= radius * radius) return false;
  }
  return true;
}

// Test the entire swept circle, including its rounded ends and obstacle corners.
export function clearLine(grid, x0, z0, x1, z1, radius) {
  if (!canOccupy(grid, x0, z0, radius) || !canOccupy(grid, x1, z1, radius)) return false;
  const dx = x1 - x0, dz = z1 - z0, length2 = dx * dx + dz * dz;
  if (length2 < 1e-12) return true;
  const minX = Math.max(0, Math.floor((Math.min(x0, x1) - radius) / CELL));
  const maxX = Math.min(N - 1, Math.floor((Math.max(x0, x1) + radius) / CELL));
  const minZ = Math.max(0, Math.floor((Math.min(z0, z1) - radius) / CELL));
  const maxZ = Math.min(N - 1, Math.floor((Math.max(z0, z1) + radius) / CELL));
  for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
    if (!grid[cz * N + cx]) continue;
    const left = cx * CELL, right = left + CELL, top = cz * CELL, bottom = top + CELL;
    let enter = 0, leave = 1;
    for (const [origin, delta, low, high] of [[x0, dx, left, right], [z0, dz, top, bottom]]) {
      if (Math.abs(delta) < 1e-12) { if (origin < low || origin > high) { enter = 2; break; } }
      else {
        const a = (low - origin) / delta, b = (high - origin) / delta;
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter <= leave) return false;
    for (const x of [left, right]) for (const z of [top, bottom]) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / length2));
      const ex = x - x0 - dx * t, ez = z - z0 - dz * t;
      if (ex * ex + ez * ez <= radius * radius) return false;
    }
  }
  return true;
}

// Devuelve una lista de puntos {x,z} (sin incluir el origen) o null si no hay camino.
export function findPath(grid, sx, sz, gx, gz, radius = 0.8) {
  if (!canOccupy(grid, sx, sz, radius)) return null;
  if (clearLine(grid, sx, sz, gx, gz, radius)) return [{ x: gx, z: gz }];
  const center = i => ({ x: ((i % N) + .5) * CELL, z: (((i / N) | 0) + .5) * CELL });
  // Actual endpoints may be off-center; connect them only through a safe segment.
  const anchor = (x, z, reach) => {
    let best = -1, distance = Infinity;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const i = nz * N + nx, p = center(i), d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < distance && clearLine(grid, x, z, p.x, p.z, radius)) { best = i; distance = d; }
    }
    return best;
  };
  const s = anchor(sx, sz, 2);
  if (s < 0) return null;
  let exact = canOccupy(grid, gx, gz, radius);
  let g = exact ? anchor(gx, gz, 2) : nearestFreeCell(grid, gx, gz, 14, radius);
  if (g < 0) return null;
  const walkable = new Int8Array(SZ);
  const fits = i => {
    if (!walkable[i]) { const p = center(i); walkable[i] = canOccupy(grid, p.x, p.z, radius) ? 1 : -1; }
    return walkable[i] === 1;
  };

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
      if (closed[ni] === stampN || !fits(ni)) continue;
      let cost = 1;
      if (d >= 4) {
        if (!fits(cz * N + nx) || !fits(nz * N + cx)) continue;
        cost = 1.4142;
      }
      const from = center(i), to = center(ni);
      if (!clearLine(grid, from.x, from.z, to.x, to.z, radius)) continue;
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
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k];
    pts.push({ x: ((i % N) + 0.5) * CELL, z: (((i / N) | 0) + 0.5) * CELL });
  }
  if (reached && exact) pts.push({ x: gx, z: gz });
  if (!reached && best === s) return null;
  if (!pts.length) return null;

  // Suavizado por línea de visión con ventana limitada
  const r = radius;
  const out = [];
  let ax = sx, az = sz, i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 14);
    while (j > i && !clearLine(grid, ax, az, pts[j].x, pts[j].z, r)) j--;
    if (!clearLine(grid, ax, az, pts[j].x, pts[j].z, r)) return null;
    out.push(pts[j]);
    ax = pts[j].x; az = pts[j].z;
    i = j + 1;
  }
  return out;
}
