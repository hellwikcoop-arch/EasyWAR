import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// script/build_runner.sh runs against synthetic cmake/lipo stand-ins inside a throwaway copy of the
// repository layout (the script resolves its root from its own location), so nothing real is built
// and no sidecar already built in the working tree is touched.
const SCRIPT = fileURLToPath(new URL('../script/build_runner.sh', import.meta.url));
const skip = process.platform === 'win32' ? 'потрібен bash' : false;

function runBuild(triple) {
  const root = mkdtempSync(join(tmpdir(), 'easywar-build-runner-'));
  mkdirSync(join(root, 'script'));
  mkdirSync(join(root, 'runner'));
  copyFileSync(SCRIPT, join(root, 'script', 'build_runner.sh'));
  const bin = join(root, 'stub-bin');
  mkdirSync(bin);
  // Configuring (`-B <dir>`) creates <dir>; `--build <dir>` leaves a fake `runner` in it.
  writeFileSync(
    join(bin, 'cmake'),
    '#!/bin/sh\nif [ "$1" = --build ]; then printf "built:%s\\n" "$(basename "$2")" > "$2/runner"; exit 0; fi\n' +
      'while [ $# -gt 0 ]; do if [ "$1" = -B ]; then mkdir -p "$2"; fi; shift; done\n',
  );
  // `lipo -create <a> <b> -output <out>` concatenates its inputs.
  writeFileSync(join(bin, 'lipo'), '#!/bin/sh\ncat "$2" "$3" > "$5"\n');
  chmodSync(join(bin, 'cmake'), 0o755);
  chmodSync(join(bin, 'lipo'), 0o755);
  const result = spawnSync('bash', [join(root, 'script', 'build_runner.sh'), triple], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  const binaries = join(root, 'src-tauri', 'binaries');
  return {
    result,
    binaries,
    names: existsSync(binaries) ? readdirSync(binaries).sort() : [],
    read: (name) => readFileSync(join(binaries, name), 'utf8'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('universal macOS build leaves a sidecar for each architecture and the stitched one', { skip }, () => {
  const run = runBuild('universal-apple-darwin');
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    // Tauri compiles aarch64 and x86_64 separately and looks up the sidecar for each triple;
    // the bundler then takes the universal file.
    assert.deepEqual(run.names, [
      'easywar-llm-runner-aarch64-apple-darwin',
      'easywar-llm-runner-universal-apple-darwin',
      'easywar-llm-runner-x86_64-apple-darwin',
    ]);
    assert.equal(run.read('easywar-llm-runner-aarch64-apple-darwin'), 'built:aarch64-apple-darwin\n');
    assert.equal(run.read('easywar-llm-runner-x86_64-apple-darwin'), 'built:x86_64-apple-darwin\n');
    assert.equal(run.read('easywar-llm-runner-universal-apple-darwin'), 'built:aarch64-apple-darwin\nbuilt:x86_64-apple-darwin\n');
  } finally {
    run.cleanup();
  }
});

test('single-triple builds produce exactly the file Tauri expects for that triple', { skip }, () => {
  for (const [triple, expected] of [
    ['aarch64-apple-darwin', 'easywar-llm-runner-aarch64-apple-darwin'],
    ['x86_64-apple-darwin', 'easywar-llm-runner-x86_64-apple-darwin'],
    ['x86_64-pc-windows-msvc', 'easywar-llm-runner-x86_64-pc-windows-msvc.exe'],
    ['x86_64-unknown-linux-gnu', 'easywar-llm-runner-x86_64-unknown-linux-gnu'],
  ]) {
    const run = runBuild(triple);
    try {
      assert.equal(run.result.status, 0, `${triple}: ${run.result.stderr}`);
      assert.deepEqual(run.names, [expected], triple);
    } finally {
      run.cleanup();
    }
  }
});

test('an unsupported platform is refused without writing anything', { skip }, () => {
  const run = runBuild('riscv64-unknown-freebsd');
  try {
    assert.equal(run.result.status, 2);
    assert.deepEqual(run.names, []);
  } finally {
    run.cleanup();
  }
});
