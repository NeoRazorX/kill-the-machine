import * as THREE from 'three';
import { N, CELL } from './config.js';

const rectDist = (px, pz, r) => Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.z0 - pz, 0, pz - r.z1));
const FIRE0 = [1, 0.9, 0.6], FIRE1 = [0.6, 0.15, 0.03];
const SMOKE0 = [0.42, 0.38, 0.34], SMOKE1 = [0.12, 0.11, 0.1];
const ION0 = [0.75, 0.95, 1], ION1 = [0.15, 0.45, 1];
// A superweapon never takes a headquarters below this share of its health in one strike.
export const HQ_FLOOR = 0.25;

// Charges the repaired missile silo and ion cannon, fires them and resolves their strikes. The charge
// only runs with enough power and restarts from zero when the structure changes hands.
export class Superweapons {
  constructor(game) {
    this.game = game;
    this.strikes = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.ringGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
    this.columnGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
  }

  get sites() { return this.game.techSites?.items.filter((b) => b.def.superweapon) ?? []; }

  online(b) { return !!b.team && b.tech?.state === 'online' && !b.dead; }
  progress(b) { return Math.min(1, (b.tech.charge || 0) / b.def.superweapon.charge); }
  isReady(b) { return this.online(b) && this.progress(b) >= 1; }
  remaining(b) { return Math.max(0, b.def.superweapon.charge - (b.tech.charge || 0)); }
  ready(team) { return this.sites.filter((b) => b.team === team && this.isReady(b)); }

  reset(b) { b.tech.charge = 0; b.tech.announcedReady = false; }

  update(dt) {
    const g = this.game;
    for (const b of this.sites) {
      if (!this.online(b) || this.isReady(b) || g.lowPower(b.team)) continue;
      b.tech.charge = Math.min(b.def.superweapon.charge, (b.tech.charge || 0) + dt);
      if (this.isReady(b) && !b.tech.announcedReady) {
        b.tech.announcedReady = true;
        if (b.team === g.player && !g.spectate) {
          g.audio.play('ready');
          g.audio.say(`${b.def.superweapon.title} listo`, 0);
          g.emit('toast', { text: `${b.def.superweapon.title} listo: elige un objetivo desde la barra lateral`, kind: 'good' });
        }
      }
    }
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t += dt;
      this.animate(s);
      if (s.t >= s.sw.delay) { this.strikes.splice(i, 1); this.detonate(s); }
    }
  }

  // The player may only aim at ground they have explored.
  canTarget(team, x, z) {
    const g = this.game;
    if (g.spectate || team !== g.player) return true;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    return cx >= 0 && cz >= 0 && cx < N && cz < N && g.fog[cz * N + cx] > 0;
  }

  fire(b, x, z) {
    const g = this.game;
    if (!this.isReady(b) || !this.canTarget(b.team, x, z)) return false;
    const sw = b.def.superweapon;
    this.reset(b);
    g.bump?.(b.team, 'strikes');
    const s = { sw, team: b.team, x, z, sx: b.x, sz: b.z, t: 0, meshes: [] };
    // Everybody sees where a strike is coming, so units can still get clear.
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: sw.kind === 'ion' ? 0x6fd8ff : 0xff4a3a,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.set(x, 0.15, z); ring.scale.setScalar(sw.radius); ring.renderOrder = 4;
    s.ring = ring; s.meshes.push(ring);
    if (sw.kind === 'nuke') {
      const missile = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 4, 10), new THREE.MeshStandardMaterial({ color: 0xd8dcdc, roughness: 0.5 }));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 10), new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.5 }));
      tip.position.y = 2.65;
      missile.add(body, tip);
      s.missile = missile; s.meshes.push(missile);
    } else {
      const column = new THREE.Mesh(this.columnGeo, new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      column.position.set(x, 0, z); column.scale.set(0.2, 160, 0.2);
      s.column = column; s.meshes.push(column);
    }
    for (const m of s.meshes) this.group.add(m);
    this.strikes.push(s);
    // The ion beam hums as it builds up over the target; the missile roars out of its silo.
    if (sw.kind === 'ion') g.audio.play('ioncharge', x, z); else g.audio.play('missilelaunch', b.x, b.z);
    const own = b.team === g.player, title = sw.title;
    if (!g.spectate) {
      if (own) { g.audio.say(sw.kind === 'nuke' ? 'Misil lanzado' : 'Cañón de iones disparado', 0); }
      else {
        g.audio.play('alert');
        g.audio.say(sw.kind === 'nuke' ? 'Atención: misil nuclear lanzado' : 'Atención: ataque de cañón de iones', 0);
        g.emit('toast', { text: `¡${title} enemigo disparado! Aparta tus unidades de la zona marcada`, kind: 'warn' });
      }
      g.emit('alert', { x, z });
    }
    return true;
  }

  animate(s) {
    const k = s.t / s.sw.delay, g = this.game;
    s.ring.material.opacity = 0.55 + 0.45 * Math.sin(s.t * 10);
    if (s.missile) {
      // Up out of the silo, then down onto the target.
      const m = s.missile;
      if (k < 0.45) {
        const u = k / 0.45;
        m.position.set(s.sx, 2 + u * u * 140, s.sz);
        m.rotation.set(0, 0, 0);
      } else {
        const u = (k - 0.45) / 0.55;
        m.position.set(s.x, 142 * (1 - u * u), s.z);
        m.rotation.set(Math.PI, 0, 0);
      }
      if (Math.random() < 0.8) g.fx.spawn(m.position.x, m.position.y + (k < 0.45 ? -2.5 : 2.5), m.position.z, (Math.random() - .5), 0, (Math.random() - .5), 1.2, 0.8, 2.2, SMOKE0, SMOKE1, -0.2, 0.6);
    } else {
      // A thin targeting beam that thickens just before the discharge.
      s.column.material.opacity = 0.25 + 0.5 * k;
      s.column.scale.x = s.column.scale.z = 0.15 + 0.4 * k;
      if (Math.random() < 0.6) g.fx.spawn(s.x + (Math.random() - .5) * 2, 0.3, s.z + (Math.random() - .5) * 2, 0, 2 + Math.random() * 3, 0, 0.5, 0.3, 0.05, ION0, ION1, 0, 0);
    }
  }

  dispose(s) {
    for (const m of s.meshes) {
      this.group.remove(m);
      m.traverse((o) => { if (o.isMesh) { if (o.geometry !== this.ringGeo && o.geometry !== this.columnGeo) o.geometry.dispose(); o.material.dispose(); } });
    }
  }

  // Damage falls off from the centre and spares nobody, not even the side that fired.
  detonate(s) {
    const g = this.game, { sw, x, z } = s, R = sw.radius;
    this.dispose(s);
    for (const u of g.queryUnits(x, z, R + 3).slice()) {
      if (u.dead || !u.team) continue;
      const d = Math.max(0, Math.hypot(u.x - x, u.z - z) - u.radius);
      if (d <= R) g.damage(u, sw.damage * (1 - 0.6 * d / R), u.team === s.team ? null : s.team, { x, z });
    }
    for (const b of g.buildings.slice()) {
      if (b.dead || !b.team || b.selling) continue;
      const d = rectDist(x, z, b.rect);
      if (d > R) continue;
      let amount = sw.damage * (1 - 0.6 * d / R);
      if (b.def.role === 'hq') amount = Math.min(amount, Math.max(0, b.hp - b.maxHp * HQ_FLOOR));
      g.damage(b, amount, b.team === s.team ? null : s.team, { x, z });
    }
    this.blast(s);
  }

  blast(s) {
    const g = this.game, fx = g.fx, { x, z, sw } = s, R = sw.radius, nuke = sw.kind === 'nuke';
    g.audio.play(nuke ? 'bigexplosion' : 'iondischarge', x, z);
    fx.flash(x, 3, z, R * (nuke ? 1.4 : 1), nuke ? 0xfff2d0 : 0xb8f0ff, nuke ? 0.9 : 0.5);
    fx.scorch(x, z, R * 1.05, 0.7);
    if (fx.beam && !nuke) fx.beam(x, 150, z, x, 0, z, 0x9fe8ff, R * 4);
    const n = nuke ? 16 : 7;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R * 0.8;
      fx.delayed?.push({ t: Math.random() * (nuke ? 0.8 : 0.3), fn: () => fx.explosion(x + Math.cos(a) * r, 0.5, z + Math.sin(a) * r, nuke ? 3 + Math.random() * 2 : 2 + Math.random()) });
    }
    // Shock ring along the ground; a mushroom of fire and smoke for the missile, sparks for the ion beam.
    for (let i = 0; i < (nuke ? 60 : 36); i++) {
      const a = (i / (nuke ? 60 : 36)) * Math.PI * 2, sp = R * 2.2;
      fx.spawn(x, 0.6, z, Math.cos(a) * sp, 0.4, Math.sin(a) * sp, 0.6, 1.4, 2.4, nuke ? SMOKE0 : ION0, nuke ? SMOKE1 : ION1, 0, 2.2);
    }
    if (nuke) {
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 2.5, up = 6 + Math.random() * 8;
        fx.spawn(x + Math.cos(a) * r, 1, z + Math.sin(a) * r, Math.cos(a) * 1.5, up, Math.sin(a) * 1.5, 2.5 + Math.random() * 2, 2, 5.5, i % 3 ? SMOKE0 : FIRE0, i % 3 ? SMOKE1 : FIRE1, -0.6, 0.9);
      }
    } else {
      for (let i = 0; i < 30; i++) fx.spawn(x, 1, z, (Math.random() - .5) * 8, 8 + Math.random() * 10, (Math.random() - .5) * 8, 0.8, 0.5, 0.1, ION0, ION1, 6, 0.5);
    }
  }

  // Charge bars for the owner; the enemy's discovered weapons with their countdown, as in Command & Conquer.
  status(team) {
    const g = this.game, own = [], enemy = [];
    for (const b of this.sites) {
      if (!this.online(b)) continue;
      if (b.team === team) own.push(b);
      else if (b.tech.found[team]) enemy.push(b);
    }
    return { own, enemy };
  }
}
