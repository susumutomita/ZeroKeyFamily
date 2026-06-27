# ADR-0004: 端末セッション認証層の設計

- **Status**: Proposed
- **Date**: 2026-06-27
- **Deciders**: Claude Code (ZeroKey Family メンテナ)

## Context

[README の残存限界](../../README.md) と [脅威モデル](../product/threat-model.md) のシナリオ 4・9 のとおり、現状の API はセッション認証層を持たず、呼び出し元が申告したメンバー ID をそのまま信頼する。読み取り API は `isCircleMember` で整合性を確認するが、これは本人性の証明ではない。書き込み API（確認要求の作成 / 承認 / 拒否 / 取消・端末失効・緊急停止 / 解除・招待）は、呼び出し元が当該メンバーの失効していない登録端末であることを検証できていない。[ロードマップ](../product/roadmap.md) の OWASP MASVS / NIST SP 800-63B ゲートの前提であり、[ADR-0003](./0003-audit-log-append-only.md) で actor を断定できなかった失効・取消エンドポイントの誤帰属（フォローアップ F-270605）の根本解消でもある。

この設計は invasive（全書き込みエンドポイントと既存テスト・フロントエンドに波及）なため、実装に先立って設計判断を本 ADR で固定する。実装の正本は `packages/backend/src/app.ts` のバックエンド契約とする。

## Decision

端末鍵によるチャレンジ・レスポンスのハンドシェイクで短命なセッショントークンを確立し、以後の書き込み要求を当該トークンで認証する。秘密鍵は端末外に出さない原則と、依頼内容への端末署名（content signature）の独立性を維持する。

### プロトコル

1. **チャレンジ発行**: `POST /api/auth/challenge` `{ deviceId }`。サーバーは端末の存在を確認し、単回使用の nonce を生成して `auth_challenges`（nonce・device_id・created_at・expires_at・consumed）へ保存し `{ nonce, expiresAt }` を返す。チャレンジ TTL は 2 分。
2. **セッション確立**: `POST /api/auth/session` `{ deviceId, nonce, signature }`。signature は `canonicalAuthChallenge({ purpose: 'session', deviceId, memberId, nonce })`（memberId は端末から導出）への Ed25519 署名。サーバーは nonce をロードし、欠落 / 消費済み / 期限切れ / 端末不一致を拒否、端末が active でなければ拒否、登録公開鍵で署名を検証し、nonce を consumed にして `auth_sessions`（token・device_id・member_id・created_at・expires_at・revoked）を作成し `{ token, memberId, expiresAt }` を返す。セッション TTL は 12 時間。
3. **認証付き要求**: クライアントは `Authorization: Bearer <token>` を付ける。ミドルウェアはトークンからセッションをロードし、欠落 / 期限切れ / 失効を拒否、端末を再ロードし active でなければ拒否（発行後の失効を捕捉）、コンテキストに `{ memberId, deviceId }` を設定する。書き込みエンドポイントは actor をセッションから導出し、body の memberId がセッションと矛盾する場合は拒否する（body を信頼しない）。

### 拒否マトリックス（受け入れ基準）

| 攻撃 | 防御 |
| --- | --- |
| 失効済み端末 | チャレンジ / セッション作成時に active を要求し、要求ごとに端末状態を再確認する。 |
| 他メンバーの ID を騙る | actor はトークン（端末 → メンバーに束縛）から導出し、body の申告値を信頼しない。 |
| リプレイ（nonce 再利用） | チャレンジ nonce は単回使用（consumed）。 |
| 期限切れチャレンジ | チャレンジ TTL（2 分）。 |
| セッションの期限切れ / 失効 | セッション TTL（12 時間）と revoked フラグを要求ごとに確認する。 |

### 多層防御の維持

依頼内容への端末署名（content signature）は本認証層に依存せず独立に成立させる。盗まれたセッショントークンでも、承認の content signature は端末内の秘密鍵が必要なため偽造できない。セッションは「この端末が操作している」ことを、content signature は「この端末がこの依頼内容そのものに署名した」ことを示し、層が異なる。サーバー侵害でセッションを偽造されても「確認済み」は成立しない（[Trust Claims](../product/trust-claims.md)）。

### 段階的ロールアウト

1. 認証ヘルパーとハンドシェイクエンドポイント（チャレンジ / セッション）とテストを追加する。
2. 書き込みエンドポイントへ認証を必須化し、actor をセッションから導出する。既存テストはテストハーネスのヘルパー（セッション確立 + トークン付与）に集約して波及を抑える。
3. フロントエンドが鍵生成後にセッションを確立し、トークンを透過的に付与する。
4. 読み取り API は当面 `isCircleMember` 整合性確認を継続する（将来セッション必須化を検討）。

## Consequences

- **Good**: 要求が認証済みの端末 / メンバーに束縛され、監査の actor 帰属が確実になる（F-270605 を解消）。OWASP MASVS / NIST SP 800-63B の方向に沿う。content signature の独立性で多層防御を維持する。
- **Bad**: bearer トークンという新しい資格情報が増える。Web リファレンス実装では TLS 前提で許容するが、ネイティブはトークンをセキュアハードウェアへ束縛すべき（Phase 2）。全書き込みエンドポイント・既存テスト・フロントエンドの更新を要する。
- **Tradeoff**: 代替案の「要求ごと署名（トークンなしで全要求に署名）」は bearer 資格情報を避けられるが往復が倍増しクライアントが重くなる。クライアント簡潔性のためトークン + ハンドシェイクを選び、セキュリティ核は content signature に残す。相互 TLS・DPoP 相当の所有証明はリファレンス実装ではスコープ外。再検討トリガーはネイティブ実装着手時、またはトークン盗用の脅威評価が変わったとき。

## References

- 関連コード: `packages/backend/src/app.ts`, `packages/backend/src/crypto.ts`, `packages/backend/src/db.ts`
- 関連 PR / Issue: https://github.com/susumutomita/ZeroKeyFamily/issues/13
- 関連文書: [脅威モデル](../product/threat-model.md), [商用リリースロードマップ](../product/roadmap.md)
- 関連 ADR: [ADR-0003](./0003-audit-log-append-only.md)
