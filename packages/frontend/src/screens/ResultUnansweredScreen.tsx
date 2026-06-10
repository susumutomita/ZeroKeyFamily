import { UI_COPY } from '../lib/copy';
import { StatusHeading } from './parts';

interface Props {
  targetName: string;
  onAskAnother?: () => void;
  onCancelRequest?: () => void;
  onHelp?: () => void;
  onWait?: () => void;
}

/**
 * W-05 結果表示（応答なし・期限内）。
 * 「未確認」を安心情報として表現しない。成功色・チェックマークを使わない。
 */
export function ResultUnansweredScreen({
  targetName,
  onAskAnother,
  onCancelRequest,
  onHelp,
  onWait,
}: Props) {
  return (
    <section className="screen screen--result">
      <StatusHeading icon="？" tone="pending">
        {UI_COPY.unansweredHeading}
      </StatusHeading>
      <p className="main-copy">{UI_COPY.noResponseFrom(targetName)}</p>
      <p className="main-copy">{UI_COPY.noProofNote}</p>
      <p className="main-copy main-copy--directive">{UI_COPY.doNotSendMoney}</p>
      <p className="caution">{UI_COPY.urgencyWarning}</p>
      <p className="caution">{UI_COPY.policeConsult}</p>
      <div className="actions actions--stacked">
        <button type="button" className="button" onClick={onAskAnother}>
          {UI_COPY.askAnotherFamilyButton}
        </button>
        <button type="button" className="button" onClick={onCancelRequest}>
          {UI_COPY.cancelRequestButton}
        </button>
        <button type="button" className="button button--help" onClick={onHelp}>
          {UI_COPY.helpButton}
        </button>
        <button type="button" className="button button--quiet" onClick={onWait}>
          {UI_COPY.waitUntilDeadlineButton}
        </button>
      </div>
    </section>
  );
}
