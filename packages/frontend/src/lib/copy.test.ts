import { describe, expect, it } from 'bun:test';
import { FORBIDDEN_COPY, STANDARD_COPY, UI_COPY } from './copy';

describe('安全文言ガイドの標準文言', () => {
  it('確認済みの主文がガイドと一字一句一致する', () => {
    expect(STANDARD_COPY.verified('太郎')).toBe(
      '太郎さんの登録端末が、この内容に同意の署名をしました。'
    );
  });

  it('拒否の主文がガイドと一字一句一致する', () => {
    expect(STANDARD_COPY.rejected('太郎')).toBe(
      '太郎さんの端末がこの内容を『身に覚えがない』と回答しました。お金を送らないでください。'
    );
  });

  it('応答なしの主文がガイドと一字一句一致する', () => {
    expect(STANDARD_COPY.unanswered).toBe(
      'まだ確認できていません。応答がないことは、相手が本人であることの確認にはなりません。'
    );
  });

  it('期限切れの主文がガイドと一字一句一致する', () => {
    expect(STANDARD_COPY.expired).toBe(
      '期限までに確認できませんでした。お金を送らないでください。'
    );
  });

  it('検証失敗の主文がガイドと一字一句一致する', () => {
    expect(STANDARD_COPY.verificationFailed).toBe(
      '応答の検証に失敗しました。安全のため、承認として扱いません。'
    );
  });

  it('通信断の主文がガイドと一字一句一致する', () => {
    expect(STANDARD_COPY.offline).toBe(
      'インターネットに接続できていないため、確認の状態がわかりません。確認できるまで、お金を送らないでください。'
    );
  });

  it('確認済みに併記する限界の注意がガイドと一字一句一致する', () => {
    expect(UI_COPY.verifiedLimitation).toBe(
      'これは端末の署名の確認です。少しでも不安があれば、送金の前にもう一度直接話してください。'
    );
  });

  it('確認要求フォームの注意文がワイヤーフレームと一致する', () => {
    expect(UI_COPY.formNotice).toBe(
      '金額・送金先・理由が空のままでは確認をお願いできません。'
    );
  });

  it('応答なし・期限切れに併記する相談先の注意文がガイドと一致する', () => {
    expect(UI_COPY.policeConsult).toBe(
      '困ったときは警察相談専用電話 #9110 に相談できます。'
    );
  });

  it('標準文言に禁止文言（本人です・安全です等）を含まない', () => {
    const texts = [
      STANDARD_COPY.verified('太郎'),
      STANDARD_COPY.unanswered,
      STANDARD_COPY.expired,
      STANDARD_COPY.verificationFailed,
      STANDARD_COPY.offline,
      UI_COPY.verifiedLimitation,
    ];
    for (const text of texts) {
      for (const forbidden of FORBIDDEN_COPY) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it('拒否の主文を「失敗しました」と表現しない', () => {
    expect(STANDARD_COPY.rejected('太郎')).not.toContain('失敗しました');
  });
});
