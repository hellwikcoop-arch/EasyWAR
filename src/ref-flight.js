// Політ ракет залпу в «Інтерактивній моделі» довідника: старт з труби (спалах, хмара пилу позаду), розгін двигуном із полум’ям
// і димовим слідом, пологий поворот під дією тяжіння й влучання в рельєф; кришки, що злітають з труб, — Debris. Числа перенесено з
// артефактів автора моделей; метри сцени, а не ТТХ зразка. Сцену ракета бачить у системі світу (метри), а висоту землі дає ландшафт.
import { AdditiveBlending, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Sprite, SpriteMaterial, Vector3 } from 'three';
import { clamp } from './ref-fx.js';

// boost — час роботи двигуна (с), acc — прискорення (м/с²), flame — розмір полум’я (м), tail — де від центра ракети починається полум’я,
// dust — скільки клубів пилу піднімає струмінь (розміром dustSize, розкиданих на spread метрів), flash — розмір спалаху влучання (м).
// Необов’язкові: smoke — клуби диму біля дула при старті, puff — розмір димового сліду, soft — частка прискорення першої половини
// секунди (м’який старт), bend — після 1,6 с ракета хилиться в бік польоту (вертикальний пуск), range — межа польоту (м).
// Вільха й Сапсан — процедурні моделі з тими самими полями.
export const ROCKETS = {
  gmlrs: { name: 'GMLRS', boost: 2.2, acc: 22, flame: 2.4, dust: 12, flash: 12, tail: 2.3 },
  atacms: { name: 'ATACMS', boost: 3.2, acc: 28, flame: 3.4, dust: 18, flash: 22, tail: 2.3 },
  olkha: { name: 'Вільха', boost: 3, acc: 34, flame: 3, dust: 9, dustSize: 1.2, spread: 5, flash: 14, tail: 5.3, smoke: 4, soft: .35, procedural: { length: 7.4, radius: .14, kind: 'rocket' } },
  otrk: { name: 'Сапсан', boost: 4.6, acc: 30, flame: 5.5, dust: 26, dustSize: 2, spread: 9, flash: 30, tail: 5.7, smoke: 10, puff: 1.8, soft: .35, bend: true, range: 330, procedural: { length: 7, radius: .42, kind: 'otrk' } },
};

const X_AXIS = new Vector3(1, 0, 0);
const MAX_RANGE = 190, MAX_LIFE = 14, G = 9.8;

// Проста ракета з циліндра, носового конуса, сопла й чотирьох стабілізаторів: ніс у +X, центр у нулі, довжина length метрів.
export function proceduralRocket({ length, radius, kind = 'rocket' }) {
  const g = new Group(), paint = new MeshStandardMaterial({ color: kind === 'otrk' ? '#6d745f' : '#8a8f84', metalness: .3, roughness: .6 });
  const dark = new MeshStandardMaterial({ color: '#2a2c2c', metalness: .4, roughness: .5 });
  const cone = length * .16, body = length - cone;
  const tube = new Mesh(new CylinderGeometry(radius, radius, body, 20), paint);
  tube.rotation.z = -Math.PI / 2; tube.position.x = -length / 2 + body / 2;
  const nose = new Mesh(new CylinderGeometry(radius * .08, radius, cone, 20), paint);
  nose.rotation.z = -Math.PI / 2; nose.position.x = length / 2 - cone / 2;
  const nozzle = new Mesh(new CylinderGeometry(radius * .8, radius * .55, length * .05, 16), dark);
  nozzle.rotation.z = -Math.PI / 2; nozzle.position.x = -length / 2 + length * .025;
  g.add(tube, nose, nozzle);
  const span = radius * 1.4, chord = length * .12;
  for (let i = 0; i < 4; i++) {
    const arm = new Group(), fin = new Mesh(new BoxGeometry(chord, span, radius * .12), dark);
    fin.position.set(-length / 2 + chord / 2 + length * .03, radius + span / 2 - radius * .1, 0);
    arm.rotation.x = i * Math.PI / 2;
    arm.add(fin); g.add(arm);
  }
  return g;
}

// Ракети в польоті. parent — група світу (метри); fx — пул частинок; ground(x, z) — висота рельєфу; scar(x, y, z, r) — слід від вибуху.
export class Flight {
  constructor({ parent, fx, ground = () => 0, scar = null, glow }) {
    this.parent = parent; this.fx = fx; this.ground = ground; this.scar = scar; this.list = []; this.glow = glow;
    this.flameMat = new SpriteMaterial({ map: fx.tex, color: '#ffc477', transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.onImpact = null; this.onLaunch = null;
    this.q = new Quaternion();
  }

  get busy() { return this.list.length > 0; }

  // template — модель ракети (ніс +X, центр у нулі), profile — запис ROCKETS, p / d — дуло й напрямок у системі світу; back — на скільки
  // метрів центр ракети лежить позаду дула на старті (ракета, що ховається в трубі, стартує з довжиною пів ракети й запасом).
  launch(template, profile, p, d, { back = 1.7 } = {}) {
    const m = template.clone(true);
    m.position.copy(p).addScaledVector(d, -back);
    m.quaternion.setFromUnitVectors(X_AXIS, d);
    const flame = new Sprite(this.flameMat);
    flame.scale.setScalar(profile.flame);
    flame.position.x = -profile.tail;
    m.add(flame);
    this.parent.add(m);
    // Горизонтальний напрямок пуску: у нього хилиться ракета з вертикальним стартом.
    const az = new Vector3(d.x, 0, d.z);
    if (az.lengthSq() < 1e-4) az.set(1, 0, 0);
    az.normalize();
    const rec = { m, d: d.clone(), v: 0, t: 0, flame, profile, from: p.clone(), smoke: 0, az };
    this.list.push(rec);
    // Хмара пуску: пил, що його струмінь здіймає там, де вісь ракети позаду дула упирається в землю (не ближче 5 м), і спалах біля дула.
    const reach = d.y > .15 ? clamp((p.y - this.ground(p.x, p.z)) / d.y, 5, 40) : 5;
    const at = p.clone().addScaledVector(d, -reach);
    at.y = this.ground(at.x, at.z) + .4;
    const spread = profile.spread || 4;
    for (let i = 0; i < profile.dust; i++) {
      this.fx.puff(at.x + (Math.random() - .5) * spread, at.y + Math.random() * .6, at.z + (Math.random() - .5) * spread,
        { color: '#b9ad8f', size: (profile.dustSize || 1.4) + Math.random() * 2.2, grow: 2.2, life: 2.6 + Math.random() * 1.5, op: .7, vx: (Math.random() - .5) * 2, vy: .5 + Math.random(), vz: (Math.random() - .5) * 2 });
    }
    this.fx.puff(p.x + d.x * .5, p.y + d.y * .5, p.z + d.z * .5, { color: '#ffe3b0', size: profile.flame * 2, grow: 3.5, life: .25, op: 1, add: true });
    for (let i = 0; i < (profile.smoke || 0); i++) {
      this.fx.puff(p.x + (Math.random() - .5) * 2, p.y + (Math.random() - .5) * 1.5, p.z + (Math.random() - .5) * 2,
        { color: '#e3ddd0', size: 2 + Math.random() * 2, grow: 1.8, life: 2.4 + Math.random() * 1.5, op: .55, vy: .6 });
    }
    if (this.onLaunch) this.onLaunch(rec);
    return rec;
  }

  step(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i], pr = r.profile;
      r.t += dt;
      const boost = r.t < pr.boost;
      if (boost) r.v += pr.acc * (pr.soft && r.t < .5 ? pr.soft : 1) * dt;
      else r.flame.visible = false;
      // Ракета з вертикальним стартом після 1,6 с хилиться в бік польоту.
      if (boost && pr.bend && r.t > 1.6) { r.d.addScaledVector(r.az, Math.min(1, (r.t - 1.6) / 3) * dt * .2 * r.v / 18); r.d.normalize(); }
      // Після вигоряння двигуна траєкторія плавно гнеться під тяжінням.
      if (!boost) { r.d.y -= G * dt / Math.max(20, r.v) * .9; r.d.normalize(); }
      r.m.position.addScaledVector(r.d, r.v * dt);
      r.m.quaternion.setFromUnitVectors(X_AXIS, r.d);
      if (r.flame.visible) r.flame.scale.setScalar(pr.flame * (.8 + Math.random() * .4));
      // Димовий слід лише поки працює двигун.
      if (boost) {
        r.smoke += dt * 40;
        while (r.smoke >= 1) {
          r.smoke -= 1;
          if (Math.random() > .6) continue;
          const tail = r.m.position.clone().addScaledVector(r.d, -pr.tail);
          this.fx.puff(tail.x, tail.y, tail.z, { color: '#d9d4c8', size: (pr.puff || .9) + Math.random() * .9, grow: 1.4, life: 2.2 + Math.random() * 2, op: .55, vy: .35 });
        }
      }
      const pos = r.m.position, gy = this.ground(pos.x, pos.z);
      const far = pos.distanceTo(r.from) > (pr.range || MAX_RANGE);
      if (pos.y < gy || r.t > MAX_LIFE || far) {
        if (pos.y < gy + 1 && r.t < MAX_LIFE) this.impact(r, gy);
        else if (this.onImpact) this.onImpact(r, null);
        this.parent.remove(r.m);
        this.list.splice(i, 1);
      }
    }
  }

  impact(r, gy) {
    const pos = r.m.position, big = r.profile.flash;
    this.fx.puff(pos.x, gy + 1, pos.z, { color: '#ffd08a', size: big, grow: 5, life: .5, op: 1, add: true });
    for (let i = 0; i < 14; i++) {
      this.fx.puff(pos.x + (Math.random() - .5) * 4, gy + .5, pos.z + (Math.random() - .5) * 4,
        { color: '#6b6558', size: 3 + Math.random() * 4, grow: 2.5, life: 4, op: .7, vx: (Math.random() - .5) * 3, vy: 1.5 + Math.random() * 2, vz: (Math.random() - .5) * 3 });
    }
    if (this.scar) this.scar(pos.x, gy, pos.z, big * .22);
    if (this.onImpact) this.onImpact(r, Math.round(pos.distanceTo(r.from)));
  }

  clear() {
    for (const r of this.list) this.parent.remove(r.m);
    this.list = [];
  }

  dispose() {
    this.clear();
    this.flameMat.dispose();
  }
}

// Уламки, що злітають з машини (кришки труб): летять балістично, обертаються й зникають за 2,5 с чи на землі. Геометрію й матеріал
// беруть із моделі (їх не вивільняють), тож уламок нічого не копіює. p, q, v, w — положення, поворот, швидкість і кутова швидкість
// у системі світу.
export class Debris {
  constructor({ parent, ground = () => 0 }) { this.parent = parent; this.ground = ground; this.list = []; }

  get busy() { return this.list.length > 0; }

  add(geometry, material, p, q, v, w) {
    const m = new Mesh(geometry, material);
    m.position.copy(p); m.quaternion.copy(q);
    this.parent.add(m);
    this.list.push({ m, v: v.clone(), w: w.clone(), t: 0 });
    return m;
  }

  step(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt;
      o.v.y -= G * dt;
      o.m.position.addScaledVector(o.v, dt);
      o.m.rotation.x += o.w.x * dt; o.m.rotation.y += o.w.y * dt; o.m.rotation.z += o.w.z * dt;
      if (o.t > 2.5 || o.m.position.y < this.ground(o.m.position.x, o.m.position.z)) { this.parent.remove(o.m); this.list.splice(i, 1); }
    }
  }

  clear() {
    for (const o of this.list) this.parent.remove(o.m);
    this.list = [];
  }

  dispose() { this.clear(); }
}
