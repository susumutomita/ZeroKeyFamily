import { UI_COPY } from '../lib/copy';
import { StatusHeading } from './parts';

interface Props {
  kind: 'collecting' | 'waiting';
  onCancelRequest?: () => void;
  onRefresh?: () => void;
  onHelp?: () => void;
}

/**
 * 結果表示（進行中: collecting / waiting）。
 * collecting は 2 人目の家族の確認待ち、waiting は高リスク待機時間中。
 * 未確認を安心情報として表現せず、成功色・チェックマークを使わない。
 * どちらの状態でも取り消し導線を必ず置く（safety-copy-guide）。
 */
export function ResultInProgressScreen({
  kind,
  onCancelRequest,
  onRefresh,
  onHelp,
}: Props) {
  return (
    <section className="screen screen--result">
      <StatusHeading icon="…" tone="pending">
        {kind === 'collecting'
          ? UI_COPY.collectingHeading
          : UI_COPY.waitingHeading}
      </StatusHeading>
      <p className="main-copy">{UI_COPY.inProgressCancelNote}</p>
      <p className="main-copy main-copy--directive">{UI_COPY.doNotSendMoney}</p>
      <div className="actions actions--stacked">
        <button type="button" className="button" onClick={onCancelRequest}>
          {UI_COPY.cancelRequestButton}
        </button>
        <button type="button" className="button" onClick={onRefresh}>
          {UI_COPY.refreshStatusButton}
        </button>
        <button type="button" className="button button--help" onClick={onHelp}>
          {UI_COPY.helpButton}
        </button>
      </div>
    </section>
  );
}
