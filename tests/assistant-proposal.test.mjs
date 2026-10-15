import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProposal, proposalFileNames, validateProposalText, validateProposalImage, PROPOSAL_TEXT_LIMIT } from '../src/assistant/assistant-proposal-core.js';

const date = new Date(2026, 9, 15, 16, 21);

test('пакет містить тип, модуль, елемент, версію й опис, але не значення', () => {
  const md = buildProposal({ kind: 'feature', text: 'Додати експорт у CSV', context: { branch: 'dshv', title: 'Втрати о/с разом', value: '128' }, appVersion: '1.4.2', createdAt: date, imageName: 'a.png' });
  assert.match(md, /Тип: Нова функція/u);
  assert.match(md, /Модуль: УДШВ/u);
  assert.match(md, /Елемент: Втрати о\/с разом/u);
  assert.match(md, /Версія: 1\.4\.2/u);
  assert.match(md, /Додати експорт у CSV/u);
  assert.match(md, /Скриншот додається окремим файлом: a\.png/u);
  assert.ok(!md.includes('128'));
});

test('невалідні версія, модуль і керівні символи не потрапляють у пакет', () => {
  const md = buildProposal({ kind: 'невідомий', text: 'Текст\u0000 опису', context: { branch: 'x', title: '' }, appVersion: '<script>' });
  assert.match(md, /Тип: Правка або помилка/u);
  assert.ok(!md.includes('Модуль:') && !md.includes('Версія:') && !md.includes('\u0000'));
});

test('перевірка тексту й скриншота', () => {
  assert.equal(validateProposalText('ок').ok, false);
  assert.equal(validateProposalText('x'.repeat(PROPOSAL_TEXT_LIMIT + 1)).ok, false);
  assert.equal(validateProposalText('Нормальний опис').ok, true);
  assert.equal(validateProposalImage(null).ok, true);
  assert.equal(validateProposalImage({ type: 'image/png', size: 1000 }).ok, true);
  assert.equal(validateProposalImage({ type: 'application/pdf', size: 1000 }).ok, false);
  assert.equal(validateProposalImage({ type: 'image/png', size: 11 * 1024 * 1024 }).ok, false);
});

test('імена файлів збігаються за основою', () => {
  const names = proposalFileNames(date, { type: 'image/jpeg' });
  assert.equal(names.text, 'easywar-propozytsiia-20261015-1621.md');
  assert.equal(names.image, 'easywar-propozytsiia-20261015-1621-skryn.jpg');
  assert.equal(proposalFileNames(date, null).image, null);
});
