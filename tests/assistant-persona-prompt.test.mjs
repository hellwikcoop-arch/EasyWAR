import assert from 'node:assert/strict';
import test from 'node:test';
import { identityReply, KOMBAT_GROUNDED_PROMPT, KOMBAT_NAME, KOMBAT_ROLE } from '../src/assistant/assistant-persona-prompt-core.js';
import { classifyQuery, runDialogueTurn } from '../src/assistant/assistant-dialogue-core.js';

test('persona is loaded into the grounded dialogue prompt', () => {
  assert.equal(KOMBAT_NAME, 'Комбат');
  assert.equal(KOMBAT_ROLE, 'AI-помічник EasyWAR');
  assert.match(KOMBAT_GROUNDED_PROMPT, /віртуальний український командир/u);
  assert.match(KOMBAT_GROUNDED_PROMPT, /Не вигадуй/u);
});

test('direct identity and provider questions receive truthful deterministic answers', async () => {
  for (const query of ['Хто ти?', 'Ти людина?', 'Яка у тебе модель?', 'Хто твій провайдер?', 'Ти використовуєш Anthropic API?']) {
    assert.equal(classifyQuery(query).kind, 'identity', query);
    const turn = await runDialogueTurn({ query, index: null, generate: () => { throw new Error('model must not handle identity'); } });
    assert.equal(turn.result.origin, 'persona');
    assert.match(turn.answer, /AI-помічник EasyWAR/u);
    assert.match(turn.answer, /зовнішній провайдер зараз не використовується/u);
  }
  assert.match(identityReply('Хто твій провайдер?', 'anthropic').text, /Anthropic Claude Sonnet 5\.5/u);
  assert.equal(identityReply('Як зробити резервну копію?'), null);
});

test('domain questions that mention models, API or «інші» stay with the help index', () => {
  for (const query of ['Яка модель літака в ПС?', 'Яка модель ПУ використовується в РВ?', 'Що таке API ключ?',
    'Що робити, якщо інші поля порожні?', 'Що за 3D-модель у довіднику?', 'Який штучний інтелект у каталозі?']) {
    assert.equal(identityReply(query), null, query);
    assert.notEqual(classifyQuery(query).kind, 'identity', query);
  }
  for (const query of ['Ти ШІ?', 'Що ти таке?', 'Ви людина?', 'На якій моделі ти працюєш?', 'Ти бот?']) {
    assert.equal(classifyQuery(query).kind, 'identity', query);
  }
});
