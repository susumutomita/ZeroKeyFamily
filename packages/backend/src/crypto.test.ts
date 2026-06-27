import { describe, expect, it } from 'bun:test';
import {
  canonicalAuthChallenge,
  canonicalReleasePayload,
  canonicalResponsePayload,
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
} from './crypto';

const fields = {
  amount: 300000,
  beneficiary: '○○銀行 1234567',
  circleId: 'circle-1',
  deadline: '2026-06-10T15:30:00Z',
  kind: 'approve' as const,
  nonce: 'nonce-1',
  reason: '会社のお金をなくした',
  requestId: 'request-1',
  requesterId: 'member-1',
  subject: 'お金を送ってほしいと言われた',
  targetId: 'member-2',
};

describe('canonical 署名ペイロード', () => {
  it('キーが辞書順に並んだ JSON 文字列を生成する', () => {
    const payload = canonicalResponsePayload(fields);
    const keys = Object.keys(JSON.parse(payload));
    expect(keys).toEqual([
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
    ]);
  });

  it('解除ペイロードもキー辞書順で kind に release を含む', () => {
    const payload = canonicalReleasePayload({
      circleId: 'circle-1',
      stopEventId: 'stop-1',
    });
    expect(payload).toBe(
      '{"circleId":"circle-1","kind":"release","stopEventId":"stop-1"}'
    );
  });
});

describe('Ed25519 署名と検証', () => {
  it('署名と検証がラウンドトリップする', async () => {
    const pair = await generateEd25519KeyPair();
    const payload = canonicalResponsePayload(fields);
    const signature = await signEd25519(pair.privateKey, payload);
    expect(await verifyEd25519(pair.publicKeyBase64, payload, signature)).toBe(
      true
    );
  });

  it('フィールドを 1 つでも改変したペイロードの検証は失敗する', async () => {
    const pair = await generateEd25519KeyPair();
    const payload = canonicalResponsePayload(fields);
    const signature = await signEd25519(pair.privateKey, payload);
    const tampered = canonicalResponsePayload({ ...fields, amount: 300001 });
    expect(await verifyEd25519(pair.publicKeyBase64, tampered, signature)).toBe(
      false
    );
  });

  it('不正な base64 公開鍵では検証が false になる', async () => {
    const pair = await generateEd25519KeyPair();
    const payload = canonicalResponsePayload(fields);
    const signature = await signEd25519(pair.privateKey, payload);
    expect(await verifyEd25519('!!!', payload, signature)).toBe(false);
  });
});

describe('canonicalAuthChallenge', () => {
  it('キーを辞書順に並べ purpose を session に固定する', () => {
    const payload = canonicalAuthChallenge({
      nonce: 'n-1',
      memberId: 'm-1',
      deviceId: 'd-1',
    });
    expect(payload).toBe(
      '{"deviceId":"d-1","memberId":"m-1","nonce":"n-1","purpose":"session"}'
    );
  });

  it('登録端末の署名を登録公開鍵で検証できる', async () => {
    const pair = await generateEd25519KeyPair();
    const payload = canonicalAuthChallenge({
      deviceId: 'd-1',
      memberId: 'm-1',
      nonce: 'n-1',
    });
    const signature = await signEd25519(pair.privateKey, payload);
    expect(await verifyEd25519(pair.publicKeyBase64, payload, signature)).toBe(
      true
    );
  });
});
