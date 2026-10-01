/* Емблеми презентації: ДШВ, «Повітряні Сили», «Сухопутні війська» (PNG). Вбудовуються у файл.
   Без емблем презентація будується так само, лише без них. */

const FILES = {
  'logo-dshv': new URL('./presentation-art/logo-dshv.png', import.meta.url),
  'logo-ps': new URL('./presentation-art/logo-ps.png', import.meta.url),
  'logo-sv': new URL('./presentation-art/logo-sv.png', import.meta.url),
};

const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** { 'logo-dshv', 'logo-ps', 'logo-sv' } → 'image/png;base64,…'. Помилка одного файлу не ламає решту. */
export async function loadArt() {
  const art = {};
  for (const [key, url] of Object.entries(FILES)) {
    try {
      const response = await fetch(url);
      if (response.ok) art[key] = `image/png;base64,${toBase64(new Uint8Array(await response.arrayBuffer()))}`;
    } catch { /* без цієї емблеми */ }
  }
  return art;
}
