import { UI_COPY } from '../lib/copy';

/** 最近の確認の 1 件。主語は人名ではなく「（人名）さんの端末」とする。 */
export interface RecentEntry {
  id: string;
  relation: string;
  name: string;
  action: '承認' | '拒否' | '未応答';
  date: string;
}

interface Props {
  recentEntries: RecentEntry[];
  onCreateRequest: () => void;
  onHelp: () => void;
  onOpenEntry?: (entry: RecentEntry) => void;
}

/**
 * W-01 ホーム。
 * 「困ったとき」は常時第 2 ボタンに置き、深い階層に隠さない。
 */
export function HomeScreen({
  recentEntries,
  onCreateRequest,
  onHelp,
  onOpenEntry,
}: Props) {
  return (
    <section className="screen screen--home">
      <h1 className="app-title">{UI_COPY.appName}</h1>
      <div className="actions actions--stacked">
        <button
          type="button"
          className="button button--primary button--large"
          onClick={onCreateRequest}
        >
          {UI_COPY.createRequestButton}
        </button>
        <button
          type="button"
          className="button button--help button--large"
          onClick={onHelp}
        >
          {UI_COPY.helpButton}
        </button>
      </div>
      <h2 className="section-title">{UI_COPY.recentHeading}</h2>
      {recentEntries.length === 0 ? (
        <p className="meta">まだ確認のお願いはありません。</p>
      ) : (
        <ul className="recent-list">
          {recentEntries.map((entry) => (
            <li key={entry.id} className="recent-list__item">
              <button
                type="button"
                className="recent-list__button"
                onClick={() => onOpenEntry?.(entry)}
              >
                <span>
                  {entry.relation}（{entry.name}さんの端末）が{entry.action}
                </span>
                <span className="meta">{entry.date}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <nav className="footer-nav" aria-label="その他のメニュー">
        <span>家族の管理</span>
        <span>設定</span>
        <span>履歴</span>
      </nav>
    </section>
  );
}
