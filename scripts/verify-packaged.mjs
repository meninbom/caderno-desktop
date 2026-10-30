import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const packageDir = process.argv[2] || process.env.CADERNO_PACKAGE_DIR || 'release';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const archive = path.join(root, packageDir, 'win-unpacked', 'resources', 'app.asar');
const extracted = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'caderno-asar-verify-'));
asar.extractAll(archive, extracted);
const files = [
  ['dist/caderno.png', path.join(root, 'dist', 'caderno.png')],
  ...fs.readdirSync(path.join(root, 'dist', 'assets')).map(name => [`dist/assets/${name}`, path.join(root, 'dist', 'assets', name)]),
  ...fs.readdirSync(path.join(root, 'dist', 'font-licenses')).map(name => [`dist/font-licenses/${name}`, path.join(root, 'dist', 'font-licenses', name)]),
  ['dist-electron/main.cjs', path.join(root, 'dist-electron', 'main.cjs')],
  ['dist-electron/preload.cjs', path.join(root, 'dist-electron', 'preload.cjs')],
  ['dist-electron/attachment-worker.cjs', path.join(root, 'dist-electron', 'attachment-worker.cjs')],
  ['dist-electron/transcription-worker.cjs', path.join(root, 'dist-electron', 'transcription-worker.cjs')],
  ['dist-electron/ocr-winrt.ps1', path.join(root, 'dist-electron', 'ocr-winrt.ps1')],
];
for (const [archivePath, builtPath] of files) {
  const packed = fs.readFileSync(path.join(extracted, archivePath));
  assert.deepEqual(packed, fs.readFileSync(builtPath), `${archivePath} difere do build verificado`);
  console.log(`MATCH ${archivePath} ${packed.length} bytes`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
const sourcePkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, sourcePkg.version);
assert.equal(fs.existsSync(path.join(extracted,'models','ggml-tiny.bin')),false,'modelo Whisper local não pode entrar no pacote');
assert.equal(fs.existsSync(path.join(extracted,'whisper-cli.exe')),false,'binário Whisper local não pode entrar no pacote');
console.log(`MATCH package.json version ${pkg.version}`);
