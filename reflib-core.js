// reflib-core.js
// 레퍼런스 라이브러리(reference-library) 공유 코어 모듈.
//
// Electron 렌더러(index.html)/메인 프로세스(main.js), 그리고 앞으로 붙을 MCP 서버가
// "같은 로직"으로 라이브러리 데이터(.reflib-data.json)와 파일을 다루게 하려고 분리했다.
// Electron API(ipcMain, dialog, shell 등)나 브라우저 API에는 전혀 의존하지 않고,
// Node 표준 모듈(fs, path)만 사용하는 순수 함수들만 담는다 - 그래야 MCP 서버(순수 node.js 프로세스)에서도
// require('./reflib-core.js')로 그대로 가져다 쓸 수 있다.
//
// main.js/index.html에 흩어져 있던 로직을 옮겨온 것이므로, 기존 동작(파일명 충돌 시 "(1)" 붙이기,
// 태그 중복 방지 등)을 그대로 재현하는 것을 최우선으로 한다 - 새 동작을 추가하지 않는다.
'use strict';

const fs = require('fs');
const path = require('path');

// ---- 파일 종류 (main.js 상단 상수와 동일) ----
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const MODEL_EXTS = ['.obj'];
const DOC_EXTS = ['.pdf', '.txt', '.md', '.docx'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v'];
const EMBED_EXT = '.pinembed'; // 파일을 못 받아오는 웹 임베드(핀터레스트 등)를 가리키는 참조용 파일
const LINK_EXT = '.weblink'; // 뉴스 기사 등 일반 웹 링크 - 본문을 추출해서 캐시해둔 참조용 파일
const MINIWIN_EXT = '.miniwin'; // 미니창으로 띄운 임의 사이트를 라이브러리 항목으로 남겨두는 참조용 파일
const SUPPORTED = [...IMAGE_EXTS, ...MODEL_EXTS, ...DOC_EXTS, ...VIDEO_EXTS, EMBED_EXT, LINK_EXT, MINIWIN_EXT];

function kindOf(ext) {
  ext = ext.toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (MODEL_EXTS.includes(ext)) return 'model';
  if (DOC_EXTS.includes(ext)) return 'doc';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (ext === EMBED_EXT) return 'embed';
  if (ext === LINK_EXT) return 'link';
  if (ext === MINIWIN_EXT) return 'miniwin';
  return 'other';
}

const DATA_FILE = '.reflib-data.json';

// ---- 경로 <-> 태그 키 변환 ----
// 태그/메모/즐겨찾기는 라이브러리 루트 기준 상대경로(슬래시 통일)를 키로 저장한다.
// (기존 index.html의 relKey()와 동일 - 거기서는 root를 클로저로 잡았지만 여기서는 인자로 받는다)
function relKey(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

// ---- 폴더 트리 스캔 (폴더만, 재귀) ----
// imageCount는 하위 폴더까지 전부 합친 총 개수(재귀), directCount는 그 폴더 안에 바로 있는 파일 개수
function scanTree(dir, root) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { name: path.basename(dir), relPath: path.relative(root, dir), children: [], imageCount: 0, directCount: 0 }; }
  const children = [];
  let directCount = 0;
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      children.push(scanTree(full, root));
    } else {
      directCount++;
    }
  }
  children.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const childrenTotal = children.reduce((sum, c) => sum + c.imageCount, 0);
  return { name: path.basename(dir), relPath: path.relative(root, dir), children, imageCount: directCount + childrenTotal, directCount };
}

// ---- 특정 폴더의 파일 목록 (이미지/3D모델/문서/영상/참조파일 전부) ----
function listImages(dir, recursive) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (recursive) out = out.concat(listImages(full, true));
    } else {
      const stat = fs.statSync(full);
      const ext = path.extname(ent.name);
      const item = { path: full, name: ent.name, size: stat.size, mtime: stat.mtimeMs, kind: kindOf(ext) };
      if (ext.toLowerCase() === EMBED_EXT) {
        try {
          const meta = JSON.parse(fs.readFileSync(full, 'utf-8'));
          item.embedUrl = meta.embedUrl;
          item.embedTitle = meta.title;
          item.sourceUrl = meta.sourceUrl;
        } catch {}
      }
      if (ext.toLowerCase() === LINK_EXT) {
        try {
          const meta = JSON.parse(fs.readFileSync(full, 'utf-8'));
          item.linkUrl = meta.url;
          item.linkTitle = meta.title;
          item.linkImage = meta.image;
          item.linkExcerpt = meta.excerpt;
        } catch {}
      }
      if (ext.toLowerCase() === MINIWIN_EXT) {
        try {
          const meta = JSON.parse(fs.readFileSync(full, 'utf-8'));
          item.miniwinUrl = meta.url;
          item.miniwinTitle = meta.title;
        } catch {}
      }
      if (ext.toLowerCase() === '.txt' || ext.toLowerCase() === '.md') {
        try {
          const fd = fs.openSync(full, 'r');
          const buf = Buffer.alloc(300);
          const bytesRead = fs.readSync(fd, buf, 0, 300, 0);
          fs.closeSync(fd);
          item.textExcerpt = buf.toString('utf-8', 0, bytesRead).replace(/�$/, '').replace(/\s+/g, ' ').trim();
        } catch {}
      }
      out.push(item);
    }
  }
  return out;
}

// ---- 메타데이터(태그/메모/즐겨찾기) 로드/저장 ----
function loadData(root) {
  const p = path.join(root, DATA_FILE);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return { user_id: 'default_user', version: 1, tags: {}, notes: {}, favorites: [], pinnedFolders: [] }; }
}
function saveData(root, data) {
  const p = path.join(root, DATA_FILE);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return true;
}

// ---- 태그 ----
// data.tags는 { "상대/경로.png": ["태그1", "태그2"] } 형태. (index.html 기존 로직과 동일한 규칙 적용)
function getTags(data, key) {
  return (data.tags && data.tags[key]) || [];
}
// 태그 하나 추가 - 이미 있으면 중복 추가하지 않음(기존 index.html 태그 입력창 로직과 동일)
function addTag(data, key, tag) {
  tag = String(tag == null ? '' : tag).trim();
  data.tags = data.tags || {};
  if (!tag) return data.tags[key] || [];
  data.tags[key] = data.tags[key] || [];
  if (!data.tags[key].includes(tag)) data.tags[key].push(tag);
  return data.tags[key];
}
// 태그 하나 제거 (기존 index.html 태그 칩 x버튼 로직과 동일)
function removeTag(data, key, tag) {
  data.tags = data.tags || {};
  data.tags[key] = (data.tags[key] || []).filter(t => t !== tag);
  return data.tags[key];
}
// 태그 배열을 통째로 교체 - MCP의 set_tags(path, tags[])용으로 새로 추가. 빈 문자열 제거·중복 제거만 하고
// 순서는 입력 순서를 유지한다. 빈 배열을 넘기면 해당 키 자체를 지운다(=태그 없음 상태, no-tag 스마트 폴더와 일치).
function setTags(data, key, tags) {
  data.tags = data.tags || {};
  const seen = new Set();
  const clean = [];
  for (const t of (tags || [])) {
    const v = String(t == null ? '' : t).trim();
    if (v && !seen.has(v)) { seen.add(v); clean.push(v); }
  }
  if (clean.length) data.tags[key] = clean; else delete data.tags[key];
  return data.tags[key] || [];
}
// 라이브러리 전체에서 쓰인 태그 전부 (가나다 정렬) - 기존 index.html allTags()와 동일
function allTags(data) {
  const set = new Set();
  Object.values(data.tags || {}).forEach(arr => (arr || []).forEach(t => set.add(t)));
  return Array.from(set).sort();
}
// 태그가 하나도 없는 파일 목록 - folder를 생략하면 라이브러리 전체(재귀)를 본다
function listUntagged(root, data, folder, recursive) {
  const dir = folder || root;
  const rec = recursive === undefined ? true : !!recursive;
  return listImages(dir, rec).filter(img => getTags(data, relKey(root, img.path)).length === 0);
}

// ---- 검색 ----
// query: 파일명 부분일치(대소문자 무시, 기존 index.html 검색창과 동일한 방식).
// filters: { folder, tag, kind } 전부 선택사항 - folder는 root 기준 상대경로 또는 절대경로 둘 다 받는다.
function searchLibrary(root, data, query, filters) {
  filters = filters || {};
  let list = listImages(root, true);
  if (filters.folder) {
    const folderAbs = path.isAbsolute(filters.folder) ? filters.folder : path.join(root, filters.folder);
    const prefix = folderAbs + path.sep;
    list = list.filter(img => img.path === folderAbs || img.path.startsWith(prefix) || path.dirname(img.path) === folderAbs);
  }
  if (filters.kind) list = list.filter(img => img.kind === filters.kind);
  if (filters.tag) list = list.filter(img => getTags(data, relKey(root, img.path)).includes(filters.tag));
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (q) list = list.filter(img => img.name.toLowerCase().includes(q));
  return list;
}

// ---- 폴더 목록 (평평한 상대경로 배열) ----
function listFolders(root) {
  const tree = scanTree(root, root);
  const out = [];
  (function walk(node) { out.push(node.relPath); (node.children || []).forEach(walk); })(tree);
  return out;
}

// ---- 파일 이동 ----
// 중앙 그리드에서 폴더 트리로 드래그해서 옮기는 기존 move-files IPC 로직 그대로 - 같은 이름 파일이 있으면
// 자동으로 "(1)" 등을 붙여 구분한다.
function moveFiles(srcPaths, destDir) {
  const moved = [];
  const errors = [];
  for (const src of srcPaths) {
    try {
      if (path.dirname(src) === destDir) continue; // 이미 그 폴더 안에 있으면 건너뜀
      const ext = path.extname(src);
      const stem = path.basename(src, ext);
      let dest = path.join(destDir, stem + ext);
      let n = 1;
      while (fs.existsSync(dest)) { dest = path.join(destDir, `${stem} (${n})${ext}`); n++; }
      fs.renameSync(src, dest);
      moved.push({ from: src, to: dest });
    } catch (err) {
      errors.push({ path: src, error: err.message });
    }
  }
  return { moved, errors };
}
// 파일 하나만 옮기는 MCP move_file(path, targetFolder)용 얇은 래퍼
function moveFile(srcPath, destDir) {
  const { moved, errors } = moveFiles([srcPath], destDir);
  if (moved.length) return { success: true, path: moved[0].to };
  if (errors.length) return { success: false, error: errors[0].error };
  return { success: false, error: '이미 대상 폴더 안에 있습니다.' };
}

// ---- 이미지 base64 (MCP get_image(path)용 - 기존 앱은 file:// 로 바로 읽어서 별도 IPC가 없었음) ----
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
function getImageBase64(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  const buf = fs.readFileSync(absPath);
  return { mime, base64: buf.toString('base64') };
}

module.exports = {
  // 상수
  IMAGE_EXTS, MODEL_EXTS, DOC_EXTS, VIDEO_EXTS, EMBED_EXT, LINK_EXT, MINIWIN_EXT, SUPPORTED, DATA_FILE,
  // 파일/폴더 읽기
  kindOf, relKey, scanTree, listImages, listFolders,
  // 데이터 로드/저장
  loadData, saveData,
  // 태그
  getTags, addTag, removeTag, setTags, allTags, listUntagged,
  // 검색
  searchLibrary,
  // 파일 이동
  moveFile, moveFiles,
  // 이미지 읽기
  getImageBase64,
};
