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

### セキュリティレビュー指摘 4 件の修正 - 2026-06-10

#### 目的

セキュリティレビューで検出された src/app.ts の欠陥 4 件を TDD（Red → Green）で修正する。

1. [high] refreshRequest が circle 停止状態を確認せず waiting → approved へ昇格させる。
2. [high] respond が応答者と target_member_id の関係を検証していない（誰でも承認できる）。
3. [medium] verifyEd25519 の await 中に走った cancel / stop を approved 書き込みが上書きする TOCTOU。
4. [medium] deadline 検証が parse 可能性のみで、回答期限の規定（10 分〜24 時間）を強制していない。

#### 制約

- packages/backend/ 配下のみ変更。設定ファイル・package.json・他パッケージ不変。git commit しない。
- モック禁止（実 SQLite :memory: / 実 WebCrypto / app.request()）。日本語 BDD。既存 48 テストを壊さない。

#### タスク

- [x] 失敗するテストを先に追加（項目 1〜4）。
- [x] 項目 1: refreshRequest で昇格直前に circle 停止を確認。停止中は waiting のまま。解除後の最初の GET で昇格を許可。
- [x] 項目 2: 承認は target 本人のみ。target 以外の承認は高リスクの第 2 承認（target の有効承認が先行）に限る。拒否は requester 以外のメンバーなら可。
- [x] 項目 3: 署名検証後・状態書き込み直前に要求 status と circle 停止を再読込し、terminal / 停止なら 409。
- [x] 項目 4: deadline が now + 10 分未満または now + 24 時間超なら 400（境界は許可）。
- [x] bun test / bunx tsc --noEmit / bun biome check を全て Green にする。

#### 検証手順

```bash
cd packages/backend && bun test && bunx tsc --noEmit
cd ../.. && bun biome check packages/backend
```

#### 進捗ログ

- 2026-06-10: 計画作成。app.ts / app.test.ts / docs（user-journeys フロー 4、failure-and-offline-behaviors の期限規定）を確認。
- 2026-06-10: テスト 12 件を先行追加し Red を確認（fail 9 / 新規仕様の正常系 3 は既存実装で pass）。
- 2026-06-10: app.ts に修正 4 件を実装し Green（60 pass / 0 fail、tsc・biome クリーン、harness 違反 0）。TOCTOU テストは同一ティック並行起動で 10 回連続安定を確認。

#### 振り返り

- 問題: 承認権限（誰の署名が有効か）と状態遷移の前提（停止・取り消しとの競合）がコード上で暗黙だったため、署名検証が正しくても危険な遷移が成立し得た。
- 根本原因: 「署名が正しい」と「その署名者にその操作の権限がある」「書き込み時点でも前提が成立している」を分離して検証していなかった。
- 予防策: 承認者制約・停止中の昇格禁止・書き込み直前の再チェック・期限範囲をすべてテストで固定した。今後 status を書き込む経路を追加する際は、書き込み直前の再読込（TOCTOU ガード）を必須とする。
