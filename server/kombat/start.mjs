import { BudgetLedger, createKombatProxy } from './proxy.mjs';

// Operator-only service. It binds loopback and starts with the promotion disabled.
// A separate authenticated gateway and verified credit balance are required before public use.
const { ANTHROPIC_API_KEY, KOMBAT_ADMIN_TOKEN, KOMBAT_LEDGER_PATH } = process.env;
const capCents = Number(process.env.KOMBAT_BUDGET_CENTS);
if (!ANTHROPIC_API_KEY || !KOMBAT_ADMIN_TOKEN || !KOMBAT_LEDGER_PATH) throw new Error('missing-configuration');
const ledger = new BudgetLedger(KOMBAT_LEDGER_PATH, capCents);
await ledger.start();
const allowedOrigins = (process.env.KOMBAT_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
const server = createKombatProxy({ ledger, apiKey: ANTHROPIC_API_KEY, adminToken: KOMBAT_ADMIN_TOKEN, allowedOrigins,
  allowEnable: process.env.KOMBAT_ENABLE_AFTER_JE_APPROVAL === '1' });
const port = Number(process.env.KOMBAT_PORT || 8765);
server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await ledger.close(); process.exit(0); }));
