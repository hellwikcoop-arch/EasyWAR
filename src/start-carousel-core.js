// Чиста логіка каруселі стартового екрана: сторінки прокрутки, підписи категорій карток.
// Без DOM, щоб перевіряти в node --test. Показ — start-carousel.js, стилі — start-carousel.css.

// Підпис-категорія у кутку картки: усі картки однакові за розміром, тож командування
// від роду військ відрізняє лише цей рядок.
export const CATEGORY = Object.freeze({
  command: 'Командування',
  branch: 'Рід військ',
  custom: 'Без роду військ',
});

export function cardCategory({ command = false, branch = '' } = {}) {
  if (command) return CATEGORY.command;
  if (branch === 'custom') return CATEGORY.custom;
  return CATEGORY.branch;
}

// Скільки «сторінок» (екранів) у стрічці: ширина прокрутки / видима ширина; дрібний залишок (< 8 px) не рахується.
export function pageCount(scrollWidth, clientWidth) {
  if (!(clientWidth > 0) || !(scrollWidth > 0)) return 1;
  return Math.max(1, Math.ceil((scrollWidth - 8) / clientWidth));
}

// Поточна сторінка за зсувом прокрутки.
export function currentPage(scrollLeft, clientWidth, pages) {
  if (!(clientWidth > 0)) return 0;
  const page = Math.round(Math.max(0, scrollLeft) / clientWidth);
  return Math.min(Math.max(0, pages - 1), page);
}

// Зсув прокрутки для сторінки: остання сторінка впирається в кінець стрічки.
export function pageOffset(page, clientWidth, scrollWidth) {
  const max = Math.max(0, scrollWidth - clientWidth);
  return Math.min(max, Math.max(0, page) * clientWidth);
}

export function stepPage(page, direction, pages) {
  return Math.min(Math.max(0, pages - 1), Math.max(0, page + Math.sign(direction)));
}

// Колесо миші: вертикальний рух перетворюється на горизонтальну прокрутку стрічки, якщо вона є.
export function wheelDelta({ deltaX = 0, deltaY = 0 } = {}) {
  return Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
}
