import { describe, expect, it } from 'bun:test';
import { canonicalize, type SignaturePayload } from './canonical';
import {
  exportPublicKeyBase64,
  generateDeviceKeyPair,
  getOrCreateKeyPair,
  InMemoryKeyStore,
  importPublicKey,
  signPayload,
  verifySignature,
} from './crypto';

const payload: SignaturePayload = {
  amount: 300000,
  beneficiary: '○○銀行 1234567',
  circleId: 'circle-1',
  deadline: '2026-06-10T15:30:00Z',
  kind: 'approve',
  nonce: 'nonce-abc',
  reason: '会社のお金をなくした',
  requestId: 'req-1',
  requesterId: 'member-yoshiko',
  subject: 'お金を送ってほしいと言われた',
  targetId: 'member-taro',
};

describe('端末鍵（WebCrypto Ed25519）', () => {
  it('鍵生成から署名・検証まで往復できる', async () => {
    const pair = await generateDeviceKeyPair();
    const canonical = canonicalize(payload);
    const signature = await signPayload(pair.privateKey, canonical);
    expect(await verifySignature(pair.publicKey, signature, canonical)).toBe(
      true
    );
  });

  it('ペイロードを 1 フィールドでも改変すると検証が失敗する', async () => {
    const pair = await generateDeviceKeyPair();
    const signature = await signPayload(pair.privateKey, canonicalize(payload));
    const tampered = canonicalize({ ...payload, amount: 9999999 });
    expect(await verifySignature(pair.publicKey, signature, tampered)).toBe(
      false
    );
  });

  it('別の端末鍵の署名は検証に失敗する', async () => {
    const signer = await generateDeviceKeyPair();
    const other = await generateDeviceKeyPair();
    const canonical = canonicalize(payload);
    const signature = await signPayload(signer.privateKey, canonical);
    expect(await verifySignature(other.publicKey, signature, canonical)).toBe(
      false
    );
  });

  it('秘密鍵はエクスポートできない（extractable: false）', async () => {
    const pair = await generateDeviceKeyPair();
    expect(pair.privateKey.extractable).toBe(false);
    expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
  });

  it('公開鍵を base64 でエクスポートし、インポートして往復できる', async () => {
    const pair = await generateDeviceKeyPair();
    const base64 = await exportPublicKeyBase64(pair.publicKey);
    expect(base64.length).toBeGreaterThan(0);
    const imported = await importPublicKey(base64);
    expect(await exportPublicKeyBase64(imported)).toBe(base64);
    const canonical = canonicalize(payload);
    const signature = await signPayload(pair.privateKey, canonical);
    expect(await verifySignature(imported, signature, canonical)).toBe(true);
  });
});

describe('KeyStore（鍵の保存先インターフェース）', () => {
  it('InMemoryKeyStore に鍵を保存して取り出せる', async () => {
    const store = new InMemoryKeyStore();
    const pair = await generateDeviceKeyPair();
    await store.save('device-1', pair);
    const loaded = await store.load('device-1');
    expect(loaded).not.toBeNull();
    expect(
      await exportPublicKeyBase64((loaded as CryptoKeyPair).publicKey)
    ).toBe(await exportPublicKeyBase64(pair.publicKey));
  });

  it('保存されていない id の load は null を返す', async () => {
    const store = new InMemoryKeyStore();
    expect(await store.load('unknown-device')).toBeNull();
  });

  it('getOrCreateKeyPair は 2 回目以降も同じ鍵を返す', async () => {
    const store = new InMemoryKeyStore();
    const first = await getOrCreateKeyPair(store, 'device-1');
    const second = await getOrCreateKeyPair(store, 'device-1');
    const canonical = canonicalize(payload);
    const signature = await signPayload(first.privateKey, canonical);
    expect(await verifySignature(second.publicKey, signature, canonical)).toBe(
      true
    );
    expect(await exportPublicKeyBase64(second.publicKey)).toBe(
      await exportPublicKeyBase64(first.publicKey)
    );
  });
});
