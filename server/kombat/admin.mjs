// Operator-only localhost client. Keep KOMBAT_ADMIN_TOKEN in the environment, never in argv.
const token = process.env.KOMBAT_ADMIN_TOKEN;
const port = Number(process.env.KOMBAT_PORT || 8765);
if (!/^[a-f0-9]{64}$/u.test(token || '') || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('missing-admin-configuration');
const [action, argument] = process.argv.slice(2);
const endpoint = `http://127.0.0.1:${port}`;
let path, method = 'GET', body;
if (action === 'status') path = '/admin/status';
else if (action === 'issue' && /^[a-zA-Z0-9_-]{1,64}$/u.test(argument || '')) {
  path = '/admin/tokens'; method = 'POST'; body = JSON.stringify({ label: argument });
} else if (action === 'revoke' && /^[a-f0-9-]{36}$/u.test(argument || '')) {
  path = `/admin/tokens/${argument}/revoke`; method = 'POST';
} else if (action === 'disable' || action === 'enable') { path = `/admin/${action}`; method = 'POST'; }
else throw new Error('usage: admin.mjs status|issue <label>|revoke <id>|disable|enable');
const response = await fetch(`${endpoint}${path}`, {
  method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body,
});
if (!response.ok) throw new Error(`admin-command-failed: ${response.status}`);
if (action === 'issue' || action === 'status') process.stdout.write(`${await response.text()}\n`);
else process.stdout.write(`${action}: ok\n`);
