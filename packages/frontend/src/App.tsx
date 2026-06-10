import { useCallback, useState } from 'react';
import {
  api,
  cancelAndFetchRequest,
  type RequestRecord,
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
import { HomeScreen, type RecentEntry } from './screens/HomeScreen';
import { ReceiveApproveScreen } from './screens/ReceiveApproveScreen';
import { ResultExpiredScreen } from './screens/ResultExpiredScreen';
import { ResultInProgressScreen } from './screens/ResultInProgressScreen';
import { ResultNotConfirmedScreen } from './screens/ResultNotConfirmedScreen';
import { ResultUnansweredScreen } from './screens/ResultUnansweredScreen';
import { ResultVerifiedScreen } from './screens/ResultVerifiedScreen';

type View =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'receive'; request: RequestRecord; requesterLabel: string }
  | { name: 'result'; request: RequestRecord; targetName: string }
  | { name: 'stop' };

const DEVICE_KEY_ID = 'this-device';
const MEMBER_ID_STORAGE_KEY = 'zerokey-member-id';
const DEVICE_ID_STORAGE_KEY = 'zerokey-device-id';
const CIRCLE_ID_STORAGE_KEY = 'zerokey-circle-id';

/** 確認相手の候補。招待機能が入るまでの暫定動線では空。 */
const REQUEST_TARGETS: { id: string; name: string; relation?: string }[] = [];

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

interface AppProps {
  keyStore?: KeyStore;
}

/** localStorage に保存済みの自分のメンバー・端末を返し、無ければ API で登録する。 */
async function ensureSelfRegistered(keyStore: KeyStore): Promise<{
  memberId: string;
  deviceId: string;
  circleId: string;
}> {
  const storedMember = localStorage.getItem(MEMBER_ID_STORAGE_KEY);
  const storedDevice = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  const storedCircle = localStorage.getItem(CIRCLE_ID_STORAGE_KEY);
  if (storedMember && storedDevice && storedCircle) {
    return {
      memberId: storedMember,
      deviceId: storedDevice,
      circleId: storedCircle,
    };
  }
  const pair = await getOrCreateKeyPair(keyStore, DEVICE_KEY_ID);
  const publicKey = await exportPublicKeyBase64(pair.publicKey);
  const member = await api.createMember({ name: '自分', publicKey });
  const circle = await api.createCircle({ name: '家族グループ' });
  localStorage.setItem(MEMBER_ID_STORAGE_KEY, member.id);
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, member.deviceId);
  localStorage.setItem(CIRCLE_ID_STORAGE_KEY, circle.id);
  return {
    memberId: member.id,
    deviceId: member.deviceId,
    circleId: circle.id,
  };
}

export function App({ keyStore = new IndexedDbKeyStore() }: AppProps) {
  const [view, setView] = useState<View>({ name: 'home' });
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const showError = useCallback((error: unknown) => {
    // 生のエラーメッセージ（技術文言・JSON）を表示しない。
    setNotice(noticeForError(error));
  }, []);

  const goHome = useCallback(() => {
    setNotice(null);
    setView({ name: 'home' });
  }, []);

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

  const handleCreateRequest = useCallback(
    async (values: RequestFormValues) => {
      try {
        const self = await ensureSelfRegistered(keyStore);
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
          // メンバー ID を人名として表示しない。
          targetName: resolveTargetName(REQUEST_TARGETS, values.targetId),
        });
      } catch (error) {
        showError(error);
      }
    },
    [keyStore, showError]
  );

  const handleRespond = useCallback(
    async (request: RequestRecord, kind: 'approve' | 'reject') => {
      try {
        const self = await ensureSelfRegistered(keyStore);
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
            name: '自分',
            action: kind === 'approve' ? '承認' : '拒否',
            date: new Date().toLocaleDateString('ja-JP'),
          },
          ...entries,
        ]);
        setView({ name: 'result', request: updated, targetName: '自分' });
      } catch (error) {
        showError(error);
      }
    },
    [keyStore, showError]
  );

  const handleCancelRequest = useCallback(
    async (request: RequestRecord, targetName: string) => {
      try {
        const self = await ensureSelfRegistered(keyStore);
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
    [keyStore, showError]
  );

  const handleStop = useCallback(async () => {
    try {
      const self = await ensureSelfRegistered(keyStore);
      await api.stopCircle(self.circleId, { memberId: self.memberId });
      setNotice(
        'すべての承認を止めました。再開には家族 2 人の操作が必要です。'
      );
      setView({ name: 'home' });
    } catch (error) {
      showError(error);
    }
  }, [keyStore, showError]);

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
        />
      )}
      {view.name === 'create' && (
        <CreateRequestScreen
          targets={REQUEST_TARGETS}
          onSubmit={handleCreateRequest}
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
