import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ApiClient,
  cancelAndFetchRequest,
  type RequestRecord,
  respondAndFetchRequest,
} from './api';

interface CapturedRequest {
  method: string;
  path: string;
  body: unknown;
}

/**
 * バックエンド（packages/backend/src/app.ts）が返す確認要求レコードと
 * 同じ形のフィクスチャ。封筒 `{ request: {...} }` で配信する。
 */
const requestRecordFixture: RequestRecord = {
  id: 'req-1',
  circleId: 'c1',
  requesterMemberId: 'm1',
  targetMemberId: 'm2',
  subject: 'お金を送ってほしいと言われた',
  amount: 300000,
  beneficiary: '○○銀行 1234567',
  reason: '会社のお金をなくした',
  deadline: '2026-06-10T15:30:00Z',
  nonce: 'nonce-abc',
  status: 'unanswered',
  secondApprovalRequired: true,
  waitRequired: true,
  waitUntil: null,
  createdAt: '2026-06-10T12:00:00.000Z',
};

let server: ReturnType<typeof Bun.serve>;
let client: ApiClient;
const captured: CapturedRequest[] = [];
const capturedQueries: string[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const text = await req.text();
      captured.push({
        method: req.method,
        path: url.pathname,
        body: text === '' ? null : JSON.parse(text),
      });
      capturedQueries.push(url.search);
      // バックエンドの実レスポンス形式（app.ts）を再現する。
      if (url.pathname === '/api/requests' && req.method === 'POST') {
        return Response.json(
          { request: requestRecordFixture },
          { status: 201 }
        );
      }
      if (
        /^\/api\/requests\/[^/]+$/.test(url.pathname) &&
        req.method === 'GET'
      ) {
        return Response.json({ request: requestRecordFixture });
      }
      if (url.pathname.endsWith('/respond')) {
        // 応答 API は金額などを含まない最小 JSON を返す。
        return Response.json({
          status: 'collecting',
          approvals: 1,
          requiredApprovals: 2,
        });
      }
      if (url.pathname === '/api/members' && req.method === 'POST') {
        return Response.json(
          {
            member: { id: 'm-1', name: '佐藤良子' },
            device: {
              id: 'd-1',
              memberId: 'm-1',
              publicKey: 'base64key',
              status: 'active',
            },
          },
          { status: 201 }
        );
      }
      if (url.pathname === '/api/circles' && req.method === 'POST') {
        return Response.json(
          { circle: { id: 'c-1', name: '佐藤家', status: 'normal' } },
          { status: 201 }
        );
      }
      // GET /api/circles/:id/members（宛先候補・参加メンバー一覧）。
      if (
        /^\/api\/circles\/[^/]+\/members$/.test(url.pathname) &&
        req.method === 'GET'
      ) {
        return Response.json({
          members: [
            { id: 'm-1', name: '佐藤良子' },
            { id: 'm-2', name: '佐藤太郎' },
          ],
        });
      }
      // GET /api/circles/:id/requests（受信箱・送信箱）。
      if (
        /^\/api\/circles\/[^/]+\/requests$/.test(url.pathname) &&
        req.method === 'GET'
      ) {
        return Response.json({ requests: [requestRecordFixture] });
      }
      // GET /api/members/:id/circles（参加中の家族一覧）。
      if (
        /^\/api\/members\/[^/]+\/circles$/.test(url.pathname) &&
        req.method === 'GET'
      ) {
        return Response.json({
          circles: [
            { id: 'c-1', name: '佐藤家', status: 'normal' },
            { id: 'c-2', name: '田中家', status: 'stopped' },
          ],
        });
      }
      if (url.pathname === '/api/invites' && req.method === 'POST') {
        return Response.json(
          {
            invite: {
              id: 'inv-1',
              circleId: 'c1',
              kind: 'remote',
              status: 'waiting',
              confirmableAt: '2026-06-12T12:00:00Z',
            },
          },
          { status: 201 }
        );
      }
      if (/^\/api\/invites\/[^/]+\/confirm$/.test(url.pathname)) {
        return Response.json({
          invite: { id: 'inv-1', status: 'confirmed', circleId: 'c-joined' },
        });
      }
      if (/^\/api\/invites\/[^/]+\/cancel$/.test(url.pathname)) {
        return Response.json({ invite: { id: 'inv-1', status: 'cancelled' } });
      }
      if (/^\/api\/devices\/[^/]+\/revoke$/.test(url.pathname)) {
        return Response.json({ device: { id: 'd-1', status: 'revoked' } });
      }
      if (url.pathname.endsWith('/stop')) {
        return Response.json({
          circle: { id: 'c-1', status: 'stopped' },
          stopEvent: { id: 'se-1' },
        });
      }
      if (url.pathname.endsWith('/release')) {
        return Response.json({ circle: { id: 'c-1', status: 'normal' } });
      }
      if (url.pathname.endsWith('/cancel')) {
        return Response.json({ status: 'invalidated' });
      }
      return Response.json({ id: 'generated-id', status: 'unanswered' });
    },
  });
  client = new ApiClient(`http://localhost:${server.port}`);
});

afterAll(() => {
  server.stop(true);
});

function lastCaptured(): CapturedRequest {
  const last = captured.at(-1);
  if (!last) {
    throw new Error('リクエストが記録されていません');
  }
  return last;
}

describe('API クライアント（実 HTTP サーバーに対する送信）', () => {
  it('POST /api/members の `{ member, device }` 封筒を unwrap し deviceId を解決する', async () => {
    const member = await client.createMember({
      name: '佐藤良子',
      publicKey: 'base64key',
    });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/members',
      body: { name: '佐藤良子', publicKey: 'base64key' },
    });
    expect(member).toEqual({ id: 'm-1', name: '佐藤良子', deviceId: 'd-1' });
  });

  it('POST /api/circles は creatorMemberId 必須の契約に合わせてボディに作成者を含める', async () => {
    const circle = await client.createCircle({
      name: '佐藤家',
      creatorMemberId: 'm-1',
    });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/circles',
      body: { name: '佐藤家', creatorMemberId: 'm-1' },
    });
    expect(circle).toEqual({ id: 'c-1', name: '佐藤家', status: 'normal' });
  });

  it('GET /api/circles/:id/members は呼び出し元 memberId を必須クエリにして `{ members }` 封筒を unwrap する', async () => {
    const members = await client.listCircleMembers('c-1', 'm-1');
    const last = lastCaptured();
    expect(last.method).toBe('GET');
    expect(last.path).toBe('/api/circles/c-1/members');
    expect(last.body).toBeNull();
    // 非メンバーへの名簿露出を防ぐため memberId を必ず付ける。
    expect(capturedQueries.at(-1) ?? '').toContain('memberId=m-1');
    expect(members).toEqual([
      { id: 'm-1', name: '佐藤良子' },
      { id: 'm-2', name: '佐藤太郎' },
    ]);
  });

  it('GET /api/circles/:id/requests は memberId を必須にして常にクエリへ含める', async () => {
    const requests = await client.listRequests('c-1', { memberId: 'm-1' });
    const last = lastCaptured();
    expect(last.method).toBe('GET');
    expect(last.path).toBe('/api/circles/c-1/requests');
    expect(last.body).toBeNull();
    expect(capturedQueries.at(-1) ?? '').toContain('memberId=m-1');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.amount).toBe(300000);
  });

  it('GET /api/circles/:id/requests は memberId に加え targetMemberId / requesterMemberId をクエリ文字列に組み立てる', async () => {
    await client.listRequests('c-1', {
      memberId: 'm-1',
      targetMemberId: 'm-2',
      requesterMemberId: 'm-1',
    });
    const last = lastCaptured();
    expect(last.method).toBe('GET');
    expect(last.path).toBe('/api/circles/c-1/requests');
    const query = capturedQueries.at(-1) ?? '';
    expect(query).toContain('memberId=m-1');
    expect(query).toContain('targetMemberId=m-2');
    expect(query).toContain('requesterMemberId=m-1');
  });

  it('GET /api/members/:id/circles の `{ circles }` 封筒を unwrap して参加中の家族一覧を返す', async () => {
    const circles = await client.listMyCircles('m-1');
    expect(lastCaptured()).toEqual({
      method: 'GET',
      path: '/api/members/m-1/circles',
      body: null,
    });
    expect(circles).toEqual([
      { id: 'c-1', name: '佐藤家', status: 'normal' },
      { id: 'c-2', name: '田中家', status: 'stopped' },
    ]);
  });

  it('POST /api/invites と confirm / cancel は `{ invite }` 封筒を unwrap する', async () => {
    const invite = await client.createInvite({
      circleId: 'c1',
      inviterMemberId: 'm1',
      kind: 'remote',
    });
    expect(lastCaptured().path).toBe('/api/invites');
    expect(invite.id).toBe('inv-1');
    expect(invite.status).toBe('waiting');
    const confirmed = await client.confirmInvite('inv-1', {
      inviteeMemberId: 'm-2',
    });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/invites/inv-1/confirm',
      body: { inviteeMemberId: 'm-2' },
    });
    // 参加先 circle を切り替えるため、レスポンスの circleId を保持する。
    expect(confirmed).toEqual({
      id: 'inv-1',
      status: 'confirmed',
      circleId: 'c-joined',
    });
    await client.cancelInvite('inv-1');
    expect(lastCaptured().path).toBe('/api/invites/inv-1/cancel');
  });

  it('POST /api/requests にバックエンド契約のフィールド名（requesterMemberId / targetMemberId）で送る', async () => {
    const form = {
      circleId: 'c1',
      requesterMemberId: 'm1',
      targetMemberId: 'm2',
      subject: 'お金を送ってほしいと言われた',
      amount: 300000,
      beneficiary: '○○銀行 1234567',
      reason: '会社のお金をなくした',
      deadline: '2026-06-10T15:30:00Z',
    };
    await client.createRequest(form);
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/requests',
      body: form,
    });
  });

  it('POST /api/requests の `{ request: {...} }` 封筒を unwrap してレコードを返す', async () => {
    const created = await client.createRequest({
      circleId: 'c1',
      requesterMemberId: 'm1',
      targetMemberId: 'm2',
      subject: 'お金を送ってほしいと言われた',
      amount: 300000,
      beneficiary: '○○銀行 1234567',
      reason: '会社のお金をなくした',
      deadline: '2026-06-10T15:30:00Z',
    });
    expect(created.status).toBe('unanswered');
    expect(created.amount).toBe(300000);
    expect(created.requesterMemberId).toBe('m1');
    expect(created.targetMemberId).toBe('m2');
    expect(created.nonce).toBe('nonce-abc');
  });

  it('GET /api/requests/:id の封筒を unwrap して状態を取得する', async () => {
    const result = await client.getRequest('req-1');
    expect(lastCaptured()).toEqual({
      method: 'GET',
      path: '/api/requests/req-1',
      body: null,
    });
    expect(result.status).toBe('unanswered');
    expect(result.amount).toBe(300000);
    expect(result.targetMemberId).toBe('m2');
  });

  it('POST /api/requests/:id/respond に署名付き応答を送り、最小 JSON の status を受け取る', async () => {
    const result = await client.respondToRequest('req-1', {
      deviceId: 'd1',
      kind: 'approve',
      signature: 'sig-base64',
    });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/requests/req-1/respond',
      body: { deviceId: 'd1', kind: 'approve', signature: 'sig-base64' },
    });
    expect(result.status).toBe('collecting');
    // 応答 API のレスポンスは完全なレコードではない（amount を含まない）。
    expect('amount' in result).toBe(false);
  });

  it('POST /api/requests/:id/cancel に requesterMemberId をボディで送る', async () => {
    const result = await client.cancelRequest('req-1', {
      requesterMemberId: 'm1',
    });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/requests/req-1/cancel',
      body: { requesterMemberId: 'm1' },
    });
    expect(result.status).toBe('invalidated');
  });

  it('respondAndFetchRequest は応答後に GET /api/requests/:id で完全なレコードを取り直す', async () => {
    const record = await respondAndFetchRequest(client, 'req-1', {
      deviceId: 'd1',
      kind: 'approve',
      signature: 'sig-base64',
    });
    expect(lastCaptured()).toEqual({
      method: 'GET',
      path: '/api/requests/req-1',
      body: null,
    });
    // 結果画面に渡せる完全なレコードであること（金額等が defined）。
    expect(record.amount).toBe(300000);
    expect(record.beneficiary).toBe('○○銀行 1234567');
    expect(record.reason).toBe('会社のお金をなくした');
  });

  it('cancelAndFetchRequest は取り消し後に完全なレコードを取り直す', async () => {
    const record = await cancelAndFetchRequest(client, 'req-1', 'm1');
    expect(lastCaptured()).toEqual({
      method: 'GET',
      path: '/api/requests/req-1',
      body: null,
    });
    expect(record.amount).toBe(300000);
    expect(
      captured.some(
        (entry) =>
          entry.path === '/api/requests/req-1/cancel' &&
          JSON.stringify(entry.body) ===
            JSON.stringify({ requesterMemberId: 'm1' })
      )
    ).toBe(true);
  });

  it('POST /api/devices/:id/revoke は `{ device }` 封筒を unwrap する', async () => {
    const device = await client.revokeDevice('d1');
    expect(lastCaptured().path).toBe('/api/devices/d1/revoke');
    expect(device).toEqual({ id: 'd-1', status: 'revoked' });
  });

  it('POST /api/circles/:id/stop は封筒を unwrap し stopEventId を返す', async () => {
    const stopped = await client.stopCircle('c1', { memberId: 'm1' });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/circles/c1/stop',
      body: { memberId: 'm1' },
    });
    expect(stopped).toEqual({
      id: 'c-1',
      status: 'stopped',
      stopEventId: 'se-1',
    });
  });

  it('POST /api/circles/:id/release はボディキー signatures で解除署名 2 件を送る', async () => {
    const signatures = [
      { deviceId: 'd1', signature: 's1' },
      { deviceId: 'd2', signature: 's2' },
    ];
    const released = await client.releaseCircle('c1', { signatures });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/circles/c1/release',
      body: { signatures },
    });
    expect(released).toEqual({ id: 'c-1', status: 'normal' });
  });

  it('エラー応答（4xx）は例外として伝わる', async () => {
    const errorServer = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({ error: 'amount は必須です' }, { status: 400 }),
    });
    try {
      const errorClient = new ApiClient(`http://localhost:${errorServer.port}`);
      expect(
        errorClient.cancelRequest('req-1', { requesterMemberId: 'm1' })
      ).rejects.toThrow('400');
    } finally {
      errorServer.stop(true);
    }
  });
});
