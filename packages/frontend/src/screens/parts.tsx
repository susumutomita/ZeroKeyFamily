import type { ReactNode } from 'react';

/**
 * 状態見出し。状態は色だけで区別せず、アイコン形状と文言を併用する
 * （wireframes.md 共通デザイン要件）。
 */
export function StatusHeading({
  icon,
  tone,
  children,
}: {
  icon: string;
  tone: 'verified' | 'pending' | 'failed' | 'alert';
  children: ReactNode;
}) {
  return (
    <h1 className={`status-heading status-heading--${tone}`}>
      <span className="status-icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </h1>
  );
}

/** 金額を 300,000 円 のように桁区切りで大きく表示する。 */
export function formatAmount(amount: number): string {
  return `${amount.toLocaleString('ja-JP')} 円`;
}

/** 金額・送金先・理由の再掲（省略表示を禁止する）。 */
export function RequestDetail({
  amount,
  beneficiary,
  reason,
  subject,
  deadlineText,
}: {
  amount: number;
  beneficiary: string;
  reason: string;
  subject?: string;
  deadlineText?: string;
}) {
  return (
    <dl className="request-detail">
      {subject !== undefined && (
        <>
          <dt>内容</dt>
          <dd>{subject}</dd>
        </>
      )}
      <dt>金額</dt>
      <dd className="request-detail__amount">{formatAmount(amount)}</dd>
      <dt>送金先</dt>
      <dd>{beneficiary}</dd>
      <dt>理由</dt>
      <dd>{reason}</dd>
      {deadlineText !== undefined && (
        <>
          <dt>期限</dt>
          <dd>{deadlineText}</dd>
        </>
      )}
    </dl>
  );
}
