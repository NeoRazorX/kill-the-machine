import * as THREE from 'three';
import { preloadModels, assetStatus, MODEL_IDS, getInstanceAsset, cloneModel } from '../src/assets.js';
import { buildUnitModel, buildBuildingModel } from '../src/models.js';
import { DEFS } from '../src/config.js';
import { Unit } from '../src/units.js';
import { Building } from '../src/buildings.js';
import { Input } from '../src/input.js';
import { FX } from '../src/fx.js';
import { GameMap, MapVisuals } from '../src/map.js';
import { checkMap } from './map.js';

const output = document.querySelector('#results'), results = [];
const assert = (ok, name) => { if (!ok) throw new Error(name); results.push(`PASS ${name}`); };
const close = (a,b) => Math.abs(a-b) < .001;
try {
  // First boot: a missing model must fail clearly, with no synthetic replacement.
  const realFetch = globalThis.fetch;
  let rejected = false, unavailable = false;
  try {
    globalThis.fetch = (url, options) => String(url).endsWith('/m_siege.glb') ? Promise.resolve(new Response('',{status:404})) : realFetch(url,options);
    await preloadModels();
  } catch { rejected = true; }
  finally { globalThis.fetch = realFetch; }
  try { cloneModel('h_tank'); } catch { unavailable = true; }
  assert(rejected && unavailable && assetStatus.failed.includes('m_siege'), 'missing GLB rejects startup atomically; no fallback');
  await preloadModels();
  assert(assetStatus.loaded.length === MODEL_IDS.length && !assetStatus.failed.length, 'retry loads the complete model catalog');
  const game = {
    fx:{spawn(){},smoke(){}},scene:new THREE.Scene(),time:1,player:'human',spectate:false,
    impact(){},isVisibleEntity:()=>true,lowPower:()=>false,findTarget:()=>null,
  };
  const fx = new FX({...game,audio:{play(){}},time:0},game.scene);
  let flash;
  fx.muzzle=(x,y,z)=>{flash=new THREE.Vector3(x,y,z);};
  const target={kind:'unit',x:40,z:30,def:{height:2},dead:false};
  const stats = [];
  for (const def of Object.values(DEFS)) {
    const model = def.kind === 'unit' ? buildUnitModel(def) : buildBuildingModel(def);
    const copy = cloneModel(def.id);
    let meshes=0,triangles=0,finite=true;
    model.group.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;finite &&= Array.from(o.geometry.attributes.position.array).every(Number.isFinite);}});
    assert(model.group.userData.modelSource==='glb' && meshes>0 && finite, `${def.id}: authored geometry`);
    stats.push({id:def.id,meshes,triangles});
    const bounds = new THREE.Box3().setFromObject(model.group);
    assert(bounds.min.y > -.04 && bounds.max.y <= def.height+.16, `${def.id}: floor and height (${bounds.max.y.toFixed(2)})`);
    if (def.kind==='building') assert(bounds.max.x<=def.w+0.02 && bounds.min.x>=-def.w-0.02 && bounds.max.z<=def.h+0.02 && bounds.min.z>=-def.h-0.02, `${def.id}: footprint`);
    for(const name of ['turret','barrel','body','fill','bob','ring','drill','dish','crystal']) {
      if(!model.parts[name]) continue;
      const before = copy.parts[name].quaternion.clone();
      model.parts[name].rotateY(.4);
      assert(copy.parts[name].quaternion.equals(before), `${def.id}: independent ${name}`);
    }
    let instance;
    if(def.kind==='unit') {
      instance = new Unit(game,def,12,20,def.team);
      instance.anim=.6;instance.walk=1;instance.heading=.4;instance.aim=1.2;instance.recoil=1;instance.moving=true;instance.load=def.capacity/2;
      instance.syncMesh(.05);
      if(instance.parts.legs) assert(instance.parts.legs.some(l=>Math.abs(l.rotation.x)>.01), `${def.id}: walking`);
      if(instance.parts.spider) assert(instance.parts.spider.length===(def.id==='m_siege'?6:4), `${def.id}: articulated legs`);
      if(def.harvester) {
        const p=instance.parts;
        assert(close(p.fill.scale.y,.5) && close(p.fill.position.y-p.fillH*p.fill.scale.y/2,p.fillBottom), `${def.id}: half cargo stays on bin floor`);
        instance.load=def.capacity;instance.syncMesh(.05);
        assert(p.fill.visible && close(p.fill.scale.y,1), `${def.id}: full cargo`);
        // Exercise the actual refinery transfer, not only a manually assigned load.
        let delivered = 0;
        const oldAddCredits = game.addCredits;
        game.addCredits = (team, amount) => { delivered += amount; };
        instance.refinery = { dead: false };
        instance.hstate = 'unload';
        instance.order = { type: 'harvest' };
        instance.updateHarvester(def.capacity / def.unloadRate / 2);
        instance.syncMesh(.05);
        assert(p.fill.visible && close(instance.load, def.capacity / 2) && close(p.fill.scale.y, .5), `${def.id}: unloading lowers visible cargo`);
        instance.updateHarvester(def.capacity / def.unloadRate / 2);
        instance.syncMesh(.05);
        assert(instance.load === 0 && instance.hstate === 'idle' && instance.refinery === null && close(delivered, def.capacity), `${def.id}: refinery receives the complete cargo`);
        assert(!p.fill.visible && p.fill.scale.y === 0 && close(p.fill.position.y, p.fillBottom), `${def.id}: empty bin contains no visible mineral`);
        game.addCredits = oldAddCredits;
        instance.field = { x: instance.x, z: instance.z, amount: def.capacity };
        instance.hstate = 'gather';
        instance.updateHarvester(.1);
        instance.syncMesh(.05);
        assert(instance.load > 0 && p.fill.visible && p.fill.scale.y > 0, `${def.id}: gathering restores visible cargo`);
      }
    } else {
      instance = new Building(game,def,def.team,10,10);
      instance.update(.8);
      assert(instance.mesh.scale.y>.02&&instance.mesh.scale.y<1,`${def.id}: construction`);
      instance.update(.8);instance.update(.05);
      if (def.produces) {
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(instance.mesh.quaternion);
        assert(front.z > .999 && instance.spawnPt.z > instance.rect.z1 && instance.front === 1,
          `${def.id}: doors face the gameplay camera and units exit on the door side`);
        const placement = Object.assign(Object.create(Input.prototype), { game });
        placement.beginPlacement(def);
        assert(placement.ghost.children[0].quaternion.equals(instance.mesh.quaternion),
          `${def.id}: placement preview matches the built orientation`);
        placement.cancelPlacement();
      }
      const ghost = cloneModel(def.id);
      const originalMaterials=[];instance.mesh.traverse(o=>{if(o.isMesh)originalMaterials.push(o.material);});
      ghost.group.traverse(o=>{if(o.isMesh)o.material=new THREE.MeshBasicMaterial();});
      let i=0, unchanged=true;instance.mesh.traverse(o=>{if(o.isMesh)unchanged &&= o.material===originalMaterials[i++];});
      assert(unchanged,`${def.id}: placement ghost isolation`);
    }
    if(def.weapon) {
      instance.aim=2.1; instance.x=14; // unsynchronized combat pose
      fx.fireWeapon(instance,target);
      const actual=instance.parts.muzzle.getWorldPosition(new THREE.Vector3());
      assert(flash.distanceTo(actual)<.00001 && Number.isFinite(flash.y),`${def.id}: real weapon muzzle`);
    }
    if(instance.parts.barrel) {
      const p=instance.parts;instance.recoil=1;
      if(def.kind==='unit') instance.syncMesh(.01); else instance.updateTurret(.01,false);
      const delta=p.barrel.position.clone().sub(p.barrelRest);
      assert(delta.length()>.1 && delta.clone().normalize().dot(p.recoilAxis)<-.999,`${def.id}: recoil along barrel axis`);
    }
  }
  assert(checkMap().startsWith('PASS'), '32 map seeds: paths, formation clearance and reproducibility');
  const map=new GameMap(20260), visuals=new MapVisuals(map,game.scene);
  const instanced=[];visuals.group.traverse(o=>{if(o.isInstancedMesh)instanced.push(o);});
  assert(instanced.length===6, 'vegetation, ore, landmarks and rim use six instanced meshes');
  for(const id of ['env_tree','env_rock','env_ore','env_cliff','env_ruin']) {
    const asset=getInstanceAsset(id);
    if (id === 'env_cliff' || id === 'env_ruin') {
      const position = asset.geometry.attributes.position;
      let contained = true;
      for (let i = 0; i < position.count; i++) contained &&= Math.hypot(position.getX(i), position.getZ(i)) <= 1;
      assert(contained, `${id}: visual footprint stays inside blocked radius`);
    }
    assert(instanced.some(o=>o.geometry===asset.geometry),`${id}: imported geometry is instanced`);
  }
  const field=map.fields[0];field.amount=0;visuals.updateOre();
  const matrix=new THREE.Matrix4();visuals.ore.getMatrixAt(field.crystalStart,matrix);
  assert(new THREE.Vector3().setFromMatrixScale(matrix).length()<.001,'depleted ore disappears');
  field.amount=field.max;visuals.updateOre();visuals.ore.getMatrixAt(field.crystalStart,matrix);
  assert(new THREE.Vector3().setFromMatrixScale(matrix).length()>.5,'regenerated ore reappears');
  const renderer=new THREE.WebGLRenderer();renderer.setSize(640,480);renderer.shadowMap.enabled=true;
  const camera=new THREE.PerspectiveCamera(45,640/480,.1,600);camera.position.set(25,70,85);camera.lookAt(25,0,25);
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x444444,2));
  const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(25,80,25);sun.castShadow=true;
  Object.assign(sun.shadow.camera,{left:-100,right:100,top:100,bottom:-100,far:200});scene.add(sun);
  const units=Object.values(DEFS).filter(d=>d.kind==='unit');
  for(let i=0;i<100;i++){const o=cloneModel(units[i%units.length].id).group;o.position.set(i%10*5,0,Math.floor(i/10)*5);scene.add(o);}
  for(const [i,def] of Object.values(DEFS).filter(d=>d.kind==='building').entries()){const o=cloneModel(def.id).group;o.position.set(i*6,0,-10);scene.add(o);}
  renderer.render(scene,camera);
  assert(renderer.info.render.triangles>0,'mixed army and all buildings render with shadows');
  results.push(`RENDER ${JSON.stringify(renderer.info.render)}`);
  results.push(`CATALOG ${JSON.stringify(stats)}`);
  renderer.dispose();
  output.textContent=results.join('\n')+'\nALL PASSED';
} catch(error) { output.textContent=results.join('\n')+'\nFAIL '+error.stack; }
