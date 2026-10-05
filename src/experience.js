// Bonuses are totals relative to the unit definition, never cumulative per kill.
export const RANKS = Object.freeze([
  Object.freeze({ name: 'Recluta', kills: 0, damage: 1, health: 1 }),
  Object.freeze({ name: 'Veterana', kills: 3, damage: 1.1, health: 1 }),
  Object.freeze({ name: 'Élite', kills: 8, damage: 1.2, health: 1.1 }),
]);

export function isCombatUnit(unit) {
  return unit.kind === 'unit' && !!unit.def.weapon && !unit.def.harvester;
}

export function experienceText(unit) {
  const rank = RANKS[unit.rank], next = RANKS[unit.rank + 1];
  const progress = next ? `${unit.kills}/${next.kills} bajas · siguiente: ${next.name}` : `${unit.kills} bajas · rango máximo`;
  const bonus = unit.rank === 2 ? '+20 % daño · +10 % vida máxima' : unit.rank === 1 ? '+10 % daño' : 'Sin bonificaciones';
  return `${rank.name} · ${progress}\n${bonus}`;
}
