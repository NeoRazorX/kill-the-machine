import * as THREE from 'three';
import { preloadModels } from '../src/assets.js';
import { GameMap, MapVisuals, resolveLayout } from '../src/map.js';
import { checkMap } from '../tests/map.js';
import { SIZE } from '../src/config.js';
import { THEMES } from '../src/themes.js';
const C = SIZE / 2;
const status = document.querySelector('#checks');
try {
  await preloadModels();
  const checked = checkMap();
  // ?map=temperate|desert|ice&layout=quarry|river
  const params = new URLSearchParams(location.search);
  const theme = THEMES[params.get('map')] || THEMES.temperate;
  const map = new GameMap(undefined, resolveLayout(params.get('layout') || 'quarry')), scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.sky);
  document.querySelector('h1').textContent = map.layout.names[theme.id];
  document.querySelector('#blurb').textContent = map.layout.blurb;
  // Theme and layout links keep the other choice; Play starts on this map and look.
  for (const a of document.querySelectorAll('a[href^="?"]')) {
    const p = new URLSearchParams(a.getAttribute('href'));
    if (!p.has('map')) p.set('map', theme.id);
    if (!p.has('layout')) p.set('layout', map.layout.id);
    a.href = `?${p}`;
  }
  document.querySelector('#play').href = `/?autostart=easy&layout=${map.layout.id}&map=${theme.id}`;
  const renderer = new THREE.WebGLRenderer({canvas:document.querySelector('#map'),antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 1000);
  scene.add(new THREE.HemisphereLight(...theme.hemi));
  const sun = new THREE.DirectionalLight(...theme.sun);
  sun.position.set(C + 63, 330, C + 78); sun.target.position.set(C, 0, C);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left:-C * 1.5,right:C * 1.5,top:C * 1.5,bottom:-C * 1.5,near:1,far:800});
  sun.shadow.normalBias = .08;
  scene.add(sun, sun.target);
  const start = performance.now();
  new MapVisuals(map, scene, theme);
  const groundMs = Math.round(performance.now() - start);
  const render = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.render(scene, camera); };
  const view = (detail) => { camera.position.set(detail ? C + 2 : C, detail ? 95 : C * 2.4, detail ? C + 85 : C * 2.9); camera.lookAt(detail ? C : C - 10, 0, C); render(); };
  document.querySelector('#overview').onclick = () => view(false);
  document.querySelector('#detail').onclick = () => view(true);
  window.addEventListener('resize', render);
  view(false);
  status.textContent = `32 variantes verificadas · ${map.landmarks.length} hitos · ${renderer.info.render.calls} llamadas de dibujo`;
  status.title = `${checked} Terrain build: ${groundMs} ms`;
} catch (error) { status.textContent = `FAIL: ${error.message}`; console.error(error); }
