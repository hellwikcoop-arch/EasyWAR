/* Чиста логіка технологічного шару стартового екрана (start-tech.js): мережа вузлів на canvas,
   підсвітка картки під курсором, показ годинника. Без DOM, щоб тестувати окремо від UI. */

export const LINK_DISTANCE = 150;
export const MIN_NODES = 24;
export const MAX_NODES = 90;
const AREA_PER_NODE = 22000;
const MAX_SPEED = 0.018; // px за мс

/** Кількість вузлів пропорційна площі екрана, у межах [MIN_NODES, MAX_NODES]. */
export function nodeCount(width, height) {
  const area = Math.max(0, width) * Math.max(0, height);
  return Math.min(MAX_NODES, Math.max(MIN_NODES, Math.round(area / AREA_PER_NODE)));
}

/** Вузли з випадковими позицією, швидкістю й фазою мерехтіння; rand — джерело [0, 1) для детермінованих тестів. */
export function createNodes(count, width, height, rand = Math.random) {
  return Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2;
    const speed = MAX_SPEED * (0.35 + 0.65 * rand());
    return {
      x: rand() * width,
      y: rand() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 0.8 + rand() * 1.4,
      phase: rand() * Math.PI * 2,
    };
  });
}

const wrap = (value, size) => ((value % size) + size) % size;

/** Зсуває вузли на dt мс; хто вийшов за край, з'являється з протилежного боку. */
export function stepNodes(nodes, width, height, dt) {
  const step = Math.min(Math.max(dt, 0), 64); // після паузи вкладки не стрибаємо
  for (const node of nodes) {
    node.x = wrap(node.x + node.vx * step, width);
    node.y = wrap(node.y + node.vy * step, height);
  }
  return nodes;
}

/** Прозорість лінії між двома вузлами: ближче — яскравіше, далі за maxDistance — немає лінії. */
export function linkAlpha(distance, maxDistance = LINK_DISTANCE) {
  if (!(distance >= 0) || distance >= maxDistance) return 0;
  const k = 1 - distance / maxDistance;
  return +(k * k * 0.42).toFixed(4);
}

/** Пари вузлів, з'єднаних лінією: [i, j, alpha]. */
export function links(nodes, maxDistance = LINK_DISTANCE) {
  const out = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      if (Math.abs(dx) >= maxDistance || Math.abs(dy) >= maxDistance) continue;
      const alpha = linkAlpha(Math.hypot(dx, dy), maxDistance);
      if (alpha > 0) out.push([i, j, alpha]);
    }
  }
  return out;
}

/** Позиція курсора всередині картки у відсотках (для CSS-змінних --ew-mx / --ew-my). */
export function spotlight(rect, clientX, clientY) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return { x: 50, y: 50 };
  const clamp = (v) => Math.min(100, Math.max(0, v));
  return {
    x: +clamp(((clientX - rect.left) / rect.width) * 100).toFixed(1),
    y: +clamp(((clientY - rect.top) / rect.height) * 100).toFixed(1),
  };
}

/** Чи анімувати шар: не анімуємо при «зменшити рух», у прихованій вкладці і коли відкрито модуль. */
export function shouldAnimate({ reducedMotion = false, documentHidden = false, activeBranch = '' } = {}) {
  return !reducedMotion && !documentHidden && !activeBranch;
}

const pad = (n) => String(n).padStart(2, '0');

/** Рядки годинника в куті екрана: «03:07:26» і «19.10.2026». */
export function clockText(date) {
  return {
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    date: `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`,
  };
}
