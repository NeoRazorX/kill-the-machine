import { CELL, SIZE, DEFS, visionRadius } from './config.js';
import { mulberry32 } from './map.js';
import { canOccupy, clearLine, findPath } from './pathfinding.js';
import { cloneModel } from './assets.js';

export const CASH_CRATE_COUNT = 12;
export const CASH_CRATE_RADIUS = 1.2;
const MAX_UNIT_SIGHT = Math.max(...Object.values(DEFS).filter(d => d.kind === 'unit').map(d => d.sight));

// Separate from the terrain seed: the familiar quarry has new rewards each match.
export function generateCashCrates(map, seed) {
  const random = mulberry32(seed), items = [];
  // Every corner may hold a base, so none of them gets a crate.
  const starts = map.spawns.map(([x, z]) => ({ x: x * CELL, z: z * CELL }));
  for (let attempt = 0; attempt < 3000 && items.length < CASH_CRATE_COUNT; attempt++) {
    const x = (4 + Math.floor(random() * (SIZE / CELL - 8)) + .5) * CELL;
    const z = (4 + Math.floor(random() * (SIZE / CELL - 8)) + .5) * CELL;
    if (starts.some(s => Math.hypot(x - s.x, z - s.z) < 48)) continue;
    if (map.fields.some(f => Math.hypot(x - f.x, z - f.z) < f.r + 6)) continue;
    if (items.some(c => Math.hypot(x - c.x, z - c.z) < 24)) continue;
    if (!canOccupy(map.grid, x, z, 1.8) || map.waterXZ?.(x, z)) continue;
    // Even the largest vehicle must be able to reach the exact pickup position.
    const reachable = starts.every(s => {
      const path = findPath(map.grid, s.x, s.z, x, z, 1.6), end = path?.at(-1);
      return end && Math.hypot(end.x - x, end.z - z) < .01;
    });
    if (!reachable) continue;
    items.push({ id: items.length, x, z, amount: 300 + Math.floor(random() * 5) * 100,
      rotation: random() * Math.PI * 2, seen: false, found: {}, collected: false });
  }
  return items;
}

export class CashCrates {
  constructor(game, seed = Math.floor(Math.random() * 0x100000000)) {
    this.game = game;
    this.items = generateCashCrates(game.map, seed);
    for (const crate of this.items) {
      crate.mesh = cloneModel('prop_cash_crate').group;
      crate.mesh.position.set(crate.x, 0, crate.z);
      crate.mesh.rotation.y = crate.rotation;
      crate.mesh.visible = false;
      game.scene.add(crate.mesh);
    }
  }

  // Removes the crates from the scene, when the menu swaps the map before a match.
  dispose() {
    for (const crate of this.items) this.game.scene.remove(crate.mesh);
  }

  at(x, z) {
    return this.items.find(c => !c.collected && (c.seen || this.game.spectate) && Math.hypot(c.x - x, c.z - z) <= 2.3);
  }

  // Cajas pendientes que el bando ya ha visto con sus propias unidades o edificios.
  discoveredBy(team) {
    return this.items.filter(c => !c.collected && c.found[team]);
  }

  // Cada bando descubre por su cuenta, independientemente de la niebla del jugador.
  discover() {
    const g = this.game;
    for (const crate of this.items) {
      if (crate.collected) continue;
      for (const b of g.buildings) {
        if (!b.dead && b.team && !crate.found[b.team] && Math.hypot(b.x - crate.x, b.z - crate.z) <= visionRadius(b)) crate.found[b.team] = true;
      }
      for (const s of g.superweapons?.spotters ?? []) {
        if (!crate.found[s.team] && Math.hypot(s.x - crate.x, s.z - crate.z) <= s.def.sight) crate.found[s.team] = true;
      }
      for (const u of g.queryUnits(crate.x, crate.z, MAX_UNIT_SIGHT)) {
        if (!u.dead && !crate.found[u.team] && Math.hypot(u.x - crate.x, u.z - crate.z) <= u.def.sight) crate.found[u.team] = true;
      }
    }
  }

  claim(crate, unit) {
    const g = this.game;
    if (crate.collected || unit.dead || !g.teams[unit.team]) return;
    crate.collected = true;
    crate.mesh.visible = false;
    g.scene.remove(crate.mesh);
    // A found cash reserve pays its face value, independently of AI mining income.
    const team = g.teams[unit.team];
    team.credits += crate.amount;
    team.stats.earned += crate.amount;
    g.bump?.(unit.team, 'crates'); g.bump?.(unit.team, 'crateCredits', crate.amount);
    if (g.visibleAt(crate.x, crate.z) || g.spectate) g.fx.marker(crate.x, crate.z, 'rally');
    if (unit.team === g.player && !g.spectate) {
      g.audio.play('sell');
      g.emit('toast', { text: `Caja recuperada: +${crate.amount} $`, kind: 'good' });
    }
  }

  update() {
    const g = this.game;
    for (const crate of this.items) {
      if (crate.collected) continue;
      if (g.visibleAt(crate.x, crate.z)) crate.seen = true;
      crate.mesh.visible = crate.seen || g.spectate;
      if (g.over) continue;
      let collector = null, nearest = Infinity;
      for (const unit of g.queryUnits(crate.x, crate.z, 3.5)) {
        if (unit.dead || !g.teams[unit.team]) continue;
        const distance = Math.hypot(unit.x - crate.x, unit.z - crate.z);
        if (distance > unit.radius + CASH_CRATE_RADIUS) continue;
        if (!clearLine(g.map.grid, unit.x, unit.z, crate.x, crate.z, 0)) continue;
        if (distance < nearest || (distance === nearest && unit.id < collector?.id)) {
          collector = unit; nearest = distance;
        }
      }
      if (collector) this.claim(crate, collector);
    }
  }
}
