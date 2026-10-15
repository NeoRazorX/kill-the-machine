import * as THREE from 'three';

// A separate, bounded pool keeps movement effects from taking particles away from combat.
export const MAX_GROUND_PARTICLES = 512;
const STYLES = {
  desert: { color: 0xc6a16c, life: 1.25, size: .85, lift: .45, gravity: -.12, opacity: .36 },
  ice: { color: 0xeff8ff, life: .8, size: .48, lift: 2.1, gravity: 5, opacity: .85 },
};

export class GroundTrails {
  constructor(game, group) {
    this.game = game;
    this.n = 0;
    this.distance = new WeakMap();
    this.particles = Array.from({ length: MAX_GROUND_PARTICLES }, () => ({}));
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GROUND_PARTICLES), 1);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GROUND_PARTICLES * 3), 3);
    geometry.setAttribute('trailAlpha', this.alpha);
    geometry.setAttribute('trailTint', this.tint);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `
        attribute float trailAlpha;
        attribute vec3 trailTint;
        varying vec2 puffUV;
        varying float puffAlpha;
        varying vec3 puffTint;
        void main() {
          puffUV = uv * 2.0 - 1.0;
          puffAlpha = trailAlpha; puffTint = trailTint;
          vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          center.xy += position.xy * length(instanceMatrix[0].xyz);
          gl_Position = projectionMatrix * center;
        }`,
      fragmentShader: `
        varying vec2 puffUV;
        varying float puffAlpha;
        varying vec3 puffTint;
        void main() {
          float r = length(puffUV);
          float alpha = (1.0 - smoothstep(0.15, 1.0, r)) * puffAlpha;
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(puffTint, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_GROUND_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.alpha.setUsage(THREE.DynamicDrawUsage); this.tint.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    group.add(this.mesh);
    this.matrix = new THREE.Matrix4();
    this.color = new THREE.Color();
  }

  emit(unit, dt, oldX, oldZ) {
    const g = this.game, style = STYLES[g.theme?.id];
    const dx = unit.x - oldX, dz = unit.z - oldZ, dist = Math.hypot(dx, dz);
    if (!style || unit.dead || unit.def.producer === 'barracks' || unit.def.hover ||
        !unit.moving || dt <= 0 || dist < .001 || !g.isVisibleEntity(unit)) {
      this.distance.delete(unit);
      return;
    }
    const size = Math.max(.7, Math.min(1.7, unit.radius / 1.5));
    const spacing = (g.theme.id === 'ice' ? .65 : .8) / Math.sqrt(size), previous = this.distance.get(unit) || 0;
    const total = previous + dist;
    this.distance.set(unit, total % spacing);
    const nx = dx / dist, nz = dz / dist;
    const speed = Math.min(1.5, dist / dt / 6);
    this.color.setHex(style.color);
    // Bound catch-up work after a long frame; interpolate along the actual path travelled.
    for (let step = spacing - previous, bursts = 0; step <= dist && bursts < 4; step += spacing, bursts++) {
      for (const side of [-1, 1]) {
        const x = oldX + nx * step - nx * unit.radius * .6 + nz * side * unit.radius * .65;
        const z = oldZ + nz * step - nz * unit.radius * .6 - nx * side * unit.radius * .65;
        if (this.n >= MAX_GROUND_PARTICLES || (!g.spectate && !g.visibleAt(x, z))) continue;
        const p = this.particles[this.n++];
        Object.assign(p, {
          x, y: .18, z, vx: -nx * (.25 + speed * .4) + nz * side * (.3 + Math.random() * .4),
          vz: -nz * (.25 + speed * .4) - nx * side * (.3 + Math.random() * .4),
          vy: style.lift * (.7 + Math.random() * .6) * (.6 + speed * .4),
          age: 0, life: style.life * (.8 + Math.random() * .4),
          size: style.size * size * (.7 + speed * .3), gravity: style.gravity,
          opacity: style.opacity, snow: g.theme.id === 'ice',
          r: this.color.r, g: this.color.g, b: this.color.b,
        });
      }
    }
  }

  update(dt) {
    if (!this.n && !this.mesh.count) return;
    const g = this.game;
    for (let i = 0; i < this.n;) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life || (!g.spectate && !g.visibleAt(p.x, p.z))) {
        this.particles[i] = this.particles[--this.n]; this.particles[this.n] = p;
        continue;
      }
      const drag = Math.exp(-1.8 * dt);
      p.vx *= drag; p.vz *= drag; p.vy -= p.gravity * dt;
      p.x += p.vx * dt; p.z += p.vz * dt; p.y = Math.max(.08, p.y + p.vy * dt);
      const t = p.age / p.life;
      const scale = p.size * (p.snow ? 1 - t * .75 : .5 + t * 1.8);
      this.matrix.makeScale(scale, scale, scale).setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this.matrix);
      this.alpha.setX(i, p.opacity * Math.min(1, t * 8) * (1 - t) ** 2);
      this.tint.setXYZ(i, p.r, p.g, p.b);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = this.alpha.needsUpdate = this.tint.needsUpdate = true;
  }
}
