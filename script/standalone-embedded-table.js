// Іде в кінець кожного автономного файлу (script/build_standalone.mjs). Якщо застосунок
// поклав у тег #easywar-embedded-table копію таблиці («Файл для телефона» → «Вбудувати
// таблицю»), цей сценарій відкриває її в дашборді одразу після завантаження сторінки.
// Порожній тег — нічого не робить: тоді таблицю обирають кнопкою «Відкрити таблицю…».
(function (doc, win) {
  var tag = doc.getElementById('easywar-embedded-table');
  if (!tag || !String(tag.textContent || '').trim()) return;
  var payload;
  try { payload = JSON.parse(tag.textContent); } catch (error) { return; }
  if (!payload || payload.v !== 1 || typeof payload.data !== 'string' || !payload.data) return;

  function decode(base64) {
    var binary = win.atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function stamp(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return two(date.getDate()) + '.' + two(date.getMonth() + 1) + '.' + date.getFullYear() +
      ' ' + two(date.getHours()) + ':' + two(date.getMinutes());
  }

  function open(av) {
    var name = String(payload.name || 'table.xlsx');
    return Promise.resolve(av.connect(decode(payload.data), name, null)).then(function () {
      var when = stamp(payload.exportedAt);
      if (typeof av.toast === 'function') {
        av.toast('Відкрито вбудовану таблицю «' + name + '»' + (when ? ' (станом на ' + when + ')' : ''), 'ok');
      }
    }).catch(function (error) {
      if (typeof av.showError === 'function') av.showError('Не вдалося відкрити вбудовану таблицю: ' + (error && error.message || error));
    });
  }

  // Дашборд виставляє window.__AV після ініціалізації; чекаємо на нього до 30 с.
  var tries = 0;
  (function wait() {
    var av = win.__AV;
    if (av && typeof av.connect === 'function') { open(av); return; }
    tries += 1;
    if (tries < 300) win.setTimeout(wait, 100);
  })();
})(document, window);
