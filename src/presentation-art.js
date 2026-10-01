/* Графіка презентації (вирізані зображення на прозорому тлі). Вбудовується у файл як PNG.
   Без графіки презентація будується так само, лише без ілюстрацій. */

const FILES = {
  soldiers: new URL('./presentation-art/soldiers.png', import.meta.url),
  f16: new URL('./presentation-art/f16.png', import.meta.url),
  himars: new URL('./presentation-art/himars.png', import.meta.url),
};

const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** { soldiers, f16, himars } → 'image/png;base64,…'. Помилка завантаження одного файлу не ламає решту. */
export async function loadArt() {
  const art = {};
  for (const [key, url] of Object.entries(FILES)) {
    try {
      const response = await fetch(url);
      if (response.ok) art[key] = `image/png;base64,${toBase64(new Uint8Array(await response.arrayBuffer()))}`;
    } catch { /* без цієї ілюстрації */ }
  }
  return art;
}
