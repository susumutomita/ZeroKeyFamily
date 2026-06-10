import { useState } from 'react';
import { UI_COPY } from '../lib/copy';
import { RequestDetail, StatusHeading } from './parts';

interface Props {
  requesterLabel: string;
  request: {
    subject: string;
    amount: number;
    beneficiary: string;
    reason: string;
    deadlineText: string;
  };
  onApprove: () => void | Promise<void>;
  onReject: () => void;
  onCallFirst?: () => void;
  /** テスト用に二段階目から描画する場合のみ指定する。 */
  initialStep?: 1 | 2;
}

/**
 * W-03 確認要求の受信（承認画面）。
 * 金額・送金先・理由・依頼者を一画面に表示し、要約の省略表示を禁止する。
 * 承認は二段階（確認操作 → 端末鍵による同意の署名）、拒否はワンタップ。
 */
export function ReceiveApproveScreen({
  requesterLabel,
  request,
  onApprove,
  onReject,
  onCallFirst,
  initialStep = 1,
}: Props) {
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [signing, setSigning] = useState(false);

  const handleApprove = async () => {
    setSigning(true);
    try {
      await onApprove();
    } finally {
      setSigning(false);
    }
  };

  return (
    <section className="screen screen--receive">
      <StatusHeading icon="⚠" tone="alert">
        {UI_COPY.incomingHeading}
      </StatusHeading>
      <p className="main-copy">{requesterLabel}からのお願いです。</p>
      <RequestDetail
        subject={request.subject}
        amount={request.amount}
        beneficiary={request.beneficiary}
        reason={request.reason}
        deadlineText={request.deadlineText}
      />
      <p className="main-copy">{UI_COPY.incomingQuestion}</p>
      {step === 1 ? (
        <div className="actions actions--stacked">
          <button
            type="button"
            className="button button--primary button--large"
            onClick={() => setStep(2)}
          >
            ▶ {UI_COPY.approveStep1Button}
          </button>
          <button
            type="button"
            className="button button--large"
            onClick={onReject}
          >
            {UI_COPY.rejectButton}
          </button>
          <button type="button" className="button" onClick={onCallFirst}>
            {UI_COPY.callFirstButton}
          </button>
        </div>
      ) : (
        <div className="actions actions--stacked">
          <p className="caution">
            この内容にあなたの端末が同意したことが、依頼者に伝わります。
          </p>
          <button
            type="button"
            className="button button--primary button--large"
            disabled={signing}
            onClick={handleApprove}
          >
            {UI_COPY.approveStep2Button}
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setStep(1)}
          >
            {UI_COPY.backButton}
          </button>
        </div>
      )}
    </section>
  );
}
