// Живий фон стартового екрана: дві процедурні руки тягнуться до курсора («Створення Адама»):
// каркасна червона з верхнього лівого кута й темна суцільна з нижнього правого; позаду — нерухомі зорі
// з повільним мерехтінням. Сцена лежить під брендом і картками (#view-start, z-index −1), не ловить
// кліки й нічого не завантажує: геометрія будується в коді, мережі й сховища немає.
// Поза й зорі рахуються в start-hand-core.js (є тести), тут лише DOM і three.js.
import './start-hand.css';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry,
  DirectionalLight, Euler, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, PerspectiveCamera, Points, PointsMaterial, Quaternion, Scene, SphereGeometry,
  SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  HAND_SCENE, HAND_SHAPE, handLength, handPose, handSceneMode, pointerToCursor, smoothTowards, starBrightness, starField,
} from './start-hand-core.js';

// Кут огляду камери; відстань до площини рук така, що по вертикалі видно рівно [-1, 1].
const FOV_DEG = 30;
const CAMERA_Z = 1 / Math.tan((FOV_DEG * Math.PI) / 360);
const ACCENT = 0xff5a48;
const MAX_DT = 0.05;

function hasWebGL() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

// М'яка пляма для зорі: радіальний градієнт на маленькому полотні.
function starSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// Передпліччя згасає до чорного від зап'ястя до ліктя: рука ніби виходить із темряви.
function fadeAlongX(geometry, xBright, xDark) {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const t = Math.min(1, Math.max(0, (pos.getX(i) - xDark) / (xBright - xDark)));
    const v = t * t;
    colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

// Долоня: заокруглений брусок, звужений до зап'ястя й трохи випуклий на тильному боці.
function palmGeometry(shape) {
  const g = new RoundedBoxGeometry(shape.palmLength, shape.palmWidth, shape.palmThickness, 4, 0.08);
  const pos = g.getAttribute('position');
  const half = shape.palmWidth / 2;
  for (let i = 0; i < pos.count; i += 1) {
    const t = (pos.getX(i) + shape.palmLength / 2) / shape.palmLength;
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const dome = 1 - 0.38 * (y / half) * (y / half);
    pos.setY(i, y * (0.7 + 0.3 * t));
    // Тильний бік (+Z) випуклий, долонний майже плоский; до зап'ястя долоня тонша.
    pos.setZ(i, z * (0.8 + 0.2 * t) * (z > 0 ? 1.25 * dome : 0.85));
  }
  g.computeVertexNormals();
  return g;
}

// Геометрії спільні для обох рук: однакові фаланги й долоня, дзеркальність лише в розміщенні.
function buildGeometries(shape) {
  const capsules = new Map();
  const capsule = (radius, length) => {
    const key = `${radius}:${length}`;
    if (!capsules.has(key)) {
      const g = new CapsuleGeometry(radius, length, 3, 10);
      g.rotateZ(-Math.PI / 2);
      g.translate(length / 2, 0, 0);
      capsules.set(key, g);
    }
    return capsules.get(key);
  };
  const forearm = new CylinderGeometry(shape.forearmRadius.elbow, shape.forearmRadius.wrist, shape.forearmLength, 12, 4, false);
  forearm.rotateZ(Math.PI / 2);
  forearm.scale(1, 1, 0.82);
  forearm.translate(-shape.forearmLength / 2, 0, 0);
  fadeAlongX(forearm, -0.1, -shape.forearmLength * 0.78);
  const wrist = new SphereGeometry(1, 12, 8);
  wrist.scale(0.09, 0.15, 0.065);
  const thenar = new SphereGeometry(1, 10, 7);
  thenar.scale(0.13, 0.085, 0.05);
  return { capsule, forearm, wrist, thenar, palm: palmGeometry(shape) };
}

// Одна рука. thumbSide: +1 — великий палець на +Y, −1 — на −Y (ліва й права рука дзеркальні).
// addPart додає меш (або пару заливка + каркас) до батька.
function buildHand({ shape, geometries, thumbSide, addPart }) {
  const group = new Group();
  addPart(group, geometries.forearm, { fade: true });
  addPart(group, geometries.wrist, {});
  const palm = addPart(group, geometries.palm, {});
  palm.position.x = shape.palmLength / 2;

  const joints = {};
  for (const [name, finger] of Object.entries(shape.fingers)) {
    const chain = [];
    let parent = group;
    let x = shape.palmLength - 0.015;
    finger.phalanges.forEach((length, i) => {
      const joint = new Object3D();
      joint.position.set(x, i === 0 ? thumbSide * finger.y * shape.palmWidth : 0, 0);
      if (i === 0) joint.rotation.z = thumbSide * finger.spread;
      joint.rotation.order = 'ZYX';
      addPart(joint, geometries.capsule(finger.radius[i], length), {});
      parent.add(joint);
      chain.push(joint);
      parent = joint;
      x = length;
    });
    joints[name] = chain;
  }

  // Великий палець: відведений убік і трохи до долоні, згинається до вказівного. Біля основи — м'яз
  // (тенар), щоб палець виростав з долоні, а не стирчав збоку.
  const thumbRoot = new Object3D();
  thumbRoot.position.set(shape.thumb.base.x, thumbSide * shape.thumb.base.y * shape.palmWidth, shape.thumb.base.z);
  thumbRoot.rotation.set(-thumbSide * 0.7, 0.12, thumbSide * shape.thumb.abduction, 'ZXY');
  group.add(thumbRoot);
  const thenar = addPart(group, geometries.thenar, {});
  thenar.position.set(shape.thumb.base.x + 0.06, thumbSide * (shape.thumb.base.y * shape.palmWidth - 0.02), shape.thumb.base.z - 0.01);
  thenar.rotation.z = thumbSide * shape.thumb.abduction * 0.6;
  const thumbChain = [];
  let parent = thumbRoot;
  let x = 0;
  shape.thumb.phalanges.forEach((length, i) => {
    const joint = new Object3D();
    joint.position.set(x, 0, 0);
    addPart(joint, geometries.capsule(shape.thumb.radius[i], length), {});
    parent.add(joint);
    thumbChain.push(joint);
    parent = joint;
    x = length;
  });
  joints.thumb = thumbChain;
  return { group, joints };
}

function applyCurls(hand, curls, shape) {
  for (const [name, chain] of Object.entries(hand.joints)) {
    const angles = name === 'thumb' ? shape.thumbCurlAngles : shape.curlAngles;
    const curl = curls[name] || 0;
    chain.forEach((joint, i) => { joint.rotation.y = curl * angles[i]; });
  }
}

(function startHandScene() {
  const start = document.getElementById('view-start');
  if (!start || start.querySelector('canvas.ew-hand')) return;
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mode = handSceneMode({ reducedMotion: reduced, webgl: hasWebGL() });
  if (mode === 'none') return;

  const canvas = document.createElement('canvas');
  canvas.className = 'ew-hand';
  canvas.setAttribute('aria-hidden', 'true');
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (e) {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  start.prepend(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEG, 16 / 9, 0.1, 30);
  camera.position.z = CAMERA_Z;

  // Зорі: позиції з ядра, мерехтіння — через колір вершин.
  const stars = starField();
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new BufferAttribute(stars.positions, 3));
  const starColors = new Float32Array(stars.count * 3);
  const starColorAttr = new BufferAttribute(starColors, 3);
  starGeometry.setAttribute('color', starColorAttr);
  const starMaterial = new PointsMaterial({
    size: 2.2, sizeAttenuation: false, map: starSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  scene.add(new Points(starGeometry, starMaterial));
  const warm = new Color(0xffd9c4);
  const cool = new Color(0xcfe3ff);
  const tmpColor = new Color();
  function twinkle(timeSec) {
    for (let i = 0; i < stars.count; i += 1) {
      const b = starBrightness(stars.phases[i], stars.speeds[i], timeSec) * (stars.sizes[i] > 2 ? 1 : 0.8);
      tmpColor.copy(cool).lerp(warm, stars.tints[i]).multiplyScalar(b);
      starColors[i * 3] = tmpColor.r; starColors[i * 3 + 1] = tmpColor.g; starColors[i * 3 + 2] = tmpColor.b;
    }
    starColorAttr.needsUpdate = true;
  }

  // Світло лише для суцільної руки: холодне небо, тепле контрове з боку каркасної руки.
  scene.add(new HemisphereLight(0x46597a, 0x04060a, 0.7));
  const rim = new DirectionalLight(0xff8a70, 0.9);
  rim.position.set(-2.2, 1.6, 0.9);
  scene.add(rim);
  const key = new DirectionalLight(0x9fc0e6, 0.45);
  key.position.set(1.4, 1.2, 2.5);
  scene.add(key);

  const geometries = buildGeometries(HAND_SHAPE);
  const wireMaterial = new MeshBasicMaterial({ color: ACCENT, wireframe: true, transparent: true, opacity: 0.5, depthWrite: false });
  const wireFadeMaterial = wireMaterial.clone();
  wireFadeMaterial.vertexColors = true;
  const fillMaterial = new MeshBasicMaterial({
    color: 0x14090b, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2,
  });
  const solidMaterial = new MeshStandardMaterial({ color: 0x1a2230, roughness: 0.9, metalness: 0, flatShading: true });
  const solidFadeMaterial = solidMaterial.clone();
  solidFadeMaterial.vertexColors = true;

  const wireHand = buildHand({
    shape: HAND_SHAPE, geometries, thumbSide: -1,
    addPart(parent, geometry, { fade }) {
      const fill = new Mesh(geometry, fillMaterial);
      const wire = new Mesh(geometry, fade ? wireFadeMaterial : wireMaterial);
      fill.add(wire);
      parent.add(fill);
      return fill;
    },
  });
  const solidHand = buildHand({
    shape: HAND_SHAPE, geometries, thumbSide: 1,
    addPart(parent, geometry, { fade }) {
      const mesh = new Mesh(geometry, fade ? solidFadeMaterial : solidMaterial);
      parent.add(mesh);
      return mesh;
    },
  });
  scene.add(wireHand.group, solidHand.group);

  const tipOffset = new Vector3();
  const tipWorld = new Vector3();
  const euler = new Euler();
  const quaternion = new Quaternion();
  const length = handLength(HAND_SHAPE);
  function placeHand(hand, pose) {
    euler.set(pose.roll, -pose.pitch, pose.angle, 'ZYX');
    quaternion.setFromEuler(euler);
    hand.group.quaternion.copy(quaternion);
    tipOffset.set(length, 0, 0).applyQuaternion(quaternion);
    // Кінчик пальця виступає до камери; щоб на екрані він стояв там, де рахує ядро, ділимо на перспективу.
    const k = (CAMERA_Z - tipOffset.z) / CAMERA_Z;
    tipWorld.set(pose.tip.x * k, pose.tip.y * k, tipOffset.z);
    hand.group.position.copy(tipWorld).sub(tipOffset);
    applyCurls(hand, pose.curls, HAND_SHAPE);
  }

  let width = 1;
  let height = 1;
  function resize() {
    const w = Math.max(1, start.clientWidth || window.innerWidth);
    const h = Math.max(1, start.clientHeight || window.innerHeight);
    if (w === width && h === height) return false;
    width = w; height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    return true;
  }

  const cursor = { x: HAND_SCENE.restTarget.x, y: HAND_SCENE.restTarget.y };
  const target = { x: cursor.x, y: cursor.y };
  let hasPointer = false;
  function pose(timeSec) {
    const aspect = width / height;
    placeHand(wireHand, handPose({ cursor, aspect, side: 'left', timeSec }));
    placeHand(solidHand, handPose({ cursor, aspect, side: 'right', timeSec }));
  }
  function renderStatic() {
    resize();
    twinkle(0);
    pose(0);
    renderer.render(scene, camera);
  }

  if (mode === 'static') {
    renderStatic();
    window.addEventListener('resize', renderStatic);
    return;
  }

  let rafId = 0;
  let lastNow = 0;
  let clock = 0;
  function frame(now) {
    rafId = 0;
    if (!isActive()) return;
    const dt = lastNow ? Math.min(MAX_DT, (now - lastNow) / 1000) : 0;
    lastNow = now;
    clock += dt;
    resize();
    const goal = hasPointer ? target : HAND_SCENE.restTarget;
    cursor.x = smoothTowards(cursor.x, goal.x, dt);
    cursor.y = smoothTowards(cursor.y, goal.y, dt);
    twinkle(clock);
    pose(clock);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  // Сцена спить, коли вкладку не видно, стартовий екран схований за модулем або стоїть екран входу.
  function isActive() {
    return !document.hidden && start.style.display !== 'none' && !document.documentElement.classList.contains('ew-locked');
  }
  function wake() {
    if (rafId || !isActive()) return;
    lastNow = 0;
    rafId = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', wake);
  new MutationObserver(wake).observe(start, { attributes: true, attributeFilter: ['style'] });
  new MutationObserver(wake).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('pointermove', (event) => {
    const c = pointerToCursor({ clientX: event.clientX, clientY: event.clientY, width, height });
    target.x = c.x; target.y = c.y;
    hasPointer = true;
  }, { passive: true });
  // Курсор вийшов за вікно (relatedTarget порожній) або вікно втратило фокус: руки повертаються в спокій.
  window.addEventListener('pointerout', (event) => { if (!event.relatedTarget) hasPointer = false; });
  window.addEventListener('blur', () => { hasPointer = false; });
  wake();
})();
