import { describe, expect, it } from 'bun:test';
import {
  CANONICAL_KEYS,
  canonicalize,
  encodeCanonical,
  payloadFromRequest,
  type SignaturePayload,
} from './canonical';

const basePayload: SignaturePayload = {
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

describe('署名ペイロードの canonical 化', () => {
  it('キーが辞書順に並んだ JSON 文字列を生成する', () => {
    const json = canonicalize(basePayload);
    const keys = Object.keys(JSON.parse(json));
    expect(keys).toEqual([...CANONICAL_KEYS]);
    expect([...keys].sort()).toEqual(keys);
  });

  it('仕様書の canonical 形式と一字一句一致する', () => {
    const json = canonicalize(basePayload);
    expect(json).toBe(
      '{"amount":300000,"beneficiary":"○○銀行 1234567","circleId":"circle-1","deadline":"2026-06-10T15:30:00Z","kind":"approve","nonce":"nonce-abc","reason":"会社のお金をなくした","requestId":"req-1","requesterId":"member-yoshiko","subject":"お金を送ってほしいと言われた","targetId":"member-taro"}'
    );
  });

  it('入力オブジェクトのプロパティ順に依存しない', () => {
    const reordered: SignaturePayload = {
      targetId: basePayload.targetId,
      subject: basePayload.subject,
      requesterId: basePayload.requesterId,
      requestId: basePayload.requestId,
      reason: basePayload.reason,
      nonce: basePayload.nonce,
      kind: basePayload.kind,
      deadline: basePayload.deadline,
      circleId: basePayload.circleId,
      beneficiary: basePayload.beneficiary,
      amount: basePayload.amount,
    };
    expect(canonicalize(reordered)).toBe(canonicalize(basePayload));
  });

  it('JSON として往復しても値が保存される', () => {
    expect(JSON.parse(canonicalize(basePayload))).toEqual(basePayload);
  });

  it('どのフィールドを 1 つ改変しても canonical 文字列が変わる（改変検出）', () => {
    const original = canonicalize(basePayload);
    const mutations: SignaturePayload[] = [
      { ...basePayload, amount: 300001 },
      { ...basePayload, beneficiary: '△△銀行 7654321' },
      { ...basePayload, circleId: 'circle-2' },
      { ...basePayload, deadline: '2026-06-10T16:30:00Z' },
      { ...basePayload, kind: 'reject' },
      { ...basePayload, nonce: 'nonce-xyz' },
      { ...basePayload, reason: '別の理由' },
      { ...basePayload, requestId: 'req-2' },
      { ...basePayload, requesterId: 'member-other' },
      { ...basePayload, subject: '別の用件' },
      { ...basePayload, targetId: 'member-hanako' },
    ];
    expect(mutations).toHaveLength(CANONICAL_KEYS.length);
    for (const mutated of mutations) {
      expect(canonicalize(mutated)).not.toBe(original);
    }
  });

  it('UTF-8 バイト列にエンコードできる', () => {
    const bytes = encodeCanonical(basePayload);
    expect(new TextDecoder().decode(bytes)).toBe(canonicalize(basePayload));
  });

  it('確認要求レコードと応答種別からペイロードを構築できる', () => {
    const payload = payloadFromRequest(
      {
        id: basePayload.requestId,
        circleId: basePayload.circleId,
        requesterId: basePayload.requesterId,
        targetId: basePayload.targetId,
        subject: basePayload.subject,
        amount: basePayload.amount,
        beneficiary: basePayload.beneficiary,
        reason: basePayload.reason,
        deadline: basePayload.deadline,
        nonce: basePayload.nonce,
      },
      'approve'
    );
    expect(payload).toEqual(basePayload);
  });
});
