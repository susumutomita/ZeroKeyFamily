# ADR-0003: 監査証跡を独立した追記専用ジャーナルにする

- **Status**: Accepted
- **Date**: 2026-06-27
- **Deciders**: Claude Code (ZeroKey Family メンテナ)

## Context

[脅威モデル](../product/threat-model.md) は家族内不正と事後追跡を緩和すべき脅威として挙げ、[ロードマップ](../product/roadmap.md) のバックエンド要件と運用ゲート（インシデント対応）は監査ログを前提にする。安全上重要なイベント（メンバー / 端末登録・端末失効・招待・確認要求の作成 / 承認 / 拒否 / 取消 / 検証失敗 / リプレイ拒否 / 認可拒否・緊急停止 / 解除）を、後から書き換えられない形で残す必要がある。証跡は家族（circle）単位で参照し、家族内データのプライバシー原則（[Trust Claims](../product/trust-claims.md)）に従って機微情報を平文で残さない。実装の正本は `packages/backend/src/app.ts` のバックエンド契約とする。

## Decision

`audit_log` テーブルを追記専用（append-only）の独立したジャーナルとして導入する。

- **追記専用**: アプリケーションコードは `audit_log` に対して `INSERT` のみを行い、`UPDATE` / `DELETE` を実装しない。証跡の改ざん耐性（tamper-evidence）の前提にする。
- **外部キーを張らない**: `circle_id` / `actor_member_id` / `target_id` は参照先の行へ FK を張らず、ID の非正規化保持に留める。監査ログは他テーブルのライフサイクルから独立したジャーナルであり、参照先の都合で記録が失敗・連鎖変更されないことを優先する。
- **機微情報を残さない**: `summary` は固定の最小ラベルとし、金額・送金先・理由・件名・秘密鍵を平文で格納しない。対象は `target_id`（端末 / 要求 / 招待 / circle の ID）で参照する。
- **circle 非紐付けイベント**: 加入前に起こるメンバー / 端末登録は `circle_id` を NULL にし、家族単位の参照（`GET /api/circles/:id/audit`）には含めない。
- **認可されない実行者**: 端末失効・招待取消は呼び出し元を認証しないため、actor を被害者・招待者と断定せず NULL にする。実行者の確定は端末セッション認証（[Issue 13](https://github.com/susumutomita/ZeroKeyFamily/issues/13)）に委ねる。

代替案として stop_events / responses のような既存テーブル群からの再構成も検討したが、横断的な時系列の証跡を一貫した形で得られず、イベント種別ごとに表現が割れるため採らない。

## Consequences

- **Good**: 改ざん耐性のある一貫した時系列証跡を家族単位で取得でき、インシデント対応と家族内不正の事後追跡の基盤になる。FK 非依存によりログ書き込みが本処理の失敗要因にならない。
- **Bad**: 追記専用と機微情報非格納は機械検証されず、現時点ではコードレビューと本 ADR で担保する。FK がないため参照整合性は呼び出し側の責務になる。
- **Tradeoff**: 改ざん検知用のハッシュチェイン・外部 SIEM 連携・長期保管ポリシーは将来の運用 Issue に委ねる。`audit_log` への `UPDATE` / `DELETE` を機械検出する harness invariant の追加はフォローアップとし、追加・緩和時は本 ADR を supersede する。

## References

- 関連コード: `packages/backend/src/db.ts`, `packages/backend/src/app.ts`
- 関連 PR / Issue: https://github.com/susumutomita/ZeroKeyFamily/issues/12
- 関連文書: [脅威モデル](../product/threat-model.md), [商用リリースロードマップ](../product/roadmap.md)
- 関連 ADR: [ADR-0002](./0002-skill-audit-invariants.md)
