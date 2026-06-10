import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateRequestScreen } from './CreateRequestScreen';
import { EmergencyStopScreen } from './EmergencyStopScreen';
import { HomeScreen } from './HomeScreen';
import { ReceiveApproveScreen } from './ReceiveApproveScreen';

describe('W-01 ホーム', () => {
  const html = renderToStaticMarkup(
    <HomeScreen
      recentEntries={[
        {
          id: 'r1',
          relation: '息子',
          name: '太郎',
          action: '拒否',
          date: '6/9',
        },
        {
          id: 'r2',
          relation: '娘',
          name: '花子',
          action: '承認',
          date: '6/2',
        },
      ]}
      onCreateRequest={() => {}}
      onHelp={() => {}}
    />
  );

  it('「家族に確認をお願いする」の大ボタンがある', () => {
    expect(html).toContain('家族に確認をお願いする');
  });

  it('「困ったとき（緊急停止・相談）」の大ボタンがある', () => {
    expect(html).toContain('困ったとき（緊急停止・相談）');
  });

  it('最近の確認の主語が「（人名）さんの端末」である', () => {
    expect(html).toContain('息子（太郎さんの端末）が拒否');
    expect(html).toContain('娘（花子さんの端末）が承認');
  });
});

describe('W-02 確認要求の作成', () => {
  const html = renderToStaticMarkup(
    <CreateRequestScreen
      targets={[
        { id: 'm-taro', name: '太郎', relation: '息子' },
        { id: 'm-hanako', name: '花子', relation: '娘' },
      ]}
      onSubmit={() => {}}
      onBack={() => {}}
    />
  );

  it('未入力時は送信ボタンが disabled である', () => {
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*>確認をお願いする<\/button>/
    );
  });

  it('必須項目の注意文を表示する', () => {
    expect(html).toContain(
      '金額・送金先・理由が空のままでは確認をお願いできません。'
    );
  });

  it('金額・送金先・理由の入力欄が必須として表示される', () => {
    expect(html).toContain('金額');
    expect(html).toContain('送金先');
    expect(html).toContain('理由');
    expect(html).toContain('必須');
  });
});

describe('W-03 確認要求の受信（承認画面）', () => {
  const request = {
    subject: 'お金を送ってほしいと言われた',
    amount: 300000,
    beneficiary: '○○銀行 1234567',
    reason: '会社のお金をなくした',
    deadlineText: '今日 15:30 まで',
  };

  it('金額・送金先・理由・依頼者を一画面に表示する', () => {
    const html = renderToStaticMarkup(
      <ReceiveApproveScreen
        requesterLabel="お母さん（佐藤良子さんの端末）"
        request={request}
        onApprove={() => {}}
        onReject={() => {}}
      />
    );
    expect(html).toContain('300,000');
    expect(html).toContain('○○銀行 1234567');
    expect(html).toContain('会社のお金をなくした');
    expect(html).toContain('お母さん（佐藤良子さんの端末）');
    expect(html).toContain('お金を送ってほしいと言われた');
  });

  it('承認は二段階で、最初の画面では署名ボタンを出さない', () => {
    const html = renderToStaticMarkup(
      <ReceiveApproveScreen
        requesterLabel="お母さん（佐藤良子さんの端末）"
        request={request}
        onApprove={() => {}}
        onReject={() => {}}
      />
    );
    expect(html).toContain('承認にすすむ');
    expect(html).not.toContain('同意の署名をして承認する');
  });

  it('二段階目で署名による承認ボタンを表示する', () => {
    const html = renderToStaticMarkup(
      <ReceiveApproveScreen
        requesterLabel="お母さん（佐藤良子さんの端末）"
        request={request}
        onApprove={() => {}}
        onReject={() => {}}
        initialStep={2}
      />
    );
    expect(html).toContain('同意の署名をして承認する');
  });

  it('拒否はワンタップでできる（最初の画面に拒否ボタンがある）', () => {
    const html = renderToStaticMarkup(
      <ReceiveApproveScreen
        requesterLabel="お母さん（佐藤良子さんの端末）"
        request={request}
        onApprove={() => {}}
        onReject={() => {}}
      />
    );
    expect(html).toContain('拒否する');
  });
});

describe('W-08 緊急停止', () => {
  const html = renderToStaticMarkup(
    <EmergencyStopScreen onStop={() => {}} onBack={() => {}} />
  );

  it('「すべての承認を今すぐ止める」の大ボタンがある', () => {
    expect(html).toContain('すべての承認を今すぐ止める');
  });

  it('理由の入力が不要であることを明示し、入力欄を置かない', () => {
    expect(html).toContain('理由の入力は不要です');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<input');
  });

  it('警察相談専用電話 #9110 を案内する', () => {
    expect(html).toContain('#9110');
  });

  it('解除には家族 2 人の操作が必要であることを示す', () => {
    expect(html).toContain('家族 2 人の操作がない限り再開されません。');
  });
});
