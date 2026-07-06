# 筋トレ記録アプリ（PWA）

iPhoneのホーム画面から使う筋トレ記録アプリ。**修正指示を受けたら、必ず下の「修正フロー」を上から順に全部実行すること。**編集だけして終わるのは作業未完了。

- 公開URL: https://prkxfzmfx-pixel.github.io/workout-log/
- リポジトリ: https://github.com/prkxfzmfx-pixel/workout-log （公開。このフォルダが作業コピー）
- 姉妹アプリ: 家計簿 `..\_kakeibo_app\`。**タブ構成・レイアウト・操作感は両アプリで統一する方針**。片方のUIを変えるときは、もう片方にも同じ変更が必要か必ず検討し、ユーザーに一言確認するか両方に適用する

## 構成

| ファイル | 内容 |
|---|---|
| index.html | アプリ本体。CSS/JSすべてこの1ファイルに入っている（外部ライブラリ・CDN禁止） |
| data.js | 初回起動時にlocalStorageへ取り込む過去データ。**原則編集しない** |
| sw.js | Service Worker（ネットワーク優先・オフラインキャッシュ） |
| test/smoke.test.js | スモークテスト（DOMスタブ + eval方式） |

## 絶対に守ること

1. **データ本体はユーザーのiPhoneのlocalStorage**（キー `kintore.v1`）にあり、サーバーにバックアップはない。保存データの構造（days/exercisesの形）を変えるときは、**必ず `migrate()` に旧形式→新形式の変換を追加**し、テストに移行ケースを足す。既存データを壊すと復元不能
2. レイアウトの根幹を壊さない: `fitViewport()`（スタンドアロン時はscreen.height採用）、body/main/navのflex構造、セーフエリア対応。**`position: fixed` や `100vh/100dvh` を新たに使わない**（iOSスタンドアロンで高さがバグる。過去に実証済み）
3. 公開リポジトリなので、個人情報・トークン・APIキーを絶対に置かない
4. 新しいファイルを追加したら `sw.js` の `ASSETS` に追記し、`CACHE` 名の数字を+1する（例: kintore-v2 → v3）
5. 既存仕様（前回値プリセット、入力タブ離脱時の日付初期化、種目タイプ=重量×回数/回数のみ/分、除脂肪体重の自動計算）はテストが守っている。仕様を変えるならテストも同じコミットで更新する

## 修正フロー（この順で必ず全部やる）

1. `index.html` を編集する
2. テスト実行: `node test\smoke.test.js` → **全項目PASSするまで次に進まない**。新機能を足したらテストケースも追加
3. コミット & push（コミットメッセージは日本語で内容を書く）:
   ```powershell
   git add -A; git commit -m "変更内容"; git push
   ```
   （gitが見つからないシェルでは `C:\Program Files\Git\cmd\git.exe` を絶対パスで）
4. 配信確認（push後1〜2分かかる）。今回の変更にしか含まれない文字列で判定する:
   ```powershell
   (Invoke-WebRequest "https://prkxfzmfx-pixel.github.io/workout-log/?v=$(Get-Random)" -UseBasicParsing).Content -match "新コード固有の文字列"
   ```
5. **5分待っても旧版のままなら GitHub Pages のビルド詰まり**（このリポジトリで頻発）。再ビルドを蹴る:
   ```powershell
   & "C:\Program Files\GitHub CLI\gh.exe" api repos/prkxfzmfx-pixel/workout-log/pages/builds -X POST
   # 状態確認（building→builtになるのを待つ）:
   & "C:\Program Files\GitHub CLI\gh.exe" api repos/prkxfzmfx-pixel/workout-log/pages/builds/latest --jq .status
   ```
   （ghはこのPCで認証済み。認証エラーなら `gh auth status` を確認してユーザーに報告）
6. ユーザーへの完了報告に必ず含めること: **「iPhoneでアプリを完全終了（アプリスイッチャーから上スワイプ）→開き直しで反映。1回で変わらなければもう一度終了→起動」**

## 実装メモ

- 画面はタブ5つ: 入力 / カレンダー / 一覧 / レポート / 設定（この名前・順序は家計簿と統一。変えない）
- カレンダー: 日タップ→選択ハイライト＋下部に詳細（チップ表示）→「この日を修正」で入力タブへ
- 描画は `render()` が state.tab に応じて main.innerHTML を丸ごと書き換える方式。イベントはHTML属性のonclick
- グラフ色は検証済みパレット（体重=#2a78d6系 / 除脂肪=#1baf7a系、ダークモードは別調整値）。色を追加するときは凡例・ラベルを必ず併記
- クラウド自動バックアップ: 起動時＋前面復帰時に1日1回、非公開リポ `prkxfzmfx-pixel/app-backups` の `kintore.json` へGitHub API直接PUT（`cloudBackup()`）。トークン（Fine-grained PAT）はlocalStorage `kintore.cloudToken` にのみ保存。**トークンをコードやリポジトリに書かない**
