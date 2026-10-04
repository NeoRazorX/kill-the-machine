import * as THREE from 'three';

// ------------------------------------------------------------------ helpers
const geoCache = new Map();
function G(kind, ...a) {
  const key = kind + a.join(',');
  let g = geoCache.get(key);
  if (!g) {
    switch (kind) {
      case 'box': g = new THREE.BoxGeometry(...a); break;
      case 'cyl': g = new THREE.CylinderGeometry(a[0], a[1], a[2], a[3] || 8); break;
      case 'cone': g = new THREE.ConeGeometry(a[0], a[1], a[2] || 8); break;
      case 'sph': g = new THREE.SphereGeometry(a[0], a[1] || 10, a[2] || 8); break;
      case 'oct': g = new THREE.OctahedronGeometry(a[0], 0); break;
      case 'tor': g = new THREE.TorusGeometry(a[0], a[1], 6, 18); break;
      case 'bowl': g = new THREE.SphereGeometry(a[0], 14, 6, 0, Math.PI * 2, 0, Math.PI / 2); break;
      default: throw new Error('geo ' + kind);
    }
    geoCache.set(key, g);
  }
  return g;
}
const matCache = new Map();
function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0.25,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}
const box = (w, h, d) => G('box', w, h, d);

function part(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
}

const HC = { hull: 0x6b7a55, hull2: 0x56633f, dark: 0x30362b, metal: 0x8b95a0, steel: 0x59616b, light: 0xc7ccd2, skin: 0xd9a679, accent: 0x3d8bff, glass: 0x8fd8ff };
const MC = { hull: 0x2f333c, hull2: 0x3b404c, dark: 0x15161b, metal: 0x585f6e, steel: 0x3a3f4b, red: 0xff3b30 };

const H = {
  hull: () => mat(HC.hull), hull2: () => mat(HC.hull2), dark: () => mat(HC.dark), metal: () => mat(HC.metal, { metal: 0.6, rough: 0.5 }),
  steel: () => mat(HC.steel), light: () => mat(HC.light), skin: () => mat(HC.skin, { metal: 0 }),
  acc: () => mat(HC.accent, { emissive: HC.accent, ei: 0.35 }),
  glass: () => mat(HC.glass, { emissive: 0x4aa8ff, ei: 0.5, metal: 0.6, rough: 0.2 }),
  ore: () => mat(0x37e6b8, { emissive: 0x17a98a, ei: 0.9 }),
  yellow: () => mat(0xe0b020),
};
const M = {
  hull: () => mat(MC.hull, { metal: 0.5 }), hull2: () => mat(MC.hull2, { metal: 0.5 }), dark: () => mat(MC.dark, { metal: 0.4 }),
  metal: () => mat(MC.metal, { metal: 0.7, rough: 0.45 }), steel: () => mat(MC.steel),
  glow: () => mat(0xff3b30, { emissive: 0xff2214, ei: 1.8, rough: 0.4 }),
  orange: () => mat(0xff7a1a, { emissive: 0xff5a00, ei: 1.6 }),
  ore: () => mat(0x37e6b8, { emissive: 0x17a98a, ei: 0.9 }),
};

// -------------------------------------------------------------- unidades
export function buildUnitModel(def, team) {
  const group = new THREE.Group();
  const parts = {};
  const fn = UNIT_BUILDERS[def.id];
  fn(group, parts);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, parts };
}

function infantry(g, parts, heavy) {
  const legs = [];
  for (const s of [-1, 1]) {
    const pv = grp(g, s * 0.2, 0.75, 0);
    part(pv, box(0.24, 0.75, 0.26), H.dark(), 0, -0.375, 0);
    legs.push(pv);
  }
  const body = grp(g);
  part(body, box(heavy ? 0.74 : 0.62, 0.75, 0.42), H.hull(), 0, 1.1, 0);
  part(body, box(heavy ? 0.78 : 0.66, 0.16, 0.46), H.acc(), 0, 1.4, 0);
  part(body, G('sph', 0.2, 8, 6), H.skin(), 0, 1.72, 0);
  part(body, box(0.46, 0.2, 0.46), H.dark(), 0, 1.84, 0);
  if (heavy) {
    part(body, G('cyl', 0.15, 0.15, 1.5, 8), H.dark(), 0.34, 1.5, 0.25, Math.PI / 2);
    part(body, G('cyl', 0.19, 0.15, 0.25, 8), H.acc(), 0.34, 1.5, 1.05, Math.PI / 2);
  } else {
    part(body, box(0.12, 0.14, 1.0), H.metal(), 0.3, 1.15, 0.4);
    part(body, box(0.1, 0.22, 0.3), H.dark(), 0.3, 1.05, 0.15);
  }
  parts.legs = legs; parts.body = body;
}

function tracks(g, mt, w = 0.75, len = 3.4, x = 1.15) {
  for (const s of [-1, 1]) {
    part(g, box(w, 0.7, len), mt, s * x, 0.35, 0);
    for (let i = -1; i <= 1; i++) part(g, G('cyl', 0.34, 0.34, w + 0.08, 10), H.steel(), s * x, 0.36, i * (len / 3), 0, 0, Math.PI / 2);
  }
}

const UNIT_BUILDERS = {
  h_rifle: (g, p) => infantry(g, p, false),
  h_rocket: (g, p) => infantry(g, p, true),

  h_tank(g, p) {
    tracks(g, H.dark());
    part(g, box(2.0, 0.6, 3.0), H.hull(), 0, 0.85, 0);
    part(g, box(2.0, 0.35, 0.9), H.hull2(), 0, 0.95, 1.55, -0.35);
    part(g, box(2.04, 0.08, 0.5), H.acc(), 0, 1.17, -0.9);
    const t = grp(g, 0, 1.2, 0);
    part(t, box(1.5, 0.55, 1.6), H.hull(), 0, 0.28, 0);
    part(t, box(0.9, 0.3, 0.9), H.hull2(), 0, 0.7, -0.15);
    part(t, G('cyl', 0.2, 0.2, 0.15, 8), H.dark(), -0.3, 0.9, -0.2);
    part(t, box(1.52, 0.07, 0.4), H.acc(), 0, 0.5, -0.55);
    const b = grp(t, 0, 0.4, 0.7);
    part(b, G('cyl', 0.15, 0.15, 1.9, 8), H.metal(), 0, 0, 0.95, Math.PI / 2);
    part(b, G('cyl', 0.22, 0.22, 0.3, 8), H.dark(), 0, 0, 1.75, Math.PI / 2);
    p.turret = t; p.barrel = b; p.barrelZ = 0.7;
  },

  h_arty(g, p) {
    tracks(g, H.dark(), 0.7, 3.2, 1.1);
    part(g, box(2.0, 0.55, 3.0), H.hull(), 0, 0.85, 0);
    part(g, box(2.04, 0.08, 0.4), H.acc(), 0, 1.15, -1.0);
    const t = grp(g, 0, 1.15, -0.2);
    part(t, box(1.4, 0.7, 1.5), H.hull2(), 0, 0.35, 0);
    const b = grp(t, 0, 0.6, 0.3);
    b.rotation.x = -0.45;
    part(b, G('cyl', 0.17, 0.2, 3.0, 8), H.metal(), 0, 0, 1.3, Math.PI / 2);
    part(b, G('cyl', 0.26, 0.26, 0.5, 8), H.dark(), 0, 0, 2.7, Math.PI / 2);
    p.turret = t; p.barrel = b; p.barrelZ = 0.3; p.barrelAxis = 'tilt';
  },

  h_harv(g, p) {
    part(g, box(1.9, 0.45, 3.4), H.dark(), 0, 0.65, 0);
    for (const s of [-1, 1]) for (const z of [-1.15, 0, 1.2]) part(g, G('cyl', 0.5, 0.5, 0.4, 10), H.dark(), s * 1.0, 0.5, z, 0, 0, Math.PI / 2);
    part(g, box(1.6, 1.0, 1.1), H.hull(), 0, 1.3, 1.2);
    part(g, box(1.45, 0.4, 0.06), H.glass(), 0, 1.5, 1.77);
    part(g, box(1.9, 1.0, 1.9), H.metal(), 0, 1.35, -0.7);
    part(g, box(1.95, 0.1, 1.95), H.yellow(), 0, 1.75, -0.7);
    part(g, box(1.7, 0.22, 0.5), H.acc(), 0, 0.75, 1.9);
    const fill = part(g, box(1.6, 0.6, 1.6), H.ore(), 0, 1.7, -0.7);
    p.fill = fill; p.fillBase = 1.45;
  },

  m_drone(g, p) {
    const bob = grp(g, 0, 1.2, 0);
    part(bob, G('sph', 0.5, 10, 8), M.dark(), 0, 0, 0);
    part(bob, G('sph', 0.19, 8, 6), M.glow(), 0, 0.05, 0.42);
    for (const s of [-1, 1]) {
      part(bob, box(0.7, 0.07, 0.4), M.hull2(), s * 0.6, 0, -0.05, 0, 0, s * 0.25);
      part(bob, box(0.1, 0.1, 0.5), M.metal(), s * 0.3, -0.15, 0.3);
    }
    const ring = part(bob, G('tor', 0.55, 0.06), M.glow(), 0, -0.32, 0, Math.PI / 2);
    p.bob = bob; p.ring = ring; p.bobBase = 1.2;
  },

  m_sentinel(g, p) {
    const legs = [];
    for (const s of [-1, 1]) {
      const pv = grp(g, s * 0.34, 1.25, 0);
      part(pv, box(0.28, 0.75, 0.3), M.hull2(), 0, -0.4, 0);
      part(pv, box(0.22, 0.55, 0.26), M.metal(), 0, -0.95, 0.05);
      part(pv, box(0.42, 0.14, 0.7), M.dark(), 0, -1.17, 0.12);
      legs.push(pv);
    }
    const body = grp(g);
    part(body, box(1.0, 0.85, 0.7), M.hull(), 0, 1.7, 0);
    part(body, box(0.62, 0.12, 0.06), M.glow(), 0, 1.78, 0.37);
    part(body, box(0.6, 0.38, 0.5), M.dark(), 0, 2.32, 0.05);
    part(body, box(0.44, 0.1, 0.06), M.glow(), 0, 2.34, 0.31);
    part(body, box(0.24, 0.24, 1.5), M.metal(), 0.68, 1.95, 0.45);
    part(body, G('cyl', 0.1, 0.1, 0.1, 6), M.glow(), 0.68, 1.95, 1.25, Math.PI / 2);
    part(body, box(0.3, 0.3, 0.5), M.dark(), -0.7, 1.95, 0);
    p.legs = legs; p.body = body;
  },

  m_crusher(g, p) {
    spiderLegs(g, p, 4, 1.1);
    part(g, G('cyl', 1.25, 1.4, 0.7, 6), M.hull(), 0, 1.35, 0);
    part(g, G('cyl', 0.9, 1.0, 0.25, 6), M.dark(), 0, 1.75, 0);
    const t = grp(g, 0, 1.9, 0);
    part(t, box(1.3, 0.6, 1.4), M.hull2(), 0, 0.25, 0);
    part(t, box(0.9, 0.12, 0.06), M.glow(), 0, 0.3, 0.72);
    const b = grp(t, 0, 0.3, 0.5);
    part(b, G('cyl', 0.2, 0.28, 2.0, 8), M.metal(), 0, 0, 0.9, Math.PI / 2);
    part(b, G('cyl', 0.3, 0.3, 0.2, 8), M.glow(), 0, 0, 1.9, Math.PI / 2);
    p.turret = t; p.barrel = b; p.barrelZ = 0.5;
  },

  m_siege(g, p) {
    spiderLegs(g, p, 6, 1.0);
    part(g, G('cyl', 1.1, 1.3, 0.6, 6), M.hull(), 0, 1.3, 0);
    const t = grp(g, 0, 1.6, -0.2);
    part(t, box(1.1, 0.5, 1.2), M.hull2(), 0, 0.2, 0);
    const b = grp(t, 0, 0.4, 0.2);
    b.rotation.x = -0.6;
    part(b, G('cyl', 0.2, 0.34, 2.8, 8), M.metal(), 0, 0, 1.1, Math.PI / 2);
    part(b, G('tor', 0.34, 0.07), M.glow(), 0, 0, 2.4, 0, Math.PI / 2);
    part(b, G('sph', 0.28, 8, 6), M.glow(), 0, 0, 2.55);
    p.turret = t; p.barrel = b; p.barrelZ = 0.2; p.barrelAxis = 'tilt';
  },

  m_harv(g, p) {
    for (const s of [-1, 1]) part(g, box(0.7, 0.8, 3.0), M.dark(), s * 1.2, 0.4, 0);
    part(g, box(2.0, 0.9, 2.6), M.hull(), 0, 1.0, -0.1);
    part(g, box(1.7, 0.1, 1.9), M.glow(), 0, 1.5, -0.3);
    const fill = part(g, box(1.5, 0.55, 1.5), M.ore(), 0, 1.7, -0.3);
    const drill = grp(g, 0, 0.85, 1.7);
    part(drill, G('cone', 0.75, 1.5, 6), M.metal(), 0, 0, 0.5, Math.PI / 2);
    part(drill, G('cone', 0.4, 0.8, 6), M.glow(), 0, 0, 1.0, Math.PI / 2);
    p.fill = fill; p.fillBase = 1.45; p.drill = drill;
  },
};

function spiderLegs(g, p, n, rad) {
  const legs = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const pv = grp(g, Math.sin(a) * rad * 0.5, 1.2, Math.cos(a) * rad * 0.5);
    pv.rotation.y = a; pv.userData.base = a;
    part(pv, box(0.24, 0.24, 1.3), M.hull2(), 0, 0.15, 0.75, -0.3);
    part(pv, box(0.2, 1.6, 0.2), M.metal(), 0, -0.35, 1.35, 0.12);
    part(pv, G('cone', 0.12, 0.3, 5), M.dark(), 0, -1.2, 1.4, Math.PI);
    legs.push(pv);
  }
  p.spider = legs;
}

// -------------------------------------------------------------- edificios
export function buildBuildingModel(def) {
  const group = new THREE.Group();
  const parts = {};
  BUILDING_BUILDERS[def.id](group, parts);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, parts };
}

function chimney(g, x, z, h, mt, tip) {
  part(g, G('cyl', 0.3, 0.42, h, 8), mt, x, h / 2, z);
  if (tip) part(g, G('cyl', 0.34, 0.34, 0.12, 8), tip, x, h + 0.02, z);
}

const BUILDING_BUILDERS = {
  h_hq(g, p) {
    part(g, box(5.8, 0.35, 5.8), H.steel(), 0, 0.175, 0);
    part(g, box(5, 2.2, 3.6), H.hull(), 0, 1.45, 0.6);
    part(g, box(5.04, 0.16, 3.64), H.acc(), 0, 2.15, 0.6);
    part(g, box(4.2, 0.3, 3.0), H.dark(), 0, 2.7, 0.6);
    part(g, box(1.8, 3.4, 1.8), H.hull2(), -1.6, 2.0, -1.8);
    part(g, box(2.0, 0.5, 2.0), H.glass(), -1.6, 3.95, -1.8);
    part(g, box(1.6, 1.4, 0.1), H.dark(), 0, 1.0, 2.42);
    part(g, box(1.7, 0.1, 0.1), H.acc(), 0, 1.75, 2.42);
    for (const s of [-1, 1]) part(g, box(0.9, 0.6, 0.06), H.glass(), s * 1.7, 1.7, 2.42);
    const dish = grp(g, 1.6, 3.0, -1.2);
    part(dish, G('cyl', 0.1, 0.1, 1.2, 6), H.metal(), 0, 0, 0);
    const bowl = part(dish, G('bowl', 1.0), H.light(), 0, 0.7, 0, -1.0);
    bowl.scale.set(1, 0.7, 1);
    p.dish = dish;
    part(g, G('cyl', 0.05, 0.05, 2.2, 5), H.metal(), 2.5, 1.5, 2.3);
    part(g, box(0.7, 0.45, 0.03), H.acc(), 2.85, 2.35, 2.3);
  },
  h_power(g, p) {
    part(g, box(3.7, 0.35, 3.7), H.steel(), 0, 0.175, 0);
    for (const s of [-1, 1]) {
      part(g, G('cyl', 0.8, 1.1, 2.8, 10), H.hull(), s * 0.95, 1.75, -0.5);
      part(g, G('cyl', 0.84, 0.84, 0.12, 10), H.acc(), s * 0.95, 3.1, -0.5);
      part(g, G('cyl', 0.82, 0.82, 0.1, 10), H.dark(), s * 0.95, 2.8, -0.5);
    }
    part(g, box(2.2, 1.2, 1.1), H.dark(), 0, 0.95, 1.2);
    part(g, box(1.6, 0.16, 0.06), H.glass(), 0, 1.2, 1.76);
    part(g, G('cyl', 0.2, 0.2, 1.8, 6), H.acc(), 0, 1.4, -0.5, 0, 0, Math.PI / 2);
  },
  h_refinery(g, p) {
    part(g, box(5.8, 0.3, 5.8), H.steel(), 0, 0.15, 0);
    part(g, box(3.4, 2.4, 3.0), H.hull(), -1.0, 1.5, -1.2);
    part(g, box(3.44, 0.14, 3.04), H.acc(), -1.0, 2.1, -1.2);
    part(g, G('cyl', 1.2, 1.2, 3.2, 14), H.metal(), 1.9, 1.9, -1.5);
    part(g, G('cone', 1.2, 0.8, 14), H.light(), 1.9, 3.9, -1.5);
    part(g, G('cyl', 0.8, 0.8, 2.2, 12), H.metal(), 2.0, 1.4, 0.6);
    chimney(g, -2.3, -2.4, 3.8, H.dark(), H.acc());
    part(g, box(3.6, 0.2, 2.0), H.dark(), 0, 0.4, 2.0);
    for (let i = 0; i < 6; i++) part(g, box(0.3, 0.05, 2.02), i % 2 ? H.yellow() : H.dark(), -1.5 + i * 0.6, 0.52, 2.0);
    part(g, G('cyl', 0.2, 0.2, 2.2, 6), H.steel(), 0.2, 2.0, 0.2, 0, 0, Math.PI / 2);
  },
  h_barracks(g, p) {
    part(g, box(5.8, 0.25, 3.9), H.steel(), 0, 0.125, 0);
    part(g, box(5.2, 1.8, 3.0), H.hull(), 0, 1.15, -0.2);
    const roof = part(g, G('cyl', 1.5, 1.5, 5.3, 12), H.hull2(), 0, 2.05, -0.2, 0, 0, Math.PI / 2);
    roof.scale.set(0.45, 1, 1);
    part(g, box(5.24, 0.1, 3.04), H.acc(), 0, 1.7, -0.2);
    part(g, box(1.3, 1.3, 0.1), H.dark(), 0, 0.9, 1.33);
    for (const s of [-1, 1]) part(g, box(0.7, 0.5, 0.06), H.glass(), s * 1.7, 1.3, 1.33);
    part(g, G('cyl', 0.05, 0.05, 2.6, 5), H.metal(), -2.5, 1.5, 1.6);
    part(g, box(0.8, 0.5, 0.03), H.acc(), -2.15, 2.5, 1.6);
    for (let i = 0; i < 4; i++) part(g, box(0.5, 0.35, 0.3), H.dark(), 0.2 + i * 0.5, 0.4, 1.7);
  },
  h_factory(g, p) {
    part(g, box(5.8, 0.3, 5.8), H.steel(), 0, 0.15, 0);
    part(g, box(5.4, 3.0, 4.2), H.hull(), 0, 1.8, -0.7);
    for (let i = 0; i < 3; i++) part(g, box(1.6, 0.5, 4.2), H.hull2(), -1.8 + i * 1.8, 3.4, -0.7, 0, 0, i % 2 ? 0.0 : 0.0);
    part(g, box(3.4, 2.5, 0.2), H.dark(), 0, 1.5, 1.45);
    part(g, box(3.6, 0.2, 0.25), H.acc(), 0, 2.85, 1.45);
    for (let i = 0; i < 5; i++) part(g, box(3.3, 0.06, 0.06), H.steel(), 0, 0.7 + i * 0.4, 1.58);
    chimney(g, 2.2, -2.3, 4.6, H.dark(), H.acc());
    chimney(g, 1.3, -2.3, 4.2, H.dark());
    part(g, box(0.3, 3.2, 0.3), H.yellow(), -2.8, 1.9, 2.0);
    part(g, box(2.4, 0.25, 0.25), H.yellow(), -1.7, 3.5, 2.0);
  },
  h_turret(g, p) {
    part(g, G('cyl', 1.6, 1.8, 0.5, 10), H.steel(), 0, 0.25, 0);
    part(g, G('cyl', 1.1, 1.3, 0.5, 10), H.hull(), 0, 0.75, 0);
    const t = grp(g, 0, 1.0, 0);
    part(t, box(1.4, 0.9, 1.5), H.hull(), 0, 0.45, 0);
    part(t, box(1.42, 0.1, 0.5), H.acc(), 0, 0.7, -0.4);
    part(t, G('sph', 0.35, 8, 6), H.glass(), 0, 1.0, -0.1);
    const b = grp(t, 0, 0.6, 0.7);
    for (const s of [-1, 1]) {
      part(b, G('cyl', 0.1, 0.1, 1.5, 6), H.metal(), s * 0.32, 0, 0.7, Math.PI / 2);
      part(b, G('cyl', 0.15, 0.15, 0.3, 6), H.dark(), s * 0.32, 0, 1.4, Math.PI / 2);
    }
    p.turret = t; p.barrel = b; p.barrelZ = 0.7;
  },

  m_hq(g, p) {
    part(g, box(5.8, 0.35, 5.8), M.steel(), 0, 0.175, 0);
    const pyr = part(g, G('cone', 3.7, 3.4, 4), M.hull(), 0, 2.0, 0, 0, Math.PI / 4);
    pyr.scale.set(1, 1, 1);
    part(g, G('cone', 2.4, 2.4, 4), M.hull2(), 0, 3.6, 0, 0, Math.PI / 4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      part(g, box(0.5, 1.8, 0.5), M.dark(), sx * 2.5, 1.2, sz * 2.5);
      part(g, box(0.35, 0.2, 0.35), M.glow(), sx * 2.5, 2.2, sz * 2.5);
    }
    part(g, box(1.2, 1.4, 0.2), M.glow(), 0, 0.9, 1.55);
    const crystal = part(g, G('oct', 0.9), M.glow(), 0, 5.0, 0);
    crystal.scale.set(0.8, 1.5, 0.8);
    const ring = part(g, G('tor', 1.4, 0.07), M.glow(), 0, 5.0, 0, Math.PI / 2.4);
    p.crystal = crystal; p.ring = ring;
  },
  m_power(g, p) {
    part(g, box(3.7, 0.35, 3.7), M.steel(), 0, 0.175, 0);
    part(g, G('cyl', 1.4, 1.5, 0.5, 8), M.hull(), 0, 0.6, 0);
    part(g, G('cyl', 1.0, 1.0, 2.8, 8), M.dark(), 0, 1.8, 0);
    part(g, G('cyl', 0.65, 0.65, 3.0, 8), M.glow(), 0, 1.85, 0);
    p.rings = [];
    for (const y of [1.2, 2.2, 3.0]) p.rings.push(part(g, G('tor', 1.25, 0.1), M.glow(), 0, y, 0, Math.PI / 2));
    for (const s of [-1, 1]) part(g, box(0.4, 1.2, 0.4), M.hull2(), s * 1.55, 0.95, 1.4);
  },
  m_refinery(g, p) {
    part(g, box(5.8, 0.3, 5.8), M.steel(), 0, 0.15, 0);
    part(g, box(3.6, 2.4, 3.2), M.hull(), -0.9, 1.5, -1.2);
    part(g, box(2.0, 1.2, 0.1), M.orange(), -0.9, 1.3, 0.42);
    part(g, G('cone', 1.4, 1.8, 6), M.metal(), 2.0, 2.6, -1.4, Math.PI);
    part(g, G('cyl', 0.5, 0.5, 1.4, 8), M.dark(), 2.0, 0.9, -1.4);
    chimney(g, -2.3, -2.4, 4.0, M.dark(), M.orange());
    chimney(g, -1.2, -2.4, 3.4, M.dark(), M.orange());
    part(g, box(3.6, 0.2, 2.0), M.dark(), 0, 0.4, 2.0);
    for (let i = 0; i < 4; i++) part(g, box(0.7, 0.05, 2.02), M.glow(), -1.35 + i * 0.9, 0.52, 2.0);
    part(g, box(3.64, 0.1, 3.24), M.glow(), -0.9, 2.1, -1.2);
  },
  m_barracks(g, p) {
    part(g, box(5.8, 0.25, 3.9), M.steel(), 0, 0.125, 0);
    part(g, box(5.2, 1.8, 3.0), M.hull(), 0, 1.15, -0.2);
    part(g, box(4.6, 0.5, 2.6), M.hull2(), 0, 2.3, -0.2);
    part(g, box(3.4, 0.14, 0.06), M.glow(), 0, 1.4, 1.32);
    part(g, box(1.4, 1.2, 0.1), M.dark(), 0, 0.85, 1.32);
    for (const s of [-1, 1]) {
      part(g, box(0.28, 1.6, 0.28), M.metal(), s * 1.6, 3.0, -0.2);
      part(g, box(0.28, 0.28, 1.4), M.metal(), s * 1.6, 3.8, 0.4);
      part(g, G('sph', 0.2, 6, 5), M.glow(), s * 1.6, 3.8, 1.1);
    }
  },
  m_factory(g, p) {
    part(g, box(5.8, 0.3, 5.8), M.steel(), 0, 0.15, 0);
    part(g, box(5.4, 2.8, 4.4), M.hull(), 0, 1.7, -0.6);
    part(g, box(4.6, 0.5, 3.6), M.hull2(), 0, 3.35, -0.6);
    part(g, box(3.3, 2.3, 0.2), M.dark(), 0, 1.45, 1.65);
    part(g, box(3.5, 0.12, 0.25), M.glow(), 0, 2.7, 1.65);
    part(g, box(0.12, 2.3, 0.25), M.glow(), -1.7, 1.45, 1.65);
    part(g, box(0.12, 2.3, 0.25), M.glow(), 1.7, 1.45, 1.65);
    chimney(g, 2.2, -2.3, 5.0, M.dark(), M.orange());
    chimney(g, -2.2, -2.3, 4.4, M.dark(), M.orange());
    for (const s of [-1, 1]) part(g, box(0.5, 2.4, 0.5), M.hull2(), s * 2.9, 1.3, 0.8, 0, 0, s * -0.15);
  },
  m_turret(g, p) {
    part(g, G('cyl', 1.6, 1.8, 0.5, 8), M.steel(), 0, 0.25, 0);
    part(g, G('cyl', 1.1, 1.3, 0.6, 8), M.hull(), 0, 0.8, 0);
    const t = grp(g, 0, 1.1, 0);
    part(t, box(1.2, 0.9, 1.3), M.hull2(), 0, 0.45, 0);
    part(t, G('sph', 0.32, 8, 6), M.glow(), 0, 0.95, 0.1);
    const b = grp(t, 0, 0.55, 0.6);
    part(b, G('cyl', 0.13, 0.2, 2.0, 8), M.metal(), 0, 0, 0.9, Math.PI / 2);
    part(b, G('cyl', 0.2, 0.2, 0.15, 8), M.glow(), 0, 0, 1.95, Math.PI / 2);
    p.turret = t; p.barrel = b; p.barrelZ = 0.6;
  },
};

export function buildOreChunkMaterial() { return H.ore(); }
