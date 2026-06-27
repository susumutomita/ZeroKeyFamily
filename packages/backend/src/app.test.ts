import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { Hono } from 'hono';
import { createApp } from './app';
import type { Clock } from './clock';
import {
  canonicalReleasePayload,
  canonicalResponsePayload,
  generateEd25519KeyPair,
  type ResponseKind,
  type ResponsePayloadFields,
  signEd25519,
} from './crypto';
import { migrate } from './db';

const START = '2026-06-10T00:00:00.000Z';

class TestClock implements Clock {
  private current: Date;

  constructor(start: string) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }
}

interface TestUser {
  memberId: string;
  deviceId: string;
  privateKey: CryptoKey;
  publicKeyBase64: string;
}

interface TestContext {
  app: Hono;
  db: Database;
  clock: TestClock;
}

interface RequestJson {
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
  status: string;
  secondApprovalRequired: boolean;
  waitRequired: boolean;
  waitUntil: string | null;
}

function mustGet<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

function createTestContext(): TestContext {
  const db = new Database(':memory:');
  migrate(db);
  const clock = new TestClock(START);
  const app = createApp({ db, clock });
  return { app, db, clock };
}

async function postJson(
  app: Hono,
  path: string,
  body: unknown
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function registerMember(app: Hono, name: string): Promise<TestUser> {
  const keys = await generateEd25519KeyPair();
  const res = await postJson(app, '/api/members', {
    name,
    publicKey: keys.publicKeyBase64,
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as {
    member: { id: string };
    device: { id: string };
  };
  return {
    memberId: json.member.id,
    deviceId: json.device.id,
    privateKey: keys.privateKey,
    publicKeyBase64: keys.publicKeyBase64,
  };
}

interface Family {
  circleId: string;
  requester: TestUser;
  target: TestUser;
  users: TestUser[];
}

async function setupFamily(ctx: TestContext, memberCount = 2): Promise<Family> {
  const names = ['花子', '太郎', '次郎', '三郎'];
  const users: TestUser[] = [];
  for (let i = 0; i < memberCount; i++) {
    users.push(await registerMember(ctx.app, mustGet(names[i], 'name')));
  }
  const requester = mustGet(users[0], 'requester');
  const target = mustGet(users[1], 'target');
  const circleRes = await postJson(ctx.app, '/api/circles', {
    name: 'テスト家族',
    creatorMemberId: requester.memberId,
  });
  expect(circleRes.status).toBe(201);
  const { circle } = (await circleRes.json()) as { circle: { id: string } };
  for (const user of users.slice(1)) {
    const inviteRes = await postJson(ctx.app, '/api/invites', {
      circleId: circle.id,
      inviterMemberId: requester.memberId,
      kind: 'qr',
    });
    expect(inviteRes.status).toBe(201);
    const { invite } = (await inviteRes.json()) as { invite: { id: string } };
    const confirmRes = await postJson(
      ctx.app,
      `/api/invites/${invite.id}/confirm`,
      { inviteeMemberId: user.memberId }
    );
    expect(confirmRes.status).toBe(200);
  }
  return { circleId: circle.id, requester, target, users };
}

function deadlineIn(clock: TestClock, minutes: number): string {
  return new Date(clock.now().getTime() + minutes * 60_000).toISOString();
}

function requestBody(
  ctx: TestContext,
  family: Family,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    circleId: family.circleId,
    requesterMemberId: family.requester.memberId,
    targetMemberId: family.target.memberId,
    subject: 'お金を送ってほしいと言われた',
    amount: 5000,
    beneficiary: '○○銀行 1234567',
    reason: '会社のお金をなくしたと言われた',
    deadline: deadlineIn(ctx.clock, 30),
    ...overrides,
  };
}

async function createRequest(
  ctx: TestContext,
  family: Family,
  overrides: Record<string, unknown> = {}
): Promise<RequestJson> {
  const res = await postJson(
    ctx.app,
    '/api/requests',
    requestBody(ctx, family, overrides)
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { request: RequestJson }).request;
}

function responsePayloadFor(
  request: RequestJson,
  kind: ResponseKind,
  overrides: Partial<ResponsePayloadFields> = {}
): string {
  return canonicalResponsePayload({
    amount: request.amount,
    beneficiary: request.beneficiary,
    circleId: request.circleId,
    deadline: request.deadline,
    kind,
    nonce: request.nonce,
    reason: request.reason,
    requestId: request.id,
    requesterId: request.requesterMemberId,
    subject: request.subject,
    targetId: request.targetMemberId,
    ...overrides,
  });
}

async function respondWith(
  ctx: TestContext,
  request: RequestJson,
  user: TestUser,
  kind: ResponseKind,
  payloadOverrides: Partial<ResponsePayloadFields> = {}
): Promise<Response> {
  const payload = responsePayloadFor(request, kind, payloadOverrides);
  const signature = await signEd25519(user.privateKey, payload);
  return postJson(ctx.app, `/api/requests/${request.id}/respond`, {
    deviceId: user.deviceId,
    kind,
    signature,
  });
}

async function getRequestJson(app: Hono, id: string): Promise<RequestJson> {
  const res = await app.request(`/api/requests/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { request: RequestJson }).request;
}

async function getCircleStatus(app: Hono, circleId: string): Promise<string> {
  const res = await app.request(`/api/circles/${circleId}`);
  expect(res.status).toBe(200);
  const { circle } = (await res.json()) as { circle: { status: string } };
  return circle.status;
}

/** 同一メンバーの 2 台目の端末を実 DB に直接登録する。 */
async function addSecondDevice(
  db: Database,
  memberId: string
): Promise<TestUser> {
  const keys = await generateEd25519KeyPair();
  const deviceId = crypto.randomUUID();
  db.run(
    `INSERT INTO devices (id, member_id, public_key, status, created_at)
     VALUES (?, ?, ?, 'active', ?)`,
    [deviceId, memberId, keys.publicKeyBase64, START]
  );
  return {
    memberId,
    deviceId,
    privateKey: keys.privateKey,
    publicKeyBase64: keys.publicKeyBase64,
  };
}

/** 高リスク条件なしの要求を承認実績にする（30 分待機を満了させる）。 */
async function buildApprovedHistory(
  ctx: TestContext,
  family: Family,
  beneficiary: string
): Promise<void> {
  const request = await createRequest(ctx, family, { beneficiary });
  const res = await respondWith(ctx, request, family.target, 'approve');
  expect(res.status).toBe(200);
  ctx.clock.advanceMinutes(30);
  const refreshed = await getRequestJson(ctx.app, request.id);
  expect(refreshed.status).toBe('approved');
}

describe('メンバー登録', () => {
  it('名前と公開鍵を登録するとメンバーと端末が作成される', async () => {
    const ctx = createTestContext();
    const keys = await generateEd25519KeyPair();
    const res = await postJson(ctx.app, '/api/members', {
      name: '花子',
      publicKey: keys.publicKeyBase64,
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      member: { id: string; name: string };
      device: { id: string; memberId: string; status: string };
    };
    expect(json.member.name).toBe('花子');
    expect(json.device.memberId).toBe(json.member.id);
    expect(json.device.status).toBe('active');
  });

  it('公開鍵が欠けた登録を 400 で拒否する', async () => {
    const ctx = createTestContext();
    const res = await postJson(ctx.app, '/api/members', { name: '花子' });
    expect(res.status).toBe(400);
  });
});

describe('家族グループの作成', () => {
  it('作成者をメンバーに含む circle を作成する', async () => {
    const ctx = createTestContext();
    const user = await registerMember(ctx.app, '花子');
    const res = await postJson(ctx.app, '/api/circles', {
      name: '我が家',
      creatorMemberId: user.memberId,
    });
    expect(res.status).toBe(201);
    const { circle } = (await res.json()) as { circle: { id: string } };
    const detail = await ctx.app.request(`/api/circles/${circle.id}`);
    expect(detail.status).toBe(200);
    const json = (await detail.json()) as {
      circle: { status: string };
      members: string[];
    };
    expect(json.circle.status).toBe('normal');
    expect(json.members).toContain(user.memberId);
  });
});

describe('家族招待', () => {
  it('QR 招待は待機なしで承認でき circle にメンバーが追加される', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 2);
    const detail = await ctx.app.request(`/api/circles/${family.circleId}`);
    const json = (await detail.json()) as { members: string[] };
    expect(json.members).toContain(family.target.memberId);
  });

  it('遠隔招待は 48 時間の待機満了前の承認を 409 で拒否する', async () => {
    const ctx = createTestContext();
    const inviter = await registerMember(ctx.app, '花子');
    const invitee = await registerMember(ctx.app, '太郎');
    const circleRes = await postJson(ctx.app, '/api/circles', {
      name: '我が家',
      creatorMemberId: inviter.memberId,
    });
    const { circle } = (await circleRes.json()) as { circle: { id: string } };
    const inviteRes = await postJson(ctx.app, '/api/invites', {
      circleId: circle.id,
      inviterMemberId: inviter.memberId,
      kind: 'remote',
    });
    expect(inviteRes.status).toBe(201);
    const { invite } = (await inviteRes.json()) as {
      invite: { id: string; confirmableAt: string };
    };
    ctx.clock.advanceHours(47);
    const early = await postJson(ctx.app, `/api/invites/${invite.id}/confirm`, {
      inviteeMemberId: invitee.memberId,
    });
    expect(early.status).toBe(409);
    const detail = await ctx.app.request(`/api/circles/${circle.id}`);
    const json = (await detail.json()) as { members: string[] };
    expect(json.members).not.toContain(invitee.memberId);
  });

  it('遠隔招待は 48 時間の待機満了後に承認できる', async () => {
    const ctx = createTestContext();
    const inviter = await registerMember(ctx.app, '花子');
    const invitee = await registerMember(ctx.app, '太郎');
    const circleRes = await postJson(ctx.app, '/api/circles', {
      name: '我が家',
      creatorMemberId: inviter.memberId,
    });
    const { circle } = (await circleRes.json()) as { circle: { id: string } };
    const inviteRes = await postJson(ctx.app, '/api/invites', {
      circleId: circle.id,
      inviterMemberId: inviter.memberId,
      kind: 'remote',
    });
    const { invite } = (await inviteRes.json()) as { invite: { id: string } };
    ctx.clock.advanceHours(48);
    const confirm = await postJson(
      ctx.app,
      `/api/invites/${invite.id}/confirm`,
      { inviteeMemberId: invitee.memberId }
    );
    expect(confirm.status).toBe(200);
    const detail = await ctx.app.request(`/api/circles/${circle.id}`);
    const json = (await detail.json()) as { members: string[] };
    expect(json.members).toContain(invitee.memberId);
  });

  it('取り消した招待は承認できない', async () => {
    const ctx = createTestContext();
    const inviter = await registerMember(ctx.app, '花子');
    const invitee = await registerMember(ctx.app, '太郎');
    const circleRes = await postJson(ctx.app, '/api/circles', {
      name: '我が家',
      creatorMemberId: inviter.memberId,
    });
    const { circle } = (await circleRes.json()) as { circle: { id: string } };
    const inviteRes = await postJson(ctx.app, '/api/invites', {
      circleId: circle.id,
      inviterMemberId: inviter.memberId,
      kind: 'qr',
    });
    const { invite } = (await inviteRes.json()) as { invite: { id: string } };
    const cancel = await postJson(
      ctx.app,
      `/api/invites/${invite.id}/cancel`,
      {}
    );
    expect(cancel.status).toBe(200);
    const confirm = await postJson(
      ctx.app,
      `/api/invites/${invite.id}/confirm`,
      { inviteeMemberId: invitee.memberId }
    );
    expect(confirm.status).toBe(409);
  });
});

describe('確認要求の作成', () => {
  it('金額が欠けた要求を 400 で拒否する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    // JSON.stringify は undefined のフィールドを送信しない（= 欠落）。
    const body = requestBody(ctx, family, { amount: undefined });
    const res = await postJson(ctx.app, '/api/requests', body);
    expect(res.status).toBe(400);
  });

  it('送金先が空文字の要求を 400 で拒否する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const res = await postJson(
      ctx.app,
      '/api/requests',
      requestBody(ctx, family, { beneficiary: '   ' })
    );
    expect(res.status).toBe(400);
  });

  it('理由が欠けた要求を 400 で拒否する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const body = requestBody(ctx, family, { reason: undefined });
    const res = await postJson(ctx.app, '/api/requests', body);
    expect(res.status).toBe(400);
  });

  it('必須項目が揃った要求を unanswered で作成し nonce をサーバーが生成する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family, {
      nonce: 'client-supplied-nonce',
    });
    expect(request.status).toBe('unanswered');
    expect(request.nonce.length).toBeGreaterThan(0);
    expect(request.nonce).not.toBe('client-supplied-nonce');
  });

  it('10 万円以上の要求は第 2 承認が必須になる', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family, { amount: 100000 });
    expect(request.secondApprovalRequired).toBe(true);
  });

  it('承認実績のない送金先への要求は 30 分待機が必須になる', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    expect(request.waitRequired).toBe(true);
  });

  it('承認実績のある送金先への要求は待機が不要になる', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await buildApprovedHistory(ctx, family, '△△銀行 7654321');
    const request = await createRequest(ctx, family, {
      beneficiary: '△△銀行 7654321',
    });
    expect(request.waitRequired).toBe(false);
  });

  it('高額かつ初送金先の要求は両方の高リスク条件が重畳する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family, { amount: 200000 });
    expect(request.secondApprovalRequired).toBe(true);
    expect(request.waitRequired).toBe(true);
  });

  it('停止中の circle では要求を作成できない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const stop = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      {
        memberId: family.target.memberId,
      }
    );
    expect(stop.status).toBe(200);
    const res = await postJson(
      ctx.app,
      '/api/requests',
      requestBody(ctx, family)
    );
    expect(res.status).toBe(409);
  });
});

describe('署名付き応答', () => {
  it('対象メンバーの承認署名で approved に確定する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000001');
    const request = await createRequest(ctx, family, {
      beneficiary: '実績済み銀行 0000001',
    });
    const res = await respondWith(ctx, request, family.target, 'approve');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('approved');
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('approved');
  });

  it('拒否署名で rejected に確定し承認と区別される', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await respondWith(ctx, request, family.target, 'reject');
    expect(res.status).toBe(200);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('rejected');
  });

  it('金額を改変したペイロードの署名は verification_failed になり approved にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await respondWith(ctx, request, family.target, 'approve', {
      amount: request.amount + 1,
    });
    expect(res.status).toBe(422);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('verification_failed');
  });

  it('nonce が一致しない署名は承認にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await respondWith(ctx, request, family.target, 'approve', {
      nonce: 'forged-nonce',
    });
    expect(res.status).toBe(422);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).not.toBe('approved');
    expect(refreshed.status).toBe('verification_failed');
  });

  it('期限が一致しない署名は承認にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await respondWith(ctx, request, family.target, 'approve', {
      deadline: deadlineIn(ctx.clock, 120),
    });
    expect(res.status).toBe(422);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('verification_failed');
  });

  it('依頼者自身は自分の要求に応答できない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await respondWith(ctx, request, family.requester, 'approve');
    expect(res.status).toBe(403);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('unanswered');
  });
});

describe('リプレイと再送の拒否', () => {
  it('同一署名の再送は 409 で拒否され第 2 承認として数えられない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000002');
    const request = await createRequest(ctx, family, {
      amount: 150000,
      beneficiary: '実績済み銀行 0000002',
    });
    const payload = responsePayloadFor(request, 'approve');
    const signature = await signEd25519(family.target.privateKey, payload);
    const first = await postJson(
      ctx.app,
      `/api/requests/${request.id}/respond`,
      { deviceId: family.target.deviceId, kind: 'approve', signature }
    );
    expect(first.status).toBe(200);
    const replay = await postJson(
      ctx.app,
      `/api/requests/${request.id}/respond`,
      { deviceId: family.target.deviceId, kind: 'approve', signature }
    );
    expect(replay.status).toBe(409);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).not.toBe('approved');
    expect(refreshed.status).toBe('collecting');
  });

  it('別要求への署名の流用は承認にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const requestA = await createRequest(ctx, family);
    const requestB = await createRequest(ctx, family);
    const payloadA = responsePayloadFor(requestA, 'approve');
    const signatureA = await signEd25519(family.target.privateKey, payloadA);
    const res = await postJson(
      ctx.app,
      `/api/requests/${requestB.id}/respond`,
      {
        deviceId: family.target.deviceId,
        kind: 'approve',
        signature: signatureA,
      }
    );
    expect(res.status).toBe(422);
    const refreshed = await getRequestJson(ctx.app, requestB.id);
    expect(refreshed.status).not.toBe('approved');
  });
});

describe('端末失効', () => {
  it('失効済み端末の署名は確認済みにならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const revoke = await postJson(
      ctx.app,
      `/api/devices/${family.target.deviceId}/revoke`,
      {}
    );
    expect(revoke.status).toBe(200);
    const res = await respondWith(ctx, request, family.target, 'approve');
    expect(res.status).toBe(422);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).not.toBe('approved');
  });
});

describe('応答なしと期限切れ', () => {
  it('期限内の未応答は unanswered のまま返り approved と混同されない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    ctx.clock.advanceMinutes(29);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('unanswered');
    expect(refreshed.status).not.toBe('approved');
    expect(refreshed.status).not.toBe('expired');
  });

  it('期限超過した未応答要求は読み取り時に expired へ確定し永続化される', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    ctx.clock.advanceMinutes(31);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('expired');
    const row = ctx.db
      .query<{ status: string }, [string]>(
        'SELECT status FROM requests WHERE id = ?'
      )
      .get(request.id);
    expect(row?.status).toBe('expired');
  });

  it('期限超過後の応答は 409 で拒否され expired のまま承認にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    ctx.clock.advanceMinutes(31);
    const res = await respondWith(ctx, request, family.target, 'approve');
    expect(res.status).toBe(409);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('expired');
  });
});

describe('高リスク: 第 2 承認', () => {
  it('1 人目の承認だけでは approved にならず収集状態を維持する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 3);
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000003');
    const request = await createRequest(ctx, family, {
      amount: 100000,
      beneficiary: '実績済み銀行 0000003',
    });
    const res = await respondWith(ctx, request, family.target, 'approve');
    expect(res.status).toBe(200);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('collecting');
    expect(refreshed.status).not.toBe('approved');
  });

  it('別メンバーの第 2 承認で approved に確定する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 3);
    const second = mustGet(family.users[2], 'second approver');
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000004');
    const request = await createRequest(ctx, family, {
      amount: 100000,
      beneficiary: '実績済み銀行 0000004',
    });
    await respondWith(ctx, request, family.target, 'approve');
    const res = await respondWith(ctx, request, second, 'approve');
    expect(res.status).toBe(200);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('approved');
  });

  it('同一メンバーの別端末による追加承認では approved にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000005');
    const request = await createRequest(ctx, family, {
      amount: 100000,
      beneficiary: '実績済み銀行 0000005',
    });
    await respondWith(ctx, request, family.target, 'approve');
    const secondDevice = await addSecondDevice(ctx.db, family.target.memberId);
    const res = await respondWith(ctx, request, secondDevice, 'approve');
    expect(res.status).toBe(200);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('collecting');
    expect(refreshed.status).not.toBe('approved');
  });
});

describe('高リスク: 初送金先の 30 分待機', () => {
  it('署名が揃っても待機満了まで waiting を返し approved を先行しない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    expect(request.waitRequired).toBe(true);
    const res = await respondWith(ctx, request, family.target, 'approve');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('waiting');
    ctx.clock.advanceMinutes(29);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('waiting');
    expect(refreshed.status).not.toBe('approved');
  });

  it('待機満了後に approved へ確定する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    await respondWith(ctx, request, family.target, 'approve');
    ctx.clock.advanceMinutes(30);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('approved');
  });

  it('待機中は依頼者が取り消せる', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    await respondWith(ctx, request, family.target, 'approve');
    const cancel = await postJson(
      ctx.app,
      `/api/requests/${request.id}/cancel`,
      { requesterMemberId: family.requester.memberId }
    );
    expect(cancel.status).toBe(200);
    ctx.clock.advanceMinutes(30);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('invalidated');
    expect(refreshed.status).not.toBe('approved');
  });
});

describe('高リスク条件の重畳', () => {
  it('高額かつ初送金先は第 2 承認と待機の両方を満たすまで approved にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 3);
    const second = mustGet(family.users[2], 'second approver');
    const request = await createRequest(ctx, family, { amount: 300000 });
    await respondWith(ctx, request, family.target, 'approve');
    let state = await getRequestJson(ctx.app, request.id);
    expect(state.status).toBe('collecting');
    const res = await respondWith(ctx, request, second, 'approve');
    expect(res.status).toBe(200);
    state = await getRequestJson(ctx.app, request.id);
    expect(state.status).toBe('waiting');
    expect(state.status).not.toBe('approved');
    ctx.clock.advanceMinutes(30);
    state = await getRequestJson(ctx.app, request.id);
    expect(state.status).toBe('approved');
  });
});

describe('依頼の取り消し', () => {
  it('依頼者は未応答の要求を取り消せる', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await postJson(ctx.app, `/api/requests/${request.id}/cancel`, {
      requesterMemberId: family.requester.memberId,
    });
    expect(res.status).toBe(200);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('invalidated');
  });

  it('依頼者以外の取り消しを 403 で拒否する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await postJson(ctx.app, `/api/requests/${request.id}/cancel`, {
      requesterMemberId: family.target.memberId,
    });
    expect(res.status).toBe(403);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('unanswered');
  });
});

describe('緊急停止', () => {
  it('任意のメンバーが単独で circle を停止できる', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const res = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      {
        memberId: family.target.memberId,
      }
    );
    expect(res.status).toBe(200);
    expect(await getCircleStatus(ctx.app, family.circleId)).toBe('stopped');
  });

  it('停止中の応答は 409 で拒否され承認は成立しない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    await postJson(ctx.app, `/api/circles/${family.circleId}/stop`, {
      memberId: family.requester.memberId,
    });
    const res = await respondWith(ctx, request, family.target, 'approve');
    expect(res.status).toBe(409);
    const row = ctx.db
      .query<{ status: string }, [string]>(
        'SELECT status FROM requests WHERE id = ?'
      )
      .get(request.id);
    expect(row?.status).not.toBe('approved');
  });

  it('発動者以外を含む 2 人の署名で停止を解除できる', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const stopRes = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      { memberId: family.requester.memberId }
    );
    const { stopEvent } = (await stopRes.json()) as {
      stopEvent: { id: string };
    };
    const payload = canonicalReleasePayload({
      circleId: family.circleId,
      stopEventId: stopEvent.id,
    });
    const res = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/release`,
      {
        signatures: [
          {
            deviceId: family.requester.deviceId,
            signature: await signEd25519(family.requester.privateKey, payload),
          },
          {
            deviceId: family.target.deviceId,
            signature: await signEd25519(family.target.privateKey, payload),
          },
        ],
      }
    );
    expect(res.status).toBe(200);
    expect(await getCircleStatus(ctx.app, family.circleId)).toBe('normal');
  });

  it('発動者 1 人の署名だけでは解除できない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const stopRes = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      { memberId: family.requester.memberId }
    );
    const { stopEvent } = (await stopRes.json()) as {
      stopEvent: { id: string };
    };
    const payload = canonicalReleasePayload({
      circleId: family.circleId,
      stopEventId: stopEvent.id,
    });
    const res = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/release`,
      {
        signatures: [
          {
            deviceId: family.requester.deviceId,
            signature: await signEd25519(family.requester.privateKey, payload),
          },
        ],
      }
    );
    expect(res.status).toBe(400);
    expect(await getCircleStatus(ctx.app, family.circleId)).toBe('stopped');
  });

  it('同一メンバーの端末 2 台の署名では解除できない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const stopRes = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      { memberId: family.requester.memberId }
    );
    const { stopEvent } = (await stopRes.json()) as {
      stopEvent: { id: string };
    };
    const payload = canonicalReleasePayload({
      circleId: family.circleId,
      stopEventId: stopEvent.id,
    });
    const secondDevice = await addSecondDevice(ctx.db, family.target.memberId);
    const res = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/release`,
      {
        signatures: [
          {
            deviceId: family.target.deviceId,
            signature: await signEd25519(family.target.privateKey, payload),
          },
          {
            deviceId: secondDevice.deviceId,
            signature: await signEd25519(secondDevice.privateKey, payload),
          },
        ],
      }
    );
    expect(res.status).toBe(400);
    expect(await getCircleStatus(ctx.app, family.circleId)).toBe('stopped');
  });

  it('waiting 中に緊急停止された要求は待機満了後の取得でも approved にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    expect(request.waitRequired).toBe(true);
    const approve = await respondWith(ctx, request, family.target, 'approve');
    expect(approve.status).toBe(200);
    const stop = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      {
        memberId: family.requester.memberId,
      }
    );
    expect(stop.status).toBe(200);
    ctx.clock.advanceMinutes(30);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('waiting');
    expect(refreshed.status).not.toBe('approved');
    const row = ctx.db
      .query<{ status: string }, [string]>(
        'SELECT status FROM requests WHERE id = ?'
      )
      .get(request.id);
    expect(row?.status).not.toBe('approved');
  });

  it('停止解除後の最初の取得で待機満了済みの waiting 要求は approved へ確定する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    await respondWith(ctx, request, family.target, 'approve');
    const stopRes = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      { memberId: family.requester.memberId }
    );
    const { stopEvent } = (await stopRes.json()) as {
      stopEvent: { id: string };
    };
    ctx.clock.advanceMinutes(30);
    const duringStop = await getRequestJson(ctx.app, request.id);
    expect(duringStop.status).toBe('waiting');
    const payload = canonicalReleasePayload({
      circleId: family.circleId,
      stopEventId: stopEvent.id,
    });
    const release = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/release`,
      {
        signatures: [
          {
            deviceId: family.requester.deviceId,
            signature: await signEd25519(family.requester.privateKey, payload),
          },
          {
            deviceId: family.target.deviceId,
            signature: await signEd25519(family.target.privateKey, payload),
          },
        ],
      }
    );
    expect(release.status).toBe(200);
    const afterRelease = await getRequestJson(ctx.app, request.id);
    expect(afterRelease.status).toBe('approved');
  });

  it('解除後は確認要求の承認が再び成立する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000006');
    const request = await createRequest(ctx, family, {
      beneficiary: '実績済み銀行 0000006',
    });
    const stopRes = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      { memberId: family.requester.memberId }
    );
    const { stopEvent } = (await stopRes.json()) as {
      stopEvent: { id: string };
    };
    const payload = canonicalReleasePayload({
      circleId: family.circleId,
      stopEventId: stopEvent.id,
    });
    await postJson(ctx.app, `/api/circles/${family.circleId}/release`, {
      signatures: [
        {
          deviceId: family.requester.deviceId,
          signature: await signEd25519(family.requester.privateKey, payload),
        },
        {
          deviceId: family.target.deviceId,
          signature: await signEd25519(family.target.privateKey, payload),
        },
      ],
    });
    const res = await respondWith(ctx, request, family.target, 'approve');
    expect(res.status).toBe(200);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('approved');
  });
});

describe('応答者と対象メンバーの関係検証', () => {
  it('対象以外のメンバーの承認署名だけでは approved にならない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 3);
    const other = mustGet(family.users[2], 'other member');
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000007');
    const request = await createRequest(ctx, family, {
      beneficiary: '実績済み銀行 0000007',
    });
    const res = await respondWith(ctx, request, other, 'approve');
    expect(res.status).toBe(403);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('unanswered');
    expect(refreshed.status).not.toBe('approved');
  });

  it('第 2 承認は対象本人の承認が先行している場合のみ数えられる', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 3);
    const second = mustGet(family.users[2], 'second approver');
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000008');
    const request = await createRequest(ctx, family, {
      amount: 100000,
      beneficiary: '実績済み銀行 0000008',
    });
    // target 本人の承認が無い状態では第 2 承認として受理しない。
    const early = await respondWith(ctx, request, second, 'approve');
    expect(early.status).toBe(403);
    let state = await getRequestJson(ctx.app, request.id);
    expect(state.status).toBe('unanswered');
    expect(state.status).not.toBe('approved');
    // target 本人の承認が先行すれば第 2 承認として数えられる。
    const targetRes = await respondWith(ctx, request, family.target, 'approve');
    expect(targetRes.status).toBe(200);
    const late = await respondWith(ctx, request, second, 'approve');
    expect(late.status).toBe(200);
    state = await getRequestJson(ctx.app, request.id);
    expect(state.status).toBe('approved');
  });

  it('対象以外の circle メンバーの拒否署名は受理され rejected に確定する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 3);
    const other = mustGet(family.users[2], 'other member');
    const request = await createRequest(ctx, family);
    const res = await respondWith(ctx, request, other, 'reject');
    expect(res.status).toBe(200);
    const refreshed = await getRequestJson(ctx.app, request.id);
    expect(refreshed.status).toBe('rejected');
  });
});

describe('署名検証中の競合 (TOCTOU)', () => {
  it('署名検証と並行して取り消された要求は approved で上書きされない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000010');
    const request = await createRequest(ctx, family, {
      beneficiary: '実績済み銀行 0000010',
    });
    const payload = responsePayloadFor(request, 'approve');
    const signature = await signEd25519(family.target.privateKey, payload);
    // respond が verifyEd25519 を await している間に cancel が完了する
    // 順序を、同一ティックでの並行起動により再現する。
    const respondPromise = postJson(
      ctx.app,
      `/api/requests/${request.id}/respond`,
      { deviceId: family.target.deviceId, kind: 'approve', signature }
    );
    const cancelPromise = postJson(
      ctx.app,
      `/api/requests/${request.id}/cancel`,
      { requesterMemberId: family.requester.memberId }
    );
    const [respondRes, cancelRes] = await Promise.all([
      respondPromise,
      cancelPromise,
    ]);
    expect(cancelRes.status).toBe(200);
    expect(respondRes.status).toBe(409);
    const row = ctx.db
      .query<{ status: string }, [string]>(
        'SELECT status FROM requests WHERE id = ?'
      )
      .get(request.id);
    expect(row?.status).not.toBe('approved');
    expect(row?.status).toBe('invalidated');
  });

  it('署名検証と並行して緊急停止された circle では approved が書き込まれない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000011');
    const request = await createRequest(ctx, family, {
      beneficiary: '実績済み銀行 0000011',
    });
    const payload = responsePayloadFor(request, 'approve');
    const signature = await signEd25519(family.target.privateKey, payload);
    const respondPromise = postJson(
      ctx.app,
      `/api/requests/${request.id}/respond`,
      { deviceId: family.target.deviceId, kind: 'approve', signature }
    );
    const stopPromise = postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      { memberId: family.requester.memberId }
    );
    const [respondRes, stopRes] = await Promise.all([
      respondPromise,
      stopPromise,
    ]);
    expect(stopRes.status).toBe(200);
    expect(respondRes.status).toBe(409);
    const row = ctx.db
      .query<{ status: string }, [string]>(
        'SELECT status FROM requests WHERE id = ?'
      )
      .get(request.id);
    expect(row?.status).not.toBe('approved');
  });
});

describe('回答期限の範囲検証', () => {
  it('現在時刻から 10 分未満の期限は 400 で拒否する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const res = await postJson(
      ctx.app,
      '/api/requests',
      requestBody(ctx, family, { deadline: deadlineIn(ctx.clock, 9) })
    );
    expect(res.status).toBe(400);
  });

  it('現在時刻から 10 分ちょうどの期限は許可する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family, {
      deadline: deadlineIn(ctx.clock, 10),
    });
    expect(request.status).toBe('unanswered');
  });

  it('現在時刻から 24 時間ちょうどの期限は許可する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family, {
      deadline: deadlineIn(ctx.clock, 24 * 60),
    });
    expect(request.status).toBe('unanswered');
  });

  it('現在時刻から 24 時間を超える期限は 400 で拒否する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const res = await postJson(
      ctx.app,
      '/api/requests',
      requestBody(ctx, family, { deadline: deadlineIn(ctx.clock, 24 * 60 + 1) })
    );
    expect(res.status).toBe(400);
  });

  it('過去の期限は 400 で拒否する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const res = await postJson(
      ctx.app,
      '/api/requests',
      requestBody(ctx, family, { deadline: deadlineIn(ctx.clock, -5) })
    );
    expect(res.status).toBe(400);
  });
});

describe('家族メンバー一覧', () => {
  it('表示名つきで参加中のメンバーを参加順に返す', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 3);
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/members?memberId=${family.requester.memberId}`
    );
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as {
      members: { id: string; name: string }[];
    };
    expect(members.map((m) => m.name)).toEqual(['花子', '太郎', '次郎']);
    expect(members[0]?.id).toBe(family.requester.memberId);
  });

  it('存在しない家族グループは 404 を返す', async () => {
    const ctx = createTestContext();
    const res = await ctx.app.request(
      '/api/circles/missing/members?memberId=anyone'
    );
    expect(res.status).toBe(404);
  });

  it('非メンバー（家族コードのみ知る者）には 403 を返す', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const outsider = await registerMember(ctx.app, '部外者');
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/members?memberId=${outsider.memberId}`
    );
    expect(res.status).toBe(403);
  });

  it('memberId 未指定は 403 を返す', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/members`
    );
    expect(res.status).toBe(403);
  });
});

describe('参加中の家族グループ一覧', () => {
  it('メンバーが参加中の家族を返す', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const res = await ctx.app.request(
      `/api/members/${family.requester.memberId}/circles`
    );
    expect(res.status).toBe(200);
    const { circles } = (await res.json()) as {
      circles: { id: string; name: string }[];
    };
    expect(circles.map((cir) => cir.id)).toContain(family.circleId);
  });

  it('存在しないメンバーは 404 を返す', async () => {
    const ctx = createTestContext();
    const res = await ctx.app.request('/api/members/missing/circles');
    expect(res.status).toBe(404);
  });
});

describe('確認要求の一覧', () => {
  it('対象メンバー宛ての受信箱を新しい順に返す', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const first = await createRequest(ctx, family);
    ctx.clock.advanceMinutes(1);
    const second = await createRequest(ctx, family);
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/requests?memberId=${family.target.memberId}&targetMemberId=${family.target.memberId}`
    );
    expect(res.status).toBe(200);
    const { requests } = (await res.json()) as { requests: RequestJson[] };
    expect(requests.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('送信者で絞り込める', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await createRequest(ctx, family);
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/requests?memberId=${family.requester.memberId}&requesterMemberId=${family.requester.memberId}`
    );
    const { requests } = (await res.json()) as { requests: RequestJson[] };
    expect(requests.length).toBe(1);
    expect(requests[0]?.requesterMemberId).toBe(family.requester.memberId);
  });

  it('非メンバーには 403 を返し履歴を露出しない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await createRequest(ctx, family);
    const outsider = await registerMember(ctx.app, '部外者');
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/requests?memberId=${outsider.memberId}`
    );
    expect(res.status).toBe(403);
  });

  it('一覧の読み取り時に期限超過した要求を expired へ確定する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    ctx.clock.advanceMinutes(31);
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/requests?memberId=${family.target.memberId}&targetMemberId=${family.target.memberId}`
    );
    const { requests } = (await res.json()) as { requests: RequestJson[] };
    expect(requests.find((r) => r.id === request.id)?.status).toBe('expired');
  });
});

interface AuditEntry {
  id: string;
  circleId: string | null;
  actorMemberId: string | null;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  createdAt: string;
}

async function getAudit(
  app: Hono,
  circleId: string,
  callerId: string
): Promise<AuditEntry[]> {
  const res = await app.request(
    `/api/circles/${circleId}/audit?memberId=${callerId}`
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { entries: AuditEntry[] }).entries;
}

describe('監査ログ', () => {
  it('家族作成・招待発行・招待確認・確認要求作成を時系列で記録する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 2);
    await createRequest(ctx, family);
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    const types = entries.map((e) => e.eventType);
    expect(types).toEqual([
      'circle_created',
      'invite_created',
      'invite_confirmed',
      'request_created',
    ]);
  });

  it('確認要求の承認を記録し承認者を actor にする', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await respondWith(ctx, request, family.target, 'approve');
    expect(res.status).toBe(200);
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    const approved = entries.find((e) => e.eventType === 'request_approved');
    expect(approved).toBeDefined();
    expect(approved?.actorMemberId).toBe(family.target.memberId);
    expect(approved?.targetId).toBe(request.id);
  });

  it('確認要求の拒否を記録する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    await respondWith(ctx, request, family.target, 'reject');
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    expect(entries.some((e) => e.eventType === 'request_rejected')).toBe(true);
  });

  it('確認要求の取り消しを記録する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    await postJson(ctx.app, `/api/requests/${request.id}/cancel`, {
      requesterMemberId: family.requester.memberId,
    });
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    expect(entries.some((e) => e.eventType === 'request_cancelled')).toBe(true);
  });

  it('認可で拒否した応答の試み（依頼者の自己承認）を記録する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    // 依頼者自身が自分の要求を承認しようとする（自己承認の不正試行）。
    const denied = await respondWith(ctx, request, family.requester, 'approve');
    expect(denied.status).toBe(403);
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    const denial = entries.find(
      (e) => e.eventType === 'request_response_denied'
    );
    expect(denial).toBeDefined();
    expect(denial?.actorMemberId).toBe(family.requester.memberId);
    expect(denial?.targetId).toBe(request.id);
  });

  it('端末失効を家族の証跡に記録する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await postJson(
      ctx.app,
      `/api/devices/${family.target.deviceId}/revoke`,
      {}
    );
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    const revoked = entries.find((e) => e.eventType === 'device_revoked');
    expect(revoked).toBeDefined();
    expect(revoked?.targetId).toBe(family.target.deviceId);
    // 失効エンドポイントは呼び出し元を認証しないため actor は確定しない（null）。
    expect(revoked?.actorMemberId).toBeNull();
  });

  it('緊急停止と解除を記録する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const stopRes = await postJson(
      ctx.app,
      `/api/circles/${family.circleId}/stop`,
      { memberId: family.requester.memberId }
    );
    const { stopEvent } = (await stopRes.json()) as {
      stopEvent: { id: string };
    };
    const payload = canonicalReleasePayload({
      circleId: family.circleId,
      stopEventId: stopEvent.id,
    });
    await postJson(ctx.app, `/api/circles/${family.circleId}/release`, {
      signatures: [
        {
          deviceId: family.requester.deviceId,
          signature: await signEd25519(family.requester.privateKey, payload),
        },
        {
          deviceId: family.target.deviceId,
          signature: await signEd25519(family.target.privateKey, payload),
        },
      ],
    });
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    const stopped = entries.find((e) => e.eventType === 'circle_stopped');
    expect(stopped?.actorMemberId).toBe(family.requester.memberId);
    expect(entries.some((e) => e.eventType === 'circle_released')).toBe(true);
  });

  it('署名検証の失敗を記録する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const res = await respondWith(ctx, request, family.target, 'approve', {
      amount: request.amount + 1,
    });
    expect(res.status).toBe(422);
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    expect(
      entries.some((e) => e.eventType === 'request_verification_failed')
    ).toBe(true);
  });

  it('同一署名の再送（リプレイ）の拒否を記録する', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx, 3);
    await buildApprovedHistory(ctx, family, '実績済み銀行 0000020');
    const request = await createRequest(ctx, family, {
      amount: 150000,
      beneficiary: '実績済み銀行 0000020',
    });
    const payload = responsePayloadFor(request, 'approve');
    const signature = await signEd25519(family.target.privateKey, payload);
    await postJson(ctx.app, `/api/requests/${request.id}/respond`, {
      deviceId: family.target.deviceId,
      kind: 'approve',
      signature,
    });
    const replay = await postJson(
      ctx.app,
      `/api/requests/${request.id}/respond`,
      { deviceId: family.target.deviceId, kind: 'approve', signature }
    );
    expect(replay.status).toBe(409);
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    expect(entries.some((e) => e.eventType === 'request_replay_rejected')).toBe(
      true
    );
  });

  it('メンバー登録と端末登録を circle に紐付けずに記録する', async () => {
    const ctx = createTestContext();
    const user = await registerMember(ctx.app, '花子');
    const rows = ctx.db
      .query<{ event_type: string; circle_id: string | null }, [string]>(
        'SELECT event_type, circle_id FROM audit_log WHERE actor_member_id = ?'
      )
      .all(user.memberId);
    const types = rows.map((r) => r.event_type);
    expect(types).toContain('member_registered');
    expect(types).toContain('device_registered');
    for (const row of rows) {
      expect(row.circle_id).toBeNull();
    }
  });

  it('非メンバーには証跡を返さず 403 を返す', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    await createRequest(ctx, family);
    const outsider = await registerMember(ctx.app, '部外者');
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/audit?memberId=${outsider.memberId}`
    );
    expect(res.status).toBe(403);
  });

  it('memberId 未指定は 403 を返す', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const res = await ctx.app.request(`/api/circles/${family.circleId}/audit`);
    expect(res.status).toBe(403);
  });

  it('存在しない家族グループは 404 を返す', async () => {
    const ctx = createTestContext();
    const res = await ctx.app.request(
      '/api/circles/missing/audit?memberId=anyone'
    );
    expect(res.status).toBe(404);
  });

  it('証跡は追記専用で過去のエントリを書き換えない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family);
    const before = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    await respondWith(ctx, request, family.target, 'approve');
    const after = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    expect(after.length).toBeGreaterThan(before.length);
    // 既存エントリ（id と順序）が後続操作で変化しない。
    expect(after.slice(0, before.length).map((e) => e.id)).toEqual(
      before.map((e) => e.id)
    );
  });

  it('機微情報（金額・送金先・理由・件名）を証跡に残さない', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    const request = await createRequest(ctx, family, {
      subject: '秘密の件名トークン',
      beneficiary: '秘密銀行 9999999',
      reason: '秘密の理由トークン',
      amount: 123456,
    });
    await respondWith(ctx, request, family.target, 'approve');
    const entries = await getAudit(
      ctx.app,
      family.circleId,
      family.requester.memberId
    );
    // 日本語トークンは UUID 等に現れないため全体を直接検査する。
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('秘密の件名トークン');
    expect(serialized).not.toContain('秘密銀行 9999999');
    expect(serialized).not.toContain('秘密の理由トークン');
    // 金額は数字列のため UUID（16 進）と偶発衝突する。自由記述である summary
    // のみを対象に検査する（id/targetId 等は UUID で機微情報を含まない）。
    for (const entry of entries) {
      expect(entry.summary).not.toContain('123456');
    }
  });

  it('limit で取得件数を絞っても直近を古い順で返す', async () => {
    const ctx = createTestContext();
    const family = await setupFamily(ctx);
    // circle_created / invite_created / invite_confirmed の後に要求を複数作る。
    for (let i = 0; i < 4; i++) {
      ctx.clock.advanceMinutes(1);
      await createRequest(ctx, family);
    }
    const res = await ctx.app.request(
      `/api/circles/${family.circleId}/audit?memberId=${family.requester.memberId}&limit=2`
    );
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as { entries: AuditEntry[] };
    expect(entries.length).toBe(2);
    // 直近 2 件を古い順で返す（末尾が最新）。
    expect(entries.every((e) => e.eventType === 'request_created')).toBe(true);
    const times = entries.map((e) => e.createdAt);
    expect((times[0] ?? '') <= (times[1] ?? '')).toBe(true);
  });
});

describe('招待確認のレスポンス', () => {
  it('確認レスポンスは参加した家族グループの circleId を返す', async () => {
    const ctx = createTestContext();
    const creator = await registerMember(ctx.app, '花子');
    const joiner = await registerMember(ctx.app, '太郎');
    const circleRes = await postJson(ctx.app, '/api/circles', {
      name: 'テスト家族',
      creatorMemberId: creator.memberId,
    });
    const { circle } = (await circleRes.json()) as { circle: { id: string } };
    const inviteRes = await postJson(ctx.app, '/api/invites', {
      circleId: circle.id,
      inviterMemberId: creator.memberId,
      kind: 'qr',
    });
    const { invite } = (await inviteRes.json()) as { invite: { id: string } };
    const confirmRes = await postJson(
      ctx.app,
      `/api/invites/${invite.id}/confirm`,
      { inviteeMemberId: joiner.memberId }
    );
    expect(confirmRes.status).toBe(200);
    const body = (await confirmRes.json()) as {
      invite: { status: string; circleId: string };
    };
    expect(body.invite.status).toBe('confirmed');
    expect(body.invite.circleId).toBe(circle.id);
  });
});
