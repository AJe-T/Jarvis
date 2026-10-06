// Dev tool: pins the local voice models (ADR-011) to exact revisions and SHA-256 hashes.
// Run when bumping a model: `node scripts/make-model-manifest.mjs` → src/main/voice/local/models.json
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const HF = 'https://huggingface.co';
const WHISPER = {
  'whisper-base.en': 'onnx-community/whisper-base.en',
  'whisper-small.en': 'onnx-community/whisper-small.en',
  'whisper-small': 'onnx-community/whisper-small',
};
const WHISPER_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
const OWW = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1';
const SILERO =
  'https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx';

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function hashOf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length };
}

const models = {};
for (const [id, repo] of Object.entries(WHISPER)) {
  const { sha } = await json(`${HF}/api/models/${repo}`);
  const tree = [
    ...(await json(`${HF}/api/models/${repo}/tree/${sha}`)),
    ...(await json(`${HF}/api/models/${repo}/tree/${sha}/onnx`)),
  ];
  const files = [];
  for (const path of WHISPER_FILES) {
    const entry = tree.find((f) => f.path === path);
    if (!entry) throw new Error(`${repo}: missing ${path}`);
    const url = `${HF}/${repo}/resolve/${sha}/${path}`;
    const pinned = entry.lfs ? { sha256: entry.lfs.oid, size: entry.lfs.size } : await hashOf(url);
    files.push({ path, url, ...pinned });
  }
  models[id] = {
    kind: 'whisper',
    source: `${repo}@${sha}`,
    license: 'Apache-2.0 (OpenAI Whisper weights: MIT)',
    files,
  };
}

const ownFiles = async (entries) => {
  const out = [];
  for (const [path, url] of entries) out.push({ path, url, ...(await hashOf(url)) });
  return out;
};
models['openwakeword-hey-jarvis'] = {
  kind: 'wake',
  source: 'dscripka/openWakeWord v0.5.1',
  license: 'Code Apache-2.0; models CC BY-NC-SA 4.0 (non-commercial)',
  files: await ownFiles([
    ['melspectrogram.onnx', `${OWW}/melspectrogram.onnx`],
    ['embedding_model.onnx', `${OWW}/embedding_model.onnx`],
    ['hey_jarvis_v0.1.onnx', `${OWW}/hey_jarvis_v0.1.onnx`],
  ]),
};
models['silero-vad'] = {
  kind: 'vad',
  source: 'snakers4/silero-vad v6.2.3',
  license: 'MIT',
  files: await ownFiles([['silero_vad.onnx', SILERO]]),
};

writeFileSync('src/main/voice/local/models.json', `${JSON.stringify(models, null, 2)}\n`);
for (const [id, m] of Object.entries(models))
  console.log(id, `${(m.files.reduce((a, f) => a + f.size, 0) / 1e6).toFixed(1)} MB`);
