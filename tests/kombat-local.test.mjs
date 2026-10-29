import assert from 'node:assert/strict';
import test from 'node:test';
import { localPaths, launchAgentPlist } from '../script/kombat-local.mjs';
import { createKombatProxy } from '../server/kombat/proxy.mjs';

test('macOS deployment separates runtime from private budget and admin data', () => {
  const paths = localPaths('/Users/tester');
  assert.equal(paths.data, '/Users/tester/Library/Application Support/EasyWAR/Kombat/data');
  assert.equal(paths.runtime, '/Users/tester/Library/Application Support/EasyWAR/Kombat/runtime');
  assert.equal(paths.plist, '/Users/tester/Library/LaunchAgents/com.hellwikcoop.easywar.kombat.plist');
  assert.notEqual(paths.data, paths.runtime);
});

test('LaunchAgent contains no key, admin token or budget credentials', () => {
  const plist = launchAgentPlist('/usr/local/bin/node', '/Users/tester/Kombat/runtime/server/kombat/local-runner.mjs');
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/u);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/u);
  assert.match(plist, /<key>StandardErrorPath<\/key><string>\/dev\/null<\/string>/u);
  assert.doesNotMatch(plist, /ANTHROPIC_API_KEY|KOMBAT_ADMIN_TOKEN|sk-ant-|admin-token|ledger\.json/u);
  assert.match(launchAgentPlist('/node', '/some/<unsafe>&path'), /&lt;unsafe&gt;&amp;path/u);
});

test('disabled proxy can start without a provider key, but an approved gate requires one', () => {
  const config = { ledger: { state: {} }, apiKey: '', adminToken: 'a'.repeat(64) };
  assert.doesNotThrow(() => createKombatProxy(config));
  assert.throws(() => createKombatProxy({ ...config, allowEnable: true }), /proxy-not-configured/u);
});
