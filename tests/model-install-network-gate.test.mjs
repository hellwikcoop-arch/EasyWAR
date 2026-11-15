// Контракт авторитетного Rust-допуску перед завантаженням AI-моделі.
// Без реального інтернету, секретів і нативних діалогів.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('завантаження моделі проходить Rust-політику й нативне підтвердження', async () => {
  const [lib, installer] = await Promise.all([
    read('src-tauri/src/lib.rs'),
    read('src-tauri/src/model_install.rs'),
  ]);
  assert.match(lib, /async fn install_local_model\([\s\S]*?window: tauri::WebviewWindow/);
  assert.match(lib, /window\.label\(\) != network_policy::MAIN_WINDOW_LABEL/);
  assert.match(lib, /model_install::consent_under_network_policy\(/);
  assert.match(lib, /model_install::install_model\(&source, &dir, &guard, emit, consent\)/);
  assert.match(installer, /pub fn consent_under_network_policy\(/);
  assert.match(installer, /let confirmed = ask\(prompt\);/);
  assert.match(installer, /crate::network_policy::Purpose::ModelInstall/);
  assert.match(installer, /confirm_download\(&consent, source, have\)\.await\?;/);
});
