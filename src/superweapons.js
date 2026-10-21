import * as THREE from 'three';
import { N, CELL, SIZE } from './config.js';

const rectDist = (px, pz, r) => Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.z0 - pz, 0, pz - r.z1));
const FIRE0 = [1, 0.9, 0.6], FIRE1 = [0.6, 0.15, 0.03];
const SMOKE0 = [0.42, 0.38, 0.34], SMOKE1 = [0.12, 0.11, 0.1];
const ION0 = [0.75, 0.95, 1], ION1 = [0.15, 0.45, 1];
// A superweapon never takes a headquarters below this share of its health in one strike.
export const HQ_FLOOR = 0.25;

// The ion beam's path: from the aimed start towards the end, cut to the weapon's length and kept on the map.
export function ionPath(sw, x, z, x2 = x, z2 = z) {
  let dx = x2 - x, dz = z2 - z, len = Math.hypot(dx, dz);
  if (len > sw.length) { dx *= sw.length / len; dz *= sw.length / len; len = sw.length; }
  let k = 1;
  for (const [p, d] of [[x, dx], [z, dz]]) {
    if (p + d * k < 0) k = -p / d;
    if (p + d * k > SIZE) k = (SIZE - p) / d;
  }
  return { x, z, x2: x + dx * k, z2: z + dz * k, len: len * k };
}

// Distance from a point to the segment a→b, and how far along it the closest point lies.
export function segDist(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / l2)) : 0;
  return Math.hypot(px - x0 - dx * t, pz - z0 - dz * t);
}
// Closest distance from a building's walls to the segment: zero if the segment crosses the building,
// otherwise the nearest of its ends to the walls or of the corners to the segment.
export function rectSegDist(r, x0, z0, x1, z1) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [p, q] of [[-dx, x0 - r.x0], [dx, r.x1 - x0], [-dz, z0 - r.z0], [dz, r.z1 - z0]]) {
    if (!p) { if (q < 0) { t0 = 2; break; } continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  if (t0 <= t1) return 0;
  return Math.min(rectDist(x0, z0, r), rectDist(x1, z1, r),
    segDist(r.x0, r.z0, x0, z0, x1, z1), segDist(r.x1, r.z0, x0, z0, x1, z1), segDist(r.x0, r.z1, x0, z0, x1, z1), segDist(r.x1, r.z1, x0, z0, x1, z1));
}

export class Superweapons {
  constructor(game) {
    this.game = game;
    this.strikes = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.ringGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
    this.columnGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    this.stripGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
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
      if (s.sw.kind === 'ion') {
        if (s.t < s.sw.delay) this.animate(s);
        else if (this.sweep(s)) { this.strikes.splice(i, 1); this.dispose(s); }
        continue;
      }
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

  // The missile falls on (x, z); the ion beam sweeps from (x, z) towards (x2, z2). Only the start
  // has to be explored ground.
  fire(b, x, z, x2 = x, z2 = z) {
    const g = this.game;
    if (!this.isReady(b) || !this.canTarget(b.team, x, z)) return false;
    const sw = b.def.superweapon;
    this.reset(b);
    g.bump?.(b.team, 'strikes');
    const s = { sw, team: b.team, x, z, sx: b.x, sz: b.z, t: 0, meshes: [] };
    // Everybody sees where a strike is coming, so units can still get clear.
    const mat = () => new THREE.MeshBasicMaterial({ color: sw.kind === 'ion' ? 0x6fd8ff : 0xff4a3a,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(this.ringGeo, mat());
    ring.position.set(x, 0.15, z); ring.scale.setScalar(sw.radius); ring.renderOrder = 4;
    s.ring = ring; s.meshes.push(ring);
    if (sw.kind === 'ion') {
      Object.assign(s, ionPath(sw, x, z, x2, z2), { head: 0, hit: new Set(), scorched: 0 });
      // The swath still to be swept, and a ring where it ends.
      const end = new THREE.Mesh(this.ringGeo, mat());
      end.position.set(s.x2, 0.15, s.z2); end.scale.setScalar(sw.radius); end.renderOrder = 4;
      const strip = new THREE.Mesh(this.stripGeo, mat());
      strip.rotation.y = Math.atan2(s.x2 - x, s.z2 - z); strip.renderOrder = 4;
      s.end = end; s.strip = strip; s.meshes.push(end, strip);
      this.placeStrip(s, 0);
    }
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
      const pulse = 0.55 + 0.45 * Math.sin(s.t * 10);
      s.end.material.opacity = pulse; s.strip.material.opacity = 0.18 * pulse;
      s.column.material.opacity = 0.25 + 0.5 * k;
      s.column.scale.x = s.column.scale.z = 0.15 + 0.4 * k;
      if (Math.random() < 0.6) g.fx.spawn(s.x + (Math.random() - .5) * 2, 0.3, s.z + (Math.random() - .5) * 2, 0, 2 + Math.random() * 3, 0, 0.5, 0.3, 0.05, ION0, ION1, 0, 0);
    }
  }

  dispose(s) {
    for (const m of s.meshes) {
      this.group.remove(m);
      m.traverse((o) => { if (o.isMesh) { if (![this.ringGeo, this.columnGeo, this.stripGeo].includes(o.geometry)) o.geometry.dispose(); o.material.dispose(); } });
    }
  }

  // The marked swath from `from` (distance along the path) to its end.
  placeStrip(s, from) {
    const ux = (s.x2 - s.x) / (s.len || 1), uz = (s.z2 - s.z) / (s.len || 1), mid = (from + s.len) / 2;
    s.strip.position.set(s.x + ux * mid, 0.14, s.z + uz * mid);
    s.strip.scale.set(s.sw.radius * 2, 1, Math.max(0.01, s.len - from));
  }

  hurt(e, amount, s, x, z) {
    if (e.kind === 'building' && e.def.role === 'hq') amount = Math.min(amount, Math.max(0, e.hp - e.maxHp * HQ_FLOOR));
    this.game.damage(e, amount, e.team === s.team ? null : s.team, { x, z });
  }

  // The ion beam runs along its path over sw.sweep seconds. Whatever comes within its reach is hit
  // once, harder the closer it stands to the line, and the side that fired is no exception.
  // Returns true once the beam has reached the end.
  sweep(s) {
    const g = this.game, fx = g.fx, sw = s.sw, R = sw.radius;
    const ux = (s.x2 - s.x) / (s.len || 1), uz = (s.z2 - s.z) / (s.len || 1);
    const k = Math.min(1, (s.t - sw.delay) / sw.sweep), prev = s.head, head = s.len * k;
    if (!s.started) {
      s.started = true;
      g.audio.play('iondischarge', s.x, s.z);
      fx.flash(s.x, 3, s.z, R * 1.5, 0xb8f0ff, 0.4);
      if (fx.beam) fx.beam(s.x, 150, s.z, s.x, 0, s.z, 0x9fe8ff, R * 2);
      s.ring.visible = false;
    }
    const along = (d) => Math.max(0, 1 - 0.6 * d / R);
    for (let i = 0, n = Math.max(1, Math.ceil(head - prev)); i <= n; i++) {
      const d = prev + (head - prev) * i / n, x = s.x + ux * d, z = s.z + uz * d;
      for (const u of g.queryUnits(x, z, R + 3).slice()) {
        if (u.dead || !u.team || s.hit.has(u) || Math.hypot(u.x - x, u.z - z) - u.radius > R) continue;
        s.hit.add(u);
        this.hurt(u, sw.damage * along(Math.max(0, segDist(u.x, u.z, s.x, s.z, s.x2, s.z2) - u.radius)), s, x, z);
      }
      for (const b of g.buildings.slice()) {
        if (b.dead || !b.team || b.selling || s.hit.has(b) || rectDist(x, z, b.rect) > R) continue;
        s.hit.add(b);
        this.hurt(b, sw.damage * along(rectSegDist(b.rect, s.x, s.z, s.x2, s.z2)), s, x, z);
      }
    }
    s.head = head;
    // The beam itself, burning a trail as it goes.
    const x = s.x + ux * head, z = s.z + uz * head;
    s.column.position.set(x, 0, z);
    s.column.material.opacity = 0.4 + 0.2 * Math.random();
    s.column.scale.x = s.column.scale.z = R * (0.45 + 0.1 * Math.random());
    this.placeStrip(s, head);
    const pulse = 0.55 + 0.45 * Math.sin(s.t * 10);
    s.end.material.opacity = pulse; s.strip.material.opacity = 0.18 * pulse;
    while (s.scorched <= head) {
      const d = s.scorched;
      fx.scorch(s.x + ux * d, s.z + uz * d, R * 0.9, 0.6);
      if (Math.random() < 0.5) fx.explosion(s.x + ux * d + (Math.random() - .5) * R, 0.5, s.z + uz * d + (Math.random() - .5) * R, 1.5 + Math.random());
      s.scorched += 2.5;
    }
    if (s.t >= (s.hum ??= sw.delay + 0.6)) { s.hum += 0.6; g.audio.play('iondischarge', x, z); }
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      fx.spawn(x, 0.6, z, Math.cos(a) * R * 2, 2 + Math.random() * 6, Math.sin(a) * R * 2, 0.6, 0.6, 0.1, ION0, ION1, 4, 0.8);
    }
    if (Math.random() < 0.3) fx.flash(x, 2, z, R, 0xb8f0ff, 0.15);
    return k >= 1;
  }

  // The missile: damage falls off from the centre and spares nobody, not even the side that fired.
  detonate(s) {
    const g = this.game, { sw, x, z } = s, R = sw.radius;
    this.dispose(s);
    for (const u of g.queryUnits(x, z, R + 3).slice()) {
      if (u.dead || !u.team) continue;
      const d = Math.max(0, Math.hypot(u.x - x, u.z - z) - u.radius);
      if (d <= R) this.hurt(u, sw.damage * (1 - 0.6 * d / R), s, x, z);
    }
    for (const b of g.buildings.slice()) {
      if (b.dead || !b.team || b.selling) continue;
      const d = rectDist(x, z, b.rect);
      if (d <= R) this.hurt(b, sw.damage * (1 - 0.6 * d / R), s, x, z);
    }
    this.blast(s);
  }

  blast(s) {
    const g = this.game, fx = g.fx, { x, z, sw } = s, R = sw.radius;
    g.audio.play('bigexplosion', x, z);
    fx.flash(x, 3, z, R * 1.4, 0xfff2d0, 0.9);
    fx.scorch(x, z, R * 1.05, 0.7);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R * 0.8;
      fx.delayed?.push({ t: Math.random() * 0.8, fn: () => fx.explosion(x + Math.cos(a) * r, 0.5, z + Math.sin(a) * r, 3 + Math.random() * 2) });
    }
    // Shock ring along the ground and a mushroom of fire and smoke.
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, sp = R * 2.2;
      fx.spawn(x, 0.6, z, Math.cos(a) * sp, 0.4, Math.sin(a) * sp, 0.6, 1.4, 2.4, SMOKE0, SMOKE1, 0, 2.2);
    }
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2.5, up = 6 + Math.random() * 8;
      fx.spawn(x + Math.cos(a) * r, 1, z + Math.sin(a) * r, Math.cos(a) * 1.5, up, Math.sin(a) * 1.5, 2.5 + Math.random() * 2, 2, 5.5, i % 3 ? SMOKE0 : FIRE0, i % 3 ? SMOKE1 : FIRE1, -0.6, 0.9);
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
