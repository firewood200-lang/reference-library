// ai-tagger.js
// ------------------------------------------------------------------
// 독립 모듈: 로컬 Ollama(비전 모델, 기본 qwen2.5vl:7b)로 이미지를 보고
// 파일명 + 태그를 자동으로 채워주는 배치 작업.
//
// 설계 원칙(ai-search.js와 동일한 원칙을 따른다 - 설계서 2번 항목):
//   - 존 index.html/main.js는 이 파일을 "불러오기만" 하고, 이 파일이 기존 코드를
//     고치지 않는다. 문제가 생기면 연결부 몇 줄만 되돌리면 원래 앱으로 즉시 복원된다.
//   - 태그/파일 처리는 기존 reflib-core.js(setTags/saveData/relKey 등)를 그대로
//     재사용해 .reflib-data.json 형식이 항상 앱과 완전히 동일하게 유지되도록 한다.
//   - 이미 태그가 붙어 있는 파일은 건드리지 않는다 - "태그 있음"을 완료 표시로 쓴다.
//   - 언제든 중단할 수 있도록 매 파일 처리 전에 shouldStop() 콜백을 확인한다.
//   - 파일 하나가 실패해도 전체를 멈추지 않고 다음 파일로 넘어간다.
// ------------------------------------------------------------------
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const core = require('./reflib-core.js');

const OLLAMA_GENERATE_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_PING_URL = 'http://127.0.0.1:11434/api/tags';
const DEFAULT_MODEL = 'qwen2.5vl:7b';
const REQUEST_TIMEOUT_MS = 120000;

// ---- Ollama가 켜져 있는지 가볍게 확인 (TCP/HTTP 레벨, 실패해도 예외를 던지지 않음) ----
function isOllamaReachable(url) {
  url = url || OLLAMA_PING_URL;
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ---- 이미지 1장을 보고 {filename, tags}를 JSON으로 받아온다 ----
function ollamaGenerateJson(promptText, imageBase64, model) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: model || DEFAULT_MODEL,
      prompt: promptText,
      images: [imageBase64],
      stream: false,
      format: 'json', // 모델이 JSON만 출력하도록 강제 - 자유 텍스트 반복 오류를 크게 줄여준다.
      options: { temperature: 0.2, repeat_penalty: 1.3, num_predict: 120 },
    });
    const req = http.request(
      OLLAMA_GENERATE_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Ollama HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          try {
            const outer = JSON.parse(body);
            const inner = JSON.parse(outer.response || '{}');
            resolve(inner);
          } catch (err) {
            reject(new Error('Ollama 응답 파싱 실패: ' + err.message));
          }
        });
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Ollama 요청 시간 초과')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function buildPrompt(existingTags) {
  const sample = (existingTags || []).slice(0, 40).join(', ');
  return (
    '이 그림을 보고 아래 JSON 형식으로만 답해. 다른 설명이나 코드블록 표시 없이 JSON 객체 하나만 출력해.\n' +
    '{"filename": "파일명으로 쓸 15자 이내 한국어 설명(명사형, 특수문자 없이, 띄어쓰기 대신 언더스코어_ 사용)", ' +
    '"tags": ["그림에서 실제로 보이는 특징만 담은 핵심 태그 3~6개, 한국어 단어나 짧은 구"]}\n' +
    '같은 단어나 글자를 반복해서 나열하지 마. 태그끼리 의미가 겹치지 않게 해.' +
    (sample ? ` 참고로 이 라이브러리에서 이미 쓰이는 태그 예시: ${sample}. 맞는 게 있으면 그대로 재사용하고, 없으면 새로 만들어도 돼.` : '')
  );
}

// 모델이 같은 조각을 반복 출력하는 오류(예: "눈_눈_눈_눈...")를 걸러내기 위해
// 조각(_로 나눈 단어) 단위로 최대 2번까지만 허용하고, 조각 수 자체도 제한한다.
function cleanFilenameStem(raw) {
  let s = String(raw || '').trim();
  s = s.split('\n')[0];
  s = s.replace(/^["'“”'`]+|["'“”'`]+$/g, '');
  s = s.replace(/[\\/:*?"<>|]/g, '');
  s = s.replace(/\s+/g, '_');

  const parts = s.split('_').filter(Boolean);
  const seen = new Map();
  const deduped = [];
  for (const p of parts) {
    const n = (seen.get(p) || 0) + 1;
    seen.set(p, n);
    if (n <= 2) deduped.push(p);
    if (deduped.length >= 8) break;
  }
  s = deduped.join('_');
  s = s.slice(0, 40);
  s = s.replace(/^_+|_+$/g, '');
  return s || 'untitled';
}

function cleanTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    let v = String(t == null ? '' : t).trim();
    v = v.replace(/[\\/:*?"<>|]/g, '');
    v = v.slice(0, 20);
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
    if (out.length >= 6) break;
  }
  return out;
}

// 기존 앱의 move-files/rename-file 로직과 동일한 "(1)" 자동 부여 규칙.
function uniqueDestPath(dir, stem, ext) {
  let dest = path.join(dir, stem + ext);
  let n = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${stem}_(${n})${ext}`);
    n++;
  }
  return dest;
}

// ---- 라이브러리(또는 지정 폴더) 배치 처리 ----
// options: { folder, model, onProgress(done,total,label), shouldStop() }
// 반환: { total, done, tagged, failed, stopped }
async function tagLibrary(root, options) {
  options = options || {};
  const onProgress = options.onProgress || function () {};
  const shouldStop = options.shouldStop || function () { return false; };
  const model = options.model || DEFAULT_MODEL;
  const scanDir = options.folder ? path.join(root, options.folder) : root;

  const data = core.loadData(root);
  const prompt = buildPrompt(core.allTags(data));

  const all = core.listImages(scanDir, true).filter((f) => f.kind === 'image');
  const targets = all.filter((f) => core.getTags(data, core.relKey(root, f.path)).length === 0);

  let done = 0;
  let tagged = 0;
  let failed = 0;
  let stopped = false;

  for (const file of targets) {
    if (shouldStop()) {
      stopped = true;
      break;
    }
    let absPath = file.path;
    try {
      const { base64 } = core.getImageBase64(absPath);
      const result = await ollamaGenerateJson(prompt, base64, model);
      const stem = cleanFilenameStem(result && result.filename);
      const tags = cleanTags(result && result.tags);

      const ext = path.extname(absPath);
      const dir = path.dirname(absPath);
      const newAbs = uniqueDestPath(dir, stem, ext);
      const oldKey = core.relKey(root, absPath);
      const newKey = core.relKey(root, newAbs);

      fs.renameSync(absPath, newAbs);
      absPath = newAbs;

      // 메모/즐겨찾기 키를 새 경로로 마이그레이션(기존 앱의 rename-file IPC와 동일한 규칙).
      // 이 파일들은 태그가 없던 파일이라 data.tags[oldKey]는 존재하지 않는다.
      if (data.notes && data.notes[oldKey]) {
        data.notes[newKey] = data.notes[oldKey];
        delete data.notes[oldKey];
      }
      if (Array.isArray(data.favorites)) {
        const idx = data.favorites.indexOf(oldKey);
        if (idx >= 0) data.favorites[idx] = newKey;
      }

      // 태그를 하나도 못 받아도 "미분류"를 붙여 완료 표시를 남긴다 - 그래야 다음 실행 때
      // 같은 파일을 무한히 다시 시도하지 않는다.
      core.setTags(data, newKey, tags.length ? tags : ['미분류']);
      core.saveData(root, data);

      tagged++;
    } catch (err) {
      failed++;
      // 이 파일은 건너뛰고 계속 진행한다. 태그가 안 붙었으므로 다음 실행 때 다시 시도된다.
    }
    done++;
    onProgress(done, targets.length, path.basename(absPath));
  }

  return { total: targets.length, done, tagged, failed, stopped };
}

module.exports = { isOllamaReachable, tagLibrary, DEFAULT_MODEL };
