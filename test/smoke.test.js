// index.html のインラインJSをDOMスタブ上で実行して主要動線を検証する
// 実行: node test\smoke.test.js （全項目PASSしてからpushすること）
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dataJs = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
const appJs = /<script>([\s\S]*)<\/script>/.exec(html)[1];

// ---- スタブ ----
const lsData = {};
global.localStorage = {
  getItem: k => (k in lsData ? lsData[k] : null),
  setItem: (k, v) => { lsData[k] = String(v); },
  removeItem: k => { delete lsData[k]; },
};
const elements = {};
function makeEl(id) {
  return {
    id, innerHTML: '', value: '', style: {}, files: [],
    addEventListener() {}, setAttribute() {}, getBoundingClientRect: () => ({ left: 0, width: 300 }),
    appendChild() {}, click() {}, remove() {},
    offsetWidth: 50,
  };
}
global.document = {
  getElementById: id => elements[id] || (elements[id] = makeEl(id)),
  createElement: tag => makeEl(tag),
  body: { appendChild() {} },
  addEventListener() {},
  hidden: false,
};
global.window = { scrollTo() {}, addEventListener() {} };
global.navigator = {};
global.location = { protocol: 'file:', hostname: '' };
global.confirm = () => true;
global.alert = () => {};
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.Blob = class {};
global.FileReader = class { readAsText() {} };

// ---- 実行 ----
// 'use strict' のため eval 内の宣言は外に漏れない → APIをglobalに書き出す
const bootstrap = `(function(){ 'use strict';\n` + dataJs + '\n' + appJs + `
;globalThis.__api = {
  get store() { return store; },
  state, go, render, openDate, setBody, addWorkout, addSet, delSet, setSetVal,
  addEx, toggleEx, renameEx, calSelect, cloudBackup,
};})()`;
eval(bootstrap);
const { state, go, render, openDate, setBody, addWorkout, addSet, delSet, setSetVal, addEx, toggleEx, renameEx, calSelect } = globalThis.__api;
const store = new Proxy({}, { get: (_, k) => globalThis.__api.store[k], has: (_, k) => k in globalThis.__api.store });

// 1) 初期シード
assert.strictEqual(Object.keys(store.days).length, 71, '初期データ71日');
assert.strictEqual(store.exercises.length, 8, '種目8件');
console.log('OK 初期シード: 71日 / 8種目');

// 2) 各タブのレンダリング
for (const t of ['cal', 'list', 'stats', 'settings', 'input']) {
  go(t);
  assert(elements.main.innerHTML.length > 100, t + ' 画面が描画される');
}
console.log('OK 全タブ描画');

// 3) カレンダー: 2026年5月に移動して 5/13 のマーク確認（筋トレ＋有酸素）
state.tab = 'cal'; state.calY = 2026; state.calM = 4; render();
const calHtml = elements.main.innerHTML;
assert(calHtml.includes('2026年5月'), 'カレンダー見出し');
const cell513 = calHtml.split('calSelect(\'2026-05-13\')')[1].split('</td>')[0];
assert(cell513.includes('dot st') && cell513.includes('dot ca'), '5/13に筋トレ・有酸素両マーク');
assert(calHtml.includes('ジム') && calHtml.includes('ボリューム'), '月間サマリ行');
console.log('OK カレンダー: 5/13 両マーク表示 + 月間サマリ');

// 3b) 日付タップ → 下部に内容表示、修正ボタンで入力タブへ
calSelect('2026-05-13');
let detailHtml = elements.main.innerHTML;
assert(detailHtml.includes('selday'), '選択日ハイライト');
assert(detailHtml.includes('5/13(水)'), '選択日の見出し');
assert(detailHtml.includes('chip">33kg 13回 ×3<'), '選択日の内容がチップ表示');
assert(detailHtml.includes('chip">60分<'), '有酸素もチップ表示');
assert(detailHtml.includes('この日を修正'), '修正ボタン');
calSelect('2026-05-20'); // 記録なしの日
assert(elements.main.innerHTML.includes('記録なし') && elements.main.innerHTML.includes('この日に入力'), '記録なしの日は入力ボタン');
openDate('2026-05-13');
assert.strictEqual(state.tab, 'input', '修正ボタン相当で入力タブへ');
assert.strictEqual(state.date, '2026-05-13');
// 入力タブを離れたら日付が今日に初期化される
go('cal');
const nowD = new Date();
const todayLocal = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`;
assert.strictEqual(state.date, todayLocal, '入力タブ離脱で日付初期化');
console.log('OK カレンダー日付タップ → チップ詳細 → 入力タブ遷移 → 離脱時初期化');

// 4) 一覧: 5/13 の内容（メモは廃止 → 出ないこと）
go('list');
assert(elements.main.innerHTML.includes('2026年5月'), '一覧の月見出し');
assert(!elements.main.innerHTML.includes('やっぱ胸はこれだわ。'), 'メモは表示されない');
assert(elements.main.innerHTML.includes('33kg 13回 ×3'), 'セットのグループ表記（チップ）');
// データ内にもnoteが存在しない（v2移行）
for (const d of Object.values(globalThis.__api.store.days)) {
  assert(!('note' in d), '日メモなし');
  for (const w of (d.workouts || [])) assert(!('note' in w), '種目メモなし');
}
assert.strictEqual(globalThis.__api.store.version, 2, 'version 2');
console.log('OK 一覧: セット表記 / メモ完全削除 / v2移行');

// 5) 記録: 日付を開いて体組成入力 → 除脂肪計算
openDate('2026-07-05');
setBody('weight', '64.2');
setBody('fat', '18');
assert.strictEqual(store.days['2026-07-05'].body.weight, 64.2);
assert(elements.main.innerHTML.includes('52.6 kg'), '除脂肪 64.2*0.82=52.64→52.6');
console.log('OK 体組成入力と除脂肪自動計算');

// 6) 前回値プリセット: 胸を追加 → 2026-05-13 の 33kg×11,9,7 が入る
addWorkout('m');
const w = store.days['2026-07-05'].workouts[0];
assert.strictEqual(w.ex, 'm');
assert.deepStrictEqual(w.sets, [{ w: 33, r: 11 }, { w: 33, r: 9 }, { w: 33, r: 7 }], '前回値プリセット');
console.log('OK 前回値プリセット (胸: 33kg 11/9/7回)');

// 7) セット追加＝直前セットの複製、値変更、削除
addSet(0);
assert.deepStrictEqual(store.days['2026-07-05'].workouts[0].sets[3], { w: 33, r: 7 });
setSetVal(0, 3, 'w', '35');
assert.strictEqual(store.days['2026-07-05'].workouts[0].sets[3].w, 35);
delSet(0, 3);
assert.strictEqual(store.days['2026-07-05'].workouts[0].sets.length, 3);
console.log('OK セット追加・変更・削除');

// 8) 有酸素追加（前回60分がプリセット）と腹（回数のみ）
addWorkout('r');
const wr = store.days['2026-07-05'].workouts[1];
assert.strictEqual(wr.minutes, 60, '有酸素の前回値60分');
addWorkout('h');
const wh = store.days['2026-07-05'].workouts[2];
assert(wh.sets.every(s => !('w' in s)), '腹は回数のみ');
console.log('OK 有酸素60分プリセット / 腹は回数のみ');

// 9) レポート: 全期間で体重グラフが出る＋月別サマリ
state.range = 'all';
go('stats');
const statsHtml = elements.main.innerHTML;
assert(statsHtml.includes('<svg'), '体重グラフSVG');
assert(statsHtml.includes('月別サマリ') || statsHtml.includes('sum'), '月別サマリ');
assert(statsHtml.includes('2026/5'), '2026年5月の行');
console.log('OK レポート: グラフ + 月別サマリ');

// 10) ボリュームの検算（9/28: 47*10*3 + 32*5 + 25*10 + 40*5 + 33*6*2 = 2416）
let vol928 = 0;
for (const w2 of store.days['2025-09-28'].workouts) for (const s of (w2.sets || [])) if (s.w != null) vol928 += s.w * s.r;
assert.strictEqual(vol928, 2416, '9/28ボリューム検算');
console.log('OK ボリューム計算 (9/28 = 2416kg)');

// 11) 種目管理: 追加・非表示・リネーム
document.getElementById('newExName').value = 'スクワット';
document.getElementById('newExType').value = 'weight';
addEx();
assert(store.exercises.some(e => e.name === 'スクワット'), '種目追加');
toggleEx(store.exercises.length - 1);
assert.strictEqual(store.exercises[store.exercises.length - 1].hidden, true, '非表示');
renameEx(0, '背中(ラット)');
assert.strictEqual(store.exercises[0].name, '背中(ラット)');
renameEx(0, '背中');
console.log('OK 種目の追加・非表示・リネーム');

// 12) 空の日はクリーンアップされる
openDate('2026-07-06');
setBody('weight', '60');
setBody('weight', '');
assert(!store.days['2026-07-06'], '空になった日は削除');
console.log('OK 空の日のクリーンアップ');

// 13) localStorageから再ロードしても一致
const reloaded = JSON.parse(lsData['kintore.v1']);
assert.strictEqual(Object.keys(reloaded.days).length, Object.keys(store.days).length);
console.log('OK 永続化');

// 14) v1データ（メモ入り）からの移行: 既存端末のlocalStorageを模擬
lsData['kintore.v1'] = JSON.stringify({
  version: 1,
  exercises: [{ id: 's', name: '背中', type: 'weight' }],
  days: { '2026-01-01': { note: '日メモ', workouts: [{ ex: 's', sets: [{ w: 40, r: 10 }], note: '種目メモ' }] } },
});
eval(bootstrap);
const migrated = globalThis.__api.store;
assert.strictEqual(migrated.version, 2, '移行後v2');
assert(!('note' in migrated.days['2026-01-01']), '既存日メモ削除');
assert(!('note' in migrated.days['2026-01-01'].workouts[0]), '既存種目メモ削除');
assert.deepStrictEqual(migrated.days['2026-01-01'].workouts[0].sets, [{ w: 40, r: 10 }], 'セットは保持');
assert(JSON.parse(lsData['kintore.v1']).version === 2, '移行結果が保存される');
console.log('OK v1→v2移行（既存端末のメモ削除）');

// 15) クラウドバックアップ（fetchモック）
(async () => {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    if (!opts.method) return { status: 200, ok: true, json: async () => ({ sha: 'abc' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const cb = globalThis.__api.cloudBackup;
  let r = await cb();
  assert.strictEqual(r.skipped, 'no-token', 'トークン未設定はスキップ');
  lsData['kintore.cloudToken'] = 'testtoken';
  r = await cb();
  assert(r.ok, 'バックアップ成功');
  assert.strictEqual(calls.length, 2, 'GET(sha取得)+PUT');
  assert(calls[1].url.includes('app-backups/contents/kintore.json'), 'アップロード先');
  assert(JSON.parse(calls[1].body).sha === 'abc', '既存ファイルのshaを指定');
  assert(JSON.parse(lsData['kintore.cloudMeta']).last, 'バックアップ日を記録');
  r = await cb();
  assert.strictEqual(r.skipped, 'done-today', '同日2回目はスキップ');
  r = await cb(true);
  assert(r.ok, 'force指定は同日でも実行');
  console.log('OK クラウドバックアップ（1日1回・sha更新・スキップ判定）');

  console.log('\n=== 全15項目 PASS ===');
})().catch(e => { console.error(e); process.exit(1); });
