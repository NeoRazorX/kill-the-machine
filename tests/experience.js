import * as THREE from 'three';
import { Game } from '../src/game.js';
import { Unit } from '../src/units.js';
import { FX } from '../src/fx.js';
import { DEFS } from '../src/config.js';
import { experienceText } from '../src/experience.js';

export function checkExperience() {
  const results = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); results.push(`PASS ${message}`); };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const game = Object.assign(Object.create(Game.prototype), {
    player: 'human', spectate: true, time: 0, units: [], buildings: [],
    teams: { human: { stats: { killed: 0, lost: 0 } }, machine: { stats: { killed: 0, lost: 0 } } },
    scene: new THREE.Scene(), audio: { play() {}, say() {} }, emit() {},
    fx: { explosion() {}, scorch() {}, bigExplosion() {}, hitSpark() {} },
    removeBuilding(e) { e.dead = true; }, queryUnits() { return this.units; },
  });
  function unit(team = 'human', id = team === 'human' ? 'h_rifle' : 'm_sentinel') {
    const def = DEFS[id], mesh = new THREE.Group(), muzzle = new THREE.Object3D(); mesh.add(muzzle);
    return Object.assign(Object.create(Unit.prototype), {
      game, kind: 'unit', def, team, hp: def.hp, maxHp: def.hp, kills: 0, rank: 0, damageMultiplier: 1,
      dead: false, x: 0, z: 0, radius: def.radius, cls: def.cls, heading: 0, aim: 0,
      mesh, parts: { muzzle },
    });
  }
  function eliminate(source, victim = unit(source.team === 'human' ? 'machine' : 'human')) {
    game.damage(victim, victim.hp, source.team, { x: 0, z: 0 }, source);
    return victim;
  }
  const original = JSON.stringify(DEFS);
  for (const team of ['human', 'machine']) {
    const attacker = unit(team), fresh = unit(team);
    attacker.hp = attacker.maxHp * .4;
    for (let i = 0; i < 2; i++) eliminate(attacker);
    assert(attacker.rank === 0 && attacker.damageMultiplier === 1, `${team}: two kills remain recruit`);
    eliminate(attacker);
    assert(attacker.rank === 1 && near(attacker.damageMultiplier, 1.1) && attacker.maxHp === attacker.def.hp, `${team}: third kill grants veteran damage only`);
    for (let i = 3; i < 7; i++) eliminate(attacker);
    assert(attacker.rank === 1, `${team}: seven kills remain veteran`);
    eliminate(attacker);
    assert(attacker.rank === 2 && near(attacker.damageMultiplier, 1.2) && near(attacker.maxHp, attacker.def.hp * 1.1), `${team}: eighth kill grants elite totals`);
    assert(near(attacker.hp / attacker.maxHp, .4), `${team}: promotion preserves health percentage`);
    const eliteHp = attacker.hp;
    for (let i = 0; i < 12; i++) eliminate(attacker);
    assert(attacker.kills === 20 && attacker.rank === 2 && attacker.hp === eliteHp && near(attacker.damageMultiplier, 1.2), `${team}: bonuses cap at elite`);
    assert(fresh.rank === 0 && fresh.maxHp === fresh.def.hp && fresh.damageMultiplier === 1, `${team}: other units do not inherit bonuses`);
    assert(experienceText(attacker).includes('Élite') && experienceText(attacker).includes('20 bajas'), `${team}: rank panel exposes current progress`);
  }
  const attacker = unit();
  const victim = eliminate(attacker);
  game.kill(victim, attacker.team, attacker);
  assert(attacker.kills === 1, 'repeated impacts cannot count a dead victim twice');
  eliminate(attacker, unit('human'));
  assert(attacker.kills === 1, 'friendly kills grant no experience');
  const building = { kind: 'building', team: 'machine', hp: 1, def: DEFS.m_power, w: 2, h: 2, x: 0, z: 0 };
  eliminate(attacker, building);
  assert(attacker.kills === 1, 'destroying buildings grants no experience');
  const harvester = unit('human', 'h_harv'); eliminate(harvester);
  assert(harvester.kills === 0, 'harvesters cannot gain ranks');
  const tower = { kind: 'building', team: 'human' }; eliminate(tower);
  assert(tower.rank === undefined, 'static defenses cannot gain ranks');
  attacker.dead = true; eliminate(attacker);
  assert(attacker.kills === 1, 'projectiles from a dead attacker grant no posthumous ranks');

  const shooter = unit(), fx = Object.assign(Object.create(FX.prototype), {
    game, projectiles: [], muzzle() {}, beam() {}, acquireProj() { return new THREE.Object3D(); },
  });
  for (let i = 0; i < 3; i++) eliminate(shooter);
  const target = unit('machine');
  fx.fireWeapon(shooter, target);
  const projectile = fx.projectiles[0];
  assert(projectile.source === shooter && near(projectile.dmg, shooter.def.weapon.damage * 1.1), 'projectile captures shooter and veteran damage at launch');
  for (let i = 3; i < 8; i++) eliminate(shooter);
  assert(near(projectile.dmg, shooter.def.weapon.damage * 1.1), 'in-flight damage does not change after promotion');
  target.hp = 1;
  game.impact(projectile);
  assert(target.dead && shooter.kills === 9, 'direct projectile kill credits the original shooter');
  const artillery = unit('human', 'h_arty');
  const enemies = [unit('machine'), unit('machine')]; enemies.forEach(e => { e.hp = 1; });
  const ally = unit('human'); ally.hp = 1;
  game.units = [...enemies, ally];
  const splash = { weapon: artillery.def.weapon, team: 'human', source: artillery, dmg: 100, splash: 5, x: 0, y: 0, z: 0 };
  game.impact(splash); game.impact(splash);
  assert(artillery.kills === 2 && !ally.dead, 'splash credits each enemy once without friendly kills');
  const beamShooter = unit('machine', 'm_sentinel');
  // Exercise the instantaneous weapon branch while keeping shared definitions untouched.
  beamShooter.def = { ...beamShooter.def, weapon: { ...beamShooter.def.weapon, proj: 'beam', splash: 0 } };
  const beamTarget = unit(); beamTarget.hp = 1;
  fx.fireWeapon(beamShooter, beamTarget);
  assert(beamTarget.dead && beamShooter.kills === 1, 'instant beam kills also award experience');
  assert(JSON.stringify(DEFS) === original, 'shared unit and weapon definitions remain unchanged');
  return results;
}
