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

export interface RequestInput {
  circleId: string;
  requesterId: string;
  targetId: string;
  subject: string;
  amount: number;
  beneficiary: string;
  reason: string;
  deadline: string;
}

export interface RequestRecord {
  id: string;
  circleId: string;
  requesterId: string;
  targetId: string;
  subject: string;
  amount: number;
  beneficiary: string;
  reason: string;
  deadline: string;
  nonce: string;
  status: RequestStatus;
  highRiskSecondApproval: boolean;
  highRiskWaitUntil: string | null;
}

export interface RespondInput {
  deviceId: string;
  kind: ResponseKind;
  signature: string;
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

  createMember(input: MemberInput): Promise<MemberRecord> {
    return this.request('POST', '/members', input);
  }

  createCircle(input: CircleInput): Promise<CircleRecord> {
    return this.request('POST', '/circles', input);
  }

  createInvite(input: InviteInput): Promise<InviteRecord> {
    return this.request('POST', '/invites', input);
  }

  confirmInvite(inviteId: string): Promise<InviteRecord> {
    return this.request('POST', `/invites/${inviteId}/confirm`);
  }

  cancelInvite(inviteId: string): Promise<InviteRecord> {
    return this.request('POST', `/invites/${inviteId}/cancel`);
  }

  createRequest(input: RequestInput): Promise<RequestRecord> {
    return this.request('POST', '/requests', input);
  }

  getRequest(requestId: string): Promise<RequestRecord> {
    return this.request('GET', `/requests/${requestId}`);
  }

  respondToRequest(
    requestId: string,
    input: RespondInput
  ): Promise<RequestRecord> {
    return this.request('POST', `/requests/${requestId}/respond`, input);
  }

  cancelRequest(requestId: string): Promise<RequestRecord> {
    return this.request('POST', `/requests/${requestId}/cancel`);
  }

  revokeDevice(deviceId: string): Promise<{ id: string; status: string }> {
    return this.request('POST', `/devices/${deviceId}/revoke`);
  }

  stopCircle(
    circleId: string,
    input: { memberId: string }
  ): Promise<CircleRecord> {
    return this.request('POST', `/circles/${circleId}/stop`, input);
  }

  releaseCircle(
    circleId: string,
    input: { releases: ReleaseSignature[] }
  ): Promise<CircleRecord> {
    return this.request('POST', `/circles/${circleId}/release`, input);
  }
}

/** 既定のクライアント。同一オリジンの `/api`（dev では vite proxy 経由）。 */
export const api = new ApiClient();
