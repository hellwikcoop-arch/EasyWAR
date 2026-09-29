// Спільна сцена для тривимірних моделей EasyWAR: рендерер, студійне освітлення (ключове світло з тінню, контровий і
// заповнювальний), відбиття кімнати для металу й полярна сітка з тінню на підлозі.
// Її використовують картка вильоту (munition-3d.js) і довідник по озброєнню (ref-viewer.js).
import {
  ACESFilmicToneMapping, CanvasTexture, CircleGeometry, Color, DirectionalLight, Group, Mesh, MeshBasicMaterial,
  PMREMGenerator, PolarGridHelper, ShadowMaterial, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const FLOOR_Y = -1.05;

function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

export function createRenderer({ powerPreference = 'low-power' } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = .88;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  return renderer;
}

// Додає до сцени світло, відбиття й підлогу. Повертає групу підлоги: її можна опустити чи підняти
// (floor.position.y) і розтягнути пляму під моделлю (contact.scale).
export function addStageEnvironment(renderer, scene, { shadowSize = 3.4 } = {}) {
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .65;
  const key = new DirectionalLight('#fff6ea', 2);
  key.position.set(1.8, 7, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 1, far: 16 });
  key.shadow.bias = -.0004; key.shadow.normalBias = .015; key.shadow.radius = 5;
  scene.add(key);
  const rim = new DirectionalLight('#8fc2c2', 1.1); rim.position.set(-5, 2.5, -4); scene.add(rim);
  const fill = new DirectionalLight('#dfe8f2', .35); fill.position.set(-3, -1, 5); scene.add(fill);
  const floor = new Group();
  floor.position.y = FLOOR_Y;
  const grid = new PolarGridHelper(6.5, 16, 7, 96, new Color('#5c8a8a'), new Color('#5c8a8a'));
  grid.material.transparent = true; grid.material.opacity = .22; floor.add(grid);
  const disc = new Mesh(new CircleGeometry(6.5, 64), new MeshBasicMaterial({ color: '#07090b', transparent: true, opacity: .55 }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = -.01; floor.add(disc);
  const catcher = new Mesh(new CircleGeometry(6.5, 64), new ShadowMaterial({ color: '#000000', opacity: .5 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = .002; catcher.receiveShadow = true; floor.add(catcher);
  const contact = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = .004; contact.scale.set(2.6, 1, 1); floor.add(contact);
  scene.add(floor);
  return { floor, contact };
}
