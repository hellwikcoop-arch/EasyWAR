// Спільне для сцен «Інтерактивної моделі» (ref-sim.js, ref-machine.js): допоміжні функції, текстури-полотна й пул частинок
// диму, пилу та вогню.
import { AdditiveBlending, CanvasTexture, NormalBlending, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

export const D2R = Math.PI / 180;
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// Плавне наближення до цілі: k — швидкість (1/с), не залежить від частоти кадрів.
export const ease = (v, to, k, dt) => v + (to - v) * (1 - Math.exp(-k * dt));
// Плавний вхід і вихід для ходу вузла від 0 до 1.
export const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

export function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// Умовна плитка місцевості 512 px (аеродром, ґрунтова дорога чи поле), яку повторюють по землі. Вісь X полотна — напрямок руху
// (ніс моделі), середина по Y — під моделлю.
export function groundTexture(type) {
  return canvasTexture(512, 512, (x, w, h) => {
    const r = rng(type.length * 977 + 13);
    x.fillStyle = type === 'field' ? '#4d5636' : '#465236';
    x.fillRect(0, 0, w, h);
    const tones = type === 'field' ? ['#5a6139', '#6b6a42', '#44502f', '#73693f', '#525d35'] : ['#4c5a39', '#3f4b31', '#55603d'];
    for (let i = 0; i < (type === 'field' ? 14 : 22); i++) {
      x.fillStyle = tones[i % tones.length];
      x.globalAlpha = type === 'field' ? .9 : .5;
      const pw = 60 + r() * 170, ph = 50 + r() * 150;
      x.fillRect(r() * w - pw / 2, r() * h - ph / 2, pw, ph);
    }
    x.globalAlpha = 1;
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = r() < .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,230,.07)';
      x.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
    }
    if (type === 'airfield') {
      x.fillStyle = '#3b3d3f'; x.fillRect(0, h / 2 - 34, w, 68);
      x.fillStyle = 'rgba(255,255,255,.05)';
      for (let i = 0; i < 900; i++) x.fillRect(r() * w, h / 2 - 34 + r() * 68, 2, 2);
      x.fillStyle = '#d9d6c8';
      x.fillRect(0, h / 2 - 32, w, 2); x.fillRect(0, h / 2 + 30, w, 2);
      for (let i = 0; i < 8; i++) x.fillRect(i * 64 + 8, h / 2 - 2, 36, 4);
    } else if (type === 'road') {
      x.fillStyle = '#6e5f45'; x.fillRect(0, h / 2 - 26, w, 52);
      x.fillStyle = 'rgba(40,30,20,.45)'; x.fillRect(0, h / 2 - 15, w, 6); x.fillRect(0, h / 2 + 9, w, 6);
      for (let i = 0; i < 700; i++) { x.fillStyle = r() < .5 ? 'rgba(0,0,0,.2)' : 'rgba(255,240,200,.1)'; x.fillRect(r() * w, h / 2 - 26 + r() * 52, 3, 2); }
    }
  });
}

// М’яка пляма для диму, пилу й спалахів.
export function softTexture() {
  return canvasTexture(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.45, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
}

// Частинки: дим, пил, вогонь. Спрайти беруться з пулу, тож довгий політ не створює тисяч об’єктів.
export class Fx {
  constructor(parent) {
    this.parent = parent; this.list = []; this.free = { n: [], a: [] }; this.tex = softTexture(); this.quiet = false;
  }

  puff(x, y, z, o = {}) {
    if (this.quiet || this.list.length > 600) return;
    const add = !!o.add, pool = this.free[add ? 'a' : 'n'];
    let p = pool.pop();
    if (!p) p = { s: new Sprite(new SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, blending: add ? AdditiveBlending : NormalBlending })), add };
    p.s.material.color.set(o.color || '#cfcfcf');
    p.s.position.set(x, y, z);
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.size = o.size || .5; p.grow = o.grow ?? 1.2; p.life = o.life || 1.6; p.t = 0; p.op = o.op ?? .55;
    p.s.scale.setScalar(p.size); p.s.material.opacity = 0;
    this.parent.add(p.s);
    this.list.push(p);
  }

  step(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { this.parent.remove(p.s); this.free[p.add ? 'a' : 'n'].push(p); this.list.splice(i, 1); continue; }
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.vx *= 1 - .6 * dt; p.vz *= 1 - .6 * dt;
      p.s.scale.setScalar(p.size * (1 + p.grow * k));
      // Короткий наплив (30 мс), щоб дим біля сопла швидкої ракети був видно одразу.
      p.s.material.opacity = p.op * (1 - k) * Math.min(1, p.t / .03);
    }
  }

  clear() {
    for (const p of this.list) { this.parent.remove(p.s); this.free[p.add ? 'a' : 'n'].push(p); }
    this.list = [];
  }

  dispose() {
    this.clear();
    for (const pool of Object.values(this.free)) for (const p of pool) p.s.material.dispose();
    this.tex.dispose();
  }
}
