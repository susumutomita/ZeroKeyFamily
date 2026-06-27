export type ResponseKind = 'approve' | 'reject';

export interface ResponsePayloadFields {
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

/**
 * キーを辞書順に並べた canonical JSON を返す。
 * サーバーは保存済み要求からこの文字列を再構築して検証する。
 */
export function canonicalResponsePayload(
  fields: ResponsePayloadFields
): string {
  return JSON.stringify({
    amount: fields.amount,
    beneficiary: fields.beneficiary,
    circleId: fields.circleId,
    deadline: fields.deadline,
    kind: fields.kind,
    nonce: fields.nonce,
    reason: fields.reason,
    requestId: fields.requestId,
    requesterId: fields.requesterId,
    subject: fields.subject,
    targetId: fields.targetId,
  });
}

export interface ReleasePayloadFields {
  circleId: string;
  stopEventId: string;
}

/** 緊急停止解除の canonical 署名ペイロード（キー辞書順）。 */
export function canonicalReleasePayload(fields: ReleasePayloadFields): string {
  return JSON.stringify({
    circleId: fields.circleId,
    kind: 'release',
    stopEventId: fields.stopEventId,
  });
}

export interface AuthChallengeFields {
  deviceId: string;
  memberId: string;
  nonce: string;
}

/**
 * 端末セッション確立の canonical 署名ペイロード（キー辞書順）。
 * 端末は登録鍵でこの文字列に署名し、サーバーは登録公開鍵で検証する。
 * 設計は docs/adr/0004-device-session-authentication.md を参照。
 */
export function canonicalAuthChallenge(fields: AuthChallengeFields): string {
  return JSON.stringify({
    deviceId: fields.deviceId,
    memberId: fields.memberId,
    nonce: fields.nonce,
    purpose: 'session',
  });
}

const encoder = new TextEncoder();

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(value, 'base64');
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  bytes.set(decoded);
  return bytes;
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(view).toString('base64');
}

export async function verifyEd25519(
  publicKeyBase64: string,
  payload: string,
  signatureBase64: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      base64ToBytes(publicKeyBase64),
      'Ed25519',
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      base64ToBytes(signatureBase64),
      encoder.encode(payload)
    );
  } catch {
    return false;
  }
}

export interface Ed25519KeyPair {
  privateKey: CryptoKey;
  publicKeyBase64: string;
}

export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { privateKey: pair.privateKey, publicKeyBase64: bytesToBase64(raw) };
}

export async function signEd25519(
  privateKey: CryptoKey,
  payload: string
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    encoder.encode(payload)
  );
  return bytesToBase64(signature);
}
