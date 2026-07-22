// ai-search.js
// ------------------------------------------------------------------
// 독립 모듈: 로컬 CLIP(ONNX) 기반 이미지 임베딩 계산 + 이미지→이미지 유사 검색.
//
// 설계 원칙(설계서 2번 항목):
//   - 기존 index.html / main.js 코드는 이 파일을 "불러오기만" 하고, 절대 이 파일이
//     기존 코드를 고치지 않는다. 문제가 생기면 index.html의 연결부 몇 줄만 되돌리면
//     원래 앱으로 즉시 복원된다.
//   - 새로 만드는 데이터(이미지 임베딩)는 기존 tags/favorites 데이터 파일
//     (.reflib-data.json)과 완전히 분리된 별도 파일(.ai-embeddings.json)에 저장한다.
//   - 이 모듈은 이미지 파일을 읽기만 하며, 어떤 경우에도 원본 이미지나
//     .reflib-data.json을 쓰거나 옮기거나 지우지 않는다.
//
// 지금 단계(1단계: 모듈 뼈대 + 소규모 폴더 인덱싱 테스트)에서는 이미지→이미지
// 검색까지만 다룬다. 한글 텍스트 검색(텍스트 인코더)은 4단계에서 별도로 추가한다.
//
// 사용 모델: immich-app/XLM-Roberta-Base-ViT-B-32__laion5b_s13b_b90k 의 visual 인코더
//   (원본: LAION CLIP-ViT-B-32-xlm-roberta-base-laion5B-s13B-b90k, MIT 라이선스)
//   전처리 방식은 이 모델을 서비스하는 Immich의 실제 구현(resize shortest side ->
//   center crop -> CLIP 정규화)을 그대로 따른다.
// ------------------------------------------------------------------

const path = require('path');
const fs = require('fs');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const AI_EMBED_FILE = '.ai-embeddings.json';
const MODEL_DIR = path.join(__dirname, 'ai-model');
const VISUAL_MODEL_PATH = path.join(MODEL_DIR, 'visual', 'model.onnx');
const PREPROCESS_CFG_PATH = path.join(MODEL_DIR, 'visual', 'preprocess_cfg.json');
const TEXTUAL_DIR = path.join(MODEL_DIR, 'textual');
const TEXTUAL_MODEL_PATH = path.join(TEXTUAL_DIR, 'model.onnx');
const CONTEXT_LENGTH = 77; // config.json의 text_cfg에 context_length가 없어 OpenCLIP 기본값(77) 사용

let ort = null;
let sharp = null;
let session = null;
let preprocessCfg = null;
let textSession = null;
let tokenizer = null;

function lazyRequireDeps() {
  // onnxruntime-node/sharp는 플랫폼별 네이티브 바이너리가 필요하다.
  // require 시점에 없으면 "npm install을 먼저 실행하라"는 안내와 함께 바로 알 수 있게
  // 에러를 여기서 잡아 명확한 한글 메시지로 다시 던진다.
  if (!ort) {
    try { ort = require('onnxruntime-node'); }
    catch (err) { throw new Error('onnxruntime-node 모듈을 불러오지 못했습니다. 이 폴더에서 "npm install"을 먼저 실행해 주세요. (' + err.message + ')'); }
  }
  if (!sharp) {
    try { sharp = require('sharp'); }
    catch (err) { throw new Error('sharp 모듈을 불러오지 못했습니다. 이 폴더에서 "npm install"을 먼저 실행해 주세요. (' + err.message + ')'); }
  }
}

function checkModelFilesExist() {
  if (!fs.existsSync(VISUAL_MODEL_PATH)) {
    throw new Error(
      '이미지 인식 모델 파일이 없습니다: ' + VISUAL_MODEL_PATH + '\n' +
      '아래 주소에서 visual/model.onnx(약 335MB)를 내려받아 위 경로에 넣어주세요.\n' +
      'https://huggingface.co/immich-app/XLM-Roberta-Base-ViT-B-32__laion5b_s13b_b90k/resolve/main/visual/model.onnx'
    );
  }
}

async function getSession() {
  if (session) return session;
  lazyRequireDeps();
  checkModelFilesExist();
  preprocessCfg = JSON.parse(fs.readFileSync(PREPROCESS_CFG_PATH, 'utf-8'));
  session = await ort.InferenceSession.create(VISUAL_MODEL_PATH);
  return session;
}

// ---- 이미지 전처리: Immich의 실제 구현과 동일하게 "짧은 변 기준 리사이즈 + 중앙 크롭 + CLIP 정규화" ----
// sharp의 fit:'cover'가 "짧은 변을 목표 크기에 맞춰 리사이즈한 뒤 중앙을 잘라낸다"는
// 동작을 한 번에 처리해준다 (PIL의 resize_pil + crop_pil 두 단계와 동일한 결과).
async function preprocessImage(filePath) {
  lazyRequireDeps();
  const cfg = preprocessCfg;
  const size = Array.isArray(cfg.size) ? cfg.size[0] : cfg.size;
  const mean = cfg.mean;
  const std = cfg.std;

  const { data, info } = await sharp(filePath)
    .rotate() // exif 방향 정보 반영
    .resize(size, size, { fit: 'cover', position: 'centre', kernel: 'cubic' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error('예상치 못한 채널 수: ' + info.channels);
  }

  const floatData = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcIdx = (y * size + x) * 3;
      const dstIdx = y * size + x;
      floatData[0 * plane + dstIdx] = (data[srcIdx + 0] / 255 - mean[0]) / std[0];
      floatData[1 * plane + dstIdx] = (data[srcIdx + 1] / 255 - mean[1]) / std[1];
      floatData[2 * plane + dstIdx] = (data[srcIdx + 2] / 255 - mean[2]) / std[2];
    }
  }
  return new ort.Tensor('float32', floatData, [1, 3, size, size]);
}

function l2normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

function cosineSim(a, b) {
  // 저장된 벡터는 이미 L2 정규화되어 있으므로 내적이 곧 코사인 유사도다.
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

async function embedImage(filePath) {
  const sess = await getSession();
  const tensor = await preprocessImage(filePath);
  const results = await sess.run({ image: tensor });
  const outputName = sess.outputNames[0];
  const output = Array.from(results[outputName].data);
  return l2normalize(output);
}

// ---- 한글 텍스트 검색 (4단계) ----
// 토크나이저는 immich/Python의 tokenizers 라이브러리가 읽는 것과 완전히 같은 형식인
// textual/tokenizer.json을 그대로 사용한다(같은 파일, 같은 포맷 -> 같은 결과가 나오도록).
// 직접 BPE/SentencePiece를 구현하는 대신 검증된 라이브러리에 위임한다.
async function getTokenizer() {
  if (tokenizer) return tokenizer;
  let transformersLib;
  try { transformersLib = require('@huggingface/transformers'); }
  catch (err) { throw new Error('@huggingface/transformers 모듈을 불러오지 못했습니다. 이 폴더에서 "npm install"을 먼저 실행해 주세요. (' + err.message + ')'); }
  if (!fs.existsSync(path.join(TEXTUAL_DIR, 'tokenizer.json'))) {
    throw new Error(
      '토크나이저 파일이 없습니다: ' + path.join(TEXTUAL_DIR, 'tokenizer.json') + '\n' +
      '다운로드: https://huggingface.co/immich-app/XLM-Roberta-Base-ViT-B-32__laion5b_s13b_b90k/resolve/main/textual/tokenizer.json'
    );
  }
  tokenizer = await transformersLib.AutoTokenizer.from_pretrained(TEXTUAL_DIR, { local_files_only: true });
  return tokenizer;
}

async function getTextSession() {
  if (textSession) return textSession;
  lazyRequireDeps();
  if (!fs.existsSync(TEXTUAL_MODEL_PATH)) {
    throw new Error(
      '텍스트 검색 모델 파일이 없습니다: ' + TEXTUAL_MODEL_PATH + '\n' +
      '다운로드: https://huggingface.co/immich-app/XLM-Roberta-Base-ViT-B-32__laion5b_s13b_b90k/resolve/main/textual/model.onnx'
    );
  }
  textSession = await ort.InferenceSession.create(TEXTUAL_MODEL_PATH);
  return textSession;
}

// 텍스트 -> 임베딩 벡터. 모델의 실제 입력 이름(input_ids+attention_mask 조합 또는 text
// 단일 입력)을 session.inputNames로 그때그때 확인해서 맞춰 넣는다 - 두 방식 중 어느 쪽인지
// 미리 단정하지 않기 위함(잘못 가정하면 조용히 틀린 결과가 나오는 대신, 여기선 맞는 쪽을 골라 쓴다).
async function embedText(text) {
  const sess = await getTextSession();
  const tok = await getTokenizer();
  const encoded = await tok(text, { padding: 'max_length', truncation: true, max_length: CONTEXT_LENGTH });

  const feeds = {};
  const names = sess.inputNames;
  if (names.includes('input_ids') && names.includes('attention_mask')) {
    const ids = Int32Array.from(encoded.input_ids.data, Number);
    const mask = Int32Array.from(encoded.attention_mask.data, Number);
    feeds.input_ids = new ort.Tensor('int32', ids, [1, CONTEXT_LENGTH]);
    feeds.attention_mask = new ort.Tensor('int32', mask, [1, CONTEXT_LENGTH]);
  } else if (names.includes('text')) {
    const ids = Int32Array.from(encoded.input_ids.data, Number);
    feeds.text = new ort.Tensor('int32', ids, [1, CONTEXT_LENGTH]);
  } else {
    throw new Error('알 수 없는 텍스트 모델 입력 이름: ' + names.join(', '));
  }

  const results = await sess.run(feeds);
  const outputName = sess.outputNames[0];
  const output = Array.from(results[outputName].data);
  return l2normalize(output);
}

// ---- ai-embeddings.json 로드/저장 (기존 .reflib-data.json과 완전히 분리된 파일) ----
function loadEmbeddings(root) {
  const p = path.join(root, AI_EMBED_FILE);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return { version: 1, model: 'xlm-roberta-base-vit-b-32-laion5b', items: {} }; }
}

function saveEmbeddings(root, store) {
  const p = path.join(root, AI_EMBED_FILE);
  fs.writeFileSync(p, JSON.stringify(store));
}

// 기존 main.js의 relKey 방식과 통일: 라이브러리 루트 기준 상대경로(슬래시)를 키로 사용
function relKeyFor(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

// ---- 라이브러리 루트 아래 이미지 파일을 재귀적으로 모두 찾기 (main.js의 확장자 목록과 동일) ----
function listImageFiles(root) {
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (IMAGE_EXTS.includes(path.extname(ent.name).toLowerCase())) out.push(full);
    }
  })(root);
  return out;
}

// ---- 소규모/전체 인덱싱: 폴더 내 이미지 전체를 임베딩해서 ai-embeddings.json에 저장 ----
// 이미 인덱싱된 항목은 건너뛰므로 중간에 중단돼도 이어서 진행할 수 있다.
async function indexLibrary(root, onProgress) {
  const imagePaths = listImageFiles(root);
  const store = loadEmbeddings(root);
  let done = 0;
  let failed = 0;
  let newlyComputed = 0; // 이번에 새로 계산한 개수 - 이 기준으로만 중간 저장한다
  const startedAt = Date.now();
  for (const absPath of imagePaths) {
    const key = relKeyFor(root, absPath);
    if (!store.items[key]) {
      // 특정 파일(예: 구글 드라이브에 아직 로컬로 안 내려받아진 "클라우드 전용" 파일이거나
      // 손상된 이미지)에서 sharp/onnxruntime 호출이 끝없이 멈춰버리면 전체 인덱싱이
      // 영원히 멈춘 것처럼 보이는 문제가 있었다. 어떤 파일을 시도하는 중인지 콘솔에 남기고,
      // 30초 안에 안 끝나면 그 파일만 실패 처리하고 다음으로 넘어가게 한다.
      console.log(`인덱싱 시도 (${done + 1}/${imagePaths.length}):`, absPath);
      try {
        store.items[key] = await Promise.race([
          embedImage(absPath),
          new Promise((_, reject) => setTimeout(() => reject(new Error('시간 초과(30초) - 파일 접근이 멈췄을 수 있습니다')), 30000))
        ]);
        newlyComputed++;
      } catch (err) {
        failed++;
        console.error('임베딩 실패:', absPath, err.message);
      }
    }
    done++;
    if (onProgress) onProgress(done, imagePaths.length);
    // 이미 인덱싱된 이미지를 훑고 지나가는 건 즉시 끝나야 하는데, 예전 코드는 "훑은 개수"
    // 기준으로 저장해서 이미 인덱싱된 이미지가 많을 때도 전체 임베딩(수십MB)을 수백 번
    // 다시 써서 느려지는 문제가 있었다. 새로 "계산"한 개수 기준으로만 중간 저장한다.
    if (newlyComputed > 0 && newlyComputed % 20 === 0) saveEmbeddings(root, store); // 중단/크래시 대비
  }
  saveEmbeddings(root, store);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { total: imagePaths.length, indexed: Object.keys(store.items).length, failed, elapsedSec };
}

// 저장된 임베딩 전체와 기준 벡터를 비교해 상위 topK를 반환하는 공용 함수.
// 이미지 기준 검색(findSimilar)과 한글 텍스트 기준 검색(searchByText)이 이 함수를 공유한다.
function rankByVector(store, qVec, excludeKey, topK) {
  const scored = [];
  for (const [key, vec] of Object.entries(store.items)) {
    if (key === excludeKey) continue;
    scored.push({ key, score: cosineSim(qVec, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ---- 이미지 → 이미지 유사 검색 ----
function findSimilar(root, queryRelKey, topK = 20) {
  const store = loadEmbeddings(root);
  const qVec = store.items[queryRelKey];
  if (!qVec) return [];
  return rankByVector(store, qVec, queryRelKey, topK);
}

// ---- 한글(다국어) 텍스트 → 이미지 검색 ----
async function searchByText(root, text, topK = 40) {
  const qVec = await embedText(text);
  const store = loadEmbeddings(root);
  return rankByVector(store, qVec, null, topK);
}

module.exports = {
  IMAGE_EXTS, AI_EMBED_FILE,
  listImageFiles, indexLibrary, findSimilar, embedImage, embedText, searchByText,
  loadEmbeddings, relKeyFor,
};

// ---- CLI 자가 테스트: `node ai-search.js <라이브러리 루트 경로>` ----
// Electron UI를 띄우지 않고도 인덱싱 로직만 빠르게 검증할 수 있게 하기 위한 용도.
if (require.main === module) {
  const root = process.argv[2];
  const textFlagIdx = process.argv.indexOf('--text');
  if (!root) {
    console.error('사용법: node ai-search.js <라이브러리 루트 폴더 경로> [--text "검색어"]');
    process.exit(1);
  }
  (async () => {
    try {
      if (textFlagIdx >= 0) {
        // 텍스트 검색만 확인할 때는 인덱싱을 새로 하지 않고 기존 .ai-embeddings.json을 그대로 쓴다.
        const query = process.argv[textFlagIdx + 1];
        if (!query) { console.error('--text 뒤에 검색어를 넣어주세요.'); process.exit(1); }
        console.log('대상 폴더:', root);
        console.log('검색어:', query);
        const results = await searchByText(root, query, 10);
        console.log('\n검색 결과:');
        results.forEach((s, i) => console.log(`  ${i + 1}. ${s.key}  (유사도 ${s.score.toFixed(4)})`));
        return;
      }

      console.log('대상 폴더:', root);
      console.log('이미지 인덱싱 시작...');
      const result = await indexLibrary(root, (done, total) => {
        if (done % 50 === 0 || done === total) console.log(`  진행: ${done}/${total}`);
      });
      console.log('인덱싱 완료:', result);

      const store = loadEmbeddings(root);
      const firstKey = Object.keys(store.items)[0];
      if (firstKey) {
        console.log('\n샘플 유사 검색 - 기준 이미지:', firstKey);
        const similar = findSimilar(root, firstKey, 5);
        similar.forEach((s, i) => console.log(`  ${i + 1}. ${s.key}  (유사도 ${s.score.toFixed(4)})`));
      }
    } catch (err) {
      console.error('오류:', err.message);
      process.exit(1);
    }
  })();
}
