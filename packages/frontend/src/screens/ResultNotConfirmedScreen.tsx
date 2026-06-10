import { STANDARD_COPY, UI_COPY } from '../lib/copy';
import { StatusHeading } from './parts';

interface Props {
  kind: 'rejected' | 'verification_failed';
  targetName: string;
  onHelp?: () => void;
}

/**
 * W-06 結果表示（拒否・検証失敗）。
 * 拒否は「失敗」ではなく重要情報として伝える。検証失敗は承認として扱わない。
 */
export function ResultNotConfirmedScreen({ kind, targetName, onHelp }: Props) {
  return (
    <section className="screen screen--result">
      <StatusHeading icon="✕" tone="failed">
        {UI_COPY.notConfirmedHeading}
      </StatusHeading>
      {kind === 'rejected' ? (
        <p className="main-copy">{STANDARD_COPY.rejected(targetName)}</p>
      ) : (
        <p className="main-copy">{STANDARD_COPY.verificationFailed}</p>
      )}
      <div className="actions actions--stacked">
        <button type="button" className="button button--help" onClick={onHelp}>
          {UI_COPY.helpButton}
        </button>
      </div>
    </section>
  );
}
