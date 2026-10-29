#!/usr/bin/env node
// Install and control a localhost-only Kombat LaunchAgent on macOS.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, open, readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'com.hellwikcoop.easywar.kombat';
const FILES = ['server/kombat/start.mjs', 'server/kombat/proxy.mjs', 'server/kombat/admin.mjs',
  'server/kombat/local-runner.mjs', 'src/assistant/assistant-persona-prompt-core.js', 'src/assistant/kombat-persona.json'];

export function localPaths(home = homedir()) {
  const base = join(home, 'Library', 'Application Support', 'EasyWAR', 'Kombat');
  return { base, data: join(base, 'data'), runtime: join(base, 'runtime'),
    plist: join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`), service: `gui/${process.getuid()}/${LABEL}` };
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export function launchAgentPlist(nodePath, runnerPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(runnerPath)}</string></array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>/dev/null</string>\n<key>StandardErrorPath</key><string>/dev/null</string>\n</dict></plist>\n`;
}

function launchctl(args, { allowFailure = false } = {}) {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || (!allowFailure && result.status !== 0)) throw new Error(`launchctl-${args[0]}-failed`);
  return result;
}

function loaded(paths) { return launchctl(['print', paths.service], { allowFailure: true }).status === 0; }

async function install(paths) {
  if (loaded(paths)) throw new Error('stop-kombat-before-install');
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  await chmod(paths.base, 0o700); await chmod(paths.data, 0o700);
  for (const file of FILES) {
    const destination = join(paths.runtime, file);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(join(SOURCE, file), destination);
    await chmod(destination, 0o600);
  }
  const adminPath = join(paths.data, 'admin-token');
  try {
    const handle = await open(adminPath, 'wx', 0o600);
    try { await handle.writeFile(`${randomBytes(32).toString('hex')}\n`); } finally { await handle.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!/^[a-f0-9]{64}$/u.test((await readFile(adminPath, 'utf8')).trim())) throw new Error('invalid-local-admin-token');
  await chmod(adminPath, 0o600);
  await mkdir(dirname(paths.plist), { recursive: true, mode: 0o700 });
  await writeFile(paths.plist, launchAgentPlist(process.execPath, join(paths.runtime, 'server/kombat/local-runner.mjs')), { mode: 0o600 });
  await chmod(paths.plist, 0o600);
  process.stdout.write('Комбат встановлений локально; сервіс вимкнено до команди start.\n');
}

async function admin(paths, command, argument) {
  const token = (await readFile(join(paths.data, 'admin-token'), 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/u.test(token)) throw new Error('invalid-local-admin-token');
  const args = [join(paths.runtime, 'server/kombat/admin.mjs'), command, ...(argument ? [argument] : [])];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, KOMBAT_ADMIN_TOKEN: token, KOMBAT_PORT: '8765' } });
  if (result.status !== 0) throw new Error('admin-command-failed');
}

export async function main([command, argument] = process.argv.slice(2)) {
  if (process.platform !== 'darwin') throw new Error('macos-only');
  const paths = localPaths();
  if (command === 'install') return install(paths);
  if (command === 'start') {
    if (loaded(paths)) { process.stdout.write('Комбат уже запущений.\n'); return; }
    launchctl(['enable', paths.service]);
    launchctl(['bootstrap', `gui/${process.getuid()}`, paths.plist]);
    process.stdout.write('Комбат запущений на 127.0.0.1:8765; реальний API вимкнено.\n');
    return;
  }
  if (command === 'stop') {
    launchctl(['disable', paths.service]);
    if (loaded(paths)) launchctl(['bootout', `gui/${process.getuid()}`, paths.plist]);
    process.stdout.write('Комбат зупинений; автозапуск вимкнено.\n');
    return;
  }
  if (command === 'status') {
    process.stdout.write(`launchd: ${loaded(paths) ? 'завантажено' : 'зупинено'}; адреса: 127.0.0.1:8765; ліміт: $2.00; реальний API вимкнено.\n`);
    return;
  }
  if (['issue', 'revoke', 'disable'].includes(command)) return admin(paths, command, argument);
  throw new Error('usage: node script/kombat-local.mjs install|start|stop|status|issue <label>|revoke <id>|disable');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`kombat-local: ${error.message}\n`); process.exitCode = 1; });
}
