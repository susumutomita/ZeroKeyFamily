import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ApiClient } from './api';

interface CapturedRequest {
  method: string;
  path: string;
  body: unknown;
}

let server: ReturnType<typeof Bun.serve>;
let client: ApiClient;
const captured: CapturedRequest[] = [];

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
  it('POST /api/members にメンバーと公開鍵を送る', async () => {
    await client.createMember({ name: '佐藤良子', publicKey: 'base64key' });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/members',
      body: { name: '佐藤良子', publicKey: 'base64key' },
    });
  });

  it('POST /api/circles に家族グループ作成を送る', async () => {
    await client.createCircle({ name: '佐藤家' });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/circles',
      body: { name: '佐藤家' },
    });
  });

  it('POST /api/invites と confirm / cancel を送る', async () => {
    await client.createInvite({
      circleId: 'c1',
      inviterMemberId: 'm1',
      kind: 'remote',
    });
    expect(lastCaptured().path).toBe('/api/invites');
    await client.confirmInvite('inv-1');
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/invites/inv-1/confirm',
      body: null,
    });
    await client.cancelInvite('inv-1');
    expect(lastCaptured().path).toBe('/api/invites/inv-1/cancel');
  });

  it('POST /api/requests に確認要求を送る', async () => {
    const form = {
      circleId: 'c1',
      requesterId: 'm1',
      targetId: 'm2',
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

  it('GET /api/requests/:id で状態を取得する', async () => {
    const result = await client.getRequest('req-1');
    expect(lastCaptured()).toEqual({
      method: 'GET',
      path: '/api/requests/req-1',
      body: null,
    });
    expect(result.status).toBe('unanswered');
  });

  it('POST /api/requests/:id/respond に署名付き応答を送る', async () => {
    await client.respondToRequest('req-1', {
      deviceId: 'd1',
      kind: 'approve',
      signature: 'sig-base64',
    });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/requests/req-1/respond',
      body: { deviceId: 'd1', kind: 'approve', signature: 'sig-base64' },
    });
  });

  it('POST /api/requests/:id/cancel で取り消しを送る', async () => {
    await client.cancelRequest('req-1');
    expect(lastCaptured().path).toBe('/api/requests/req-1/cancel');
  });

  it('POST /api/devices/:id/revoke で失効を送る', async () => {
    await client.revokeDevice('d1');
    expect(lastCaptured().path).toBe('/api/devices/d1/revoke');
  });

  it('POST /api/circles/:id/stop で緊急停止を発動する', async () => {
    await client.stopCircle('c1', { memberId: 'm1' });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/circles/c1/stop',
      body: { memberId: 'm1' },
    });
  });

  it('POST /api/circles/:id/release に解除署名 2 件を送る', async () => {
    const releases = [
      { deviceId: 'd1', signature: 's1' },
      { deviceId: 'd2', signature: 's2' },
    ];
    await client.releaseCircle('c1', { releases });
    expect(lastCaptured()).toEqual({
      method: 'POST',
      path: '/api/circles/c1/release',
      body: { releases },
    });
  });

  it('エラー応答（4xx）は例外として伝わる', async () => {
    const errorServer = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({ error: 'amount は必須です' }, { status: 400 }),
    });
    try {
      const errorClient = new ApiClient(`http://localhost:${errorServer.port}`);
      expect(errorClient.cancelRequest('req-1')).rejects.toThrow('400');
    } finally {
      errorServer.stop(true);
    }
  });
});
