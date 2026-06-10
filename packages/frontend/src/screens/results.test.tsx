import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FORBIDDEN_COPY } from '../lib/copy';
import { ResultExpiredScreen } from './ResultExpiredScreen';
import { ResultInProgressScreen } from './ResultInProgressScreen';
import { ResultNotConfirmedScreen } from './ResultNotConfirmedScreen';
import { ResultUnansweredScreen } from './ResultUnansweredScreen';
import { ResultVerifiedScreen } from './ResultVerifiedScreen';

const detail = {
  amount: 300000,
  beneficiary: '○○銀行 1234567',
  reason: '会社のお金をなくした',
};

function expectNoForbiddenCopy(html: string): void {
  for (const forbidden of FORBIDDEN_COPY) {
    expect(html).not.toContain(forbidden);
  }
}

describe('W-04 結果表示（確認済み）', () => {
  const html = renderToStaticMarkup(
    <ResultVerifiedScreen targetName="太郎" {...detail} signedAt="6/10 14:55" />
  );

  it('登録端末の署名であることを主文で示す', () => {
    expect(html).toContain(
      '太郎さんの登録端末が、この内容に同意の署名をしました。'
    );
  });

  it('金額・送金先・理由を再掲する', () => {
    expect(html).toContain('300,000');
    expect(html).toContain('○○銀行 1234567');
    expect(html).toContain('会社のお金をなくした');
  });

  it('限界の注意文を必ず表示する', () => {
    expect(html).toContain(
      'これは端末の署名の確認です。少しでも不安があれば、送金の前にもう一度直接話してください。'
    );
  });

  it('禁止文言（本人です・安全です等）を含まない', () => {
    expectNoForbiddenCopy(html);
  });
});

describe('W-05 結果表示（応答なし・期限内）', () => {
  const html = renderToStaticMarkup(
    <ResultUnansweredScreen
      targetName="太郎"
      onCancelRequest={() => {}}
      onHelp={() => {}}
    />
  );

  it('「まだ確認できていません」を表示する', () => {
    expect(html).toContain('まだ確認できていません');
  });

  it('応答なしが本人確認にならないことを明示する', () => {
    expect(html).toContain(
      '応答がないことは、相手が本人であることの確認にはなりません。'
    );
  });

  it('「お金を送らないでください。」と行動を指示する', () => {
    expect(html).toContain('お金を送らないでください。');
  });

  it('取り消し導線（このお願いを取り消す）がある', () => {
    expect(html).toContain('このお願いを取り消す');
  });

  it('期限内なので「期限まで待つ」を表示する', () => {
    expect(html).toContain('期限まで待つ');
  });

  it('成功を示すチェックマークを使わない', () => {
    expect(html).not.toContain('✓');
    expect(html).not.toContain('✔');
  });

  it('相談先（#9110）を案内する', () => {
    expect(html).toContain('#9110');
  });

  it('禁止文言を含まない', () => {
    expectNoForbiddenCopy(html);
    expect(html).not.toContain('問題は見つかりませんでした');
  });
});

describe('W-05b 結果表示（期限切れ）', () => {
  const html = renderToStaticMarkup(
    <ResultExpiredScreen
      targetName="太郎"
      onRetry={() => {}}
      onHelp={() => {}}
    />
  );

  it('「期限までに確認できませんでした」を表示する', () => {
    expect(html).toContain('期限までに確認できませんでした');
  });

  it('「お金を送らないでください。」と行動を指示する', () => {
    expect(html).toContain('お金を送らないでください。');
  });

  it('すでに不可能な「期限まで待つ」を表示しない', () => {
    expect(html).not.toContain('期限まで待つ');
  });

  it('成功を示すチェックマークを使わない', () => {
    expect(html).not.toContain('✓');
    expect(html).not.toContain('✔');
  });

  it('「タイムアウトしました」と表現しない', () => {
    expect(html).not.toContain('タイムアウト');
  });

  it('禁止文言を含まない', () => {
    expectNoForbiddenCopy(html);
  });
});

describe('結果表示（collecting: ほかの家族の確認待ち）', () => {
  const html = renderToStaticMarkup(
    <ResultInProgressScreen
      kind="collecting"
      onCancelRequest={() => {}}
      onRefresh={() => {}}
      onHelp={() => {}}
    />
  );

  it('「ほかの家族の確認を待っています」を表示する', () => {
    expect(html).toContain('ほかの家族の確認を待っています');
  });

  it('未確認なので「お金を送らないでください。」と行動を指示する', () => {
    expect(html).toContain('お金を送らないでください。');
  });

  it('取り消し導線（このお願いを取り消す）がある', () => {
    expect(html).toContain('このお願いを取り消す');
  });

  it('成功色・チェックマークを使わない', () => {
    expect(html).not.toContain('✓');
    expect(html).not.toContain('✔');
    expect(html).not.toContain('status-heading--verified');
  });

  it('「応答がありません」と表示しない', () => {
    expect(html).not.toContain('応答がありません');
  });

  it('禁止文言を含まない', () => {
    expectNoForbiddenCopy(html);
  });
});

describe('結果表示（waiting: 待ち時間中）', () => {
  const html = renderToStaticMarkup(
    <ResultInProgressScreen
      kind="waiting"
      onCancelRequest={() => {}}
      onRefresh={() => {}}
      onHelp={() => {}}
    />
  );

  it('「待ち時間中です」を表示する', () => {
    expect(html).toContain('待ち時間中です');
  });

  it('この間はいつでも取り消せることを伝える', () => {
    expect(html).toContain('この間はいつでも取り消せます。');
  });

  it('取り消し導線（このお願いを取り消す）がある', () => {
    expect(html).toContain('このお願いを取り消す');
  });

  it('成功色・チェックマークを使わない', () => {
    expect(html).not.toContain('✓');
    expect(html).not.toContain('✔');
    expect(html).not.toContain('status-heading--verified');
  });

  it('「応答がありません」と表示しない', () => {
    expect(html).not.toContain('応答がありません');
  });

  it('禁止文言を含まない', () => {
    expectNoForbiddenCopy(html);
  });
});

describe('W-06 結果表示（拒否）', () => {
  const html = renderToStaticMarkup(
    <ResultNotConfirmedScreen
      kind="rejected"
      targetName="太郎"
      onHelp={() => {}}
    />
  );

  it('「身に覚えがない」という回答内容を伝える', () => {
    expect(html).toContain(
      '太郎さんの端末がこの内容を『身に覚えがない』と回答しました。お金を送らないでください。'
    );
  });

  it('拒否を「失敗しました」と表現しない', () => {
    expect(html).not.toContain('失敗しました');
  });

  it('禁止文言を含まない', () => {
    expectNoForbiddenCopy(html);
  });
});

describe('W-06 結果表示（検証失敗）', () => {
  const html = renderToStaticMarkup(
    <ResultNotConfirmedScreen
      kind="verification_failed"
      targetName="太郎"
      onHelp={() => {}}
    />
  );

  it('検証失敗を承認として扱わないことを明示する', () => {
    expect(html).toContain(
      '応答の検証に失敗しました。安全のため、承認として扱いません。'
    );
  });

  it('「エラーが発生しました」のみで終えない', () => {
    expect(html).not.toContain('エラーが発生しました');
  });

  it('禁止文言を含まない', () => {
    expectNoForbiddenCopy(html);
  });
});
