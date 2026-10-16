// Dev tool: pins the local voice models (ADR-011) to exact revisions and SHA-256 hashes.
// Run when adding a model: `node scripts/make-model-manifest.mjs` → src/main/voice/local/models.json
// Models already in models.json keep their pins (installed copies stay valid); `--refresh` re-pins
// everything to the newest revision. Only metadata and small JSON files are fetched: the hashes of
// the big model files come from Hugging Face's LFS index, so nothing large is downloaded.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const HF = 'https://huggingface.co';
const OUT = 'src/main/voice/local/models.json';
const REFRESH = process.argv.includes('--refresh');
const existing = JSON.parse(readFileSync(OUT, 'utf8'));
const keep = (id) => !REFRESH && existing[id];

const WHISPER_LICENSE = 'Apache-2.0 (OpenAI Whisper weights: MIT)';
const DISTIL_LICENSE = 'MIT (distil-whisper, Hugging Face)';
const MOONSHINE_LICENSE = 'MIT (Useful Sensors Moonshine)';
const ENC_DEC = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
/**
 * Speech-to-text models for transformers.js's ASR pipeline (Whisper, Moonshine, Parakeet CTC).
 * id → [repo, licence, ONNX files (default: the int8 encoder and merged decoder)].
 */
const ASR = {
  'whisper-tiny.en': ['onnx-community/whisper-tiny.en', WHISPER_LICENSE],
  'whisper-tiny': ['onnx-community/whisper-tiny', WHISPER_LICENSE],
  'whisper-base.en': ['onnx-community/whisper-base.en', WHISPER_LICENSE],
  'whisper-base': ['onnx-community/whisper-base', WHISPER_LICENSE],
  'whisper-small.en': ['onnx-community/whisper-small.en', WHISPER_LICENSE],
  'whisper-small': ['onnx-community/whisper-small', WHISPER_LICENSE],
  'distil-small.en': ['onnx-community/distil-small.en', DISTIL_LICENSE],
  'distil-large-v3.5': ['onnx-community/distil-large-v3.5-ONNX', DISTIL_LICENSE],
  'whisper-large-v3-turbo': ['onnx-community/whisper-large-v3-turbo', WHISPER_LICENSE],
  'moonshine-tiny': ['onnx-community/moonshine-tiny-ONNX', MOONSHINE_LICENSE],
  'moonshine-base': ['onnx-community/moonshine-base-ONNX', MOONSHINE_LICENSE],
  'parakeet-ctc-0.6b': [
    'onnx-community/parakeet-ctc-0.6b-ONNX',
    'CC-BY-4.0 (NVIDIA Parakeet; attribution in THIRD_PARTY_NOTICES.md)',
    ['onnx/model_quantized.onnx', 'onnx/model_quantized.onnx_data'],
  ],
};
const ASR_REQUIRED = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
];
/** Read by the pipeline when the repo has it (Parakeet has no generation config). */
const ASR_OPTIONAL = ['generation_config.json'];

/** Piper voices (VITS, one ONNX file each) from rhasspy/piper-voices; licences from each MODEL_CARD. */
const PIPER_REPO = 'rhasspy/piper-voices';
const PIPER = {
  'piper-en_GB-northern_english_male-medium': 'CC-BY-SA-4.0',
  'piper-en_GB-alan-medium': 'Mycroft Mimic 3 dataset licence',
  'piper-en_GB-cori-high': 'Public domain',
  'piper-en_US-john-medium': 'Public domain',
  'piper-en_US-joe-medium': 'CC0-1.0',
  'piper-en_US-ryan-high': 'CC-BY-NC-SA-4.0 (non-commercial)',
  'piper-hi_IN-pratham-medium': 'CC-BY-NC-SA-4.0 (non-commercial)',
  'piper-hi_IN-priyamvada-medium': 'CC-BY-NC-SA-4.0 (non-commercial)',
  'piper-te_IN-venkatesh-medium': 'CC-BY-4.0',
  'piper-te_IN-padmavathi-medium': 'CC-BY-4.0',
};

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

/**
 * Pins files of a Hugging Face repo at one revision: LFS files from the index, small ones hashed.
 * `local` maps a repo path to where it is stored under models/<id>/.
 */
async function pinRepo(repo, sha, { dirs, paths, optional = [], local = (p) => p }) {
  const tree = (
    await Promise.all(dirs.map((d) => json(`${HF}/api/models/${repo}/tree/${sha}${d}`)))
  ).flat();
  const files = [];
  for (const path of [...paths, ...optional]) {
    const entry = tree.find((f) => f.path === path);
    if (!entry) {
      if (optional.includes(path)) continue;
      throw new Error(`${repo}: missing ${path}`);
    }
    const url = `${HF}/${repo}/resolve/${sha}/${path}`;
    const pinned = entry.lfs ? { sha256: entry.lfs.oid, size: entry.lfs.size } : await hashOf(url);
    files.push({ path: local(path), url, ...pinned });
  }
  return files;
}

const models = {};
for (const [id, [repo, license, onnx = ENC_DEC]] of Object.entries(ASR)) {
  if (keep(id)) continue;
  const { sha } = await json(`${HF}/api/models/${repo}`);
  models[id] = {
    kind: 'asr',
    source: `${repo}@${sha}`,
    license,
    files: await pinRepo(repo, sha, {
      dirs: ['', '/onnx'],
      paths: [...ASR_REQUIRED, ...onnx],
      optional: ASR_OPTIONAL,
    }),
  };
}

const piperTodo = Object.keys(PIPER).filter((id) => !keep(id));
if (piperTodo.length) {
  const { sha } = await json(`${HF}/api/models/${PIPER_REPO}`);
  for (const id of piperTodo) {
    const name = id.slice('piper-'.length); // e.g. en_GB-alan-medium
    const [locale, speaker, quality] = name.split('-');
    const dir = `${locale.split('_')[0]}/${locale}/${speaker}/${quality}`;
    models[id] = {
      kind: 'piper',
      source: `${PIPER_REPO}@${sha} ${dir}`,
      license: PIPER[id],
      files: await pinRepo(PIPER_REPO, sha, {
        dirs: [`/${dir}`],
        paths: [`${dir}/${name}.onnx`, `${dir}/${name}.onnx.json`],
        local: (p) => (p.endsWith('.json') ? 'voice.onnx.json' : 'voice.onnx'),
      }),
    };
  }
}

// Speaker verification (ADR-039): WavLM base plus SV (Microsoft, CC-BY-SA-3.0), ONNX by Xenova.
const SPEAKER = 'Xenova/wavlm-base-plus-sv';
if (!keep('wavlm-speaker')) {
  const { sha } = await json(`${HF}/api/models/${SPEAKER}`);
  models['wavlm-speaker'] = {
    kind: 'speaker',
    source: `${SPEAKER}@${sha}`,
    license: 'CC-BY-SA-3.0 (Microsoft WavLM / UniSpeech)',
    files: await pinRepo(SPEAKER, sha, {
      dirs: ['', '/onnx'],
      paths: ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx'],
    }),
  };
}

// Memory re-ranking (idea from vectorize-io/hindsight): the MS MARCO MiniLM cross-encoder
// (cross-encoder/ms-marco-MiniLM-L-6-v2, Apache-2.0), int8 ONNX by Xenova.
const RERANK = 'Xenova/ms-marco-MiniLM-L-6-v2';
if (!keep('minilm-rerank')) {
  const { sha } = await json(`${HF}/api/models/${RERANK}`);
  models['minilm-rerank'] = {
    kind: 'rerank',
    source: `${RERANK}@${sha}`,
    license: 'Apache-2.0 (cross-encoder/ms-marco-MiniLM-L-6-v2)',
    files: await pinRepo(RERANK, sha, {
      dirs: ['', '/onnx'],
      paths: [
        'config.json',
        'tokenizer.json',
        'tokenizer_config.json',
        'onnx/model_quantized.onnx',
      ],
    }),
  };
}

const ownFiles = async (entries) => {
  const out = [];
  for (const [path, url] of entries) out.push({ path, url, ...(await hashOf(url)) });
  return out;
};
if (!keep('openwakeword-hey-jarvis'))
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
if (!keep('silero-vad'))
  models['silero-vad'] = {
    kind: 'vad',
    source: 'snakers4/silero-vad v6.2.3',
    license: 'MIT',
    files: await ownFiles([['silero_vad.onnx', SILERO]]),
  };

// Kokoro-82M (Apache-2.0): Jarvis's on-device neural voice. fp32, because the int8 build runs
// about 3x slower on CPU. Voices: the four British men, plus a few favourites.
const KOKORO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_VOICES = [
  'bm_george',
  'bm_daniel',
  'bm_lewis',
  'bm_fable',
  'bf_emma',
  'af_heart',
  'am_michael',
];
if (!keep('kokoro-82m')) {
  const { sha } = await json(`${HF}/api/models/${KOKORO}`);
  models['kokoro-82m'] = {
    kind: 'tts',
    source: `${KOKORO}@${sha}`,
    license: 'Apache-2.0',
    files: await pinRepo(KOKORO, sha, {
      dirs: ['', '/onnx', '/voices'],
      paths: ['tokenizer.json', 'onnx/model.onnx', ...KOKORO_VOICES.map((v) => `voices/${v}.bin`)],
    }),
  };
}

// Kept entries (and hand-pinned ones: MiniLM, Laya's ONNX export, ADR-027) stay exactly as they are.
for (const [id, m] of Object.entries(existing)) models[id] ??= m;

writeFileSync(OUT, `${JSON.stringify(models, null, 2)}\n`);
for (const [id, m] of Object.entries(models))
  console.log(
    id,
    `${(m.files.reduce((a, f) => a + f.size, 0) / 1e6).toFixed(1)} MB`,
    '|',
    m.license,
  );
