import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getWorkspaceTemplates,
  setProfileWorkspaceTemplate,
  workspaceTemplateForProfile,
  workspaceTemplateLabel,
} from '../src/local-profiles-core.js';

const syntheticState = {
  defaultTemplateKey: 'overview',
  templates: [
    {
      key: 'overview',
      roleLabel: 'Керівник',
      title: 'Оперативне зведення',
      landingView: 'dash',
      dashboardSection: 'p-kpis',
    },
    {
      key: 'entry',
      roleLabel: 'Оператор внесення',
      title: 'Внесення доповідей',
      landingView: 'entry',
      dashboardSection: null,
    },
  ],
  assignments: [{
    profileId: 'profile-000000000000000000000001',
    templateKey: 'entry',
    updatedAt: '2026-01-01T00:00:00Z',
  }],
};

test('workspace template helpers use dedicated desktop commands', async () => {
  const calls = [];
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    return syntheticState;
  };

  await getWorkspaceTemplates(invoke);
  await setProfileWorkspaceTemplate(
    'profile-000000000000000000000001',
    'entry',
    invoke,
  );

  assert.deepEqual(calls, [
    ['get_workspace_templates', undefined],
    ['set_profile_workspace_template', {
      profileId: 'profile-000000000000000000000001',
      templateKey: 'entry',
    }],
  ]);
});

test('workspace template resolution uses explicit assignment then safe default', () => {
  assert.equal(
    workspaceTemplateForProfile(
      syntheticState,
      'profile-000000000000000000000001',
    )?.key,
    'entry',
  );
  assert.equal(
    workspaceTemplateForProfile(
      syntheticState,
      'profile-000000000000000000000002',
    )?.key,
    'overview',
  );
  assert.equal(workspaceTemplateForProfile(syntheticState, null), null);
  assert.equal(workspaceTemplateForProfile({ ...syntheticState, templates: [] }, 'x'), null);
});

test('workspace labels describe presentation and make no permission claim', () => {
  const template = workspaceTemplateForProfile(
    syntheticState,
    'profile-000000000000000000000001',
  );
  assert.equal(workspaceTemplateLabel(template), 'Оператор внесення — Внесення доповідей');
  assert.equal(workspaceTemplateLabel(null), 'Шаблон не вибрано');
  assert.doesNotMatch(workspaceTemplateLabel(template), /доступ|дозвіл|авториз/i);
});
