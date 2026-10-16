import * as THREE from 'three';

// Flat decals pressed into the ground by vehicles. A ring buffer of instances: when it is full the
// oldest mark is reused, so heavy traffic shortens how long tracks last instead of costing more.
export const MAX_TRACK_MARKS = 3072;
export const TRACK_LIFE = 14;
const COLORS = { temperate: 0x262619, desert: 0x80592f, ice: 0x8ea2b6 };
const OPACITY = { temperate: .42, desert: .38, ice: .5 };
// tread: continuous belts on both sides; feet: alternating heavy footprints; legs: small spider feet.
const KIND = { tread: 0, feet: 1, legs: 1 };

export function trackStyle(def) {
  if (def.hover || def.producer === 'barracks') return null;
  return def.tracks || 'tread';
}

export class TrackMarks {
  constructor(game, group) {
    this.game = game;
    this.next = 0; this.count = 0;
    this.distance = new WeakMap(); this.stride = new WeakMap();
    this.born = new Float32Array(MAX_TRACK_MARKS).fill(-Infinity);
    this.strength = new Float32Array(MAX_TRACK_MARKS);
    this.time = 0;
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRACK_MARKS), 1);
    this.kind = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRACK_MARKS), 1);
    geometry.setAttribute('markAlpha', this.alpha);
    geometry.setAttribute('markKind', this.kind);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      uniforms: { tint: { value: new THREE.Color(COLORS.temperate) } },
      vertexShader: `
        attribute float markAlpha;
        attribute float markKind;
        varying vec2 markUV;
        varying float alpha;
        varying float kind;
        void main() {
          markUV = uv; alpha = markAlpha; kind = markKind;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 tint;
        varying vec2 markUV;
        varying float alpha;
        varying float kind;
        void main() {
          vec2 p = markUV * 2.0 - 1.0;
          float shape;
          if (kind < 0.5) {
            // Tread belt: soft sides, feathered ends so consecutive segments blend, cross grousers.
            float side = 1.0 - smoothstep(0.55, 1.0, abs(p.x));
            float ends = 1.0 - smoothstep(0.8, 1.0, abs(p.y));
            float grouser = 0.6 + 0.4 * step(0.0, sin(markUV.y * 18.85));
            shape = side * ends * grouser;
          } else {
            // Footprint: an oval with a darker heel and toe.
            float r = length(p * vec2(1.0, 0.85));
            shape = (1.0 - smoothstep(0.6, 1.0, r)) * (0.75 + 0.25 * abs(p.y));
          }
          float a = shape * alpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(tint, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_TRACK_MARKS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 1;
    group.add(this.mesh);
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.pos = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  emit(unit, dt, oldX, oldZ) {
    const g = this.game, style = trackStyle(unit.def);
    const dx = unit.x - oldX, dz = unit.z - oldZ, dist = Math.hypot(dx, dz);
    if (!style || unit.dead || !unit.moving || dt <= 0 || dist < .001 || !g.isVisibleEntity(unit)) {
      this.distance.delete(unit);
      return;
    }
    const r = unit.radius, nx = dx / dist, nz = dz / dist, angle = Math.atan2(nx, nz);
    const spacing = style === 'tread' ? .9 : style === 'feet' ? r * .95 : r * .7;
    const previous = this.distance.has(unit) ? this.distance.get(unit) : spacing;
    this.distance.set(unit, (previous + dist) % spacing);
    // Bound catch-up work after a long frame; stamp along the path actually travelled.
    for (let step = spacing - previous, n = 0; step <= dist && n < 6; step += spacing, n++) {
      const cx = oldX + nx * step, cz = oldZ + nz * step;
      if (style === 'tread') {
        for (const side of [-1, 1]) this.stamp(cx, cz, nx, nz, side * r * .62, -spacing * .5, angle, r * .34, spacing * 1.2, 0, 1);
      } else {
        const stride = (this.stride.get(unit) || 0) + 1;
        this.stride.set(unit, stride);
        const side = stride % 2 ? 1 : -1;
        if (style === 'feet') this.stamp(cx, cz, nx, nz, side * r * .42, 0, angle, r * .36, r * .5, 1, 1.15);
        else for (const lane of [.55, 1]) this.stamp(cx, cz, nx, nz, side * r * lane, -lane * r * .4, angle, r * .16, r * .2, 1, .9);
      }
    }
  }

  // lateral/back: offset from the path point; width across and length along the direction of travel.
  stamp(cx, cz, nx, nz, lateral, back, angle, width, length, kind, strength) {
    const g = this.game, x = cx + nz * lateral + nx * back, z = cz - nx * lateral + nz * back;
    if (!g.spectate && !g.visibleAt(x, z)) return;
    const i = this.next;
    this.next = (i + 1) % MAX_TRACK_MARKS;
    this.count = Math.min(MAX_TRACK_MARKS, this.count + 1);
    this.quat.setFromAxisAngle(this.up, angle);
    this.matrix.compose(this.pos.set(x, .03, z), this.quat, this.scale.set(width, 1, length));
    this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.instanceMatrix.addUpdateRange(i * 16, 16);
    this.kind.setX(i, kind); this.kind.addUpdateRange(i, 1); this.kind.needsUpdate = true;
    this.born[i] = this.time; this.strength[i] = strength;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    if (!this.count) return;
    const id = this.game.theme?.id;
    this.material.uniforms.tint.value.setHex(COLORS[id] ?? COLORS.temperate);
    const opacity = OPACITY[id] ?? OPACITY.temperate, a = this.alpha.array;
    let live = 0;
    for (let i = 0; i < this.count; i++) {
      const t = (this.time - this.born[i]) / TRACK_LIFE;
      // Fresh for the first half, then fade out smoothly.
      a[i] = t >= 1 ? 0 : opacity * this.strength[i] * Math.min(1, 2 - t * 2);
      if (t < 1) live++;
    }
    if (!live) { this.count = this.next = 0; }
    this.mesh.count = this.count;
    this.alpha.needsUpdate = true;
  }
}
