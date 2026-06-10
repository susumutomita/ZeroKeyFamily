import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultView, resolveTargetName } from './App';
import type { RequestRecord, RequestStatus } from './lib/api';
import { UI_COPY } from './lib/copy';

function recordWithStatus(status: RequestStatus): RequestRecord {
  return {
    id: 'req-1',
    circleId: 'c1',
    requesterMemberId: 'm1',
    targetMemberId: 'm2',
    subject: 'お金を送ってほしいと言われた',
    amount: 300000,
    beneficiary: '○○銀行 1234567',
    reason: '会社のお金をなくした',
    deadline: '2026-06-10T15:30:00Z',
    nonce: 'nonce-abc',
    status,
    secondApprovalRequired: true,
    waitRequired: true,
    waitUntil: null,
    createdAt: '2026-06-10T12:00:00.000Z',
  };
}

function renderResult(status: RequestStatus): string {
  return renderToStaticMarkup(
    <ResultView
      request={recordWithStatus(status)}
      targetName="太郎"
      onClose={() => {}}
      onHelp={() => {}}
      onCancelRequest={() => {}}
      onRefresh={() => {}}
      onRetry={() => {}}
    />
  );
}

describe('結果画面の状態分岐（ResultView）', () => {
  it('approved では確認済み画面に完全なレコードの金額・送金先・理由を再掲する', () => {
    const html = renderResult('approved');
    expect(html).toContain(
      '太郎さんの登録端末が、この内容に同意の署名をしました。'
    );
    expect(html).toContain('300,000');
    expect(html).toContain('○○銀行 1234567');
    expect(html).toContain('会社のお金をなくした');
  });

  it('approved の署名日時はバックエンドから取得できないため「取得できません」と表示し、偽の時刻を出さない', () => {
    const html = renderResult('approved');
    expect(html).toContain('同意した日時（署名日時）: 取得できません');
    // 閲覧時点の年月日（new Date() 由来）を署名日時として表示しない。
    const today = new Date().toLocaleString('ja-JP').slice(0, 9);
    expect(html).not.toContain(today);
  });

  it('collecting ではほかの家族の確認待ちの専用表示を出す', () => {
    const html = renderResult('collecting');
    expect(html).toContain('ほかの家族の確認を待っています');
    expect(html).toContain(UI_COPY.cancelRequestButton);
    expect(html).not.toContain('応答がありません');
    expect(html).not.toContain('✓');
  });

  it('waiting では待ち時間中の専用表示と取り消し導線を出す', () => {
    const html = renderResult('waiting');
    expect(html).toContain('待ち時間中です');
    expect(html).toContain('この間はいつでも取り消せます。');
    expect(html).toContain(UI_COPY.cancelRequestButton);
    expect(html).not.toContain('応答がありません');
    expect(html).not.toContain('✓');
  });

  it('unanswered では応答なし（未確認）画面を出す', () => {
    const html = renderResult('unanswered');
    expect(html).toContain('まだ確認できていません');
    expect(html).toContain(UI_COPY.cancelRequestButton);
  });

  it('invalidated では取り消し済みであることを表示する', () => {
    const html = renderResult('invalidated');
    expect(html).toContain('このお願いは取り消されました。');
  });
});

describe('確認相手の表示名の解決（resolveTargetName）', () => {
  it('targets リストからメンバー ID に対応する表示名を返す', () => {
    const targets = [
      { id: 'm-taro', name: '太郎' },
      { id: 'm-hanako', name: '花子' },
    ];
    expect(resolveTargetName(targets, 'm-taro')).toBe('太郎');
    expect(resolveTargetName(targets, 'm-hanako')).toBe('花子');
  });

  it('リストが空でもメンバー ID を人名として返さない', () => {
    const resolved = resolveTargetName([], 'm-0123-abcd');
    expect(resolved).not.toBe('m-0123-abcd');
    expect(resolved).toBe('家族');
  });

  it('リストに無い ID でもメンバー ID を人名として返さない', () => {
    const targets = [{ id: 'm-taro', name: '太郎' }];
    expect(resolveTargetName(targets, 'm-unknown')).toBe('家族');
  });
});
