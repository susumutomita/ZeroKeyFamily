import { useId, useState } from 'react';
import type { CircleMember, MyCircle } from '../lib/api';
import { UI_COPY } from '../lib/copy';

interface Props {
  /** 現在の家族グループのコード（circleId）。 */
  circleId: string;
  /** 参加メンバー（名前つき・参加順）。 */
  members: CircleMember[];
  /** 参加中の家族グループ一覧（アクティブな家族の切り替えに使う）。 */
  myCircles: MyCircle[];
  /** 発行済みの招待コード（invite.id）。未発行なら null。 */
  inviteCode: string | null;
  onCreateInvite: () => void | Promise<void>;
  onJoin: (inviteCode: string) => void | Promise<void>;
  /** 参加中の家族から別の家族へアクティブを切り替える。 */
  onSwitchCircle: (circleId: string) => void | Promise<void>;
  onBack: () => void;
}

/**
 * W-07 家族の管理。
 * 家族コードと参加メンバーを表示し、招待コードの発行と別の家族への参加を行う。
 * 承認済み以外の状態に成功色・チェックマークを使わない（安全文言ガイド準拠）。
 */
export function FamilyManageScreen({
  circleId,
  members,
  myCircles,
  inviteCode,
  onCreateInvite,
  onJoin,
  onSwitchCircle,
  onBack,
}: Props) {
  const joinFieldId = useId();
  const [joinCode, setJoinCode] = useState('');
  const canJoin = joinCode.trim() !== '';

  return (
    <section className="screen screen--family">
      <h1>{UI_COPY.familyManageHeading}</h1>
      <div className="field">
        <span className="field-label">{UI_COPY.familyCodeLabel}</span>
        <p className="code-value">{circleId}</p>
      </div>

      <h2 className="section-title">{UI_COPY.myCirclesHeading}</h2>
      {myCircles.length === 0 ? (
        <p className="meta">{UI_COPY.myCirclesEmpty}</p>
      ) : (
        <ul className="circle-list">
          {myCircles.map((circle) => {
            const isActive = circle.id === circleId;
            return (
              <li key={circle.id} className="circle-list__item">
                <p className="main-copy">{circle.name}</p>
                {circle.status === 'stopped' && (
                  <p className="meta">{UI_COPY.myCirclesStoppedNote}</p>
                )}
                {isActive ? (
                  <p className="meta">{UI_COPY.myCirclesActiveLabel}</p>
                ) : (
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => onSwitchCircle(circle.id)}
                  >
                    {UI_COPY.myCirclesSwitchButton}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="section-title">{UI_COPY.familyMembersHeading}</h2>
      {members.length === 0 ? (
        <p className="meta">まだメンバーがいません。</p>
      ) : (
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.id} className="member-list__item">
              {member.name}
            </li>
          ))}
        </ul>
      )}

      <div className="actions actions--stacked">
        <button
          type="button"
          className="button button--primary button--large"
          onClick={() => onCreateInvite()}
        >
          {UI_COPY.familyInviteButton}
        </button>
      </div>
      {inviteCode !== null && (
        <div className="field">
          <span className="field-label">{UI_COPY.familyInviteCodeLabel}</span>
          <p className="code-value">{inviteCode}</p>
          <p className="meta">{UI_COPY.familyInviteCodeNote}</p>
        </div>
      )}

      <h2 className="section-title">{UI_COPY.familyJoinHeading}</h2>
      <div className="field">
        <label htmlFor={joinFieldId}>{UI_COPY.familyJoinCodeLabel}</label>
        <input
          id={joinFieldId}
          type="text"
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value)}
        />
      </div>
      <div className="actions actions--stacked">
        <button
          type="button"
          className="button button--large"
          disabled={!canJoin}
          onClick={() => onJoin(joinCode.trim())}
        >
          {UI_COPY.familyJoinButton}
        </button>
        <button type="button" className="button button--quiet" onClick={onBack}>
          {UI_COPY.backButton}
        </button>
      </div>
    </section>
  );
}
