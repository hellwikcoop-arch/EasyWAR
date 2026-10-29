// macOS LaunchAgent entry point. Secrets never appear in the plist or command line.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, userInfo } from 'node:os';

const data = join(homedir(), 'Library', 'Application Support', 'EasyWAR', 'Kombat', 'data');
const adminToken = (await readFile(join(data, 'admin-token'), 'utf8')).trim();
if (!/^[a-f0-9]{64}$/u.test(adminToken)) throw new Error('invalid-local-admin-token');

// A missing or locked Keychain item is acceptable while the real API gate is closed.
const keyResult = spawnSync('/usr/bin/security', ['find-generic-password', '-a', userInfo().username,
  '-s', 'EasyWAR.Kombat.AnthropicAPI', '-w'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
const apiKey = keyResult.status === 0 ? keyResult.stdout.trim() : '';
process.env.ANTHROPIC_API_KEY = apiKey;
process.env.KOMBAT_ADMIN_TOKEN = adminToken;
process.env.KOMBAT_LEDGER_PATH = join(data, 'ledger.json');
process.env.KOMBAT_BUDGET_CENTS = '200';
process.env.KOMBAT_ALLOWED_ORIGINS = 'tauri://localhost';
process.env.KOMBAT_PORT = '8765';
delete process.env.KOMBAT_ENABLE_AFTER_JE_APPROVAL;

await import('./start.mjs');
