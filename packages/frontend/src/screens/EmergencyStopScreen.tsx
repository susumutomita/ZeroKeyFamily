import { UI_COPY } from '../lib/copy';

interface Props {
  onStop: () => void;
  onBack?: () => void;
}

/**
 * W-08 緊急停止。
 * 理由の入力を求めず、確認ダイアログ 1 回のみで発動できる。
 */
export function EmergencyStopScreen({ onStop, onBack }: Props) {
  const handleStop = () => {
    if (window.confirm(UI_COPY.stopConfirmMessage)) {
      onStop();
    }
  };

  return (
    <section className="screen screen--stop">
      <h1>{UI_COPY.stopHeading}</h1>
      <div className="actions actions--stacked">
        <button
          type="button"
          className="button button--danger button--large"
          onClick={handleStop}
        >
          {UI_COPY.stopAllButton}
        </button>
        <p className="meta">{UI_COPY.stopNoReasonNote}</p>
        <div className="help-item">
          <p className="main-copy">{UI_COPY.stopConsultButton}</p>
          <p className="caution">{UI_COPY.policeConsult}</p>
        </div>
        <div className="help-item">
          <p className="main-copy">{UI_COPY.stopMistakeButton}</p>
          <p className="caution">
            まちがえて承認した場合も、上のボタンで承認を止めてから家族に連絡してください。
          </p>
        </div>
      </div>
      <p className="caution">{UI_COPY.stopReleaseNote}</p>
      <div className="actions">
        <button type="button" className="button button--quiet" onClick={onBack}>
          {UI_COPY.backButton}
        </button>
      </div>
    </section>
  );
}
