# 🌍 TrendScope 公開版（GitHub ＋ Cloudflare Pages）の始め方

```
GitHub（コード）──push──▶ Cloudflare Pages（公開サイト・自動デプロイ）
GitHub Actions（1時間ごと）──ニュース収集──▶ /api/upload ──▶ Workers KV（データ）
あなたのPCの TrendScope からも同じように送れます（☰ → 🌍 公開サイト）
```

公開版に載るのは **見出し（翻訳）・リンク・自動分析の結果だけ** です。設定・履歴・メモ・記事本文は載りません。

## 1. Cloudflare Pages にサイトを作る（最初の1回）
1. https://dash.cloudflare.com/sign-up でアカウント作成（無料）
2. **Workers & Pages → Create → Pages → Connect to Git** → GitHub を連携して **trendscope** を選ぶ
3. ビルド設定:
   - Framework preset: **None**
   - Build command: **（空欄）**
   - Build output directory: **public**
   - Root directory（Advanced）: **cloudflare**
4. **Save and Deploy** → `https://〜.pages.dev` のURLが出たらメモ

## 2. データ置き場（KV）をつなぐ
1. **Workers & Pages → KV（Storage & Databases）→ Create namespace**、名前は `trendscope`
2. Pages のプロジェクト → **Settings → Bindings → Add → KV namespace**
   - Variable name: **TS** ／ KV namespace: **trendscope**

## 3. 合言葉を登録
1. TrendScope の **☰ → 🌍 公開サイト → 🎲 合言葉を作る**（コピーされます）
2. Pages のプロジェクト → **Settings → Variables and Secrets → Add**
   - Type: **Secret**、Name: **UPLOAD_SECRET**、Value: 合言葉
3. **Deployments → 最新のデプロイの「…」→ Retry deployment**（設定を反映）

## 4. 1時間ごとの自動更新（GitHub Actions）
1. GitHub の trendscope → **Settings → Secrets and variables → Actions → New repository secret**
   - `PUBLIC_SITE_URL` = `https://〜.pages.dev`
   - `UPLOAD_SECRET` = 手順3と同じ合言葉
2. **Actions** タブ → 「公開版のニュースを更新」→ **Run workflow** で初回を実行
3. 緑のチェックになれば成功。以後は毎時17分に自動で更新されます
   - 翻訳を公開したくない場合: **Variables** タブに `PUBLIC_TRANSLATE` = `0`

## 5. 安全対策
| 対策 | 内容 |
|---|---|
| アクセス回数の制限 | 1つのIPから: データ60回/分、飛行機12回/分、送信10回/分（Cloudflareの拠点ごとの簡易カウント） |
| データ送信の保護 | 合言葉（16文字以上）必須。比較は時間差攻撃に強い方式。知らない項目は保存前に捨てる |
| ロボット対策（任意） | Cloudflare Turnstile。**Turnstile → Add widget** で `〜.pages.dev` を登録し、`TURNSTILE_SITEKEY`（Plaintext）と `TURNSTILE_SECRET`（Secret）を Variables に追加。通過した人だけ飛行機機能を1時間使える |
| セキュリティヘッダー | HTTPS強制・CSP・埋め込み禁止など（`cloudflare/public/_headers`） |
| 改ざん検知 | 地図ライブラリをハッシュ値で確認（SRI） |
| 釣り判定 | ブラウザ内だけで判定。入力内容はどこにも送らない |

**もっと強い回数制限が欲しくなったら**: 独自ドメインを Cloudflare に追加すると、WAF の「Rate limiting rules」（無料で1ルール）でサイト全体に正式な回数制限をかけられます。

## 6. 検索エンジンに載せる
- トップページは最新の見出しを HTML に直接書き込んで返します（検索エンジンが読みやすい）
- `/sitemap.xml` と `/robots.txt` は自動生成
- **Google Search Console** にサイトを登録してサイトマップを送信

## 7. 無料枠の目安
| 項目 | 無料枠 | TrendScopeの使い方 |
|---|---|---|
| ビルド（デプロイ） | 月500回 | コードを更新したときだけ |
| 静的ファイルの通信量 | 無制限 | 画面・スクリプト |
| Functions（/api/〜） | 1日10万回 | データ取得（5分キャッシュ）・飛行機 |
| KV 書き込み | 1日1,000回 | 1時間1回＝1日24回 |
| GitHub Actions | 公開リポジトリは無料 | 1時間1回・1〜2分 |

## 8. 著作権・利用規約
- 載せるのは見出し・リンク・自動分析のみ。日本のニュースサイトは件数比較のみ
- 見出しの機械翻訳（Google翻訳の無料窓口）は公開利用だとグレーゾーン。気になる場合は `PUBLIC_TRANSLATE=0`
- 出典はページ下部に表示。問い合わせ先をページに書いておくのがおすすめ
