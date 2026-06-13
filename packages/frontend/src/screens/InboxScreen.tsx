import type { RequestStatus } from '../lib/api';
import { UI_COPY } from '../lib/copy';

/** 受信箱の 1 件。未確定の確認のお願いを表す。 */
export interface InboxItem {
  id: string;
  subject: string;
  /** 依頼者の表示（「（人名）さんの端末」）。 */
  requesterLabel: string;
  status: RequestStatus;
}

interface Props {
  items: InboxItem[];
  onOpen: (item: InboxItem) => void;
  onBack: () => void;
}

/**
 * 受信箱。未確定（unanswered / collecting / waiting）の確認のお願いを一覧表示し、
 * タップで承認画面へ遷移する。承認済み以外に成功色・チェックマークを使わない。
 */
export function InboxScreen({ items, onOpen, onBack }: Props) {
  return (
    <section className="screen screen--inbox">
      <h1>{UI_COPY.inboxHeading}</h1>
      {items.length === 0 ? (
        <p className="meta">{UI_COPY.inboxEmpty}</p>
      ) : (
        <ul className="inbox-list">
          {items.map((item) => (
            <li key={item.id} className="inbox-list__item">
              <p className="main-copy">{item.subject}</p>
              <p className="meta">{item.requesterLabel}からのお願いです。</p>
              <button
                type="button"
                className="button button--primary button--large"
                onClick={() => onOpen(item)}
              >
                {UI_COPY.inboxOpenButton}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions actions--stacked">
        <button type="button" className="button button--quiet" onClick={onBack}>
          {UI_COPY.backButton}
        </button>
      </div>
    </section>
  );
}
