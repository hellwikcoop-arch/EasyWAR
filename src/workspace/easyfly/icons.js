// Значки EasyFLY: внутрішність SVG (viewBox 24×24, обведення currentColor, товщина 1,5).
// Взято з референсів «etap-1/icons» (без метаданих); рядки статичні, значень користувача тут немає.
export const ICONS = Object.freeze({
  'blokuie': '<path d="M12 2 22 20H2zM12 9v5m0 3h.01"/>',
  'borttekhnik': '<path d="M5 4h14v16H5zM5 10h14M9 13h6M12 10v9"/>',
  'bz-hmv': '<path d="M3 17h18M6 17V8l6-4 6 4v9M9 11h6M12 8v7"/>',
  'diysno': '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  'druk': '<path d="M6 9V3h12v6M6 17H4V9h16v8h-2M6 14h12v7H6zM17 11h.01"/>',
  'excel': '<path d="M5 3h14v18H5zM9 9l6 6m0-6-6 6M5 6h14M5 18h14"/>',
  'filtr': '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  'import-excel': '<path d="M4 3h10l5 5v13H4zM14 3v5h5M8 12l7 6m0-6-7 6"/>',
  'kalendar': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18M7 15h3"/>',
  'ke': '<circle cx="12" cy="12" r="9"/><path d="M12 5v14M5 12h14M9 9l3-4 3 4"/>',
  'khronometrazh': '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M9 2h6M12 2v3"/>',
  'lsh': '<circle cx="12" cy="12" r="9"/><path d="m6 16 10-10-2 6 4 2-6 2-2 2z"/>',
  'moi-piloty': '<circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M17 7a3 3 0 0 1 0 6M18 15a4 4 0 0 1 3 4v1"/>',
  'nahaduvannia': '<path d="M6 17h12l-2-3V9a4 4 0 0 0-8 0v5zM10 20a2 2 0 0 0 4 0M12 3v2"/>',
  'nalashtuvannia': '<path d="M10 2.5h4l.6 2.3 1.8.8 2.1-1.1 2 3.5-1.8 1.8v2.4l1.8 1.8-2 3.5-2.1-1.1-1.8.8L14 21.5h-4l-.6-2.3-1.8-.8-2.1 1.1-2-3.5 1.8-1.8v-2.4L3.5 10l2-3.5 2.1 1.1 1.8-.8z"/><circle cx="12" cy="12" r="3"/>',
  'nazad': '<path d="M19 12H5m7-7-7 7 7 7"/>',
  'nemaie-danykh': '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8"/>',
  'ovp': '<path d="M3 17 9 8l4 5 3-7 5 11M3 20h18"/>',
  'parashut': '<path d="M3 10a9 9 0 0 1 18 0H3ZM3 10l9 9 9-9M12 10v9M9 21h6"/>',
  'pmo': '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>',
  'poshuk': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  'prostrocheno': '<circle cx="12" cy="12" r="9"/><path d="M12 7v7m0 3h.01"/>',
  'prylady': '<path d="M4 19a9 9 0 1 1 16 0zM12 16l4-7M7 16h.01M17 16h.01"/>',
  'shturman': '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-3 7-4 0 3-7z"/><circle cx="12" cy="12" r="1"/>',
  'skoro': '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  'sontse-misiats': '<circle cx="8" cy="10" r="3"/><path d="M8 2v2m0 12v2M1 10h3m8 0h3M3.5 5.5l1.4 1.4m6.2 6.2 1.4 1.4M16 4a8 8 0 1 0 5 14A8.6 8.6 0 0 1 16 4Z"/>',
  'stattya-205': '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  'tekhnika-pilotuvannia': '<circle cx="12" cy="12" r="9"/><path d="M12 5v14M5 12h14m-10-3 3-4 3 4M9 15l3 4 3-4"/>',
  'vidkryty': '<path d="M6 5H4v15h16V9M13 4h7v7M20 4l-9 9"/>',
  'vlk': '<path d="M4 12h4l2-5 4 10 2-5h4"/><path d="M12 3 3 7v6c0 5 4 7 9 9 5-2 9-4 9-9V7z"/>',
  'vnesty': '<path d="M12 4v16M4 12h16"/>',
  'vtracheno': '<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8m0-8-8 8"/>',
  'zakryty': '<path d="M5 5l14 14M19 5 5 19"/>',
  'zberehty': '<path d="M4 3h14l3 3v15H3V3zM7 3v7h10V3M7 21v-8h10v8"/>',
  'zvedennia': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  'chevron': '<path d="m9 6 6 6-6 6"/>',
  'more': '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
});

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG-елемент значка за назвою (aria-hidden: поруч завжди є текстовий підпис). */
export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ef-icon');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}
