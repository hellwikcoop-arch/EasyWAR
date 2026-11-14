// Калькулятори штурмана: поля мають лишатися вузлами DOM, а не рядком «[object Object]».
import test from 'node:test';
import assert from 'node:assert/strict';

class MiniNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
}
class MiniElement extends MiniNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.listeners = {};
    this.dataset = {};
    this.id = '';
    this.classList = { add() {}, remove() {}, toggle() {} };
    this._value = '';
  }
  set className(value) { this.attrs.class = value; }
  get className() { return this.attrs.class || ''; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) {
    for (const fn of this.listeners[event.type] || []) fn({ ...event, target: this, currentTarget: this });
    return true;
  }
  set value(value) { this._value = value == null ? '' : String(value); }
  get value() { return this._value; }
  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  set textContent(value) { this._text = String(value); this.childNodes = []; }
  get textContent() {
    if (this.childNodes.length) return this.childNodes.map(node => node.textContent ?? '').join('');
    return this._text || '';
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const all = [];
    const walk = node => { all.push(node); for (const child of node.childNodes) if (child.tagName) walk(child); };
    walk(this);
    const tag = selector.toUpperCase();
    return all.filter(node => node.tagName === tag);
  }
}
class MiniText extends MiniNode {
  constructor(text) { super(); this.nodeType = 3; this.textContent = String(text); }
}

globalThis.Node = MiniNode;
globalThis.Element = MiniElement;
globalThis.document = {
  createElement: tag => new MiniElement(tag),
  createElementNS: (_ns, tag) => new MiniElement(tag),
  createTextNode: text => new MiniText(text),
};

const { render } = await import('../src/workspace/easyfly/views/calculators.js');

const EXPECT = {
  'Вітер': 'Звідки',
  'Шляхова швидкість': 'Шляхова',
  'МПР': 'МПР',
  'Коробочка': 'Радіус розвороту',
  'Майданчик': 'Вихід на пряму',
  'Зниження': 'Початок від майданчика',
};

test('кожна вкладка калькулятора малює поля і результат, без [object Object]', async () => {
  let view;
  const ctx = { go() {}, rerender() { view = render(ctx); } };
  view = render(ctx);
  assert.match(view.textContent, /Назад/);
  assert.equal(view.textContent.includes('Довідково'), false);
  const tabs = view.querySelectorAll('button').filter(node => EXPECT[node.textContent]);
  assert.equal(tabs.length, Object.keys(EXPECT).length);
  for (const tab of tabs) {
    tab.dispatchEvent(new Event('click'));
    const text = view.textContent;
    assert.equal(text.includes('[object Object]'), false, tab.textContent);
    assert.ok(view.querySelectorAll('input').length >= 2, `${tab.textContent}: поля`);
    assert.match(text, new RegExp(EXPECT[tab.textContent]), tab.textContent);
  }
});
