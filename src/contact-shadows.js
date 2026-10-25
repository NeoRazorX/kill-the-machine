import * as THREE from 'three';

// Ambient occlusion where units and buildings meet the ground. The sun's shadow map draws the cast
// shadow, but nothing darkens the ground right under a hull or along a wall, so models look pasted
// on. Each one gets a soft rounded rectangle the size of its model's base, turned with it: darkest
// along the base and fading out a little beyond it. One instanced draw covers them all.
export const MAX_CONTACT_SHADOWS = 1024;

// Only parts that start this close to the ground count towards the base, so barrels, dishes and
// antennas do not widen it.
const BASE_HEIGHT = .5;

const box = new THREE.Box3(), part = new THREE.Box3(), local = new THREE.Matrix4(), inverse = new THREE.Matrix4();
// The model's base in its own frame: { hx, hz } half extents and { cx, cz } its centre. Models that
// float clear of the ground use their whole outline.
export function footprint(object) {
  object.updateMatrixWorld(true);
  inverse.copy(object.matrixWorld).invert();
  const measure = (low) => {
    box.makeEmpty();
    object.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      part.copy(o.geometry.boundingBox).applyMatrix4(local.multiplyMatrices(inverse, o.matrixWorld));
      if (!low || part.min.y < BASE_HEIGHT) box.union(part);
    });
    return !box.isEmpty();
  };
  if (!measure(true) && !measure(false)) return { hx: .5, hz: .5, cx: 0, cz: 0 };
  return { hx: (box.max.x - box.min.x) / 2, hz: (box.max.z - box.min.z) / 2, cx: (box.max.x + box.min.x) / 2, cz: (box.max.z + box.min.z) / 2 };
}

// How dark each kind of shadow is at the base, and how far (world units) it fades out past it.
const STYLE = {
  unit: { strength: .62, reach: 1 },
  hover: { strength: .3, reach: 1.5 },
  building: { strength: .5, reach: 1.8 },
};

export class ContactShadows {
  constructor(game, scene) {
    this.game = game;
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // Per instance: half extents of the base, strength and reach.
    this.shape = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CONTACT_SHADOWS * 4), 4);
    this.shape.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('contactShape', this.shape);
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute vec4 contactShape;\nvarying vec4 vContactShape;\nvarying vec2 vContact;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vContactShape = contactShape;
          vContact = position.xz * 2.0 * (contactShape.xy + contactShape.w);`);
      shader.fragmentShader = 'varying vec4 vContactShape;\nvarying vec2 vContact;\n' +
        shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          // Distance outside a rounded rectangle the size of the base (negative inside).
          vec2 base = vContactShape.xy;
          float corner = min(base.x, base.y) * .6, reach = vContactShape.w;
          vec2 q = abs(vContact) - (base - corner);
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
          float fade = 1.0 - smoothstep(-reach * .25, reach, d);
          diffuseColor.a = vContactShape.z * pow(fade, 1.6);`);
    };
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_CONTACT_SHADOWS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  add(entity, style, fade = 1) {
    const i = this.mesh.count;
    if (i >= MAX_CONTACT_SHADOWS) return;
    const f = entity.footprint ??= footprint(entity.mesh), m = entity.mesh, a = m.rotation.y;
    const c = Math.cos(a), s = Math.sin(a);
    this.position.set(m.position.x + f.cx * c + f.cz * s, .04, m.position.z - f.cx * s + f.cz * c);
    this.quaternion.setFromAxisAngle(this.up, a);
    this.scale.set(2 * (f.hx + style.reach), 1, 2 * (f.hz + style.reach));
    this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scale));
    this.shape.setXYZW(i, f.hx, f.hz, style.strength * fade, style.reach);
    this.mesh.count = i + 1;
  }

  // Rebuilt every frame from what is on screen: hidden units leave no shadow to give them away.
  update() {
    const g = this.game;
    this.mesh.count = 0;
    for (const b of g.buildings) {
      // Grows in with the building and shrinks away when it is sold.
      if (!b.dead && b.mesh.visible) this.add(b, STYLE.building, Math.min(1, b.mesh.scale.y * 1.5));
    }
    for (const u of g.units) if (!u.dead && u.mesh.visible) this.add(u, u.def.hover ? STYLE.hover : STYLE.unit);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shape.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
