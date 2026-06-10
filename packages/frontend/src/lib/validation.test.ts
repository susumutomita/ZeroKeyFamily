import { describe, expect, it } from 'bun:test';
import { validateRequestForm } from './validation';

describe('確認要求フォームの必須項目バリデーション', () => {
  const valid = {
    amount: '300000',
    beneficiary: '○○銀行 1234567',
    reason: '会社のお金をなくした',
  };

  it('金額・送金先・理由がそろっていれば送信できる', () => {
    expect(validateRequestForm(valid)).toBe(true);
  });

  it('金額が空なら送信できない', () => {
    expect(validateRequestForm({ ...valid, amount: '' })).toBe(false);
  });

  it('金額が数値でなければ送信できない', () => {
    expect(validateRequestForm({ ...valid, amount: 'abc' })).toBe(false);
  });

  it('金額が 0 以下なら送信できない', () => {
    expect(validateRequestForm({ ...valid, amount: '0' })).toBe(false);
    expect(validateRequestForm({ ...valid, amount: '-1' })).toBe(false);
  });

  it('送金先が空なら送信できない', () => {
    expect(validateRequestForm({ ...valid, beneficiary: '' })).toBe(false);
    expect(validateRequestForm({ ...valid, beneficiary: '   ' })).toBe(false);
  });

  it('理由が空なら送信できない', () => {
    expect(validateRequestForm({ ...valid, reason: '' })).toBe(false);
    expect(validateRequestForm({ ...valid, reason: '   ' })).toBe(false);
  });

  it('すべて空なら送信できない', () => {
    expect(
      validateRequestForm({ amount: '', beneficiary: '', reason: '' })
    ).toBe(false);
  });
});
