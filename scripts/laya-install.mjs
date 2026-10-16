// ADR-027: installs Laya's ONNX export by hand until it is hosted for the in-app download.
// Usage: node scripts/laya-install.mjs <folder with encoder.onnx, head.onnx, ...>
// Every file must match the size and SHA-256 pinned in models.json, or nothing is installed.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import MODELS from '../src/main/voice/local/models.json' with { type: 'json' };

const ID = 'laya-multilingual';
const from = process.argv[2];
if (!from) throw new Error('usage: node scripts/laya-install.mjs <export folder>');
if (!process.env.APPDATA) throw new Error('APPDATA is not set; run this in Windows PowerShell.');
const to = join(process.env.APPDATA, 'Jarvis', 'models', ID);

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });

const { files } = MODELS[ID];
for (const f of files) {
  const src = join(from, f.path);
  if (!existsSync(src))
    throw new Error(`${f.path} is missing from ${from}; nothing was installed.`);
  if (statSync(src).size !== f.size || (await sha256(src)) !== f.sha256)
    throw new Error(`${f.path} doesn't match the pinned export; nothing was installed.`);
}
// Copy to .part first: a half-copied file must never look installed. Close Jarvis first, since
// Windows won't replace a model file the running app has open.
await mkdir(to, { recursive: true });
for (const f of files) await copyFile(join(from, f.path), join(to, `${f.path}.part`));
for (const f of files) await rename(join(to, `${f.path}.part`), join(to, f.path));
console.log(`Laya installed in ${to}`);
