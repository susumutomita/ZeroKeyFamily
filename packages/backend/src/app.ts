import type { Database } from 'bun:sqlite';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Clock } from './clock';
import {
  canonicalReleasePayload,
  canonicalResponsePayload,
  type ResponseKind,
  verifyEd25519,
} from './crypto';

export interface AppDeps {
  db: Database;
  clock: Clock;
}

const HIGH_RISK_AMOUNT_THRESHOLD = 100_000;
const HIGH_RISK_WAIT_MS = 30 * 60_000;
const REMOTE_INVITE_WAIT_MS = 48 * 60 * 60_000;
// 回答期限は作成時点から 10 分以上 24 時間以内
// （docs/product/failure-and-offline-behaviors.md の既定値・変更範囲）。
const MIN_DEADLINE_OFFSET_MS = 10 * 60_000;
const MAX_DEADLINE_OFFSET_MS = 24 * 60 * 60_000;

const TERMINAL_REQUEST_STATUSES = new Set([
  'approved',
  'rejected',
  'expired',
  'verification_failed',
  'invalidated',
]);

interface MemberRow {
  id: string;
  name: string;
  created_at: string;
}

interface DeviceRow {
  id: string;
  member_id: string;
  public_key: string;
  status: string;
  created_at: string;
  revoked_at: string | null;
}

interface CircleRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface InviteRow {
  id: string;
  circle_id: string;
  inviter_member_id: string;
  invitee_member_id: string | null;
  kind: string;
  status: string;
  created_at: string;
  confirmable_at: string;
}

interface RequestRow {
  id: string;
  circle_id: string;
  requester_member_id: string;
  target_member_id: string;
  subject: string;
  amount: number;
  beneficiary: string;
  reason: string;
  deadline: string;
  nonce: string;
  status: string;
  high_risk_second_approval: number;
  high_risk_wait_required: number;
  high_risk_wait_until: string | null;
  created_at: string;
}

interface StopEventRow {
  id: string;
  circle_id: string;
  member_id: string;
  created_at: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toRequestJson(row: RequestRow): Record<string, unknown> {
  return {
    id: row.id,
    circleId: row.circle_id,
    requesterMemberId: row.requester_member_id,
    targetMemberId: row.target_member_id,
    subject: row.subject,
    amount: row.amount,
    beneficiary: row.beneficiary,
    reason: row.reason,
    deadline: row.deadline,
    nonce: row.nonce,
    status: row.status,
    secondApprovalRequired: row.high_risk_second_approval === 1,
    waitRequired: row.high_risk_wait_required === 1,
    waitUntil: row.high_risk_wait_until,
    createdAt: row.created_at,
  };
}

export function createApp(deps: AppDeps): Hono {
  const { db, clock } = deps;
  const app = new Hono();

  const nowMs = (): number => clock.now().getTime();
  const nowIso = (): string => clock.now().toISOString();

  const getMember = (id: string): MemberRow | null =>
    db.query<MemberRow, [string]>('SELECT * FROM members WHERE id = ?').get(id);

  const getDevice = (id: string): DeviceRow | null =>
    db.query<DeviceRow, [string]>('SELECT * FROM devices WHERE id = ?').get(id);

  const getCircle = (id: string): CircleRow | null =>
    db.query<CircleRow, [string]>('SELECT * FROM circles WHERE id = ?').get(id);

  const getInvite = (id: string): InviteRow | null =>
    db.query<InviteRow, [string]>('SELECT * FROM invites WHERE id = ?').get(id);

  const getRequest = (id: string): RequestRow | null =>
    db
      .query<RequestRow, [string]>('SELECT * FROM requests WHERE id = ?')
      .get(id);

  const isCircleMember = (circleId: string, memberId: string): boolean =>
    db
      .query<{ ok: number }, [string, string]>(
        `SELECT 1 AS ok FROM circle_members
         WHERE circle_id = ? AND member_id = ? AND left_at IS NULL`
      )
      .get(circleId, memberId) !== null;

  const setRequestStatus = (id: string, status: string): void => {
    db.run('UPDATE requests SET status = ? WHERE id = ?', [status, id]);
  };

  /**
   * 読み取り時の状態確定。期限超過した未確定要求は expired へ、
   * 待機満了した waiting は approved へ永続化する。
   */
  const refreshRequest = (row: RequestRow): RequestRow => {
    if (
      (row.status === 'unanswered' || row.status === 'collecting') &&
      nowMs() > Date.parse(row.deadline)
    ) {
      setRequestStatus(row.id, 'expired');
      return { ...row, status: 'expired' };
    }
    if (
      row.status === 'waiting' &&
      row.high_risk_wait_until !== null &&
      nowMs() >= Date.parse(row.high_risk_wait_until)
    ) {
      // 停止中の circle では待機満了でも approved へ昇格させない。
      // 停止解除後の最初の読み取りで（wait_until 経過済みなら）昇格する。
      const circle = getCircle(row.circle_id);
      if (!circle || circle.status === 'stopped') {
        return row;
      }
      setRequestStatus(row.id, 'approved');
      return { ...row, status: 'approved' };
    }
    return row;
  };

  const countDistinctApprovers = (requestId: string): number =>
    db
      .query<{ member_id: string }, [string]>(
        `SELECT DISTINCT d.member_id AS member_id
         FROM responses r JOIN devices d ON d.id = r.device_id
         WHERE r.request_id = ? AND r.kind = 'approve' AND r.verified = 1`
      )
      .all(requestId).length;

  const hasVerifiedApprovalFrom = (
    requestId: string,
    memberId: string
  ): boolean =>
    db
      .query<{ ok: number }, [string, string]>(
        `SELECT 1 AS ok
         FROM responses r JOIN devices d ON d.id = r.device_id
         WHERE r.request_id = ? AND d.member_id = ?
           AND r.kind = 'approve' AND r.verified = 1
         LIMIT 1`
      )
      .get(requestId, memberId) !== null;

  const recordResponse = (
    requestId: string,
    deviceId: string,
    kind: ResponseKind,
    payload: string,
    signature: string,
    verified: boolean
  ): void => {
    db.run(
      `INSERT INTO responses
       (id, request_id, device_id, kind, payload, signature, verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        requestId,
        deviceId,
        kind,
        payload,
        signature,
        verified ? 1 : 0,
        nowIso(),
      ]
    );
  };

  const readJson = async (
    c: Context
  ): Promise<Record<string, unknown> | null> => {
    try {
      const body: unknown = await c.req.json();
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
        return body as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };

  // --- メンバー登録（メンバー + 初回端末） ---
  app.post('/api/members', async (c) => {
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { name, publicKey } = body;
    if (!isNonEmptyString(name) || !isNonEmptyString(publicKey)) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    const memberId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const createdAt = nowIso();
    db.run('INSERT INTO members (id, name, created_at) VALUES (?, ?, ?)', [
      memberId,
      name,
      createdAt,
    ]);
    db.run(
      `INSERT INTO devices (id, member_id, public_key, status, created_at)
       VALUES (?, ?, ?, 'active', ?)`,
      [deviceId, memberId, publicKey, createdAt]
    );
    return c.json(
      {
        member: { id: memberId, name },
        device: { id: deviceId, memberId, publicKey, status: 'active' },
      },
      201
    );
  });

  // --- 家族グループ作成 ---
  app.post('/api/circles', async (c) => {
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { name, creatorMemberId } = body;
    if (!isNonEmptyString(name) || !isNonEmptyString(creatorMemberId)) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    if (!getMember(creatorMemberId)) {
      return c.json({ error: 'member_not_found' }, 404);
    }
    const circleId = crypto.randomUUID();
    const createdAt = nowIso();
    db.run(
      `INSERT INTO circles (id, name, status, created_at)
       VALUES (?, ?, 'normal', ?)`,
      [circleId, name, createdAt]
    );
    db.run(
      `INSERT INTO circle_members (circle_id, member_id, joined_at)
       VALUES (?, ?, ?)`,
      [circleId, creatorMemberId, createdAt]
    );
    return c.json({ circle: { id: circleId, name, status: 'normal' } }, 201);
  });

  app.get('/api/circles/:id', (c) => {
    const circle = getCircle(c.req.param('id'));
    if (!circle) {
      return c.json({ error: 'circle_not_found' }, 404);
    }
    const members = db
      .query<{ member_id: string }, [string]>(
        `SELECT member_id FROM circle_members
         WHERE circle_id = ? AND left_at IS NULL`
      )
      .all(circle.id)
      .map((row) => row.member_id);
    return c.json({
      circle: { id: circle.id, name: circle.name, status: circle.status },
      members,
    });
  });

  // --- 家族メンバー一覧（表示名つき。確認要求の宛先候補に使う） ---
  app.get('/api/circles/:id/members', (c) => {
    const circle = getCircle(c.req.param('id'));
    if (!circle) {
      return c.json({ error: 'circle_not_found' }, 404);
    }
    // 家族コード(circleId)を知るだけの非メンバーに名簿・履歴を露出しない。
    // 呼び出し元 memberId が当該 circle のメンバーであることを要求する。
    const callerId = c.req.query('memberId');
    if (!isNonEmptyString(callerId) || !isCircleMember(circle.id, callerId)) {
      return c.json({ error: 'not_circle_member' }, 403);
    }
    const members = db
      .query<{ id: string; name: string }, [string]>(
        `SELECT m.id AS id, m.name AS name
         FROM circle_members cm JOIN members m ON m.id = cm.member_id
         WHERE cm.circle_id = ? AND cm.left_at IS NULL
         ORDER BY cm.joined_at ASC, cm.rowid ASC`
      )
      .all(circle.id);
    return c.json({ members });
  });

  // --- 確認要求の一覧（受信箱・送信箱）。読み取り時に状態を確定する。 ---
  app.get('/api/circles/:id/requests', (c) => {
    const circle = getCircle(c.req.param('id'));
    if (!circle) {
      return c.json({ error: 'circle_not_found' }, 404);
    }
    // 確認履歴（金額・送金先・理由）は家族内に限定する。非メンバーには返さない。
    const callerId = c.req.query('memberId');
    if (!isNonEmptyString(callerId) || !isCircleMember(circle.id, callerId)) {
      return c.json({ error: 'not_circle_member' }, 403);
    }
    const targetMemberId = c.req.query('targetMemberId');
    const requesterMemberId = c.req.query('requesterMemberId');
    const conditions = ['circle_id = ?'];
    const params: string[] = [circle.id];
    if (isNonEmptyString(targetMemberId)) {
      conditions.push('target_member_id = ?');
      params.push(targetMemberId);
    }
    if (isNonEmptyString(requesterMemberId)) {
      conditions.push('requester_member_id = ?');
      params.push(requesterMemberId);
    }
    const rows = db
      .query<RequestRow, string[]>(
        `SELECT * FROM requests WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC`
      )
      .all(...params);
    const requests = rows.map((row) => toRequestJson(refreshRequest(row)));
    return c.json({ requests });
  });

  // --- あるメンバーが参加中の家族グループ一覧（家族の切り替えに使う） ---
  app.get('/api/members/:id/circles', (c) => {
    const member = getMember(c.req.param('id'));
    if (!member) {
      return c.json({ error: 'member_not_found' }, 404);
    }
    const circles = db
      .query<{ id: string; name: string; status: string }, [string]>(
        `SELECT c.id AS id, c.name AS name, c.status AS status
         FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
         WHERE cm.member_id = ? AND cm.left_at IS NULL
         ORDER BY cm.joined_at ASC, cm.rowid ASC`
      )
      .all(member.id);
    return c.json({ circles });
  });

  // --- 招待 ---
  app.post('/api/invites', async (c) => {
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { circleId, inviterMemberId, kind } = body;
    if (!isNonEmptyString(circleId) || !isNonEmptyString(inviterMemberId)) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    if (kind !== 'qr' && kind !== 'remote') {
      return c.json({ error: 'invalid_kind' }, 400);
    }
    if (!getCircle(circleId)) {
      return c.json({ error: 'circle_not_found' }, 404);
    }
    if (!isCircleMember(circleId, inviterMemberId)) {
      return c.json({ error: 'not_circle_member' }, 403);
    }
    const inviteId = crypto.randomUUID();
    const createdAt = nowIso();
    // 遠隔招待はなりすまし防止のため 48 時間の待機を必須にする（短縮不可）。
    const confirmableAt =
      kind === 'remote'
        ? new Date(nowMs() + REMOTE_INVITE_WAIT_MS).toISOString()
        : createdAt;
    const status = kind === 'remote' ? 'waiting' : 'pending';
    db.run(
      `INSERT INTO invites
       (id, circle_id, inviter_member_id, kind, status, created_at, confirmable_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        inviteId,
        circleId,
        inviterMemberId,
        kind,
        status,
        createdAt,
        confirmableAt,
      ]
    );
    return c.json(
      { invite: { id: inviteId, circleId, kind, status, confirmableAt } },
      201
    );
  });

  app.post('/api/invites/:id/confirm', async (c) => {
    const invite = getInvite(c.req.param('id'));
    if (!invite) {
      return c.json({ error: 'invite_not_found' }, 404);
    }
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { inviteeMemberId } = body;
    if (!isNonEmptyString(inviteeMemberId)) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    if (!getMember(inviteeMemberId)) {
      return c.json({ error: 'member_not_found' }, 404);
    }
    if (invite.status === 'cancelled' || invite.status === 'confirmed') {
      return c.json({ error: 'invite_not_confirmable' }, 409);
    }
    if (nowMs() < Date.parse(invite.confirmable_at)) {
      return c.json({ error: 'waiting_period_not_elapsed' }, 409);
    }
    if (isCircleMember(invite.circle_id, inviteeMemberId)) {
      return c.json({ error: 'already_member' }, 409);
    }
    db.run(
      `INSERT INTO circle_members (circle_id, member_id, joined_at)
       VALUES (?, ?, ?)`,
      [invite.circle_id, inviteeMemberId, nowIso()]
    );
    db.run(
      `UPDATE invites SET status = 'confirmed', invitee_member_id = ?
       WHERE id = ?`,
      [inviteeMemberId, invite.id]
    );
    return c.json({
      invite: {
        id: invite.id,
        status: 'confirmed',
        circleId: invite.circle_id,
      },
    });
  });

  app.post('/api/invites/:id/cancel', (c) => {
    const invite = getInvite(c.req.param('id'));
    if (!invite) {
      return c.json({ error: 'invite_not_found' }, 404);
    }
    if (invite.status === 'confirmed') {
      return c.json({ error: 'invite_already_confirmed' }, 409);
    }
    db.run("UPDATE invites SET status = 'cancelled' WHERE id = ?", [invite.id]);
    return c.json({ invite: { id: invite.id, status: 'cancelled' } });
  });

  // --- 確認要求の作成 ---
  app.post('/api/requests', async (c) => {
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const {
      circleId,
      requesterMemberId,
      targetMemberId,
      subject,
      amount,
      beneficiary,
      reason,
      deadline,
    } = body;
    if (
      !isNonEmptyString(circleId) ||
      !isNonEmptyString(requesterMemberId) ||
      !isNonEmptyString(targetMemberId) ||
      !isNonEmptyString(subject)
    ) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    // 金額・送金先・理由はクライアント検証に依存せず API レベルで必須にする。
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return c.json({ error: 'amount_required' }, 400);
    }
    if (!isNonEmptyString(beneficiary)) {
      return c.json({ error: 'beneficiary_required' }, 400);
    }
    if (!isNonEmptyString(reason)) {
      return c.json({ error: 'reason_required' }, 400);
    }
    if (!isNonEmptyString(deadline) || Number.isNaN(Date.parse(deadline))) {
      return c.json({ error: 'deadline_required' }, 400);
    }
    // 回答期限は 10 分以上 24 時間以内（境界値は許可）。クライアント検証に
    // 依存せずサーバー側で強制する。
    const deadlineOffsetMs = Date.parse(deadline) - nowMs();
    if (
      deadlineOffsetMs < MIN_DEADLINE_OFFSET_MS ||
      deadlineOffsetMs > MAX_DEADLINE_OFFSET_MS
    ) {
      return c.json({ error: 'deadline_out_of_range' }, 400);
    }
    const circle = getCircle(circleId);
    if (!circle) {
      return c.json({ error: 'circle_not_found' }, 404);
    }
    if (circle.status === 'stopped') {
      return c.json({ error: 'circle_stopped' }, 409);
    }
    if (
      !isCircleMember(circleId, requesterMemberId) ||
      !isCircleMember(circleId, targetMemberId)
    ) {
      return c.json({ error: 'not_circle_member' }, 403);
    }
    // 高リスク条件は独立判定し、複数該当時は重畳する。
    const secondApprovalRequired = amount >= HIGH_RISK_AMOUNT_THRESHOLD;
    const hasApprovedBeneficiary =
      db
        .query<{ ok: number }, [string, string]>(
          `SELECT 1 AS ok FROM requests
           WHERE circle_id = ? AND beneficiary = ? AND status = 'approved'
           LIMIT 1`
        )
        .get(circleId, beneficiary) !== null;
    const waitRequired = !hasApprovedBeneficiary;
    const id = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    db.run(
      `INSERT INTO requests
       (id, circle_id, requester_member_id, target_member_id, subject, amount,
        beneficiary, reason, deadline, nonce, status,
        high_risk_second_approval, high_risk_wait_required,
        high_risk_wait_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unanswered', ?, ?, NULL, ?)`,
      [
        id,
        circleId,
        requesterMemberId,
        targetMemberId,
        subject,
        amount,
        beneficiary,
        reason,
        deadline,
        nonce,
        secondApprovalRequired ? 1 : 0,
        waitRequired ? 1 : 0,
        nowIso(),
      ]
    );
    const row = getRequest(id);
    if (!row) {
      return c.json({ error: 'internal_error' }, 500);
    }
    return c.json({ request: toRequestJson(row) }, 201);
  });

  // --- 確認要求の状態取得 ---
  app.get('/api/requests/:id', (c) => {
    const row = getRequest(c.req.param('id'));
    if (!row) {
      return c.json({ error: 'request_not_found' }, 404);
    }
    return c.json({ request: toRequestJson(refreshRequest(row)) });
  });

  // --- 署名付き応答 ---
  app.post('/api/requests/:id/respond', async (c) => {
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { deviceId, kind, signature } = body;
    if (!isNonEmptyString(deviceId) || !isNonEmptyString(signature)) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    if (kind !== 'approve' && kind !== 'reject') {
      return c.json({ error: 'invalid_kind' }, 400);
    }
    const found = getRequest(c.req.param('id'));
    if (!found) {
      return c.json({ error: 'request_not_found' }, 404);
    }
    const circle = getCircle(found.circle_id);
    // 停止中の circle では承認を成立させない。
    if (!circle || circle.status === 'stopped') {
      return c.json({ error: 'circle_stopped', status: found.status }, 409);
    }
    const request = refreshRequest(found);
    if (request.status === 'expired') {
      return c.json({ error: 'request_expired', status: 'expired' }, 409);
    }
    if (TERMINAL_REQUEST_STATUSES.has(request.status)) {
      return c.json(
        { error: 'request_finalized', status: request.status },
        409
      );
    }
    const device = getDevice(deviceId);
    if (!device) {
      return c.json({ error: 'device_not_found' }, 404);
    }
    if (!isCircleMember(request.circle_id, device.member_id)) {
      return c.json({ error: 'not_circle_member' }, 403);
    }
    if (device.member_id === request.requester_member_id) {
      return c.json({ error: 'requester_cannot_respond' }, 403);
    }
    // 承認は target_member_id 本人の登録端末のみ有効。target 以外のメンバーは
    // 高リスクの第 2 承認（target 本人の有効な承認が先行している場合）に限り
    // 受理する。拒否は requester 以外の circle メンバーなら誰でもよい
    // （user-journeys.md フロー 4「いずれかが拒否」）。
    if (kind === 'approve' && device.member_id !== request.target_member_id) {
      if (request.high_risk_second_approval !== 1) {
        return c.json({ error: 'not_target_member' }, 403);
      }
      if (!hasVerifiedApprovalFrom(request.id, request.target_member_id)) {
        return c.json({ error: 'target_approval_required' }, 403);
      }
    }
    // 同一署名の再送（リプレイ）は状態を変えずに拒否する。
    const duplicated = db
      .query<{ ok: number }, [string, string]>(
        'SELECT 1 AS ok FROM responses WHERE request_id = ? AND signature = ?'
      )
      .get(request.id, signature);
    if (duplicated) {
      return c.json(
        { error: 'replayed_signature', status: request.status },
        409
      );
    }
    // 保存済み要求から canonical 文字列を再構築する（クライアント提示を信頼しない）。
    const payload = canonicalResponsePayload({
      amount: request.amount,
      beneficiary: request.beneficiary,
      circleId: request.circle_id,
      deadline: request.deadline,
      kind,
      nonce: request.nonce,
      reason: request.reason,
      requestId: request.id,
      requesterId: request.requester_member_id,
      subject: request.subject,
      targetId: request.target_member_id,
    });
    // 失効済み端末の署名は検証せず拒否し、承認として扱わない。
    if (device.status !== 'active') {
      recordResponse(request.id, device.id, kind, payload, signature, false);
      setRequestStatus(request.id, 'verification_failed');
      return c.json(
        { error: 'device_revoked', status: 'verification_failed' },
        422
      );
    }
    const verified = await verifyEd25519(device.public_key, payload, signature);
    // TOCTOU 対策: 検証 (await) 中に走った取り消し・期限確定・緊急停止を
    // 後続の状態書き込みで上書きしない。書き込み直前に再読込して確認する。
    const latest = getRequest(request.id);
    if (!latest || TERMINAL_REQUEST_STATUSES.has(latest.status)) {
      return c.json(
        { error: 'request_finalized', status: latest?.status ?? 'unknown' },
        409
      );
    }
    const latestCircle = getCircle(request.circle_id);
    if (!latestCircle || latestCircle.status === 'stopped') {
      return c.json({ error: 'circle_stopped', status: latest.status }, 409);
    }
    if (!verified) {
      recordResponse(request.id, device.id, kind, payload, signature, false);
      setRequestStatus(request.id, 'verification_failed');
      return c.json(
        {
          error: 'signature_verification_failed',
          status: 'verification_failed',
        },
        422
      );
    }
    recordResponse(request.id, device.id, kind, payload, signature, true);
    if (kind === 'reject') {
      setRequestStatus(request.id, 'rejected');
      return c.json({ status: 'rejected' });
    }
    if (latest.status === 'waiting') {
      // 待機中の追加承認は状態を変えない（approved を先行させない）。
      return c.json({
        status: 'waiting',
        waitUntil: latest.high_risk_wait_until,
      });
    }
    const approvals = countDistinctApprovers(request.id);
    const requiredApprovals = request.high_risk_second_approval === 1 ? 2 : 1;
    if (approvals < requiredApprovals) {
      setRequestStatus(request.id, 'collecting');
      return c.json({ status: 'collecting', approvals, requiredApprovals });
    }
    if (request.high_risk_wait_required === 1) {
      // 必要署名が揃った時刻 + 30 分まで approved にしない。
      const waitUntil = new Date(nowMs() + HIGH_RISK_WAIT_MS).toISOString();
      db.run(
        `UPDATE requests SET status = 'waiting', high_risk_wait_until = ?
         WHERE id = ?`,
        [waitUntil, request.id]
      );
      return c.json({ status: 'waiting', waitUntil });
    }
    setRequestStatus(request.id, 'approved');
    return c.json({ status: 'approved' });
  });

  // --- 依頼者による取り消し ---
  app.post('/api/requests/:id/cancel', async (c) => {
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { requesterMemberId } = body;
    if (!isNonEmptyString(requesterMemberId)) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    const found = getRequest(c.req.param('id'));
    if (!found) {
      return c.json({ error: 'request_not_found' }, 404);
    }
    if (found.requester_member_id !== requesterMemberId) {
      return c.json({ error: 'not_requester' }, 403);
    }
    const request = refreshRequest(found);
    if (
      request.status !== 'unanswered' &&
      request.status !== 'collecting' &&
      request.status !== 'waiting'
    ) {
      return c.json({ error: 'cannot_cancel', status: request.status }, 409);
    }
    setRequestStatus(request.id, 'invalidated');
    return c.json({ status: 'invalidated' });
  });

  // --- 端末失効 ---
  app.post('/api/devices/:id/revoke', (c) => {
    const device = getDevice(c.req.param('id'));
    if (!device) {
      return c.json({ error: 'device_not_found' }, 404);
    }
    db.run(
      "UPDATE devices SET status = 'revoked', revoked_at = ? WHERE id = ?",
      [nowIso(), device.id]
    );
    return c.json({ device: { id: device.id, status: 'revoked' } });
  });

  // --- 緊急停止（単独メンバーで発動可能） ---
  app.post('/api/circles/:id/stop', async (c) => {
    const circle = getCircle(c.req.param('id'));
    if (!circle) {
      return c.json({ error: 'circle_not_found' }, 404);
    }
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { memberId } = body;
    if (!isNonEmptyString(memberId)) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    if (!isCircleMember(circle.id, memberId)) {
      return c.json({ error: 'not_circle_member' }, 403);
    }
    if (circle.status === 'stopped') {
      return c.json({ error: 'already_stopped' }, 409);
    }
    const stopEventId = crypto.randomUUID();
    db.run(
      `INSERT INTO stop_events (id, circle_id, member_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [stopEventId, circle.id, memberId, nowIso()]
    );
    db.run("UPDATE circles SET status = 'stopped' WHERE id = ?", [circle.id]);
    return c.json({
      circle: { id: circle.id, status: 'stopped' },
      stopEvent: { id: stopEventId },
    });
  });

  // --- 緊急停止の解除（発動者以外を含む 2 人の署名が必要） ---
  app.post('/api/circles/:id/release', async (c) => {
    const circle = getCircle(c.req.param('id'));
    if (!circle) {
      return c.json({ error: 'circle_not_found' }, 404);
    }
    if (circle.status !== 'stopped') {
      return c.json({ error: 'circle_not_stopped' }, 409);
    }
    const body = await readJson(c);
    if (!body) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { signatures } = body;
    if (!Array.isArray(signatures)) {
      return c.json({ error: 'missing_required_field' }, 400);
    }
    const stopEvent = db
      .query<StopEventRow, [string]>(
        `SELECT * FROM stop_events WHERE circle_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`
      )
      .get(circle.id);
    if (!stopEvent) {
      return c.json({ error: 'stop_event_not_found' }, 409);
    }
    const payload = canonicalReleasePayload({
      circleId: circle.id,
      stopEventId: stopEvent.id,
    });
    const verifiedMembers = new Set<string>();
    const accepted: { deviceId: string; signature: string }[] = [];
    for (const entry of signatures) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const { deviceId, signature } = entry as Record<string, unknown>;
      if (!isNonEmptyString(deviceId) || !isNonEmptyString(signature)) {
        continue;
      }
      const device = getDevice(deviceId);
      if (device?.status !== 'active') {
        continue;
      }
      if (!isCircleMember(circle.id, device.member_id)) {
        continue;
      }
      if (verifiedMembers.has(device.member_id)) {
        continue;
      }
      if (!(await verifyEd25519(device.public_key, payload, signature))) {
        continue;
      }
      verifiedMembers.add(device.member_id);
      accepted.push({ deviceId, signature });
    }
    const includesNonInitiator = [...verifiedMembers].some(
      (memberId) => memberId !== stopEvent.member_id
    );
    if (verifiedMembers.size < 2 || !includesNonInitiator) {
      return c.json({ error: 'insufficient_signatures' }, 400);
    }
    for (const item of accepted) {
      db.run(
        `INSERT INTO stop_releases
         (id, stop_event_id, device_id, signature, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          stopEvent.id,
          item.deviceId,
          item.signature,
          nowIso(),
        ]
      );
    }
    db.run("UPDATE circles SET status = 'normal' WHERE id = ?", [circle.id]);
    return c.json({ circle: { id: circle.id, status: 'normal' } });
  });

  return app;
}
