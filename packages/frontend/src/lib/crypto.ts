/**
 * WebCrypto Ed25519 による端末鍵の生成・署名・検証。
 *
 * 秘密鍵は extractable: false で生成し、端末（KeyStore）の外に出さない。
 * サーバーへ送るのは raw 形式公開鍵の base64 と署名のみ。
 */

const ALGORITHM = 'Ed25519';

/** 鍵の保存先を抽象化するインターフェース。ブラウザは IndexedDB 実装を使う。 */
export interface KeyStore {
  load(id: string): Promise<CryptoKeyPair | null>;
  save(id: string, keyPair: CryptoKeyPair): Promise<void>;
}

/** テスト・非ブラウザ環境向けの in-memory 実装。 */
export class InMemoryKeyStore implements KeyStore {
  private readonly pairs = new Map<string, CryptoKeyPair>();

  load(id: string): Promise<CryptoKeyPair | null> {
    return Promise.resolve(this.pairs.get(id) ?? null);
  }

  save(id: string, keyPair: CryptoKeyPair): Promise<void> {
    this.pairs.set(id, keyPair);
    return Promise.resolve();
  }
}

const DB_NAME = 'zerokey-family';
const STORE_NAME = 'device-keys';

/** ブラウザ向けの IndexedDB 実装。CryptoKeyPair を structured clone で保存する。 */
export class IndexedDbKeyStore implements KeyStore {
  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load(id: string): Promise<CryptoKeyPair | null> {
    const db = await this.openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const get = tx.objectStore(STORE_NAME).get(id);
        get.onsuccess = () =>
          resolve((get.result as CryptoKeyPair | undefined) ?? null);
        get.onerror = () => reject(get.error);
      });
    } finally {
      db.close();
    }
  }

  async save(id: string, keyPair: CryptoKeyPair): Promise<void> {
    const db = await this.openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const put = tx.objectStore(STORE_NAME).put(keyPair, id);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      });
    } finally {
      db.close();
    }
  }
}

/** Ed25519 鍵ペアを生成する。秘密鍵は extractable: false。 */
export async function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, false, [
    'sign',
    'verify',
  ]);
  return pair as CryptoKeyPair;
}

/** KeyStore から鍵を取得し、無ければ生成して保存する。 */
export async function getOrCreateKeyPair(
  store: KeyStore,
  id: string
): Promise<CryptoKeyPair> {
  const existing = await store.load(id);
  if (existing) {
    return existing;
  }
  const pair = await generateDeviceKeyPair();
  await store.save(id, pair);
  return pair;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 公開鍵を raw 形式でエクスポートし base64 にする。 */
export async function exportPublicKeyBase64(
  publicKey: CryptoKey
): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return bytesToBase64(raw);
}

/** base64 の raw 公開鍵をインポートする（検証専用）。 */
export async function importPublicKey(base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(base64),
    ALGORITHM,
    true,
    ['verify']
  );
}

/** canonical 文字列に署名し base64 で返す。 */
export async function signPayload(
  privateKey: CryptoKey,
  canonical: string
): Promise<string> {
  const signature = await crypto.subtle.sign(
    ALGORITHM,
    privateKey,
    new TextEncoder().encode(canonical)
  );
  return bytesToBase64(signature);
}

/** base64 署名を canonical 文字列に対して検証する。 */
export async function verifySignature(
  publicKey: CryptoKey,
  signatureBase64: string,
  canonical: string
): Promise<boolean> {
  return crypto.subtle.verify(
    ALGORITHM,
    publicKey,
    base64ToBytes(signatureBase64),
    new TextEncoder().encode(canonical)
  );
}
