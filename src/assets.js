import * as THREE from 'three';
import { GLTFLoader } from '../lib/addons/loaders/GLTFLoader.js';
import { DEFS } from './config.js';

export const ENVIRONMENT_MODELS = ['env_tree', 'env_rock', 'env_ore', 'env_cliff', 'env_ruin'];
export const MODEL_IDS = [...Object.keys(DEFS), ...ENVIRONMENT_MODELS, 'prop_cash_crate'];
const templates = new Map();
const instanceAssets = new Map();
const animatedNodes = ['turret', 'barrel', 'muzzle', 'body', 'fill', 'bob', 'ring', 'drill', 'dish', 'crystal'];
const groups = { legs: 'leg_', spider: 'spider_', rings: 'ring_' };
const requiredNodes = {
  h_rifle: ['body', 'leg_0', 'leg_1'], h_rocket: ['body', 'leg_0', 'leg_1'], h_medic: ['body', 'leg_0', 'leg_1', 'muzzle'],
  m_sentinel: ['body', 'leg_0', 'leg_1'],
  h_harv: ['fill'], m_harv: ['fill', 'drill'], m_drone: ['bob', 'ring'], m_nanite: ['bob', 'ring', 'muzzle'],
  h_mech: ['muzzle'], m_welder: ['muzzle'],
  m_crusher: Array.from({length: 4}, (_,i) => `spider_${i}`),
  m_siege: Array.from({length: 6}, (_,i) => `spider_${i}`),
  h_hq: ['dish'], m_hq: ['crystal', 'ring'], m_power: ['ring_0', 'ring_1', 'ring_2'],
};
export const assetStatus = { loaded: [], failed: [], loadMs: 0, total: MODEL_IDS.length };

function validate(id, scene) {
  const def = DEFS[id];
  const names = [...(requiredNodes[id] || [])];
  if (def?.weapon) names.push('muzzle');
  if (def?.turret || (def?.kind === 'building' && def.weapon)) names.push('turret', 'barrel');
  for (const name of names) {
    if (!scene.getObjectByName(name)) throw new Error(`${id}: missing ${name}`);
  }
  const fill = scene.getObjectByName('fill');
  if (fill && !(Number.isFinite(fill.userData.height) && fill.userData.height > 0)) {
    throw new Error(`${id}: missing cargo height`);
  }
  let meshes = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh || !o.geometry.attributes.position) throw new Error(`${id}: invalid rigid mesh`);
    o.castShadow = true; o.receiveShadow = true;
  });
  if (!meshes) throw new Error(`${id}: empty model`);
  if (ENVIRONMENT_MODELS.includes(id) && meshes !== 1) throw new Error(`${id}: environment must be a single mesh`);
}

// Load a complete catalog before allowing simulation, icons or placement previews.
// Commit atomically so a missing file cannot leave a half-loaded game.
export async function preloadModels(onProgress = () => {}) {
  const pending = new Map();
  assetStatus.loaded = []; assetStatus.failed = [];
  const start = performance.now(), loader = new GLTFLoader();
  await Promise.all(MODEL_IDS.map(async (id) => {
    try {
      const url = new URL(`../assets/models/${id}.glb`, import.meta.url);
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const gltf = await loader.parseAsync(await response.arrayBuffer(), new URL('.', url).href);
      validate(id, gltf.scene);
      pending.set(id, gltf.scene);
      assetStatus.loaded.push(id);
    } catch (error) {
      assetStatus.failed.push(id);
      console.error(`Could not load ${id}:`, error);
    }
    onProgress(assetStatus.loaded.length + assetStatus.failed.length, MODEL_IDS.length);
  }));
  assetStatus.loadMs = performance.now() - start;
  if (assetStatus.failed.length) {
    // Release this failed attempt; existing templates are never changed mid-game.
    for (const scene of pending.values()) disposeTemplate(scene);
    throw new Error(`Missing models: ${assetStatus.failed.join(', ')}`);
  }
  // Repeated calls are for pre-game retries/tests, never while live entities use the catalog.
  for (const scene of templates.values()) disposeTemplate(scene);
  for (const { geometry } of instanceAssets.values()) geometry.dispose();
  templates.clear(); instanceAssets.clear();
  for (const [id, scene] of pending) templates.set(id, scene);
  return assetStatus;
}

function disposeTemplate(scene) {
  const geometries = new Set(), materials = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    geometries.add(o.geometry);
    for (const material of [].concat(o.material)) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function template(id) {
  const model = templates.get(id);
  if (!model) throw new Error(`Model ${id} is not loaded`);
  return model;
}

export function cloneModel(id) {
  // Transforms are unique; rigid geometry and materials remain shared and immutable.
  const group = template(id).clone(true), parts = {};
  for (const name of animatedNodes) {
    const node = group.getObjectByName(name);
    if (node) parts[name] = node;
  }
  for (const [key, prefix] of Object.entries(groups)) {
    const nodes = [];
    group.traverse(o => { if (o.name.startsWith(prefix)) nodes.push(o); });
    nodes.sort((a,b) => Number(a.name.slice(prefix.length)) - Number(b.name.slice(prefix.length)));
    if (nodes.length) parts[key] = nodes;
  }
  if (parts.barrel) {
    parts.barrelRest = parts.barrel.position.clone();
    parts.recoilAxis = new THREE.Vector3(0,0,1).applyQuaternion(parts.barrel.quaternion);
  }
  if (parts.fill) {
    parts.fillH = parts.fill.userData.height;
    parts.fillBottom = parts.fill.position.y - parts.fillH / 2;
  }
  if (parts.bob) parts.bobBase = parts.bob.position.y;
  if (parts.crystal) parts.crystalBase = parts.crystal.position.y;
  if (parts.spider) parts.spiderRest = parts.spider.map(o => o.quaternion.clone());
  group.userData.modelSource = 'glb';
  return { group, parts };
}

// Bake the exported node transform once, then instance the authored environment mesh.
export function getInstanceAsset(id) {
  if (!ENVIRONMENT_MODELS.includes(id)) throw new Error(`Not an environment model: ${id}`);
  if (!instanceAssets.has(id)) {
    const group = template(id); group.updateMatrixWorld(true);
    let mesh;
    group.traverse(o => { if (o.isMesh) mesh = o; });
    instanceAssets.set(id, { geometry: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), material: mesh.material });
  }
  return instanceAssets.get(id);
}
