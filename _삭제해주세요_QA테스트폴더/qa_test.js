// QA 스크립트 - 배포된 reflib-core.js를 실제 라이브러리 폴더 옆의 임시 테스트 픽스처(_qa_test_20260824)에 대해
// 그대로 돌려서, 리팩토링 전 main.js/index.html의 동작과 일치하는지 검증한다. 실제 사용자 라이브러리 데이터는
// 전혀 건드리지 않는다 - 오직 이 스크립트가 만든 임시 폴더 안에서만 읽고 쓴다.
const path = require('path');
const assert = require('assert');
// 사용법: node qa_test.js <reflib-core.js 경로> <테스트 픽스처 루트 폴더>
const corePath = process.argv[2];
const root = process.argv[3];
if (!corePath || !root) { console.error('usage: node qa_test.js <reflib-core.js path> <fixture root>'); process.exit(2); }
const core = require(path.resolve(corePath));
let failed = 0;
function check(name, fn) {
  try { fn(); console.log('OK   -', name); }
  catch (err) { failed++; console.log('FAIL -', name, '->', err.message); }
}

// 1) listImages / kindOf
check('listImages(recursive)는 sub1의 파일 3개를 찾는다', () => {
  const list = core.listImages(root, true);
  assert.strictEqual(list.length, 3, `got ${list.length}`);
  const byName = Object.fromEntries(list.map(i => [i.name, i]));
  assert.strictEqual(byName['a.png'].kind, 'image');
  assert.strictEqual(byName['note.md'].kind, 'doc');
});

// 2) scanTree / listFolders
check('scanTree는 sub1/sub2를 자식으로 갖는다', () => {
  const tree = core.scanTree(root, root);
  const names = tree.children.map(c => c.name).sort();
  assert.deepStrictEqual(names, ['sub1', 'sub2']);
});
check('listFolders는 루트/서브 4개(자기자신 포함)를 평평하게 반환', () => {
  const folders = core.listFolders(root);
  assert.ok(folders.includes(''), '루트 자신도 포함되어야 함');
  assert.ok(folders.includes('sub1'));
  assert.ok(folders.includes('sub2'));
});

// 3) relKey
check('relKey는 슬래시로 통일된 상대경로를 만든다', () => {
  const key = core.relKey(root, path.join(root, 'sub1', 'a.png'));
  assert.strictEqual(key, 'sub1/a.png');
});

// 4) 태그: dedup, trim, setTags 배열교체, allTags, listUntagged
check('태그 추가/중복방지/trim/제거/전체교체가 기존 로직과 동일', () => {
  const data = { user_id: 'qa', version: 1, tags: {}, notes: {}, favorites: [], pinnedFolders: [] };
  const key = 'sub1/a.png';
  core.addTag(data, key, '인물');
  core.addTag(data, key, '인물'); // 중복 무시
  core.addTag(data, key, '  표정  '); // trim
  assert.deepStrictEqual(core.getTags(data, key), ['인물', '표정']);
  core.removeTag(data, key, '인물');
  assert.deepStrictEqual(core.getTags(data, key), ['표정']);
  core.setTags(data, key, ['x', 'x', ' y ', '']);
  assert.deepStrictEqual(core.getTags(data, key), ['x', 'y']);
  assert.deepStrictEqual(core.allTags(data), ['x', 'y']);
  const untagged = core.listUntagged(root, data).map(i => i.name).sort();
  assert.deepStrictEqual(untagged, ['b.png', 'note.md']); // a.png만 태그 있음
});

// 5) loadData/saveData 라운드트립 (임시 폴더 안에서만 - 실사용자 데이터는 안 건드림)
check('saveData 후 loadData가 동일한 내용을 돌려준다', () => {
  const data = { user_id: 'qa', version: 1, tags: { 'sub1/a.png': ['테스트'] }, notes: {}, favorites: ['sub1/b.png'], pinnedFolders: [] };
  core.saveData(root, data);
  const reloaded = core.loadData(root);
  assert.deepStrictEqual(reloaded, data);
});
check('DATA_FILE이 없는 새 폴더는 기본 스켈레톤을 돌려준다', () => {
  const emptyDir = path.join(root, 'sub2');
  const d = core.loadData(emptyDir);
  assert.deepStrictEqual(d, { user_id: 'default_user', version: 1, tags: {}, notes: {}, favorites: [], pinnedFolders: [] });
});

// 6) moveFile / moveFiles - 충돌 시 "(1)" 접미사
check('moveFile은 파일을 옮기고, 이름이 겹치면 (1)을 붙인다', () => {
  const src = path.join(root, 'sub1', 'b.png');
  const destDir = path.join(root, 'sub2');
  const r1 = core.moveFile(src, destDir);
  assert.ok(r1.success, JSON.stringify(r1));
  assert.strictEqual(path.basename(r1.path), 'b.png');
  // 다시 sub1으로 옮겨 원상복구 준비 - 그 전에 sub1에 동명 파일을 하나 만들어 충돌 케이스도 검증
  require('fs').writeFileSync(path.join(root, 'sub1', 'b.png'), 'placeholder');
  const r2 = core.moveFile(r1.path, path.join(root, 'sub1'));
  assert.ok(r2.success, JSON.stringify(r2));
  assert.strictEqual(path.basename(r2.path), 'b (1).png', `got ${r2.path}`);
});

// 7) searchLibrary
check('searchLibrary는 파일명 부분일치로 찾는다', () => {
  const data = core.loadData(root);
  const res = core.searchLibrary(root, data, 'note');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].name, 'note.md');
});

// 8) getImageBase64
check('getImageBase64는 mime과 base64를 돌려준다', () => {
  const img = core.getImageBase64(path.join(root, 'sub1', 'a.png'));
  assert.strictEqual(img.mime, 'image/png');
  assert.ok(img.base64.length > 0);
});

console.log('---');
console.log(failed === 0 ? `ALL PASS (${8 - 0}개 검사 그룹)` : `${failed}개 실패`);
process.exit(failed === 0 ? 0 : 1);
