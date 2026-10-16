import * as THREE from 'three';

// Selection and hover circles drawn on the ground under units. They are depth-tested against the
// scene, so the unit's model hides the part of the ring behind it instead of the ring covering it.
export const MAX_SELECTION_RINGS = 256;
export const RING_SCALE = 1.25;

export class SelectionRings {
  constructor(scene) {
    const geometry = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_SELECTION_RINGS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.matrix = new THREE.Matrix4();
    this.color = new THREE.Color();
  }

  begin() { this.mesh.count = 0; }

  add(unit, color) {
    const i = this.mesh.count;
    if (i >= MAX_SELECTION_RINGS) return;
    const r = unit.radius * RING_SCALE;
    this.mesh.setMatrixAt(i, this.matrix.makeScale(r, 1, r).setPosition(unit.x, 0.05, unit.z));
    this.mesh.setColorAt(i, this.color.set(color));
    this.mesh.count = i + 1;
  }

  end() {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
