import { STANDARD_COPY, UI_COPY } from '../lib/copy';
import { RequestDetail, StatusHeading } from './parts';

interface Props {
  targetName: string;
  amount: number;
  beneficiary: string;
  reason: string;
  signedAt: string;
  onClose?: () => void;
  onHelp?: () => void;
}

/**
 * W-04 結果表示（確認済み）。
 * 「誰の登録端末が署名したか」「何に署名したか（金額・送金先・理由の再掲）」
 * 「限界の注意」の 3 点を必ず併記する（safety-copy-guide）。
 */
export function ResultVerifiedScreen({
  targetName,
  amount,
  beneficiary,
  reason,
  signedAt,
  onClose,
  onHelp,
}: Props) {
  return (
    <section className="screen screen--result">
      <StatusHeading icon="✓" tone="verified">
        {UI_COPY.verifiedHeading}
      </StatusHeading>
      <p className="main-copy">{STANDARD_COPY.verified(targetName)}</p>
      <RequestDetail
        amount={amount}
        beneficiary={beneficiary}
        reason={reason}
      />
      <p className="meta">同意した日時（署名日時）: {signedAt}</p>
      <p className="limitation-note">{UI_COPY.verifiedLimitation}</p>
      <div className="actions">
        <button type="button" className="button" onClick={onClose}>
          {UI_COPY.closeButton}
        </button>
        <button type="button" className="button button--help" onClick={onHelp}>
          {UI_COPY.helpShortButton}
        </button>
      </div>
    </section>
  );
}
