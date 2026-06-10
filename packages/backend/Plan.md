# Plan.md（packages/backend）

### Phase 1 コアプロトコル バックエンド実装 - 2026-06-10

#### 目的

docs/specs/2026-06-10-zerokey-family-phase1-core.md の家族登録・確認要求・端末署名・検証・失効・緊急停止のコアプロトコルを Hono + bun:sqlite + WebCrypto (Ed25519) で TDD 実装する。

#### 制約

- packages/backend/ 以外に触れない。package.json / tsconfig / biome.json を変更しない。
- モック禁止（実 SQLite :memory: / 実 Hono app.request() / 実 WebCrypto）。
- Clock 注入で待機時間（48h / 30 分）のテストに実時間を使わない。
- 日本語 BDD（describe/it）。`it.only` / `xit` 禁止。

#### タスク

- [x] 仕様書・user-journeys・failure-and-offline-behaviors の読み込み。
- [x] Bun の Ed25519 WebCrypto サポート確認。
- [x] テスト先行作成（src/crypto.test.ts / src/app.test.ts）。
- [x] 実装（src/clock.ts / src/crypto.ts / src/db.ts / src/app.ts / src/index.ts）。
- [x] bun test / bunx tsc --noEmit / bun biome check を全て Green にする。

#### 検証手順

```bash
cd packages/backend && bun test && bunx tsc --noEmit
cd ../.. && bun biome check packages/backend
```

#### 進捗ログ

- 2026-06-10: 仕様読み込み・環境確認（Bun 1.3.11、Ed25519 verify 動作確認）完了。
- 2026-06-10: テスト・実装・品質ゲートを完了（テスト 48 件 Green、tsc / biome クリーン、実 DB での起動スモーク確認済み）。

#### 振り返り

- 問題: requests の status enum（仕様書）に承認収集中・待機中の中間状態が無い。
- 根本原因: 仕様書のデータモデルが確定状態のみ列挙し、高リスクフローの中間状態（収集中 / 待機中）を明示していなかった。
- 予防策: `collecting` / `waiting` を status に追加し、GET が approved を先行して返さないことをテストで固定した。仕様書側への反映はフォローアップ対象。
