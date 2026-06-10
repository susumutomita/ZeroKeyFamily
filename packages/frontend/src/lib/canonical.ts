/**
 * 署名ペイロードの canonical 化。
 *
 * キーを辞書順に並べた JSON 文字列を UTF-8 でエンコードし、Ed25519 で署名する。
 * サーバーも同じ canonical 文字列を保存済み要求から再構築して検証するため、
 * この順序と形式が署名互換性の正本となる。
 */

export type ResponseKind = 'approve' | 'reject';

export interface SignaturePayload {
  amount: number;
  beneficiary: string;
  circleId: string;
  deadline: string;
  kind: ResponseKind;
  nonce: string;
  reason: string;
  requestId: string;
  requesterId: string;
  subject: string;
  targetId: string;
}

/** 辞書順（UTF-16 コード単位の昇順）に固定したキー一覧。 */
export const CANONICAL_KEYS = [
  'amount',
  'beneficiary',
  'circleId',
  'deadline',
  'kind',
  'nonce',
  'reason',
  'requestId',
  'requesterId',
  'subject',
  'targetId',
] as const satisfies readonly (keyof SignaturePayload)[];

/** キー辞書順の JSON 文字列を生成する。 */
export function canonicalize(payload: SignaturePayload): string {
  const ordered: Record<string, unknown> = {};
  for (const key of CANONICAL_KEYS) {
    ordered[key] = payload[key];
  }
  return JSON.stringify(ordered);
}

/** canonical JSON を UTF-8 バイト列にエンコードする（署名対象）。 */
export function encodeCanonical(payload: SignaturePayload): Uint8Array {
  return new TextEncoder().encode(canonicalize(payload));
}

/**
 * 確認要求レコードに対応するフィールドの最小集合。
 * フィールド名はバックエンド API のレコード（requesterMemberId / targetMemberId）に
 * 合わせる。canonical ペイロード側のキー名（requesterId / targetId）は
 * サーバーの canonicalResponsePayload と互換のまま変えない。
 */
export interface SignableRequest {
  id: string;
  circleId: string;
  requesterMemberId: string;
  targetMemberId: string;
  subject: string;
  amount: number;
  beneficiary: string;
  reason: string;
  deadline: string;
  nonce: string;
}

/** 確認要求と応答種別から署名ペイロードを構築する。 */
export function payloadFromRequest(
  request: SignableRequest,
  kind: ResponseKind
): SignaturePayload {
  return {
    amount: request.amount,
    beneficiary: request.beneficiary,
    circleId: request.circleId,
    deadline: request.deadline,
    kind,
    nonce: request.nonce,
    reason: request.reason,
    requestId: request.id,
    requesterId: request.requesterMemberId,
    subject: request.subject,
    targetId: request.targetMemberId,
  };
}
