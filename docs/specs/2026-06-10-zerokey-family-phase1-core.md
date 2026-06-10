# ZeroKey Family Phase 1 コア機能 仕様書

## 概要

docs/product/ の正本文書群（[vision](../product/vision.md) / [trust-claims](../product/trust-claims.md) / [scope-and-non-goals](../product/scope-and-non-goals.md) / [user-journeys](../product/user-journeys.md)）に基づき、家族登録・確認要求・端末署名・検証・失効・緊急停止のコアプロトコルを本リポジトリのスタック（Bun + Hono + SQLite + Vite + React）でリファレンス実装する。iOS / Android ネイティブ実装・ストア配布・セキュアハードウェア統合は本仕様のスコープ外であり、本実装はドメインロジックと API・Web UI の正本となる。

- 正本 Issue: https://github.com/susumutomita/ZeroKeyFamily/issues/1（ロードマップ）、https://github.com/susumutomita/ZeroKeyFamily/issues/2（プロダクト定義）、https://github.com/susumutomita/ZeroKeyFamily/issues/3（ユーザージャーニー）
- ヒアリング: ユーザー作成の上記 Issue と承認済み docs/product/ 文書群を回答として扱う（`/goal` による自律実行指示に基づく）。

## ユーザーストーリー

- 高齢の親として、詐欺電話の最中に「依頼内容」を本物の家族の登録端末で確かめるために、確認要求を送りたい。
- 家族として、身に覚えのない依頼を拒否し、その結果が依頼者に明確に伝わるようにしたい。
- 家族として、端末を失ったときに鍵を即時失効し、以後その鍵の署名が無効になるようにしたい。
- 家族として、詐欺疑い・誤承認に気づいたら単独で緊急停止を発動したい。

## 受け入れ基準

[user-journeys](../product/user-journeys.md) の開始・終了・失敗条件と [failure-and-offline-behaviors](../product/failure-and-offline-behaviors.md) の「実装欠陥として扱う挙動」を正とする。特に以下はテストで担保する。

- [ ] 金額・送金先・理由のいずれかが欠けた確認要求は API レベルで拒否される（クライアント検証に依存しない）。
- [ ] 署名は対象・金額・送金先・理由・期限・nonce・依頼者を束縛し、フィールドを 1 つでも改変した検証は失敗する。
- [ ] nonce・期限の不一致（リプレイ）は検証で拒否される。
- [ ] 失効済み端末鍵の署名は「確認済み」にならない。
- [ ] 「応答なし」（期限内・未応答）と「期限切れ」（確定）は別状態として API が返す。応答なしを承認として扱う経路が存在しない。
- [ ] 高リスク要求（10 万円以上 → 第 2 承認、初送金先 → 30 分待機）は条件を独立判定し、回避経路がない。
- [ ] 緊急停止は単独メンバーで発動でき、停止中の承認は成立しない。解除には発動者以外を含む 2 人の署名が必要。
- [ ] 遠隔招待は 48 時間の待機満了前に承認を完了できない。

## 非機能要件

- パフォーマンス: 検証 API は 100ms 以内（ローカル SQLite 前提）。
- セキュリティ: 秘密鍵はサーバーへ送信しない（クライアント側 WebCrypto で生成・署名）。暗号は WebCrypto の Ed25519 のみ（自作暗号禁止）。
- アクセシビリティ: [wireframes](../product/wireframes.md) の共通デザイン要件（最小 17pt 相当、色のみに依存しない状態表示、「困ったとき」導線）。
- テスト: TDD、`describe`/`it` は日本語 BDD。モック禁止（実 SQLite・実 Hono アプリ・実 WebCrypto を使う）。

## 技術設計

### データモデル（bun:sqlite）

- `members` — id, name, created_at。
- `devices` — id, member_id, public_key (base64), status ('active' | 'revoked'), created_at, revoked_at。
- `circles` — id, name, status ('normal' | 'stopped'), created_at。
- `circle_members` — circle_id, member_id, joined_at, left_at。
- `invites` — id, circle_id, inviter_member_id, kind ('qr' | 'remote'), status ('pending' | 'waiting' | 'confirmed' | 'cancelled'), created_at, confirmable_at（remote は作成 + 48h）。
- `requests` — id, circle_id, requester_member_id, target_member_id, subject, amount, beneficiary, reason, deadline, nonce, status ('unanswered' | 'collecting' | 'waiting' | 'approved' | 'rejected' | 'expired' | 'verification_failed' | 'invalidated'), high_risk_second_approval (bool), high_risk_wait_required (bool), high_risk_wait_until (nullable), created_at。`collecting` は高リスク要求で必要署名が揃うまでの収集状態、`waiting` は必要署名が揃ってから 30 分待機の満了までの状態（いずれも approved を先行して返さない）。
- `responses` — id, request_id, device_id, kind ('approve' | 'reject'), payload (canonical JSON), signature (base64), verified (bool), created_at。
- `stop_events` / `stop_releases` — 緊急停止の発動・解除（解除署名 2 件、発動者以外を含む）。

### 署名ペイロード（canonical 形式）

キーを辞書順に並べた JSON 文字列を UTF-8 でエンコードし、Ed25519 で署名する。

```json
{"amount":300000,"beneficiary":"○○銀行 1234567","circleId":"...","deadline":"2026-06-10T15:30:00Z","kind":"approve","nonce":"...","reason":"会社のお金をなくした","requestId":"...","requesterId":"...","subject":"お金を送ってほしいと言われた","targetId":"..."}
```

サーバーは保存済み要求からこの canonical 文字列を再構築して検証する（クライアント提示のペイロードを信頼しない）。

緊急停止の解除署名は、キー辞書順の `{"circleId":"...","kind":"release","stopEventId":"..."}` を同形式で署名する（stopEventId を束縛し、別の停止イベントへの流用を防ぐ）。

### API エンドポイント（Hono、`/api` 配下）

- `POST /api/members` — メンバー + 初回端末（公開鍵）登録。
- `POST /api/circles` — 家族グループ作成。
- `POST /api/invites` / `POST /api/invites/:id/confirm` / `POST /api/invites/:id/cancel` — 招待。remote は confirmable_at 前の confirm を 409 で拒否。
- `POST /api/requests` — 確認要求作成。amount / beneficiary / reason 欠落は 400。高リスク判定をサーバー側で実施。
- `GET /api/requests/:id` — 状態取得。期限超過は読み取り時に 'expired' へ確定。応答なしは 'unanswered' のまま返す。
- `POST /api/requests/:id/respond` — 署名付き応答。検証成功で approved / rejected、失敗で verification_failed。停止中 circle は 409。
- `POST /api/requests/:id/cancel` — 依頼者による取り消し（W-05 の導線）。
- `POST /api/devices/:id/revoke` — 失効。
- `POST /api/circles/:id/stop` / `POST /api/circles/:id/release` — 緊急停止・解除（解除は署名 2 件）。

時刻は `Clock` インターフェースで注入し、待機時間（48h / 30 分）のテストで実時間待ちをしない。

### UI コンポーネント（packages/frontend、React）

[wireframes](../product/wireframes.md) W-01〜W-09 に対応する画面。最低限、ホーム / 確認要求作成（必須項目バリデーション）/ 受信・承認（スライド相当の二段階操作）/ 結果 5 状態（確認済み・拒否・応答なし・期限切れ・検証失敗）/ 緊急停止。鍵生成と署名はブラウザの WebCrypto で行い、秘密鍵は IndexedDB（exportable=false 相当の運用）に保持する。文言は [safety-copy-guide](../product/safety-copy-guide.md) に従う。

## スコープ外

- iOS / Android ネイティブアプリ、Secure Enclave / StrongBox 統合、ストア配布。
- ZKP / MPC / FHE / ブロックチェーン Trust Registry（[scope-and-non-goals](../product/scope-and-non-goals.md) のとおり Phase 2 以降）。
- プッシュ通知・本人確認（eKYC）外部連携・運用監視基盤。
