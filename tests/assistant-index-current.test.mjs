import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildKnowledgeIndex, serializeKnowledgeIndex, KNOWLEDGE_SOURCE_FILES } from '../src/assistant/assistant-knowledge-core.js';

test('the shipped documentation index is generated from the current allowlisted sources', async () => {
  const root = new URL('../', import.meta.url);
  const documents = await Promise.all(KNOWLEDGE_SOURCE_FILES.map(async file => ({ file, markdown: await readFile(new URL(file, root), 'utf8') })));
  const shipped = await readFile(new URL('src/assistant/knowledge/index.json', root), 'utf8');
  assert.equal(shipped, serializeKnowledgeIndex(buildKnowledgeIndex(documents)));
});
