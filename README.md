# ZeroKey Family

AI 音声・映像の真偽判定に頼らず、具体的な依頼内容に対する家族の意思表示を暗号的に検証する家族向け確認サービス。問いを「この声は本物か」から「この依頼に、本物の家族の登録端末が署名したか」へ変える。

詐欺電話の主要な標的である高齢者とその家族を主対象に、高額送金や送金先変更などの操作を、声や電話番号ではなく登録端末の署名で確かめる。プロダクトの定義は [docs/product/](./docs/product/) を正本とする（[ビジョン](./docs/product/vision.md) / [Trust Claims](./docs/product/trust-claims.md) / [スコープと非目標](./docs/product/scope-and-non-goals.md) / [用語集](./docs/product/glossary.md)）。

## 何を保証し、何を保証しないか

「確認済み」は「対象メンバーの失効していない登録端末の秘密鍵が、その依頼の内容（対象・金額・送金先・理由・期限・nonce・依頼者）そのものに署名した」ことだけを意味する。相手が本人で安全だという意味ではない。脅迫下の承認・端末乗っ取り・家族内不正は保証しない。声・映像・電話番号・表示名を信頼の根にしない。詳細は [Trust Claims](./docs/product/trust-claims.md) を参照。

## 実装状況

Phase 1（初期商用リリース相当）のリファレンス実装が動作する。コミット履歴ではなく、リリースゲートの正本は [docs/product/roadmap.md](./docs/product/roadmap.md)。

- バックエンド（`packages/backend`、Hono + `bun:sqlite` + WebCrypto Ed25519）: メンバー・端末登録、家族グループ、招待（対面 QR / 遠隔 48 時間待機）、確認要求（金額・送金先・理由を API レベルで必須化、nonce はサーバー生成）、署名検証（保存済み要求から canonical を再構築し、改ざん・リプレイ・失効鍵・期限超過・停止中を拒否）、高リスク操作（10 万円以上の第 2 承認、初送金先の 30 分待機、独立判定）、緊急停止（単独発動・発動者以外を含む 2 署名で解除）。
- フロントエンド（`packages/frontend`、Vite + React + WebCrypto）: 名前オンボーディング、家族の管理（家族コード共有・招待コードでの参加・メンバー一覧）、確認要求の作成、受信箱、承認・拒否（端末鍵で署名、秘密鍵は端末外に出さない）、結果状態（確認済み・拒否・応答なし・期限切れ・検証失敗・収集中・待機中）の出し分け、緊急停止。文言は [安全文言ガイド](./docs/product/safety-copy-guide.md) に準拠する。

二人がそれぞれの端末（ブラウザ）で同じ家族コードを共有すると、依頼者と承認者のクロスメンバーのフローを実署名で再現できる（実際の二台のスマートフォンと同じモデル）。

### 本リポジトリの対象外

ネイティブ iOS / Android アプリ、ZKP / MPC / FHE、ブロックチェイン Trust Registry、独立した暗号レビュー・侵入テスト・ストア審査は Phase 2 以降または外部プロセスであり、本リポジトリのコードには含まれない。境界は [スコープと非目標](./docs/product/scope-and-non-goals.md) を参照。

加えて、本リファレンス実装の API はセッション認証層を持たず、メンバー ID を申告された呼び出し元として信頼する。読み取り API は家族コードだけの非メンバーに名簿・履歴を露出しないようメンバー ID を要求するが、これは整合性の確認であり、呼び出し元が当該メンバー本人であることの証明ではない。本番では各リクエストに端末セッション認証（端末鍵による署名付きセッション）を課す必要がある。署名検証の核（依頼内容への端末署名）はサーバー認証に依存せず成立する点は変わらない。

## 技術スタック

| 用途 | ツール |
| --- | --- |
| ランタイム | Bun |
| バックエンド | Hono + `bun:sqlite` |
| フロントエンド | Vite + React |
| 暗号 | WebCrypto（Ed25519、秘密鍵は端末内のセキュアハードウェア前提） |
| リンター/フォーマッター | Biome |
| テスト | bun test（モックなし: 実 DB・実 WebCrypto・実 HTTP・実レンダリング） |

## セットアップと実行

```bash
make install        # 依存をインストール（--ignore-scripts）

# 開発サーバ（backend: http://localhost:3000 / frontend: vite が /api を proxy）
make dev

make test           # 全ワークスペースのテスト
make typecheck      # tsc --noEmit
make build          # プロダクションビルド
make before-commit  # 品質ゲート一括（architecture-harness + harness_test + lint）
bun scripts/e2e-phase1.ts   # 実バックエンド + 実フロント API で核ジャーニーを通す結合ゲート
```

## ディレクトリ構成

```
.
├── docs/product/    # プロダクト定義の正本（ビジョン・Trust Claims・ジャーニー・文言）
├── docs/specs/      # Phase 1 仕様書と役割別レビュー
├── packages/backend/   # Hono API（署名検証の核）
├── packages/frontend/  # Vite + React クライアント
├── scripts/         # architecture-harness と e2e ゲート
└── docs/architecture/harness.md  # invariant の正本
```

## サプライチェイン防御

このテンプレート由来の多層防御を引き継ぐ。`make install` は常に `--ignore-scripts` を付け、`bunfig.toml` の `trustedDependencies = []` で lifecycle script を止め、`architecture-harness` が Git URL 依存・lifecycle hook 濫用・IOC を機械検出する。設計判断の正本は [ADR-0001](./docs/adr/0001-supply-chain-hardening.md)。

## 開発ガイドライン

[CLAUDE.md](./CLAUDE.md) と [AGENTS.md](./AGENTS.md) を参照。新機能は `/feature` スキル経由で開発する。
