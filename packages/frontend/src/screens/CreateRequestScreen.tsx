import { useId, useState } from 'react';
import { UI_COPY } from '../lib/copy';
import { validateRequestForm } from '../lib/validation';

export interface RequestFormValues {
  targetId: string;
  subject: string;
  amount: number;
  beneficiary: string;
  reason: string;
  deadlineMinutes: number;
}

interface Props {
  targets: { id: string; name: string; relation?: string }[];
  onSubmit: (values: RequestFormValues) => void;
  onBack?: () => void;
  /** 宛先が 0 人のときの家族管理への導線。 */
  onManageFamily?: () => void;
}

const SUBJECT_PRESETS = [
  'お金を送ってほしいと言われた',
  '電話番号が変わったと言われた',
  'カード・通帳を渡すように言われた',
  'その他の確認',
] as const;

const DEADLINE_CHOICES = [
  { minutes: 15, label: '15 分' },
  { minutes: 30, label: '30 分' },
  { minutes: 60, label: '1 時間' },
] as const;

/**
 * W-02 確認要求の作成。
 * 金額・送金先・理由は必須。未入力時は送信ボタンを無効化し、省略経路を設けない。
 */
export function CreateRequestScreen({
  targets,
  onSubmit,
  onBack,
  onManageFamily,
}: Props) {
  const formId = useId();
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [subject, setSubject] = useState<string>(SUBJECT_PRESETS[0]);
  const [amount, setAmount] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [reason, setReason] = useState('');
  const [deadlineMinutes, setDeadlineMinutes] = useState(30);

  const canSubmit =
    targetId !== '' && validateRequestForm({ amount, beneficiary, reason });

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit({
      targetId,
      subject,
      amount: Number(amount),
      beneficiary,
      reason,
      deadlineMinutes,
    });
  };

  // 宛先候補が 0 人のときは確認を作れない。家族追加へ誘導する
  // （必須項目検証はそのまま）。
  if (targets.length === 0) {
    return (
      <section className="screen screen--form">
        <h1>確認の前に</h1>
        <p className="main-copy">{UI_COPY.noTargetsNote}</p>
        <div className="actions actions--stacked">
          <button
            type="button"
            className="button button--primary button--large"
            onClick={() => onManageFamily?.()}
          >
            {UI_COPY.goManageFamilyButton}
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={onBack}
          >
            {UI_COPY.backButton}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="screen screen--form">
      <h1>{UI_COPY.createRequestButton}</h1>
      <fieldset className="field">
        <legend>だれに確認しますか</legend>
        {targets.map((target) => (
          <label key={target.id} className="radio-label">
            <input
              type="radio"
              name={`${formId}-target`}
              value={target.id}
              checked={targetId === target.id}
              onChange={() => setTargetId(target.id)}
            />
            {target.name}
            {target.relation !== undefined && `（${target.relation}）`}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`${formId}-subject`}>
          何についての確認ですか（必須）
        </label>
        <select
          id={`${formId}-subject`}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        >
          {SUBJECT_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${formId}-amount`}>金額（必須）</label>
        <input
          id={`${formId}-amount`}
          type="number"
          inputMode="numeric"
          min="1"
          placeholder="円"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-beneficiary`}>送金先（必須）</label>
        <input
          id={`${formId}-beneficiary`}
          type="text"
          value={beneficiary}
          onChange={(event) => setBeneficiary(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-reason`}>理由（必須）</label>
        <input
          id={`${formId}-reason`}
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-deadline`}>回答期限</label>
        <select
          id={`${formId}-deadline`}
          value={deadlineMinutes}
          onChange={(event) => setDeadlineMinutes(Number(event.target.value))}
        >
          {DEADLINE_CHOICES.map((choice) => (
            <option key={choice.minutes} value={choice.minutes}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      <p className="caution">注意: {UI_COPY.formNotice}</p>
      <div className="actions actions--stacked">
        <button
          type="button"
          className="button button--primary button--large"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {UI_COPY.submitRequestButton}
        </button>
        <button type="button" className="button button--quiet" onClick={onBack}>
          {UI_COPY.backButton}
        </button>
      </div>
    </section>
  );
}
