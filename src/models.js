import { cloneModel } from './assets.js';

// All model geometry comes from the Blender catalog. No runtime model builders.
export function buildUnitModel(def) { return cloneModel(def.id); }
export function buildBuildingModel(def) { return cloneModel(def.id); }
