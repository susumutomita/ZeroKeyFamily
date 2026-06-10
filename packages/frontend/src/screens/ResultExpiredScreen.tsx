import { UI_COPY } from '../lib/copy';
import { StatusHeading } from './parts';

interface Props {
  targetName: string;
  onRetry?: () => void;
  onAskAnother?: () => void;
  onHelp?: () => void;
}

/**
 * W-05b 結果表示（期限切れ）。
 * W-05 と画面を分け、「期限まで待つ」などすでに不可能な選択肢を表示しない。
 */
export function ResultExpiredScreen({
  targetName,
  onRetry,
  onAskAnother,
  onHelp,
}: Props) {
  return (
    <section className="screen screen--result">
      <StatusHeading icon="✕" tone="failed">
        {UI_COPY.expiredHeading}
      </StatusHeading>
      <p className="main-copy">{UI_COPY.noResponseUntilDeadline(targetName)}</p>
      <p className="main-copy">{UI_COPY.noProofNote}</p>
      <p className="main-copy main-copy--directive">{UI_COPY.doNotSendMoney}</p>
      <p className="caution">{UI_COPY.policeConsult}</p>
      <div className="actions actions--stacked">
        <button type="button" className="button" onClick={onRetry}>
          {UI_COPY.retryRequestButton}
        </button>
        <button type="button" className="button" onClick={onAskAnother}>
          {UI_COPY.askAnotherFamilyButton}
        </button>
        <button type="button" className="button button--help" onClick={onHelp}>
          {UI_COPY.helpButton}
        </button>
      </div>
    </section>
  );
}
