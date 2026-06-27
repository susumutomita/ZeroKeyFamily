# Plan.md

### 監査ログの記録と参照 API（Issue 12） - 2026-06-27

#### 目的

安全上重要なイベント（メンバー / 端末登録・端末失効・招待発行 / 確認 / 取消・確認要求作成 / 承認 / 拒否 / 取消 / 検証失敗 / リプレイ拒否・緊急停止 / 解除）を追記専用で記録し、家族メンバーが自分の家族の証跡を参照できる API を追加する。運用ゲート（インシデント対応）と脅威モデル（家族内不正・事後追跡）の前提を満たす。Issue: https://github.com/susumutomita/ZeroKeyFamily/issues/12 。

#### 制約

- 実 SQLite・実 HTTP（モック禁止）。TDD・日本語 BDD・カバレッジ維持。
- 機微情報（金額・送金先・理由・件名・秘密鍵）を平文で証跡に残さない。要約は固定の最小ラベルとし、対象は ID で参照する。
- 追記専用。audit_log への UPDATE / DELETE を実装しない。
- 参照 API は既存の `isCircleMember` 認可規約を踏襲し、非メンバーへ 403 を返す。
- ゲート（architecture-harness → make before-commit → backend test/typecheck/build → e2e）を全 Green にするまで未完了。

#### タスク

1. `packages/backend/src/db.ts` に追記専用 `audit_log` テーブルを追加。
2. `packages/backend/src/app.ts` に `appendAudit` ヘルパーと各イベント点での記録を追加。
3. `GET /api/circles/:id/audit`（メンバー限定・時系列）を追加。
4. 日本語 BDD テスト（記録・非メンバー 403・追記専用・機微情報の非格納・時系列順）を追加。
5. `scripts/e2e-phase1.ts` に証跡アサーションを追加。

#### 検証手順

- `bun test`（backend）が Green。
- `bun scripts/e2e-phase1.ts` が核ジャーニー後に期待した証跡を返す。
- `make before-commit` と backend の typecheck / build が Green。

#### 進捗ログ

- 2026-06-27: ブランチ `claude/phase1-audit-log` で着手。既存ルートの棚卸しから記録すべきイベント点を確定。
- 2026-06-27: TDD で実装。`audit_log` 追記専用テーブル、`appendAudit` ヘルパー、各イベント点での記録、`GET /api/circles/:id/audit`（メンバー限定・時系列）を追加。backend テスト 87 件・typecheck・build・biome・architecture-harness・e2e（証跡アサーション 4 件）が Green。
- 2026-06-27: /security-review は指摘 0 件。/code-review（high・workflow）で 10 件を検出し対応。監査整合性: 認可拒否した応答試行を `request_response_denied` で記録（自己承認など家族内不正の追跡）、端末失効・招待取消の actor 誤帰属を NULL に修正（実行者の確定は Issue 13 のセッション認証へ）、`circle_released` の targetId を circle.id に統一。品質: 読み取り認可を `requireCircleMember` ヘルパーへ集約（members / requests / audit の三重化を解消）、`circle_released` の summary を固定ラベル化、監査参照に既定 100・上限 500 の limit を追加、UUID と偶発衝突する機微情報テストの判定を summary 限定へ修正。設計記録: ADR-0003（追記専用・FK 非依存）を追加。harness による追記専用の機械検証と、失効 / 招待取消エンドポイントの呼び出し元認可はフォローアップ化。

#### 振り返り

- **問題**: 監査ログが「正常系イベント」のみを記録し、認可で拒否した不正試行（自己承認など）を残していなかった。また認証層が無い失効 / 取消エンドポイントで actor を被害者・招待者と断定し、証跡が実行者を誤って示していた。読み取り認可ロジックが 3 エンドポイントに重複していた。
- **根本原因**: 「記録すべきイベント」を成功操作中心に列挙し、脅威モデルの主目的（不正試行の事後追跡）を網羅していなかった。actor の意味（実行者）と、認証層が無い現状（呼び出し元を証明できない）の整合を初版で詰めていなかった。
- **予防策**: 認可拒否を監査対象に含め、actor を断定できない操作は NULL とし限界を ADR と Issue 13 へ明示。読み取り認可をヘルパーへ一本化し drift を防止。追記専用の機械検証はフォローアップ（harness invariant）として残す。

### Phase 1 完成に向けた段階的実装（/loop オーケストレーション） - 2026-06-27

#### 目的

「完成させて必要な機能を Issue に切って段階的に実装する」という goal を、Phase 1（初期商用リリース相当）のうち本リポジトリのコードで実装可能な範囲に対して遂行する。ネイティブアプリ・ZKP / MPC / FHE・ブロックチェイン・独立した暗号レビュー / 侵入テスト / ストア審査は対象外（[スコープと非目標](./docs/product/scope-and-non-goals.md) と README のとおり Phase 2 以降または外部プロセス）。

#### 制約

- 作業順序（AGENTS.md）: ドキュメント更新 → リファクタリング → 機能追加。
- 実 DB・実 WebCrypto・実 HTTP・実レンダリング（モック禁止）。TDD・日本語 BDD・カバレッジ維持。
- 文言は [安全文言ガイド](./docs/product/safety-copy-guide.md) 準拠。承認済み以外に成功色・チェックマークを使わない。
- ゲート（architecture-harness → make before-commit → /review → /security-review → /simplify）を全 Green にするまで各 Issue は未完了。
- 新機能は `/feature` フロー、Issue は `#番号` 引用禁止（フル URL か「Issue 番号」）。

#### タスク（backlog として GitHub Issue に分割）

1. 脅威モデルの策定（Phase 0 ゲート / docs）。
2. 監査ログの記録と参照 API（運用ゲート / backend）。
3. API 端末セッション認証層（README 残存限界の解消 / backend + frontend）。
4. ソーシャルリカバリーによる機種変更・端末紛失時の復旧（Phase 1 安全機構ゲート / backend + frontend）。
5. 端末失効・復旧の利用者フロー UI（frontend）。

実装順: 1 → 2 → 3 → 4 → 5（docs を先に、セキュリティ核を認証 → 復旧の順で積む）。1 件ずつ Issue 化して PR で完了させる。

#### 検証手順

- 各 Issue の受け入れ基準を満たす結合テスト（既存 `scripts/e2e-phase1.ts` を拡張）。
- `make before-commit` と各 workspace の test / typecheck / build が Green。

#### 進捗ログ

- 2026-06-27: 現状診断。Phase 1 Web リファレンス実装（PR #10）が完成済みであることを確認。既存ルートを棚卸しし、コード実装可能な Phase 1 残課題 5 件を特定。backlog を GitHub Issue 化し、Issue 1（TRACKING）へ紐付ける。

#### 振り返り

- （各 Issue 完了時に追記する。）

### Phase 1 Web プロダクトのエンドツーエンド完成 - 2026-06-13

#### 目的

「今はテンプレートしかない」状態（核ジャーニーが UI 上で完結しない）を解消し、Phase 1 の Web プロダクトを実バックエンドに対して動く製品に仕上げる。ネイティブアプリ・ZKP/MPC/FHE・ブロックチェイン・外部監査/審査は対象外（Issue 1 の Phase 2 / プロセスゲート）。

#### 制約

- 実 DB・実 WebCrypto・実 HTTP・実レンダリング（モック禁止）。TDD・日本語 BDD。
- 文言は docs/product/safety-copy-guide.md 準拠。承認済み以外に成功色・チェックマークを使わない。
- ゲート（architecture-harness → make before-commit → e2e ゲート）を全 Green にするまで未完了。

#### タスク

1. バックエンド: 家族メンバー一覧 / 確認要求一覧エンドポイント追加、招待確認に circleId 追加（完了）。
2. フロントエンド: createCircle/confirmInvite の契約修正、メンバー一覧・要求一覧クライアント、名前オンボーディング、家族管理画面（コード共有・参加）、受信箱、宛先候補の実データ化（並列エージェント実装中）。
3. README / package.json を実プロダクト記述へ更新（完了）、scripts/e2e-phase1.ts 追加（完了）。
4. e2e ゲート実行 → 全ゲート → PR。

#### 検証手順

- `bun scripts/e2e-phase1.ts` が実バックエンド + 実フロント API で核ジャーニー（家族作成・招待・参加・メンバー一覧・要求作成・受信箱・承認・拒否・改ざん拒否）を通す。
- `make before-commit` と各 workspace の test/typecheck/build が Green。

#### 進捗ログ

- 2026-06-13: ブランチ `claude/complete-phase1-app` で着手。現状診断で「createCircle が creatorMemberId 未送信で実サーバー 400」「confirmInvite が body 未送信」「宛先リスト空・受信箱/家族設定 UI なし」を特定。バックエンドに 2 エンドポイント追加 + 招待確認 circleId 追加（テスト 66 件 Green、live smoke 確認）。README/package.json 刷新、e2e ゲート作成。フロント実装を並列エージェントに委任。
- 2026-06-13: フロント実装完了（オンボーディング・家族管理・受信箱・宛先実データ化）。e2e ゲートで核ジャーニー（承認→初回送金先 30 分待機→確認済み・拒否・改ざん拒否）を実バックエンドで通過。レビューで high 1 / medium 3 / low 1 を検出し対応: 読み取り API に家族メンバーシップ確認を追加（家族コードのみの非メンバーへの名簿・履歴露出を 403 化）、受信箱を unanswered 限定、家族切り替え（参加中の家族一覧 + アクティブ切替）を追加、e2e のアサーション分離。API の無認証という限界を README に明記。
- 2026-06-13: 全ゲート Green（フロント 137・バック 71・e2e・make before-commit）。PR #10 を作成し CI 確認。

#### 振り返り

- **問題**: バックエンドが実装途中で固めた API 契約（createCircle の creatorMemberId 必須、confirmInvite の body 必須）にフロントが追随できておらず、ユニットテストのモックが不一致を隠していた。新規の読み取りエンドポイントが既存の isCircleMember 認可規約を踏襲せず、家族コードのみの非メンバーに確認履歴を露出していた。
- **根本原因**: 並列実装で契約の機械検証（実物どうしの結合）が無く、モックが「動いているように見えて実サーバーで 400」を許した。新エンドポイント追加時に既存の認可規約をレビュー観点として持っていなかった。
- **予防策**: 実バックエンド + 実フロント API + 実 WebCrypto を結合する e2e ゲート（scripts/e2e-phase1.ts）を常設し、契約不一致を CI 前に検出できるようにした。読み取り API もメンバーシップ確認を必須化し規約を統一。API の無認証という残存限界を README に明記し、本番の端末セッション認証をフォローアップとして残す。

### ZeroKey Family プロダクト定義ドキュメント（Issue 1 / 2 / 3） - 2026-06-10

#### 目的

Issue 2（プロダクトビジョン・Trust Claims・スコープ・非目標）と Issue 3（エンドツーエンドのユーザージャーニーと誤用耐性 UX）の成果物を `docs/product/` 配下に作成する。Issue 1（商用リリースロードマップ）はリリースゲート文書として `docs/product/roadmap.md` に整備する。

- Issue 1: https://github.com/susumutomita/ZeroKeyFamily/issues/1
- Issue 2: https://github.com/susumutomita/ZeroKeyFamily/issues/2
- Issue 3: https://github.com/susumutomita/ZeroKeyFamily/issues/3

#### 制約

- 作業順序: ドキュメント更新 → リファクタリング → 機能追加。本タスクはドキュメントのみ。
- ドキュメント規則（文末「。」、日本語と半角英数字の間に半角スペース）に従う。
- Issue の完了条件を文書側で満たす: 「応答なし」を本人確認成功として扱わない、危険な要求で金額・送金先・理由を省略できない、各フローに開始・終了・失敗条件を定義する。
- ゲート（architecture-harness → make before-commit）を全て Green にするまで未完了。

#### タスク

1. Plan.md に本計画を追記する。
2. Issue 2 成果物: `docs/product/vision.md` / `trust-claims.md` / `scope-and-non-goals.md` / `glossary.md`。
3. Issue 3 成果物: `docs/product/user-journeys.md` / `wireframes.md` / `safety-copy-guide.md` / `failure-and-offline-behaviors.md` / `usability-test-plan.md`。
4. Issue 1 成果物: `docs/product/roadmap.md`（リリースゲートチェックリストと各 Issue へのリンク）。
5. ゲート実行 → コミット → push → draft PR 作成。

#### 検証手順

- `bun scripts/architecture-harness.ts --staged --fail-on=error` が Green。
- `make before-commit` が Green。
- Issue 2 / 3 の完了条件チェックボックスに対応する記述が各文書に存在する。

#### 進捗ログ

- 2026-06-10: ブランチ `claude/goal-issues-implementation-o13b64` で着手。Issue 3 件を確認し、ドキュメント成果物の構成を決定。
- 2026-06-10: `docs/product/` に 10 文書を作成。Issue 2（vision / trust-claims / scope-and-non-goals / glossary）、Issue 3（user-journeys / wireframes / safety-copy-guide / failure-and-offline-behaviors / usability-test-plan）、Issue 1（roadmap）。
- 2026-06-10: scope 外の発見 2 件をフォローアップ記録。README が typescript-template のままで ZeroKey Family を反映していない件、PostToolUse フックが /bin/sh で bash 構文を使い常にエラーになる件。
- 2026-06-10: code-review（2 ファインダー並列）で文書間矛盾 9 件を検出し修正（応答なし/期限切れの状態分離、署名束縛フィールドへの理由追加、ロードマップのゲート分離、W-04/W-05/W-05b/W-09 の補完、フロー 4 独立判定、フロー 7 状態遷移図）。security-review は指摘 0 件。draft PR #4 作成、CI Green。
- 2026-06-10: 実装フェーズ開始（/feature フロー）。仕様書 `docs/specs/2026-06-10-zerokey-family-phase1-core.md` 作成、役割別 Issue 5〜9 作成。packages/backend（Hono + bun:sqlite + Ed25519）と packages/frontend（Vite + React + WebCrypto）の土台を固定し、PM / Designer / QA / User / バックエンド開発 / フロントエンド開発の 6 エージェントを並列起動。
- 2026-06-10: 6 エージェント完了。バックエンド 48 テスト・フロントエンド 82 テスト全 pass（モックなし: 実 SQLite / 実 WebCrypto / 実 HTTP / 実レンダリング）。typecheck・build・biome・harness 全 Green。canonical 形式（11 キー辞書順）の両側整合を確認。実装で確定した collecting / waiting 状態と解除署名ペイロードを仕様書へ反映。フォローアップ 3 件追加（W-07/W-09 画面、メンバー一覧 API、User フィードバック文言反映）。
- 2026-06-10: 実装レビュー（バックエンド・フロントエンド 2 ファインダー）で high 6 件を含む 14 件を検出し修正。バックエンド: 停止中 circle の waiting→approved 昇格、承認者と対象メンバーの未検証、検証 await 中の TOCTOU、期限の 10 分〜24 時間範囲強制（60 テストへ増加）。フロントエンド: レスポンス封筒の unwrap 漏れ（requests / members / circles / invites / devices / stop / release）、フィールド名契約不一致、承認直後のクラッシュ、取り消しボディ欠落、偽の署名日時、collecting / waiting 専用画面、技術エラー文言の排除（112 テストへ増加）。low 2 件（送金先実績の金額条件、検証失敗 terminal の妨害耐性）は製品判断としてフォローアップ化。
- 2026-06-10: CI の safe-chain 最小パッケージ年齢チェックで browserslist の推移的依存 2 件がブロックされ失敗 → root overrides で範囲下限の安定バージョンに固定して解消。PR #4 の本文を最終状態に更新、CI Green（ci / GitGuardian）。

#### 振り返り

- **問題 1**: PostToolUse フック（biome 自動整形）が `/bin/sh` で bash 固有構文（`[[ ]]` と `=~`）を実行しており、すべての Write/Edit で構文エラーを出していた。Markdown 編集には実害がなく、TypeScript の整形は手動の `biome check --write` で代替した。
- **問題 2**: 仕様書だけを共有して並列実装したため、バックエンドが具体化した API 契約（レスポンス封筒・フィールド名・ボディキー）とフロントエンドの想定が乖離し、統合レビューで high 4 件の契約不一致が出た。
- **根本原因**: フックは bash 前提で書かれ `sh` 互換性が未検証だった。並列実装では API 契約の機械検証（OpenAPI 等の共有スキーマ）がなく、仕様書の自然言語記述が唯一の合意点だった。
- **予防策**: フック修正をフォローアップ化（F-GSC606）。統合フェーズに「契約の正本はバックエンド実装」と明記したレビューゲートを置き、実 HTTP サーバーに対する契約テストをフロントエンドに追加した。次回は共有スキーマか契約テストの先行作成を仕様フェーズに含める。

### Claude Code ハーネス近代化（最新モデル・最新プラクティス対応） - 2026-06-10

#### 目的

既存テンプレートを最新の Claude Code プラクティスに合わせて作り直す。参考: [nvidia/skillspector](https://github.com/nvidia/skillspector)（スキルのセキュリティ検査）と [SnailSploit/claude-red](https://github.com/SnailSploit/claude-red)（スキル集の構成）。スキル・フック自体が攻撃面になる時代に合わせ、ハーネスにスキル監査の invariant を足し、スキルの書き方を最新仕様に揃える。

#### 制約

- 作業順序: ドキュメント更新 → リファクタリング → 機能追加。
- invariant の追加は `docs/architecture/harness.md` への明文化と ADR を伴う。
- 設定ファイル（biome.json 等）は直接編集しない。
- ゲート（architecture-harness → make before-commit → /review → /security-review → /simplify）を全て Green にするまで未完了。

#### タスク

1. docs 更新 — `harness.md` の `INVARIANT_SUPPLY_CHAIN_CONFIG_PRESENT` が `.npmrc` 前提のまま（PR #104 で削除済み）の stale 記述を修正。スキル監査 invariant の ADR-0002 を作成。
2. `scripts/architecture-harness.ts` にスキル監査 invariant を追加（SKILL.md frontmatter 検証、prompt injection・危険パターン検出）+ テスト。
3. 既存スキルの frontmatter を最新プラクティス（リサーチ結果に基づく）に更新。
4. `/skill-audit` スキルを追加。
5. README / CLAUDE.md / AGENTS.md を同期（最新モデル指針を含む）。
6. ゲート実行 → PR。

#### 検証手順

- `bun scripts/architecture-harness.ts --fail-on=warning` で全件スキャンが Green。
- 故意に injection パターンを含むスキルを置いた一時ファイルで新 invariant が error を出すことをテストで確認（`bun test`）。
- `make before-commit` が Green。
- CI Green。

#### 進捗ログ

- 2026-06-10: ブランチ `chore/modernize-claude-harness` 作成。skillspector / claude-red のリサーチをバックグラウンドで開始。harness.md の stale な `.npmrc` 記述を発見。
- 2026-06-10: docs 更新完了（harness.md 修正 + ADR-0002 + スキル invariant 3 件の明文化）。
- 2026-06-10: `scripts/architecture-harness.ts` にスキル invariant 3 件を実装、`scripts/architecture-harness.test.ts` で 24 テスト Green。`make harness_test` を before-commit ゲートに追加。
- 2026-06-10: `.claude/scripts/check-test-style.sh` の日本語検出が macOS (BSD grep / bash 3.2) で常に誤検知するバグを修正。
- 2026-06-10: スキル frontmatter を最新仕様に更新（argument-hint / allowed-tools / disable-model-invocation）。`/skill-audit` スキル追加。CLAUDE.md を `@AGENTS.md` import 方式に再構成、`.claude/rules/skill-authoring.md` (path-scoped rule) 追加、README 同期。
- 2026-06-10: settings.json への permissions.allow 追加は権限分類器に拒否されたためフォローアップ化（ユーザー判断事項）。フォローアップ 3 件記録。
- 2026-06-10: /review 指摘を反映 — `--skills-only` モード追加（pre-install 検査がリポジトリ前提で必ず失敗する問題の解消）、EXFIL 検出強化（`sh -c "$(curl ...)"` / `| sudo sh`）、ZWNJ/ZWJ を warning に分離。/security-review は指摘 0 件。
- 2026-06-10: /simplify 指摘を反映 — `standalone` フィールドで rule タグ化（id プレフィックス依存を解消）、隠し指示検出をテーブル化し `.claude` 配下全ファイルへ拡張、EXFIL スコープに settings.json 追加、`parseFrontmatter` を `Bun.YAML.parse` に置換、CLAUDE.md 禁止事項の重複を AGENTS.md 参照に一本化、テストの一時ディレクトリ掃除。最終 31 テスト Green、全ゲート Green。

#### 振り返り

- **問題**: harness.md の `INVARIANT_SUPPLY_CHAIN_CONFIG_PRESENT` 記述が PR #104 の `.npmrc` 削除に追随しておらず stale だった。`.claude/scripts/check-test-style.sh` の日本語検出は macOS で常に誤検知していた。
- **根本原因**: 実装と正本ドキュメントの同期を機械検証する仕組みが invariant 本文には無い。hook スクリプトは GNU 前提で書かれ、BSD 環境でテストされていなかった。
- **予防策**: スキル・フックを harness の検査対象に含めた（本 PR の invariant 3 件）。hook スクリプトの環境差異はポータブルな構文（C ロケール + POSIX 文字クラス）に寄せた。description 等の宣言と実装の整合は `/skill-audit` のチェックリストでレビュー時に確認する。
