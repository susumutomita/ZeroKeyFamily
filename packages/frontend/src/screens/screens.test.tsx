import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateRequestScreen } from './CreateRequestScreen';
import { EmergencyStopScreen } from './EmergencyStopScreen';
import { FamilyManageScreen } from './FamilyManageScreen';
import { HomeScreen } from './HomeScreen';
import { InboxScreen } from './InboxScreen';
import { OnboardingScreen } from './OnboardingScreen';
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
      onManageFamily={() => {}}
      onOpenInbox={() => {}}
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

  it('「家族の管理」「届いた確認」への導線をホームから 1 タップで出す', () => {
    expect(html).toContain('家族の管理');
    expect(html).toContain('届いた確認');
  });
});

describe('オンボーディング（初回の名前登録）', () => {
  it('名前入力欄と「はじめる」ボタンを出す', () => {
    const html = renderToStaticMarkup(<OnboardingScreen onStart={() => {}} />);
    expect(html).toContain('お名前を教えてください');
    expect(html).toContain('はじめる');
    expect(html).toContain('<input');
  });

  it('名前未入力では「はじめる」ボタンを無効化する', () => {
    const html = renderToStaticMarkup(<OnboardingScreen onStart={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>はじめる<\/button>/);
  });
});

describe('W-07 家族の管理', () => {
  const baseProps = {
    circleId: 'circle-1234',
    members: [
      { id: 'm-1', name: '佐藤良子' },
      { id: 'm-2', name: '佐藤太郎' },
    ],
    myCircles: [
      { id: 'circle-1234', name: '佐藤家', status: 'normal' as const },
      { id: 'circle-5678', name: '田中家', status: 'normal' as const },
    ],
    inviteCode: null,
    onCreateInvite: () => {},
    onJoin: () => {},
    onSwitchCircle: () => {},
    onBack: () => {},
  };

  it('家族コードと参加メンバーの名前を表示する', () => {
    const html = renderToStaticMarkup(<FamilyManageScreen {...baseProps} />);
    expect(html).toContain('circle-1234');
    expect(html).toContain('佐藤良子');
    expect(html).toContain('佐藤太郎');
  });

  it('招待ボタンと別の家族に参加する導線を出す', () => {
    const html = renderToStaticMarkup(<FamilyManageScreen {...baseProps} />);
    expect(html).toContain('この家族に招待する');
    expect(html).toContain('別の家族に参加する');
  });

  it('招待コードが発行されたら表示する', () => {
    const html = renderToStaticMarkup(
      <FamilyManageScreen {...baseProps} inviteCode="invite-9999" />
    );
    expect(html).toContain('invite-9999');
  });

  it('メンバー表示に成功色やチェックマークを使わない', () => {
    const html = renderToStaticMarkup(<FamilyManageScreen {...baseProps} />);
    expect(html).not.toContain('✓');
    expect(html).not.toContain('status-heading--verified');
  });

  it('参加中の家族を一覧表示し、アクティブな家族には切り替えボタンを出さない', () => {
    const html = renderToStaticMarkup(<FamilyManageScreen {...baseProps} />);
    expect(html).toContain('参加中の家族');
    expect(html).toContain('佐藤家');
    expect(html).toContain('田中家');
    // アクティブな家族には「いま選んでいる」表示を出す。
    expect(html).toContain('いま選んでいる家族です。');
  });

  it('アクティブでない家族には切り替えボタンを出す（元家族へ戻れる導線）', () => {
    const html = renderToStaticMarkup(<FamilyManageScreen {...baseProps} />);
    expect(html).toContain('この家族に切り替える');
  });

  it('参加中の家族が 1 つだけなら切り替えボタンを出さない', () => {
    const html = renderToStaticMarkup(
      <FamilyManageScreen
        {...baseProps}
        myCircles={[
          { id: 'circle-1234', name: '佐藤家', status: 'normal' as const },
        ]}
      />
    );
    expect(html).not.toContain('この家族に切り替える');
    expect(html).toContain('いま選んでいる家族です。');
  });

  it('停止中の家族には停止中の案内を出し、成功色やチェックマークを使わない', () => {
    const html = renderToStaticMarkup(
      <FamilyManageScreen
        {...baseProps}
        myCircles={[
          { id: 'circle-1234', name: '佐藤家', status: 'normal' as const },
          { id: 'circle-5678', name: '田中家', status: 'stopped' as const },
        ]}
      />
    );
    expect(html).toContain('この家族は今、すべての承認を止めています。');
    expect(html).not.toContain('✓');
  });
});

describe('受信箱', () => {
  const items = [
    {
      id: 'req-1',
      subject: 'お金を送ってほしいと言われた',
      requesterLabel: '太郎さんの端末',
      status: 'unanswered' as const,
    },
  ];

  it('未確定の確認を一覧表示し、開く導線を出す', () => {
    const html = renderToStaticMarkup(
      <InboxScreen items={items} onOpen={() => {}} onBack={() => {}} />
    );
    expect(html).toContain('お金を送ってほしいと言われた');
    expect(html).toContain('太郎さんの端末');
    expect(html).toContain('内容を見て確認する');
  });

  it('空のときは案内文を出し、成功色やチェックマークを使わない', () => {
    const html = renderToStaticMarkup(
      <InboxScreen items={[]} onOpen={() => {}} onBack={() => {}} />
    );
    expect(html).toContain('いま確認をお願いされているものはありません。');
    expect(html).not.toContain('✓');
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

  it('宛先が 0 人のときは家族追加の導線を出し、送信ボタンを出さない', () => {
    const empty = renderToStaticMarkup(
      <CreateRequestScreen
        targets={[]}
        onSubmit={() => {}}
        onBack={() => {}}
        onManageFamily={() => {}}
      />
    );
    expect(empty).toContain('先に家族を追加してください。');
    expect(empty).toContain('家族の管理へ');
    expect(empty).not.toContain('確認をお願いする');
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
