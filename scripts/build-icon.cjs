const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

// Use Electron's native image exporter, with no additional image dependencies.
if (typeof electron === 'string') {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(electron, [__filename], { env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const root = path.resolve(__dirname, '..');
const source = electron.nativeImage.createFromPath(path.join(root, 'build/caderno.png'));
if (source.isEmpty()) throw new Error('Logo PNG inválida');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = sizes.map(size => source.resize({ width: size, height: size, quality: 'best' }).toPNG());
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const n = 6 + i * 16;
  header[n] = sizes[i] === 256 ? 0 : sizes[i];
  header[n + 1] = header[n];
  header.writeUInt16LE(1, n + 4);
  header.writeUInt16LE(32, n + 6);
  header.writeUInt32LE(frames[i].length, n + 8);
  header.writeUInt32LE(offset, n + 12);
  offset += frames[i].length;
}
fs.writeFileSync(path.join(root, 'build/icon.ico'), Buffer.concat([header, ...frames]));
fs.copyFileSync(path.join(root, 'build/caderno.png'), path.join(root, 'src/public/caderno.png'));
console.log(`Windows icon: ${sizes.join(', ')} px`);
electron.app.exit(0);
