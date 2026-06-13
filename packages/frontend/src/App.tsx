import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type CircleMember,
  cancelAndFetchRequest,
  type RequestRecord,
  type RequestStatus,
  respondAndFetchRequest,
} from './lib/api';
import { canonicalize, payloadFromRequest } from './lib/canonical';
import { UI_COPY } from './lib/copy';
import {
  exportPublicKeyBase64,
  getOrCreateKeyPair,
  IndexedDbKeyStore,
  type KeyStore,
  signPayload,
} from './lib/crypto';
import { noticeForError } from './lib/notices';
import {
  CreateRequestScreen,
  type RequestFormValues,
} from './screens/CreateRequestScreen';
import { EmergencyStopScreen } from './screens/EmergencyStopScreen';
import { FamilyManageScreen } from './screens/FamilyManageScreen';
import { HomeScreen, type RecentEntry } from './screens/HomeScreen';
import { type InboxItem, InboxScreen } from './screens/InboxScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { ReceiveApproveScreen } from './screens/ReceiveApproveScreen';
import { ResultExpiredScreen } from './screens/ResultExpiredScreen';
import { ResultInProgressScreen } from './screens/ResultInProgressScreen';
import { ResultNotConfirmedScreen } from './screens/ResultNotConfirmedScreen';
import { ResultUnansweredScreen } from './screens/ResultUnansweredScreen';
import { ResultVerifiedScreen } from './screens/ResultVerifiedScreen';

type View =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'family' }
  | { name: 'inbox' }
  | { name: 'receive'; request: RequestRecord; requesterLabel: string }
  | { name: 'result'; request: RequestRecord; targetName: string }
  | { name: 'stop' };

const DEVICE_KEY_ID = 'this-device';
const MEMBER_ID_STORAGE_KEY = 'zerokey-member-id';
const DEVICE_ID_STORAGE_KEY = 'zerokey-device-id';
const CIRCLE_ID_STORAGE_KEY = 'zerokey-circle-id';
const MEMBER_NAME_STORAGE_KEY = 'zerokey-member-name';

/** 受信箱に並べる未確定の状態。 */
const UNSETTLED_STATUSES: ReadonlySet<RequestStatus> = new Set<RequestStatus>([
  'unanswered',
  'collecting',
  'waiting',
]);

/** その確認がまだ確定していない（受信箱に並べる）かを判定する。 */
export function isUnsettled(status: RequestStatus): boolean {
  return UNSETTLED_STATUSES.has(status);
}

/**
 * メンバー ID から表示名を解決する。
 * リストに無い場合でも ID を人名として表示しない（「家族」で代替する）。
 */
export function resolveTargetName(
  targets: readonly { id: string; name: string }[],
  targetId: string
): string {
  return targets.find((target) => target.id === targetId)?.name ?? '家族';
}

/** 依頼者の「（人名）さんの端末」ラベルを実メンバーから組み立てる。 */
export function requesterLabelFor(
  members: readonly CircleMember[],
  requesterMemberId: string
): string {
  return `${resolveTargetName(members, requesterMemberId)}さんの端末`;
}

/** 受信箱用に、未確定の確認だけを依頼者ラベル付きで並べる。 */
export function buildInboxItems(
  requests: readonly RequestRecord[],
  members: readonly CircleMember[]
): InboxItem[] {
  return requests
    .filter((request) => isUnsettled(request.status))
    .map((request) => ({
      id: request.id,
      subject: request.subject,
      requesterLabel: requesterLabelFor(members, request.requesterMemberId),
      status: request.status,
    }));
}

interface SelfState {
  memberId: string;
  deviceId: string;
  circleId: string;
  name: string;
}

interface AppProps {
  keyStore?: KeyStore;
}

/** localStorage から保存済みの自分を読み出す。未登録なら null。 */
function loadSelf(): SelfState | null {
  const memberId = localStorage.getItem(MEMBER_ID_STORAGE_KEY);
  const deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  const circleId = localStorage.getItem(CIRCLE_ID_STORAGE_KEY);
  const name = localStorage.getItem(MEMBER_NAME_STORAGE_KEY);
  if (memberId && deviceId && circleId && name) {
    return { memberId, deviceId, circleId, name };
  }
  return null;
}

export function App({ keyStore = new IndexedDbKeyStore() }: AppProps) {
  const [self, setSelf] = useState<SelfState | null>(() => loadSelf());
  const [view, setView] = useState<View>({ name: 'home' });
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const showError = useCallback((error: unknown) => {
    // 生のエラーメッセージ（技術文言・JSON）を表示しない。
    setNotice(noticeForError(error));
  }, []);

  const goHome = useCallback(() => {
    setNotice(null);
    setView({ name: 'home' });
  }, []);

  /** 宛先候補に使う家族メンバー（自分を含む生の一覧）を取り直す。 */
  const refreshMembers = useCallback(
    async (current: SelfState): Promise<CircleMember[]> => {
      const list = await api.listCircleMembers(current.circleId);
      setMembers(list);
      return list;
    },
    []
  );

  // 自分が確定したら家族メンバーを読み込む（宛先候補・名前解決に使う）。
  useEffect(() => {
    if (self === null) {
      return;
    }
    refreshMembers(self).catch(showError);
  }, [self, refreshMembers, showError]);

  /** 初回オンボーディング: 名前登録 → メンバー作成 → 家族グループ作成。 */
  const handleOnboard = useCallback(
    async (name: string) => {
      try {
        const pair = await getOrCreateKeyPair(keyStore, DEVICE_KEY_ID);
        const publicKey = await exportPublicKeyBase64(pair.publicKey);
        const member = await api.createMember({ name, publicKey });
        const circle = await api.createCircle({
          name: `${name}の家族`,
          creatorMemberId: member.id,
        });
        localStorage.setItem(MEMBER_ID_STORAGE_KEY, member.id);
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, member.deviceId);
        localStorage.setItem(CIRCLE_ID_STORAGE_KEY, circle.id);
        localStorage.setItem(MEMBER_NAME_STORAGE_KEY, member.name);
        setSelf({
          memberId: member.id,
          deviceId: member.deviceId,
          circleId: circle.id,
          name: member.name,
        });
        setView({ name: 'home' });
      } catch (error) {
        showError(error);
      }
    },
    [keyStore, showError]
  );

  const handleCreateRequest = useCallback(
    async (values: RequestFormValues) => {
      if (self === null) {
        return;
      }
      try {
        const deadline = new Date(
          Date.now() + values.deadlineMinutes * 60 * 1000
        ).toISOString();
        const request = await api.createRequest({
          circleId: self.circleId,
          requesterMemberId: self.memberId,
          targetMemberId: values.targetId,
          subject: values.subject,
          amount: values.amount,
          beneficiary: values.beneficiary,
          reason: values.reason,
          deadline,
        });
        setNotice(null);
        setView({
          name: 'result',
          request,
          // 実メンバーから名前解決する（メンバー ID を人名として出さない）。
          targetName: resolveTargetName(members, values.targetId),
        });
      } catch (error) {
        showError(error);
      }
    },
    [self, members, showError]
  );

  const handleRespond = useCallback(
    async (request: RequestRecord, kind: 'approve' | 'reject') => {
      if (self === null) {
        return;
      }
      try {
        const pair = await getOrCreateKeyPair(keyStore, DEVICE_KEY_ID);
        const canonical = canonicalize(payloadFromRequest(request, kind));
        const signature = await signPayload(pair.privateKey, canonical);
        // respond のレスポンスは最小 JSON のため、完全なレコードを取り直す。
        const updated = await respondAndFetchRequest(api, request.id, {
          deviceId: self.deviceId,
          kind,
          signature,
        });
        setNotice(null);
        setRecentEntries((entries) => [
          {
            id: updated.id,
            relation: '家族',
            name: self.name,
            action: kind === 'approve' ? '承認' : '拒否',
            date: new Date().toLocaleDateString('ja-JP'),
          },
          ...entries,
        ]);
        setView({ name: 'result', request: updated, targetName: self.name });
      } catch (error) {
        showError(error);
      }
    },
    [self, keyStore, showError]
  );

  const handleCancelRequest = useCallback(
    async (request: RequestRecord, targetName: string) => {
      if (self === null) {
        return;
      }
      try {
        // バックエンドは requesterMemberId をボディで必須にしている。
        const cancelled = await cancelAndFetchRequest(
          api,
          request.id,
          self.memberId
        );
        setView({ name: 'result', request: cancelled, targetName });
      } catch (error) {
        showError(error);
      }
    },
    [self, showError]
  );

  const handleStop = useCallback(async () => {
    if (self === null) {
      return;
    }
    try {
      await api.stopCircle(self.circleId, { memberId: self.memberId });
      setNotice(
        'すべての承認を止めました。再開には家族 2 人の操作が必要です。'
      );
      setView({ name: 'home' });
    } catch (error) {
      showError(error);
    }
  }, [self, showError]);

  const refreshResult = useCallback(
    async (requestId: string, targetName: string) => {
      try {
        const request = await api.getRequest(requestId);
        setView({ name: 'result', request, targetName });
      } catch (error) {
        showError(error);
      }
    },
    [showError]
  );

  /** 家族の管理画面を開く（最新メンバーを読み込み、招待コードは消す）。 */
  const openFamily = useCallback(async () => {
    if (self === null) {
      return;
    }
    setInviteCode(null);
    setNotice(null);
    try {
      await refreshMembers(self);
    } catch (error) {
      showError(error);
    }
    setView({ name: 'family' });
  }, [self, refreshMembers, showError]);

  const handleCreateInvite = useCallback(async () => {
    if (self === null) {
      return;
    }
    try {
      const invite = await api.createInvite({
        circleId: self.circleId,
        inviterMemberId: self.memberId,
        kind: 'qr',
      });
      setInviteCode(invite.id);
    } catch (error) {
      showError(error);
    }
  }, [self, showError]);

  const handleJoinFamily = useCallback(
    async (code: string) => {
      if (self === null) {
        return;
      }
      try {
        const confirmed = await api.confirmInvite(code, {
          inviteeMemberId: self.memberId,
        });
        const joinedCircleId = confirmed.circleId ?? self.circleId;
        localStorage.setItem(CIRCLE_ID_STORAGE_KEY, joinedCircleId);
        const next = { ...self, circleId: joinedCircleId };
        setSelf(next);
        setInviteCode(null);
        setNotice(UI_COPY.familyJoinedNote);
        await refreshMembers(next);
      } catch (error) {
        showError(error);
      }
    },
    [self, refreshMembers, showError]
  );

  /** 受信箱を開く（自分宛の未確定の確認を読み込む）。 */
  const openInbox = useCallback(async () => {
    if (self === null) {
      return;
    }
    setNotice(null);
    try {
      const list = await refreshMembers(self);
      const requests = await api.listRequests(self.circleId, {
        targetMemberId: self.memberId,
      });
      setInboxItems(buildInboxItems(requests, list));
    } catch (error) {
      showError(error);
    }
    setView({ name: 'inbox' });
  }, [self, refreshMembers, showError]);

  const openInboxItem = useCallback(
    async (item: InboxItem) => {
      try {
        const request = await api.getRequest(item.id);
        setView({
          name: 'receive',
          request,
          requesterLabel: item.requesterLabel,
        });
      } catch (error) {
        showError(error);
      }
    },
    [showError]
  );

  // 名前未登録ならオンボーディングへ誘導する。
  if (self === null) {
    return (
      <main className="app">
        {notice !== null && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <OnboardingScreen onStart={handleOnboard} />
      </main>
    );
  }

  // 宛先候補は自分を除いた家族メンバー。
  const targets = members
    .filter((member) => member.id !== self.memberId)
    .map((member) => ({ id: member.id, name: member.name }));

  return (
    <main className="app">
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {view.name === 'home' && (
        <HomeScreen
          recentEntries={recentEntries}
          onCreateRequest={() => setView({ name: 'create' })}
          onHelp={() => setView({ name: 'stop' })}
          onManageFamily={openFamily}
          onOpenInbox={openInbox}
        />
      )}
      {view.name === 'create' && (
        <CreateRequestScreen
          targets={targets}
          onSubmit={handleCreateRequest}
          onBack={goHome}
          onManageFamily={openFamily}
        />
      )}
      {view.name === 'family' && (
        <FamilyManageScreen
          circleId={self.circleId}
          members={members}
          inviteCode={inviteCode}
          onCreateInvite={handleCreateInvite}
          onJoin={handleJoinFamily}
          onBack={goHome}
        />
      )}
      {view.name === 'inbox' && (
        <InboxScreen
          items={inboxItems}
          onOpen={openInboxItem}
          onBack={goHome}
        />
      )}
      {view.name === 'receive' && (
        <ReceiveApproveScreen
          requesterLabel={view.requesterLabel}
          request={{
            subject: view.request.subject,
            amount: view.request.amount,
            beneficiary: view.request.beneficiary,
            reason: view.request.reason,
            deadlineText: new Date(view.request.deadline).toLocaleString(
              'ja-JP'
            ),
          }}
          onApprove={() => handleRespond(view.request, 'approve')}
          onReject={() => handleRespond(view.request, 'reject')}
        />
      )}
      {view.name === 'result' && (
        <ResultView
          request={view.request}
          targetName={view.targetName}
          onClose={goHome}
          onHelp={() => setView({ name: 'stop' })}
          onCancelRequest={() =>
            handleCancelRequest(view.request, view.targetName)
          }
          onRefresh={() => refreshResult(view.request.id, view.targetName)}
          onRetry={() => setView({ name: 'create' })}
        />
      )}
      {view.name === 'stop' && (
        <EmergencyStopScreen onStop={handleStop} onBack={goHome} />
      )}
    </main>
  );
}

export function ResultView({
  request,
  targetName,
  onClose,
  onHelp,
  onCancelRequest,
  onRefresh,
  onRetry,
}: {
  request: RequestRecord;
  targetName: string;
  onClose: () => void;
  onHelp: () => void;
  onCancelRequest: () => void;
  onRefresh: () => void;
  onRetry: () => void;
}) {
  switch (request.status) {
    case 'approved':
      return (
        <ResultVerifiedScreen
          targetName={targetName}
          amount={request.amount}
          beneficiary={request.beneficiary}
          reason={request.reason}
          // バックエンドのレスポンスに応答日時が含まれないため、
          // 閲覧時刻などの偽の時刻を署名日時として表示しない。
          signedAt={UI_COPY.signedAtUnavailable}
          onClose={onClose}
          onHelp={onHelp}
        />
      );
    case 'collecting':
      return (
        <ResultInProgressScreen
          kind="collecting"
          onCancelRequest={onCancelRequest}
          onRefresh={onRefresh}
          onHelp={onHelp}
        />
      );
    case 'waiting':
      return (
        <ResultInProgressScreen
          kind="waiting"
          onCancelRequest={onCancelRequest}
          onRefresh={onRefresh}
          onHelp={onHelp}
        />
      );
    case 'rejected':
      return (
        <ResultNotConfirmedScreen
          kind="rejected"
          targetName={targetName}
          onHelp={onHelp}
        />
      );
    case 'verification_failed':
      return (
        <ResultNotConfirmedScreen
          kind="verification_failed"
          targetName={targetName}
          onHelp={onHelp}
        />
      );
    case 'expired':
      return (
        <ResultExpiredScreen
          targetName={targetName}
          onRetry={onRetry}
          onHelp={onHelp}
        />
      );
    case 'invalidated':
      return (
        <section className="screen screen--result">
          <p className="main-copy">このお願いは取り消されました。</p>
          <button type="button" className="button" onClick={onClose}>
            もどる
          </button>
        </section>
      );
    default:
      return (
        <ResultUnansweredScreen
          targetName={targetName}
          onAskAnother={onRetry}
          onCancelRequest={onCancelRequest}
          onHelp={onHelp}
          onWait={onRefresh}
        />
      );
  }
}
