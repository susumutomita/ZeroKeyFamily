import { useId, useState } from 'react';
import { UI_COPY } from '../lib/copy';

interface Props {
  onStart: (name: string) => void | Promise<void>;
}

/**
 * 初回オンボーディング。名前未登録のときに表示し、名前を受け取って
 * メンバー登録と家族グループ作成へつなぐ。ハードコードした名前は使わない。
 */
export function OnboardingScreen({ onStart }: Props) {
  const fieldId = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const canStart = name.trim() !== '' && !busy;

  const handleStart = async () => {
    if (name.trim() === '') {
      return;
    }
    setBusy(true);
    try {
      await onStart(name.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screen screen--form">
      <h1>{UI_COPY.onboardingHeading}</h1>
      <p className="main-copy">{UI_COPY.onboardingNote}</p>
      <div className="field">
        <label htmlFor={fieldId}>{UI_COPY.onboardingNameLabel}</label>
        <input
          id={fieldId}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="actions actions--stacked">
        <button
          type="button"
          className="button button--primary button--large"
          disabled={!canStart}
          onClick={handleStart}
        >
          {UI_COPY.onboardingStartButton}
        </button>
      </div>
    </section>
  );
}
