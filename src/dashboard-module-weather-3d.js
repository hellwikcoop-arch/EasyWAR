// 3D-рельєф для картки «Метеоумови»: справжні висоти України (heights.png із map-assets, SRTM)
// з мідними ізогіпсами на темному тлі, хмари над пунктами між НМХ і ВМХ, кільця небезпеки й
// шпильки з підписами — у стилі погодних дашбордів. Працює офлайн; завантажується лише на вимогу.
// Чиста логіка (розбір висот, проєкція, розкладка хмар) — у dashboard-module-weather-core.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  RELIEF_EXAGGERATION, RELIEF_META, cloudPuffs, decodeHeights, reliefProject, reliefSize, reliefY, sampleRelief, smoothHeights,
} from './dashboard-module-weather-core.js';

const HEIGHTS_URL = 'map-assets/heights.png';
/** Крок ізогіпс у метрах; кожна п'ята — товща. */
const CONTOUR_STEP = 50;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

/** Висоти один раз на сесію: файл ~2,5 МБ, розбір — до сітки ~340 × 233. */
let reliefPromise = null;
function loadRelief() {
  reliefPromise ??= (async () => {
    const response = await fetch(new URL(HEIGHTS_URL, document.baseURI));
    if (!response.ok) throw new Error(`heights.png: ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    // Розміри беремо до close(): після нього ширина й висота знімка нульові.
    const { width, height } = bitmap;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const { data } = context.getImageData(0, 0, width, height);
    return smoothHeights(decodeHeights(data, width, height, 5), 2);
  })().catch(error => { reliefPromise = null; throw error; });
  return reliefPromise;
}

const TERRAIN_VERTEX = /* glsl */`
  attribute float aHeight;
  attribute float aLand;
  varying float vHeight;
  varying float vLand;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vHeight = aHeight;
    vLand = aLand;
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const TERRAIN_FRAGMENT = /* glsl */`
  uniform float uStep;
  uniform vec3 uCopper;
  uniform vec3 uBase;
  uniform vec3 uWater;
  uniform vec3 uLight;
  varying float vHeight;
  varying float vLand;
  varying vec3 vNormal;
  varying vec3 vWorld;
  // Лінія рівня з антиаліасингом; там, де лінії густіші за піксель, вона гасне, а не рябить.
  float contour(float value, float width) {
    float w = fwidth(value);
    float f = abs(fract(value - 0.5) - 0.5);
    return (1.0 - smoothstep(0.0, w * width, f)) * (1.0 - smoothstep(0.3, 0.7, w));
  }
  void main() {
    float light = 0.45 + 0.75 * max(dot(normalize(vNormal), normalize(uLight)), 0.0);
    float inside = smoothstep(0.2, 0.8, vLand);
    float sea = 1.0 - smoothstep(-2.0, 0.5, vHeight);
    float minor = contour(vHeight / uStep, 1.2);
    float major = contour(vHeight / (uStep * 5.0), 1.8);
    float tint = clamp(vHeight / 900.0, 0.0, 1.0);
    vec3 ground = mix(uBase, uBase * 1.9 + uCopper * 0.08, tint) * light;
    vec3 lines = uCopper * (0.7 + 0.8 * tint);
    vec3 color = ground + lines * (minor * 0.5 + major * 0.95) * mix(0.3, 1.0, inside) * (1.0 - sea);
    // Море — синім, як вода в референсі.
    color = mix(color, uWater * (0.5 + 0.3 * light), sea * 0.88);
    // Поза Україною — приглушено: висоти є, але фокус на своїй території.
    color *= mix(0.45, 1.0, max(inside, sea));
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const CLOUD_VERTEX = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  uniform float uTime;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.15 + position.z * 0.05) * 2.5;
    p.z += cos(uTime * 0.12 + position.x * 0.05) * 2.5;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uScale / -view.z;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * view;
  }
`;

const CLOUD_FRAGMENT = /* glsl */`
  uniform sampler2D uMap;
  varying float vAlpha;
  void main() {
    vec4 texel = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vec3(0.9, 0.93, 1.0), min(1.0, texel.a * vAlpha * 1.7));
    #include <colorspace_fragment>
  }
`;

/** М'яка «клубна» текстура хмари, намальована на канві (без файлів). */
function puffTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const blob = (x, y, r, a) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(255,255,255,${a})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  };
  blob(64, 64, 60, 0.55);
  blob(46, 58, 34, 0.45);
  blob(80, 54, 30, 0.4);
  blob(66, 78, 32, 0.35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Підпис пункту як спрайт сталого екранного розміру. */
function labelSprite(lines, tone) {
  const scale = 2;
  const font = `600 ${12 * scale}px system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = font;
  const width = Math.ceil(Math.max(...lines.map(line => context.measureText(line).width)) + 16 * scale);
  const height = (lines.length * 15 + 8) * scale;
  canvas.width = width;
  canvas.height = height;
  context.font = font;
  context.fillStyle = tone === 'bad' ? 'rgba(226,64,80,0.92)' : 'rgba(47,107,255,0.9)';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#f4f8ff';
  context.textBaseline = 'top';
  lines.forEach((line, index) => {
    context.globalAlpha = index ? 0.86 : 1;
    context.fillText(line, 8 * scale, (5 + index * 15) * scale);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }));
  const pixels = 0.0011;
  sprite.scale.set(width * pixels / scale, height * pixels / scale, 1);
  sprite.center.set(0, 0);
  sprite.renderOrder = 10;
  return sprite;
}

function terrainMesh(relief) {
  const { width, depth } = reliefSize();
  const cols = relief?.cols ?? 2;
  const rows = relief?.rows ?? 2;
  const geometry = new THREE.PlaneGeometry(width, depth, cols - 1, rows - 1);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const heights = new Float32Array(position.count);
  const land = new Float32Array(position.count);
  for (let index = 0; index < position.count; index += 1) {
    const metres = relief ? relief.heights[index] : 0;
    heights[index] = metres;
    land[index] = relief ? relief.land[index] : 1;
    position.setY(index, reliefY(metres));
  }
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setAttribute('aLand', new THREE.BufferAttribute(land, 1));
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    uniforms: {
      uStep: { value: CONTOUR_STEP },
      uCopper: { value: new THREE.Color('#e3a565') },
      uBase: { value: new THREE.Color('#1a2033') },
      uWater: { value: new THREE.Color('#2f6fe0') },
      uLight: { value: new THREE.Vector3(-0.4, 1, 0.35) },
    },
  });
  return new THREE.Mesh(geometry, material);
}

/** Шар погоди одного кадру: хмари, шпильки з підписами й кільця небезпеки. */
function weatherLayer(frame, relief, puffMap) {
  const group = new THREE.Group();
  const positions = [];
  const sizes = [];
  const alphas = [];
  let assumed = 0;
  for (const station of frame.stations) {
    const ground = sampleRelief(relief, station.longitude, station.latitude);
    const centre = reliefProject(station.longitude, station.latitude);
    const groundY = reliefY(ground);
    const cloud = cloudPuffs(station, ground);
    if (cloud.assumed) assumed += 1;
    for (const puff of cloud.puffs) { positions.push(puff.x, puff.y, puff.z); sizes.push(puff.size); alphas.push(puff.alpha); }
    const top = cloud.puffs.length ? reliefY(ground + cloud.lower) : groundY + 18;
    const pin = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(centre.x, groundY, centre.z), new THREE.Vector3(centre.x, top, centre.z)]);
    group.add(new THREE.Line(pin, new THREE.LineBasicMaterial({ color: station.tone === 'bad' ? 0xff5d6c : 0xcfe0ff, transparent: true, opacity: 0.55 })));
    const base = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshBasicMaterial({ color: station.tone === 'bad' ? 0xff5d6c : station.tone === 'warn' ? 0xffb84d : 0x9fd3ff }));
    base.rotation.x = -Math.PI / 2;
    base.position.set(centre.x, groundY + 0.6, centre.z);
    group.add(base);
    const label = labelSprite([station.label, station.callout], station.tone);
    label.position.set(centre.x, top + 2, centre.z);
    group.add(label);
    if (station.tone) {
      // Кільця небезпеки: що гірша видимість, то ширші; червоні — небезпечно, сині — увага.
      const color = station.tone === 'bad' ? 0xff5d6c : 0x5a8cff;
      const reach = Number.isFinite(station.visibility) ? Math.max(30, 140 - station.visibility * 10) : 80;
      [0.45, 0.75, 1].forEach((ratio, index) => {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(reach * ratio - 2, reach * ratio, 96),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 - index * 0.22, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(centre.x, groundY + 1.2 + index * 0.2, centre.z);
        group.add(ring);
      });
    }
  }
  if (positions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms: { uMap: { value: puffMap }, uScale: { value: 400 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    const clouds = new THREE.Points(geometry, material);
    clouds.name = 'clouds';
    clouds.renderOrder = 5;
    group.add(clouds);
  }
  group.userData.assumed = assumed;
  return group;
}

function disposeTree(root) {
  root.traverse(node => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      material.map?.dispose?.();
      material.dispose?.();
    }
  });
}

function summaryStrip(frame) {
  return el('dl', { class: 'ewmc-wx-strip' }, frame.summary.map(cell => el('div', { class: `ewmc-wx-cell${cell.tone ? ` ${cell.tone}` : ''}`, title: `${cell.label} (${cell.note})` },
    el('dt', { text: cell.label }), el('dd', { text: cell.valueText }))));
}

/**
 * Відкриває 3D-рельєф на весь екран для моделі картки (`weatherModel`). Закривається кнопкою або
 * Escape; усі ресурси WebGL звільняються. Без WebGL показує пояснення замість сцени.
 */
export async function openWeatherRelief({ model, title = 'Метеоумови', returnFocus = null } = {}) {
  const frames = model?.frames ?? [];
  if (!frames.length) throw new Error('Немає спостережень із часом і координатами.');
  let current = Number.isInteger(model.current) ? model.current : frames.length - 1;

  const canvasHost = el('div', { class: 'ewmc-wx3d-canvas' });
  const timeText = el('span', { class: 'ewmc-wx3d-time' });
  const alert = el('span', { class: 'ewmc-wx-alert calm' });
  const slider = el('input', { type: 'range', min: 0, max: frames.length - 1, step: 1, value: current, 'aria-label': 'Момент спостереження', disabled: frames.length < 2 });
  const stripHost = el('div');
  const note = el('p', { class: 'ewmc-wx3d-note' });
  const closeButton = el('button', { type: 'button', class: 'btn quiet ewmc-wx3d-close', text: 'Закрити' });
  const dialog = el('dialog', { class: 'ewmc-wx3d', 'aria-label': `${title}: 3D-рельєф` },
    el('div', { class: 'ewmc-wx3d-shell' },
      el('header', { class: 'ewmc-wx3d-head' },
        el('div', {}, el('h2', { text: title }), el('p', { text: 'Перетягуйте, щоб обертати; коліщатко — наблизити.' })),
        alert,
        closeButton),
      canvasHost,
      el('footer', { class: 'ewmc-wx3d-foot' }, timeText, slider, el('span'), stripHost)));
  canvasHost.append(note);
  document.body.append(dialog);
  dialog.showModal();

  let renderer = null;
  let frameId = 0;
  let resizeObserver = null;
  let controls = null;
  let scene = null;
  let layer = null;
  let relief = null;
  let reliefNote = '';
  const puffMap = puffTexture();

  const close = () => { if (dialog.open) dialog.close(); };
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    cancelAnimationFrame(frameId);
    resizeObserver?.disconnect();
    controls?.dispose();
    if (scene) disposeTree(scene);
    puffMap.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss?.();
    dialog.remove();
    returnFocus?.focus?.();
  }, { once: true });

  const showFrame = index => {
    current = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[current];
    timeText.textContent = frame.label;
    alert.className = `ewmc-wx-alert ${frame.tone || 'calm'}`;
    alert.textContent = frame.hazardText || 'Небезпечних явищ немає';
    stripHost.replaceChildren(summaryStrip(frame));
    if (!scene) return;
    if (layer) { scene.remove(layer); disposeTree(layer); }
    layer = weatherLayer(frame, relief, puffMap);
    scene.add(layer);
    const assumed = layer.userData.assumed;
    note.textContent = [
      reliefNote,
      `Висоти — SRTM (NASA/USGS), ~600 м на піксель; вертикаль перебільшено в ${RELIEF_EXAGGERATION} разів. Хмари — між НМХ і ВМХ над рельєфом.`,
      assumed ? `Для ${assumed} пункт(ів) межі хмар не вказано — показано типові 600–1400 м.` : '',
    ].filter(Boolean).join(' ');
  };
  slider.addEventListener('input', () => showFrame(Number(slider.value)));
  showFrame(current);

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    canvasHost.append(el('p', { class: 'ewmc-wx3d-fail', text: '3D недоступне на цьому комп’ютері (немає WebGL). Карта з ізолініями на дашборді показує ті самі дані.' }));
    return dialog;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasHost.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', `Рельєф України з хмарами: ${title}`);
  renderer.domElement.tabIndex = 0;

  try {
    relief = await loadRelief();
  } catch {
    reliefNote = 'Висоти рельєфу не завантажено — показано пласку карту.';
  }
  if (!dialog.open) return dialog;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070d1f, 1500, 3200);
  scene.add(terrainMesh(relief));
  const { width, depth } = reliefSize();
  const camera = new THREE.PerspectiveCamera(38, 1, 5, 6000);
  // Погляд з південного заходу на центр України, як на референсі: рельєф під кутом, море попереду.
  const centre = reliefProject(31.4, 48.6);
  camera.position.set(centre.x - 160, 820, centre.z + 1080);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(centre.x, 0, centre.z + 40);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.32;
  controls.minDistance = 120;
  controls.maxDistance = Math.max(width, depth) * 1.8;
  controls.update();
  showFrame(current);

  const resize = () => {
    const box = canvasHost.getBoundingClientRect();
    if (!box.width || !box.height) return;
    renderer.setSize(box.width, box.height, false);
    camera.aspect = box.width / box.height;
    camera.updateProjectionMatrix();
  };
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasHost);
  resize();

  const started = performance.now();
  const loop = () => {
    frameId = requestAnimationFrame(loop);
    const clouds = layer?.getObjectByName('clouds');
    if (clouds) {
      clouds.material.uniforms.uTime.value = (performance.now() - started) / 1000;
      // Розмір клубів у пікселях залежить від висоти полотна.
      clouds.material.uniforms.uScale.value = canvasHost.clientHeight * 0.9;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  loop();
  return dialog;
}

export const dashboardModuleWeather3d = { openWeatherRelief, RELIEF_META };
