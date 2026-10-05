import * as THREE from 'three';
import { preloadModels, assetStatus, cloneModel, ENVIRONMENT_MODELS } from '../src/assets.js';
import { DEFS } from '../src/config.js';

const status = document.getElementById('status');
try {
  await preloadModels((done,total) => { status.textContent = `Cargando modelos: ${done} / ${total}`; });
} catch {
  status.textContent = 'No se han podido cargar los modelos. Recarga la página para reintentar.';
  throw new Error('Catalog load failed');
}
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x11171c, 1);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.append(renderer.domElement);
const catalog = document.getElementById('catalog');
const environment = ENVIRONMENT_MODELS.map((id,i) => ({id,team:'environment',name:['Abeto','Rocas','Mineral'][i],kind:'environment'}));
const definitions = [...Object.values(DEFS), ...environment];
const floorGeometry = new THREE.PlaneGeometry(100,100);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x283537, roughness: 1 });
let views = [], turn = 0, team = 'human';
function show() {
  for (const v of views) v.sun.shadow.dispose();
  views = []; catalog.replaceChildren();
  document.body.classList.toggle('machine', team === 'machine');
  // Units first: silhouettes are easier to compare across factions.
  const defs = definitions.filter(d => d.team === team).sort((a,b) => (a.kind === 'unit' ? 0 : 1) - (b.kind === 'unit' ? 0 : 1));
  for (const def of defs) {
    const card = document.createElement('article'); card.className = 'card';
    const title = document.createElement('div'); title.className = 'label'; title.textContent = def.name;
    const kind = document.createElement('div'); kind.className = 'kind'; kind.textContent = def.kind === 'unit' ? 'Unidad' : def.kind === 'building' ? 'Edificio' : 'Entorno';
    const stats = document.createElement('div'); stats.className = 'stats';
    card.append(title,kind,stats); catalog.append(card);
    const {group} = cloneModel(def.id), scene = new THREE.Scene();
    scene.add(group, new THREE.HemisphereLight(0xd6e4ff, 0x40483a, 1.25));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    sun.position.set(-4,10,6); sun.castShadow = true; sun.shadow.mapSize.set(512,512);
    Object.assign(sun.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.1,far:30}); sun.shadow.normalBias = .035; scene.add(sun);
    const floor = new THREE.Mesh(floorGeometry,floorMaterial);
    floor.rotation.x = -Math.PI/2; floor.position.y = -.025; floor.receiveShadow = true; scene.add(floor);
    const camera = new THREE.PerspectiveCamera(38,1,.1,200);
    const box = new THREE.Box3().setFromObject(group), center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x,size.y,size.z) * .65;
    let meshes = 0, triangles = 0;
    group.traverse(o => { if(o.isMesh) {meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count)/3;} });
    stats.textContent = `${meshes} ${meshes === 1 ? 'malla' : 'mallas'} · ${triangles.toLocaleString('es')} triángulos`;
    views.push({scene,camera,sun,card,center,radius});
  }
  frame();
}
function frame() {
  renderer.setSize(innerWidth,innerHeight);
  renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
  for (const {scene,camera,card,center,radius} of views) {
    const r = card.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const w = r.width-2, h = r.height-2;
    renderer.setViewport(r.left+1,innerHeight-r.bottom+1,w,h);
    renderer.setScissor(r.left+1,innerHeight-r.bottom+1,w,h);
    camera.aspect=w/h; camera.updateProjectionMatrix();
    const angle=.6+turn*Math.PI/2, dist=radius/Math.sin(THREE.MathUtils.degToRad(19)) * 1.05;
    camera.position.copy(center).add(new THREE.Vector3(Math.sin(angle)*.78,.63,Math.cos(angle)*.78).normalize().multiplyScalar(dist));
    camera.lookAt(center); renderer.render(scene,camera);
  }
}
for (const button of document.querySelectorAll('[data-team]')) button.onclick = () => {
  team = button.dataset.team;
  for(const b of document.querySelectorAll('[data-team]')) b.setAttribute('aria-pressed',String(b === button));
  show();
};
document.getElementById('rotate').onclick=()=>{turn++;frame();};
window.addEventListener('resize',frame);
window.addEventListener('scroll',frame);
show();
status.textContent = `${assetStatus.loaded.length} GLB cargados · ${Math.round(assetStatus.loadMs)} ms · sin texturas externas`;
