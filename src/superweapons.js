import * as THREE from 'three';
import { N, CELL, SIZE, visionRadius } from './config.js';
import { cloneModel } from './assets.js';
import { GLOW } from './fx.js';

const rectDist = (px, pz, r) => Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.z0 - pz, 0, pz - r.z1));
const FIRE0 = [1, 0.9, 0.6], FIRE1 = [0.6, 0.15, 0.03];
const SMOKE0 = [0.42, 0.38, 0.34], SMOKE1 = [0.12, 0.11, 0.1];
const ION0 = [0.75, 0.95, 1], ION1 = [0.15, 0.45, 1];
// Seconds a bomb takes to fall from the squadron's altitude; it keeps the aircraft's forward speed.
const FALL = 0.7;
// Where each aircraft flies relative to the leader: `side` across the path, `back` behind it.
const FORMATIONS = {
  air_h_jet: [{ side: 0, back: 0 }, { side: -4, back: -5 }, { side: 4, back: -5 }],
  air_m_drone: [{ side: 0, back: 0 }, { side: -3.5, back: -3 }, { side: 3.5, back: -3 }, { side: -1.8, back: -7 }, { side: 1.8, back: -7 }, { side: 0, back: -10 }],
  air_h_recon: [{ side: 0, back: 0 }], air_m_recon: [{ side: 0, back: 0 }],
};

// Which way a flight from the airfield `from` crosses (x, z): from its side of the map, through the target.
export function runHeading(from, x, z) {
  let dx = x - from.x, dz = z - from.z;
  if (Math.hypot(dx, dz) < 1) { dx = x - SIZE / 2; dz = z - SIZE / 2; }
  if (Math.hypot(dx, dz) < 1) dx = 1;
  const l = Math.hypot(dx, dz);
  return { dx: dx / l, dz: dz / l };
}
// The strip an air strike bombs around (x, z): `length` along the run, centred on the target, and on
// either side of it as far as the formation's wing plus a bomb's blast (`half`). Ends at (x0, z0), (x1, z1).
export function airRun(sw, from, x, z) {
  const { dx, dz } = runHeading(from, x, z), L = sw.length / 2;
  const half = Math.max(...FORMATIONS[sw.model].map((f) => Math.abs(f.side))) + sw.radius;
  return { dx, dz, half, x0: x - dx * L, z0: z - dz * L, x1: x + dx * L, z1: z + dz * L };
}

// Every power a building holds: its superweapon and, for the airfield, the reconnaissance flight.
export const powersOf = (def) => [def.superweapon, def.recon].filter(Boolean);
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

// Charges the repaired missile silo and ion cannon, and each side's airfield, fires them and resolves
// their strikes. The charge only runs with enough power and restarts from zero when the structure
// changes hands. A tech site keeps its charge in b.tech; an airfield one per power in b.charging,
// by kind. Methods that take a building act on its superweapon unless given another of its powers.
export class Superweapons {
  constructor(game) {
    this.game = game;
    this.strikes = [];
    this.spotters = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.ringGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
    this.columnGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    this.stripGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }

  // Made on the first air strike only.
  get bombLook() {
    return this._bombLook ??= { geo: new THREE.CapsuleGeometry(0.22, 0.7, 2, 6).rotateX(Math.PI / 2),
      mat: new THREE.MeshStandardMaterial({ color: 0x272f2d, roughness: 0.6 }) };
  }

  get sites() { return this.game.buildings.filter((b) => b.def.superweapon); }

  state(b, sw = b.def.superweapon) {
    if (b.tech) return b.tech;
    b.charging ??= {};
    return b.charging[sw.kind] ??= { charge: 0, announcedReady: false };
  }
  online(b) { return !!b.team && !b.dead && (b.tech ? b.tech.state === 'online' : b.complete); }
  progress(b, sw = b.def.superweapon) { return Math.min(1, (this.state(b, sw).charge || 0) / sw.charge); }
  isReady(b, sw = b.def.superweapon) { return this.online(b) && this.progress(b, sw) >= 1; }
  remaining(b, sw = b.def.superweapon) { return Math.max(0, sw.charge - (this.state(b, sw).charge || 0)); }
  // Every ready power of the side, as { b, sw }.
  ready(team) {
    return this.sites.filter((b) => b.team === team).flatMap((b) => powersOf(b.def).filter((sw) => this.isReady(b, sw)).map((sw) => ({ b, sw })));
  }

  reset(b, sw = b.def.superweapon) { const st = this.state(b, sw); st.charge = 0; st.announcedReady = false; }

  // Vision with no body, for the side that owns it: the reconnaissance plane and the ground it reveals.
  // Each is { team, x, z, def: { sight } }, so it counts wherever a unit's sight does.
  spot(team, x, z, sight) {
    const eye = { kind: 'spotter', team, x, z, dead: false, def: { sight } };
    this.spotters.push(eye);
    return eye;
  }
  unspot(eye) { if (eye) { eye.dead = true; this.spotters = this.spotters.filter((e) => e !== eye); } }

  update(dt) {
    const g = this.game;
    for (const b of this.sites) for (const sw of powersOf(b.def)) {
      if (!this.online(b) || this.isReady(b, sw) || g.lowPower(b.team)) continue;
      const st = this.state(b, sw);
      st.charge = Math.min(sw.charge, (st.charge || 0) + dt);
      if (this.isReady(b, sw) && !st.announcedReady) {
        st.announcedReady = true;
        if (b.team === g.player && !g.spectate) {
          g.audio.play('ready');
          g.audio.say(`${sw.title} listo`, 0);
          g.emit('toast', { text: `${sw.title} listo: elige un objetivo desde la barra lateral`, kind: 'good' });
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
      if (s.sw.kind === 'air') {
        if (this.fly(s, dt)) { this.strikes.splice(i, 1); this.dispose(s); }
        continue;
      }
      if (s.sw.kind === 'recon') {
        if (this.scout(s, dt)) { this.strikes.splice(i, 1); this.dispose(s); }
        continue;
      }
      this.animate(s);
      if (s.t >= s.sw.delay) { this.strikes.splice(i, 1); this.detonate(s); }
    }
  }

  // The player may only aim at ground they have explored, except to reconnoitre it.
  canTarget(team, x, z, sw = null) {
    const g = this.game;
    if (g.spectate || team !== g.player || sw?.kind === 'recon') return true;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    return cx >= 0 && cz >= 0 && cx < N && cz < N && g.fog[cz * N + cx] > 0;
  }

  // The missile falls on (x, z); the ion beam sweeps from (x, z) towards (x2, z2). Only the start
  // has to be explored ground. `sw` picks another of the building's powers.
  fire(b, x, z, x2 = x, z2 = z, sw = b.def.superweapon) {
    const g = this.game;
    if (!this.isReady(b, sw) || !this.canTarget(b.team, x, z, sw)) return false;
    this.reset(b, sw);
    if (sw.kind === 'recon') return this.reconnoitre(b, sw, x, z);
    g.bump?.(b.team, 'strikes');
    const s = { sw, team: b.team, x, z, sx: b.x, sz: b.z, t: 0, meshes: [] };
    // Everybody sees where a strike is coming, so units can still get clear.
    const mat = () => new THREE.MeshBasicMaterial({ color: sw.kind === 'ion' ? 0x6fd8ff : 0xff4a3a,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(this.ringGeo, mat());
    ring.position.set(x, 0.15, z); ring.scale.setScalar(sw.radius); ring.renderOrder = 4;
    s.ring = ring; s.meshes.push(ring);
    if (sw.kind === 'air') {
      this.launch(s, b);
      // Aimed at enemy troops, the squadron follows the nearest one, keeping the aim's offset from it.
      const u = this.lockOn(b.team, x, z, s.half);
      if (u) s.lock = { unit: u, ox: x - u.x, oz: z - u.z };
    }
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
    } else if (sw.kind === 'ion') {
      const column = new THREE.Mesh(this.columnGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(GLOW),
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      column.position.set(x, 0, z); column.scale.set(0.2, 160, 0.2);
      s.column = column; s.meshes.push(column);
    }
    for (const m of s.meshes) this.group.add(m);
    this.strikes.push(s);
    // The ion beam hums as it builds up over the target; the missile roars out of its silo. The
    // squadron is heard as it passes overhead.
    if (sw.kind === 'ion') g.audio.play('ioncharge', x, z); else if (sw.kind === 'nuke') g.audio.play('missilelaunch', b.x, b.z);
    const own = b.team === g.player, title = sw.title;
    const said = { nuke: ['Misil lanzado', 'Atención: misil nuclear lanzado'], ion: ['Cañón de iones disparado', 'Atención: ataque de cañón de iones'],
      air: [`${title} en camino`, 'Atención: ataque aéreo enemigo'] }[sw.kind];
    if (!g.spectate) {
      if (own) { g.audio.say(said[0], 0); }
      else {
        g.audio.play('alert');
        g.audio.say(said[1], 0);
        g.emit('toast', { text: `¡${title} enemigo en camino! Aparta tus unidades de la zona marcada`, kind: 'warn' });
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
      // Aircraft share their model's geometry and materials, as every clone does.
      if (m.userData.modelSource) continue;
      m.traverse((o) => { if (o.isMesh) { if (![this.ringGeo, this.columnGeo, this.stripGeo].includes(o.geometry)) o.geometry.dispose(); o.material.dispose(); } });
    }
    for (const bomb of s.bombs ?? []) this.group.remove(bomb.mesh);
    this.unspot(s.eye); this.unspot(s.reveal);
  }

  // The squadron's path: in from the map edge behind the airfield, over the target and out across
  // the map. The leader is overhead after `delay`, the flight in.
  launch(s, b) {
    const sw = s.sw;
    s.meshes ??= [];
    const { dx, dz } = runHeading(b, s.x, s.z);
    // How far from the target the path leaves the map going along (ux, uz).
    const toEdge = (ux, uz) => Math.min(ux > 0 ? (SIZE - s.x) / ux : ux < 0 ? -s.x / ux : Infinity, uz > 0 ? (SIZE - s.z) / uz : uz < 0 ? -s.z / uz : Infinity);
    const inDist = toEdge(-dx, -dz) + 25;
    Object.assign(s, { dx, dz, ex: s.x - dx * inDist, ez: s.z - dz * inDist, inDist, outDist: inDist + toEdge(dx, dz) + 40,
      delay: inDist / sw.speed, bombs: [], hit: false, heard: false, planes: [] });
    for (const f of FORMATIONS[sw.model]) {
      const mesh = cloneModel(sw.model).group;
      mesh.visible = false;
      s.planes.push({ ...f, mesh, nextDrop: 0, phase: Math.random() * 6.3 });
      s.meshes.push(mesh);
    }
    s.ring?.material.color.setHex(0xffc040);
    // The marker of an air strike is the strip it will bomb.
    if (sw.kind === 'air') {
      s.half = airRun(sw, b, s.x, s.z).half;
      s.ring.geometry = this.stripGeo;
      s.ring.scale.set(2 * s.half, 1, sw.length + 2 * sw.radius);
      s.ring.rotation.y = Math.atan2(dx, dz);
    }
  }

  // Whether the side sees e with any of its eyes.
  seenBy(team, e) {
    return this.game.eyes(team).some((o) => Math.hypot(o.x - e.x, o.z - e.z) <= visionRadius(o));
  }

  // The enemy unit the side sees nearest to (x, z), within `reach`.
  lockOn(team, x, z, reach) {
    let best = null, bestD = reach;
    for (const u of this.game.queryUnits(x, z, reach + 2)) {
      if (u.dead || !u.team || u.team === team) continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d <= bestD && this.seenBy(team, u)) { best = u; bestD = d; }
    }
    return best;
  }

  // A single fast plane flies the same kind of path as an air strike, seeing a strip of ground as it
  // goes; over the target it reveals a wide circle for sw.duration seconds, which then stays explored.
  // Only its owner sees where it is headed; the other side just hears of it.
  reconnoitre(b, sw, x, z) {
    const g = this.game, s = { sw, team: b.team, x, z, t: 0, meshes: [] };
    this.launch(s, b);
    s.eye = this.spot(b.team, s.ex, s.ez, sw.trail);
    if (b.team === g.player || g.spectate) {
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0x8fe07a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.set(x, 0.15, z); ring.scale.setScalar(sw.radius); ring.renderOrder = 4;
      s.ring = ring; s.meshes.push(ring); this.group.add(ring);
    }
    for (const p of s.planes) this.group.add(p.mesh);
    this.strikes.push(s);
    if (!g.spectate) {
      if (b.team === g.player) g.audio.say(`${sw.craft} en camino`, 0);
      else { g.audio.say(`${sw.craft} enemigo detectado`, 0); g.emit('toast', { text: `${sw.craft} enemigo detectado`, kind: 'warn' }); }
    }
    return true;
  }

  // Returns true once the plane has left the map and the revealed ground has gone dark again.
  scout(s, dt) {
    const g = this.game, sw = s.sw, d = s.t * sw.speed, p = s.planes[0];
    const x = s.ex + s.dx * d, z = s.ez + s.dz * d, out = d > s.outDist;
    p.mesh.visible = !out && d > 0;
    p.mesh.position.set(x, sw.altitude, z);
    p.mesh.rotation.set(0, Math.atan2(s.dx, s.dz), 0);
    if (!s.heard && s.t >= s.delay - 1) { s.heard = true; g.audio.play('jetflyby', s.x, s.z); }
    if (out) { this.unspot(s.eye); s.eye = null; }
    else if (s.eye) { s.eye.x = x; s.eye.z = z; }
    if (s.ring) s.ring.material.opacity = 0.4 + 0.3 * Math.sin(s.t * 6);
    if (!s.revealAt && s.t >= s.delay) {
      s.revealAt = s.t;
      s.reveal = this.spot(s.team, s.x, s.z, sw.radius);
      if (s.ring) s.ring.visible = false;
    }
    if (s.reveal && s.t - s.revealAt >= sw.duration) { this.unspot(s.reveal); s.reveal = null; }
    return out && !!s.revealAt && !s.reveal;
  }

  // Moves the squadron and drops bombs along the marked strip, each one hurting what it lands on.
  // While locked on a unit, the run (and its marker) follows it wherever the side sees it, until `commit`
  // seconds before the leader is overhead; from then on it holds its course, so a last-moment scatter
  // can still pay off. Returns true once every aircraft has left the map.
  fly(s, dt) {
    const g = this.game, fx = g.fx, sw = s.sw, d = s.t * sw.speed, swarm = s.planes.length > 3;
    const yaw = Math.atan2(s.dx, s.dz), px = s.dz, pz = -s.dx;
    if (s.lock && s.t < s.delay - sw.commit) {
      const u = s.lock.unit;
      // Out of sight it holds the last place it was seen, and picks the unit up again if it shows.
      if (u.dead) s.lock = null;
      else if (this.seenBy(s.team, u)) {
        s.x = Math.max(0, Math.min(SIZE, u.x + s.lock.ox)); s.z = Math.max(0, Math.min(SIZE, u.z + s.lock.oz));
        s.ex = s.x - s.dx * s.inDist; s.ez = s.z - s.dz * s.inDist;
        s.ring.position.set(s.x, 0.15, s.z);
      }
    }
    s.ring.material.opacity = 0.3 + 0.2 * Math.sin(s.t * 10);
    if (!s.heard && s.t >= s.delay - 1.6) { s.heard = true; g.audio.play(swarm ? 'swarm' : 'jetflyby', s.x, s.z); }
    let out = true;
    for (const p of s.planes) {
      const a = d + p.back, wob = swarm ? Math.sin(s.t * 3 + p.phase) : 0;
      const side = p.side + wob * 0.8, x = s.ex + s.dx * a + px * side, z = s.ez + s.dz * a + pz * side;
      const y = sw.altitude + (swarm ? Math.sin(s.t * 4.3 + p.phase) * 0.6 : 0);
      p.mesh.visible = a > 0 && a < s.outDist;
      p.mesh.position.set(x, y, z);
      p.mesh.rotation.set(0, yaw, swarm ? wob * 0.35 : 0);
      if (a < s.outDist) out = false;
      // A bomb dropped now lands FALL seconds further on; drop while that spot is along the strip.
      const lx = x + s.dx * sw.speed * FALL, lz = z + s.dz * sw.speed * FALL;
      if (s.t >= p.nextDrop && Math.abs((lx - s.x) * s.dx + (lz - s.z) * s.dz) <= sw.length / 2) {
        p.nextDrop = s.t + (swarm ? 0.16 : 0.1);
        const mesh = new THREE.Mesh(this.bombLook.geo, this.bombLook.mat);
        mesh.position.set(x, y - 0.6, z); mesh.rotation.y = yaw;
        this.group.add(mesh);
        s.bombs.push({ mesh, x, y: y - 0.6, z, t: 0 });
      }
      if (p.mesh.visible && Math.random() < dt * 20) fx.spawn(x - s.dx * 2, y, z - s.dz * 2, 0, 0, 0, 0.5, 0.4, 0.3, swarm ? [1, 0.3, 0.2] : [1, 0.75, 0.4], [0.3, 0.3, 0.3], 0, 0.3);
    }
    for (let i = s.bombs.length - 1; i >= 0; i--) {
      const bomb = s.bombs[i];
      bomb.t += dt;
      const k = Math.min(1, bomb.t / FALL), run = sw.speed * Math.min(bomb.t, FALL);
      bomb.mesh.position.set(bomb.x + s.dx * run, bomb.y * (1 - k * k), bomb.z + s.dz * run);
      bomb.mesh.rotation.x = k * 0.9;
      if (k < 1) continue;
      this.group.remove(bomb.mesh);
      s.bombs.splice(i, 1);
      const bx = bomb.mesh.position.x, bz = bomb.mesh.position.z;
      fx.explosion(bx, 0.5, bz, 1.6 + Math.random());
      fx.scorch(bx, bz, 1.8, 0.5);
      if (Math.random() < 0.35) g.audio.play('explosion', bx, bz);
      this.bomb(s, bx, bz);
    }
    // The marker goes once the last plane has passed the end of the strip.
    const past = s.delay + (sw.length / 2 + 10) / sw.speed;
    if (!s.hit && s.t >= past) { s.hit = true; s.ring.visible = false; }
    // The pilots see what they bomb, even where the side has no eyes of its own.
    if (!s.eye && !s.looked && s.t >= s.delay - sw.length / 2 / sw.speed - 1) { s.looked = true; s.eye = this.spot(s.team, s.x, s.z, sw.sight); }
    if (s.eye && s.t >= past + sw.linger) { this.unspot(s.eye); s.eye = null; }
    return out && s.hit && !s.bombs.length && !s.eye;
  }

  // One bomb: damage falls off from where it lands to half at the edge of its blast, scaled by what is hit.
  bomb(s, x, z) {
    const g = this.game, sw = s.sw, R = sw.radius, mult = (e) => sw.mult[e.cls] ?? 1;
    for (const u of g.queryUnits(x, z, R + 3).slice()) {
      if (u.dead || !u.team) continue;
      const d = Math.max(0, Math.hypot(u.x - x, u.z - z) - u.radius);
      if (d <= R) this.hurt(u, sw.damage * (1 - 0.5 * d / R) * mult(u), s, x, z);
    }
    for (const b of g.buildings.slice()) {
      if (b.dead || !b.team || b.selling) continue;
      const d = rectDist(x, z, b.rect);
      if (d <= R) this.hurt(b, sw.damage * (1 - 0.5 * d / R) * mult(b), s, x, z);
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
  // Each entry is { b, sw }, one per power of the building.
  status(team) {
    const own = [], enemy = [];
    for (const b of this.sites) {
      if (!this.online(b)) continue;
      const list = b.team === team ? own : (b.tech ? b.tech.found[team] : b.seen) ? enemy : null;
      for (const sw of powersOf(b.def)) list?.push({ b, sw });
    }
    return { own, enemy };
  }
}
