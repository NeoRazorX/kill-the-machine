// Gait of the machine spider walkers (Segador, Araña Lanzacohetes, Soldador, Radar Móvil).
// Every leg is a chain spider_<i> (hip yaw) > femur_<i> > shin_<i> > hoof_<i> (pitch). Feet stay
// planted in the world while the hull walks over them; diagonal legs (even and odd indices, which
// makes a trot on four legs and a tripod on six) take turns lifting and reaching ahead to land
// where the hull will be by the middle of their next stance. Two-bone IK bends each knee to reach
// its foot, and the hoof stays level.

const DUTY = 0.5;       // fraction of each cycle a foot spends on the ground
const STRIDE = 1.2;     // planted travel per step, as a fraction of the foot's horizontal reach
const LIFT = 0.3;       // swing height, as a fraction of the reach
const BOB = 0.035;      // hull dip as each pair lands
const SETTLE = 1.6;     // cycles per second while stopped feet step back under the hull

function rig(parts) {
  return parts.spider.map((hip, i) => {
    const femur = parts.femur[i], knee = parts.shin[i].position, ankle = parts.hoof[i].position;
    const yaw = 2 * Math.atan2(hip.quaternion.y, hip.quaternion.w);
    const reach = femur.position.z + knee.z + ankle.z;
    return {
      hip: hip.position.clone(), yaw, reach,
      ju: femur.position.z, jy: hip.position.y + femur.position.y,
      a: Math.hypot(knee.z, knee.y), a0: Math.atan2(knee.y, knee.z),
      b: Math.hypot(ankle.z, ankle.y), b0: Math.atan2(ankle.y, ankle.z),
      footY: hip.position.y + femur.position.y + knee.y + ankle.y,
      restX: hip.position.x + Math.sin(yaw) * reach, restZ: hip.position.z + Math.cos(yaw) * reach,
      nodes: [hip, femur, parts.shin[i], parts.hoof[i]],
    };
  });
}

export function walkSpider(unit, dt) {
  const p = unit.parts, { x, z, heading: h } = unit;
  const g = unit.gait ||= { legs: rig(p), phase: 0, vx: 0, vz: 0, px: x, pz: z, ph: h, feet: null };
  const cos = Math.cos(h), sin = Math.sin(h);
  const toWorld = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  const rest = g.legs.map(l => toWorld(l.restX, l.restZ));
  const reach = g.legs.reduce((s, l) => s + l.reach, 0) / g.legs.length;
  // A new unit, one placed without time passing or moved by more than a stride in a frame, stands
  // with its feet under it.
  const moved = Math.hypot(x - g.px, z - g.pz);
  if (!g.feet || moved > reach || (!(dt > 0) && (moved > 0 || h !== g.ph))) {
    g.feet = rest.map(([fx, fz]) => ({ x: fx, z: fz, y: 0, swing: null, up: false }));
    g.px = x; g.pz = z; g.ph = h;
  }
  if (dt > 0) {
    const k = Math.min(1, dt * 10);
    g.vx += ((x - g.px) / dt - g.vx) * k; g.vz += ((z - g.pz) / dt - g.vz) * k;
    const turn = Math.abs(Math.atan2(Math.sin(h - g.ph), Math.cos(h - g.ph))) / dt, speed = Math.hypot(g.vx, g.vz);
    g.px = x; g.pz = z; g.ph = h;
    const cycle = g.cycle = STRIDE * reach / DUTY;
    const away = (f, i) => Math.hypot(f.x - rest[i][0], f.z - rest[i][1]) > 0.05 * reach;
    const walking = speed > 0.05 || turn > 0.05, live = walking || g.feet.some((f, i) => f.swing || away(f, i));
    const rate = live ? Math.max(Math.max(speed, turn * reach) / cycle, SETTLE * !walking) : 0;
    g.phase = (g.phase + rate * dt) % 1;
    g.feet.forEach((f, i) => {
      const q = (g.phase + (i % 2) / 2) % 1, up = live && q < 1 - DUTY, s = up ? q / (1 - DUTY) : 1;
      if (up && !f.up && (walking || away(f, i))) f.swing = { x: f.x, z: f.z };
      if (f.swing) {
        // Aim at the rest spot carried forward by the hull's velocity to the middle of the next stance.
        const lead = walking ? ((1 - s) * (1 - DUTY) + DUTY / 2) / rate : 0, e = s * s * (3 - 2 * s);
        f.x = f.swing.x + (rest[i][0] + g.vx * lead - f.swing.x) * e;
        f.z = f.swing.z + (rest[i][1] + g.vz * lead - f.swing.z) * e;
        f.y = Math.sin(Math.PI * s) * LIFT * g.legs[i].reach;
        if (!up) f.swing = null;
      }
      f.up = up;
    });
  }
  // The hull settles as each pair takes the weight.
  const bob = -BOB * (1 + Math.cos(4 * Math.PI * g.phase)) / 2 * unit.walk;
  unit.mesh.position.y = bob;
  g.legs.forEach((l, i) => pose(l, g.feet[i], x, z, cos, sin, bob));
}

function pose(l, f, x, z, cos, sin, bob) {
  const dx = f.x - x, dz = f.z - z;
  const lx = dx * cos - dz * sin - l.hip.x, lz = dx * sin + dz * cos - l.hip.z;
  const [hip, femur, shin, hoof] = l.nodes;
  hip.rotation.set(0, Math.atan2(lx, lz), 0);
  // Two-bone IK in the leg's vertical plane, knee up, from the hip joint to the ankle.
  const u = Math.hypot(lx, lz) - l.ju, y = l.footY + f.y - bob - l.jy;
  const c = Math.min(Math.max(Math.hypot(u, y), Math.abs(l.a - l.b) + 1e-3), (l.a + l.b) * 0.999);
  const fa = Math.atan2(y, u) + Math.acos((l.a * l.a + c * c - l.b * l.b) / (2 * l.a * c));
  const sa = Math.atan2(y - l.a * Math.sin(fa), u - l.a * Math.cos(fa));
  const df = fa - l.a0, ds = sa - l.b0;
  femur.rotation.x = -df; shin.rotation.x = df - ds; hoof.rotation.x = ds;
}
