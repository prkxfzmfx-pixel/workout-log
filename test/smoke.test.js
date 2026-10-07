// index.html のインラインJSをDOMスタブ上で実行して主要動線を検証する
// 実行: node test\smoke.test.js （全項目PASSしてからpushすること）
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dataJs = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
const bodyImportJs = fs.readFileSync(path.join(__dirname, '..', 'body-import.js'), 'utf8');
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
global.alert = msg => { global.__lastAlert = msg; };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.Blob = class {};
global.FileReader = class { readAsText() {} };

// ---- 実行 ----
// 'use strict' のため eval 内の宣言は外に漏れない → APIをglobalに書き出す
const bootstrap = `(function(){ 'use strict';\n` + dataJs + '\n' + bodyImportJs + '\n' + appJs + `
;globalThis.__api = {
  get store() { return store; },
  state, go, render, openDate, setBody, addWorkout, addSet, delSet, setSetVal,
  addEx, toggleEx, renameEx, calSelect, cloudBackup, decryptWithPin, applyPinToken,
  applyBodyImport, BODY_IMPORT, save,
};})()`;
eval(bootstrap);
const { state, go, render, openDate, setBody, addWorkout, addSet, delSet, setSetVal, addEx, toggleEx, renameEx, calSelect } = globalThis.__api;
const store = new Proxy({}, { get: (_, k) => globalThis.__api.store[k], has: (_, k) => k in globalThis.__api.store });

// 1) 初期シード（data.js 87日 + body-import.js の体組成237日 → 新規日付200日が増えて287日）
assert.strictEqual(Object.keys(store.days).length, 287, '初期データ87日 + 体組成取り込みで287日');
assert.strictEqual(store.exercises.length, 8, '種目8件');
assert.strictEqual(Object.keys(globalThis.__api.BODY_IMPORT.days).length, 237, '体組成取り込みデータ237日');
assert.deepStrictEqual(store.days['2026-08-28'].body, { weight: 58.6, fat: 18.6 }, '取り込んだ体組成（最新日）');
assert.deepStrictEqual(store.days['2026-08-28'].workouts, [], '体組成だけの日はworkouts空');
assert.deepStrictEqual(store.days['2023-11-17'].body, { weight: 59.4 }, '体脂肪率が--の日は体重だけ取り込む');
assert.strictEqual(lsData['kintore.bodyImport'], 'fitdays-20260829', '取り込み済みフラグ');
console.log('OK 初期シード: 287日（87日 + 体組成200日） / 8種目 / 体組成取り込み');

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
calSelect('2026-05-21'); // 記録なしの日
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

// 6) 前回値プリセット: 胸を追加 → 直近の胸 2026-06-17 の 33kg×10,8,6 が入る
addWorkout('m');
const w = store.days['2026-07-05'].workouts[0];
assert.strictEqual(w.ex, 'm');
assert.deepStrictEqual(w.sets, [{ w: 33, r: 10 }, { w: 33, r: 8 }, { w: 33, r: 6 }], '前回値プリセット');
console.log('OK 前回値プリセット (胸: 33kg 10/8/6回)');

// 7) セット追加＝直前セットの複製、値変更、削除
addSet(0);
assert.deepStrictEqual(store.days['2026-07-05'].workouts[0].sets[3], { w: 33, r: 6 });
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

// 15) 体組成の一括取り込みは非破壊（既存bodyを上書きしない／既存の日にはbodyだけ足す／1回だけ）
lsData['kintore.v1'] = JSON.stringify({
  version: 2,
  exercises: [{ id: 's', name: '背中', type: 'weight' }],
  days: {
    // 既存の体組成（Fitdaysの値と違う）→ 絶対に上書きされないこと
    '2026-08-27': { workouts: [], body: { weight: 99, fat: 99 } },
    // 筋トレだけの既存日 → workoutsを保ったままbodyが足されること
    '2026-08-24': { workouts: [{ ex: 's', sets: [{ w: 40, r: 10 }] }] },
  },
});
delete lsData['kintore.bodyImport'];
eval(bootstrap);
const imported = globalThis.__api.store;
assert.deepStrictEqual(imported.days['2026-08-27'].body, { weight: 99, fat: 99 }, '既存bodyは上書きしない');
assert.deepStrictEqual(imported.days['2026-08-24'].body, { weight: 59.1, fat: 18.9 }, '既存日にbodyだけ追加');
assert.deepStrictEqual(imported.days['2026-08-24'].workouts, [{ ex: 's', sets: [{ w: 40, r: 10 }] }], '既存workoutsは保持');
assert.strictEqual(Object.keys(imported.days).length, 2 + 235, '既存2日 + 新規235日');
assert.strictEqual(lsData['kintore.bodyImport'], 'fitdays-20260829', '取り込み済みフラグを記録');
// 2回目は何もしない（利用者が消した日を復活させない）
delete imported.days['2026-08-28'];
const again = globalThis.__api.applyBodyImport();
assert.strictEqual(again.skipped, 'done', '2回目の取り込みはスキップ');
assert(!imported.days['2026-08-28'], '消した日は復活しない');
console.log('OK 体組成の一括取り込み（非破壊・既存body保護・1回だけ）');

// 16) クラウドバックアップ（fetchモック）
(async () => {
  // 簡易クラウド: GET(JSON)は sha と base64本文、PUTは本文を保管
  const calls = [];
  let cloud = null; // { text, sha }
  global.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body });
    if (method === 'PUT') {
      const b = JSON.parse(opts.body);
      cloud = { text: Buffer.from(b.content, 'base64').toString('utf8'), sha: 'sha' + calls.length };
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (!cloud) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ sha: cloud.sha, content: Buffer.from(cloud.text, 'utf8').toString('base64') }) };
  };
  const puts = () => calls.filter(c => c.method === 'PUT').length;
  const api = globalThis.__api;
  const cb = api.cloudBackup;
  let r = await cb();
  assert.strictEqual(r.skipped, 'no-token', 'トークン未設定はスキップ');
  lsData['kintore.cloudToken'] = 'testtoken';
  // クラウドにまだ無い → アップロード
  r = await cb();
  assert(r.ok, '初回はアップロード');
  assert.strictEqual(puts(), 1, 'PUT 1回');
  assert(calls.find(c => c.method === 'PUT').url.includes('app-backups/contents/kintore.json'), 'アップロード先');
  assert(JSON.parse(lsData['kintore.cloudMeta']).last, '同期日を記録');
  // 同じ更新時刻なら何もしない（同日でも1日1回でもなく、時刻比較で判定）
  r = await cb();
  assert.strictEqual(r.skipped, 'up-to-date', '更新時刻が同じならスキップ');
  assert.strictEqual(puts(), 1, 'スキップ時はPUTしない');
  // 手元で人が編集（save()でupdatedAtが進む）→ アップロード。既存shaを指定し、本文にupdatedAtが入る
  delete lsData['kintore.cloudToken']; // save()の4秒後同期タイマーを後続テスト中に走らせない
  const tHuman = Date.now();
  api.store.days['2099-01-01'] = { workouts: [] };
  api.save();
  lsData['kintore.cloudToken'] = 'testtoken';
  assert(api.store.updatedAt >= tHuman, '人の操作による保存ではupdatedAtが進む');
  const shaBefore = cloud.sha;
  r = await cb();
  assert(r.ok, '手元が新しければ再アップロード');
  assert.strictEqual(JSON.parse(calls.filter(c => c.method === 'PUT').pop().body).sha, shaBefore, '既存ファイルのshaを指定');
  assert.strictEqual(JSON.parse(cloud.text).updatedAt, api.store.updatedAt, 'クラウドにupdatedAtが保存される');
  // 他端末（スマホ）でより新しく入力された → この端末（PC）は確認なしで自動取り込みし、上書きしない
  const phone = JSON.parse(cloud.text);
  phone.days['2099-01-02'] = { workouts: [], body: { weight: 60 } };
  phone.updatedAt = api.store.updatedAt + 60000;
  cloud = { text: JSON.stringify(phone), sha: 'phoneSha' };
  const putsBefore = puts();
  r = await cb();
  assert(r.pulled, 'クラウドが新しければ取り込む');
  assert(api.store.days['2099-01-02'], 'スマホの入力がPCに反映される');
  assert.strictEqual(api.store.updatedAt, phone.updatedAt, '更新時刻もクラウドに揃う');
  assert.strictEqual(puts(), putsBefore, '古い端末からはアップロードしない（上書き事故防止）');
  assert(JSON.parse(lsData['kintore.v1']).days['2099-01-02'], '取り込んだデータを端末に保存');
  // 体組成の自動取り込み（機械的な変更）は更新時刻を進めない
  delete lsData['kintore.cloudToken'];
  delete lsData['kintore.bodyImport'];
  const stampBefore = api.store.updatedAt;
  const imp = api.applyBodyImport();
  lsData['kintore.cloudToken'] = 'testtoken';
  assert(imp.added > 0, '前提: 体組成の取り込みが発生');
  assert.strictEqual(api.store.updatedAt, stampBefore, '自動取り込みではupdatedAtが変わらない');
  r = await cb();
  assert.strictEqual(r.skipped, 'up-to-date', '自動取り込みだけではアップロードしない');
  // 旧データ同士（どちらも更新時刻なし）で内容が違っても、どちらかを推測で上書きしない
  const legacyCloud = JSON.parse(cloud.text); delete legacyCloud.updatedAt; legacyCloud.days = {};
  cloud = { text: JSON.stringify(legacyCloud), sha: 'legacy' };
  delete api.store.updatedAt;
  const nDays = Object.keys(api.store.days).length, putsLegacy = puts();
  r = await cb();
  assert.strictEqual(r.skipped, 'up-to-date', '時刻なし同士は何もしない');
  assert.strictEqual(Object.keys(api.store.days).length, nDays, '取り込みもしない');
  assert.strictEqual(puts(), putsLegacy, 'アップロードもしない');
  // 明示の「今すぐバックアップ」は比較せずアップロード
  r = await cb(true);
  assert(r.ok, 'force指定は常にアップロード');
  assert.strictEqual(puts(), putsLegacy + 1, 'force時はPUT');
  console.log('OK クラウド同期（新しい方を採用・PCは自動取り込み・古い端末は上書きしない・自動取り込みは時刻不変）');

  // 17) かんたん設定コード（6桁→トークン復号）。実コード・実トークンは使わずテスト専用の暗号文で往復検証
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const km = await crypto.subtle.importKey('raw', enc.encode('123456'), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('github_pat_TESTTOKEN')));
  const blob = Buffer.concat([salt, iv, ct]).toString('base64');
  assert.strictEqual(await globalThis.__api.decryptWithPin('123456', blob), 'github_pat_TESTTOKEN', '正しいコードで復号できる');
  let pinFailed = false;
  try { await globalThis.__api.decryptWithPin('000000', blob); } catch (e) { pinFailed = true; }
  assert(pinFailed, '誤ったコードは復号失敗（AES-GCM認証エラー）');
  globalThis.__api.go('settings');
  assert(elements.main.innerHTML.includes('id="cloudPin"'), '設定タブにコード入力欄');
  document.getElementById('cloudPin').value = '000000';
  global.__lastAlert = '';
  await globalThis.__api.applyPinToken();
  assert.strictEqual(global.__lastAlert, 'パスワードが間違っています', '誤ったコードでエラーメッセージ');
  console.log('OK かんたん設定コード（復号往復・誤コード検出）');

  console.log('\n=== 全17項目 PASS ===');
})().catch(e => { console.error(e); process.exit(1); });
