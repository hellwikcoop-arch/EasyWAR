// Тривимірні моделі боєприпасів (three.js) завантажуються лише тоді, коли вперше відкривають
// картку вильоту: решта модуля «Повітряні Сили» від них не важчає.
let loading = null;
window.Munition3D = {
  mount(el, kind, options) {
    if (!loading) loading = import('./munition-3d.js');
    return loading.then(m => m.mount(el, kind, options));
  },
};
