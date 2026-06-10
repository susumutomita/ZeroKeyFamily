/**
 * バックエンド API クライアント。
 *
 * エンドポイントは docs/specs/2026-06-10-zerokey-family-phase1-core.md の
 * 「API エンドポイント」一覧に従う。開発時は vite の proxy で
 * `/api` が http://localhost:3000 へ転送される。
 */

import type { ResponseKind } from './canonical';

export type RequestStatus =
  | 'unanswered'
  | 'collecting'
  | 'waiting'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'verification_failed'
  | 'invalidated';

export interface MemberInput {
  name: string;
  publicKey: string;
}

export interface MemberRecord {
  id: string;
  name: string;
  deviceId: string;
}

export interface CircleInput {
  name: string;
}

export interface CircleRecord {
  id: string;
  name: string;
  status: 'normal' | 'stopped';
}

export interface InviteInput {
  circleId: string;
  inviterMemberId: string;
  kind: 'qr' | 'remote';
}

export interface InviteRecord {
  id: string;
  status: 'pending' | 'waiting' | 'confirmed' | 'cancelled';
  confirmableAt?: string;
}

/** バックエンド POST /api/requests の契約（app.ts）に一致するフィールド名。 */
export interface RequestInput {
  circleId: string;
  requesterMemberId: string;
  targetMemberId: string;
  subject: string;
  amount: number;
  beneficiary: string;
  reason: string;
  deadline: string;
}

/** バックエンド toRequestJson（app.ts）が返すレコードと同じ形。 */
export interface RequestRecord {
  id: string;
  circleId: string;
  requesterMemberId: string;
  targetMemberId: string;
  subject: string;
  amount: number;
  beneficiary: string;
  reason: string;
  deadline: string;
  nonce: string;
  status: RequestStatus;
  secondApprovalRequired: boolean;
  waitRequired: boolean;
  waitUntil: string | null;
  createdAt: string;
}

export interface RespondInput {
  deviceId: string;
  kind: ResponseKind;
  signature: string;
}

/**
 * POST /api/requests/:id/respond の最小レスポンス。
 * 金額などの完全なレコードは含まないため、結果画面にはそのまま渡さない。
 */
export interface RespondResult {
  status: RequestStatus;
  waitUntil?: string | null;
  approvals?: number;
  requiredApprovals?: number;
}

/** POST /api/requests/:id/cancel の最小レスポンス。 */
export interface CancelResult {
  status: RequestStatus;
}

export interface ReleaseSignature {
  deviceId: string;
  signature: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`API エラー (status ${status}): ${body}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${this.baseUrl}/api${path}`, init);
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    return (await response.json()) as T;
  }

  /** レスポンスは `{ member, device }` 封筒なので unwrap して返す。 */
  async createMember(input: MemberInput): Promise<MemberRecord> {
    const body = await this.request<{
      member: { id: string; name: string };
      device: { id: string };
    }>('POST', '/members', input);
    return {
      id: body.member.id,
      name: body.member.name,
      deviceId: body.device.id,
    };
  }

  /** レスポンスは `{ circle: {...} }` 封筒なので unwrap して返す。 */
  async createCircle(input: CircleInput): Promise<CircleRecord> {
    const body = await this.request<{ circle: CircleRecord }>(
      'POST',
      '/circles',
      input
    );
    return body.circle;
  }

  /** レスポンスは `{ invite: {...} }` 封筒なので unwrap して返す。 */
  async createInvite(input: InviteInput): Promise<InviteRecord> {
    const body = await this.request<{ invite: InviteRecord }>(
      'POST',
      '/invites',
      input
    );
    return body.invite;
  }

  /** 確認のレスポンスは `{ invite: { id, status } }` のみを含む。 */
  async confirmInvite(
    inviteId: string
  ): Promise<Pick<InviteRecord, 'id' | 'status'>> {
    const body = await this.request<{
      invite: Pick<InviteRecord, 'id' | 'status'>;
    }>('POST', `/invites/${inviteId}/confirm`);
    return body.invite;
  }

  /** 取り消しのレスポンスは `{ invite: { id, status } }` のみを含む。 */
  async cancelInvite(
    inviteId: string
  ): Promise<Pick<InviteRecord, 'id' | 'status'>> {
    const body = await this.request<{
      invite: Pick<InviteRecord, 'id' | 'status'>;
    }>('POST', `/invites/${inviteId}/cancel`);
    return body.invite;
  }

  /** レスポンスは `{ request: {...} }` 封筒なので unwrap して返す。 */
  async createRequest(input: RequestInput): Promise<RequestRecord> {
    const body = await this.request<{ request: RequestRecord }>(
      'POST',
      '/requests',
      input
    );
    return body.request;
  }

  /** レスポンスは `{ request: {...} }` 封筒なので unwrap して返す。 */
  async getRequest(requestId: string): Promise<RequestRecord> {
    const body = await this.request<{ request: RequestRecord }>(
      'GET',
      `/requests/${requestId}`
    );
    return body.request;
  }

  respondToRequest(
    requestId: string,
    input: RespondInput
  ): Promise<RespondResult> {
    return this.request('POST', `/requests/${requestId}/respond`, input);
  }

  /** バックエンドは requesterMemberId をボディで必須にしている。 */
  cancelRequest(
    requestId: string,
    input: { requesterMemberId: string }
  ): Promise<CancelResult> {
    return this.request('POST', `/requests/${requestId}/cancel`, input);
  }

  /** レスポンスは `{ device: {...} }` 封筒なので unwrap して返す。 */
  async revokeDevice(
    deviceId: string
  ): Promise<{ id: string; status: string }> {
    const body = await this.request<{
      device: { id: string; status: string };
    }>('POST', `/devices/${deviceId}/revoke`);
    return body.device;
  }

  /** レスポンスは `{ circle, stopEvent }` 封筒。解除署名に使う stopEventId を返す。 */
  async stopCircle(
    circleId: string,
    input: { memberId: string }
  ): Promise<{
    id: string;
    status: 'normal' | 'stopped';
    stopEventId: string;
  }> {
    const body = await this.request<{
      circle: { id: string; status: 'normal' | 'stopped' };
      stopEvent: { id: string };
    }>('POST', `/circles/${circleId}/stop`, input);
    return {
      id: body.circle.id,
      status: body.circle.status,
      stopEventId: body.stopEvent.id,
    };
  }

  /** バックエンドのボディキーは `signatures`。レスポンスは `{ circle }` 封筒。 */
  async releaseCircle(
    circleId: string,
    input: { signatures: ReleaseSignature[] }
  ): Promise<{ id: string; status: 'normal' | 'stopped' }> {
    const body = await this.request<{
      circle: { id: string; status: 'normal' | 'stopped' };
    }>('POST', `/circles/${circleId}/release`, input);
    return body.circle;
  }
}

/**
 * 署名付き応答を送ったあと、結果画面用の完全なレコードを取り直す。
 * respond のレスポンスは最小 JSON（金額等を含まない）のため、
 * そのまま結果画面に渡してはならない。
 */
export async function respondAndFetchRequest(
  client: ApiClient,
  requestId: string,
  input: RespondInput
): Promise<RequestRecord> {
  await client.respondToRequest(requestId, input);
  return client.getRequest(requestId);
}

/** 取り消しを送ったあと、結果画面用の完全なレコードを取り直す。 */
export async function cancelAndFetchRequest(
  client: ApiClient,
  requestId: string,
  requesterMemberId: string
): Promise<RequestRecord> {
  await client.cancelRequest(requestId, { requesterMemberId });
  return client.getRequest(requestId);
}

/** 既定のクライアント。同一オリジンの `/api`（dev では vite proxy 経由）。 */
export const api = new ApiClient();
