// Адреси ілюстрацій «Силует і контур» (src/ref-art/<id>-sil.webp, <id>-lin.webp).
// Окремий модуль: import.meta.glob існує лише у збірці Vite, тому ref-wiki.js підвантажує його динамічно
// й без нього (тести в Node) просто не показує розділ.
export const ART_URLS = import.meta.glob('./ref-art/*.webp', { eager: true, query: '?url', import: 'default' });
