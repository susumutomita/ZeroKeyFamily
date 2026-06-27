/**
 * Phase 1 のエンドツーエンド契約ゲート。
 *
 * 実バックエンド（packages/backend の createApp）を起動し、実フロントエンドの
 * API クライアントと実 WebCrypto 署名で核となるジャーニーを通す。ユニット
 * テストのフェイクでは隠れる契約不一致（フィールド名・封筒・必須ボディ）を
 * 実物どうしの結合で検出する。`bun scripts/e2e-phase1.ts` で実行する。
 */

import { Database } from 'bun:sqlite';
import { createApp } from '../packages/backend/src/app';
import type { Clock } from '../packages/backend/src/clock';
import { migrate } from '../packages/backend/src/db';
import {
  ApiClient,
  respondAndFetchRequest,
} from '../packages/frontend/src/lib/api';
import {
  canonicalize,
  payloadFromRequest,
} from '../packages/frontend/src/lib/canonical';
import {
  exportPublicKeyBase64,
  generateDeviceKeyPair,
  signPayload,
} from '../packages/frontend/src/lib/crypto';

/** 待機満了などの時間経過を再現できる可変クロック。 */
class MutableClock implements Clock {
  private current = new Date();
  now(): Date {
    return new Date(this.current.getTime());
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
}

interface Person {
  memberId: string;
  deviceId: string;
  privateKey: CryptoKey;
  publicKeyBase64: string;
}

async function makeKeys(): Promise<
  Pick<Person, 'privateKey' | 'publicKeyBase64'>
> {
  const pair = await generateDeviceKeyPair();
  return {
    privateKey: pair.privateKey,
    publicKeyBase64: await exportPublicKeyBase64(pair.publicKey),
  };
}

async function register(api: ApiClient, name: string): Promise<Person> {
  const keys = await makeKeys();
  const member = await api.createMember({
    name,
    publicKey: keys.publicKeyBase64,
  });
  return { memberId: member.id, deviceId: member.deviceId, ...keys };
}

interface SignableRequest {
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
}

async function sign(
  person: Person,
  request: SignableRequest,
  kind: 'approve' | 'reject'
): Promise<string> {
  return signPayload(
    person.privateKey,
    canonicalize(payloadFromRequest(request, kind))
  );
}

async function main(): Promise<void> {
  const db = new Database(':memory:');
  migrate(db);
  const clock = new MutableClock();
  const app = createApp({ db, clock });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  const api = new ApiClient(`http://localhost:${server.port}`);
  const deadline = (): string =>
    new Date(clock.now().getTime() + 30 * 60_000).toISOString();

  try {
    // 1. 花子が登録し家族を作る。
    const hanako = await register(api, '花子');
    const circle = await api.createCircle({
      name: '花子の家族',
      creatorMemberId: hanako.memberId,
    });
    check(
      '家族グループを作成できる',
      typeof circle.id === 'string' && circle.id.length > 0
    );

    // 2. 太郎が登録し、QR 招待で家族に参加する。
    const taro = await register(api, '太郎');
    const invite = await api.createInvite({
      circleId: circle.id,
      inviterMemberId: hanako.memberId,
      kind: 'qr',
    });
    const confirmed = await api.confirmInvite(invite.id, {
      inviteeMemberId: taro.memberId,
    });
    check(
      '招待確認が参加した circleId を返す',
      confirmed.circleId === circle.id
    );

    // 3. 家族メンバー一覧に二人が表示名つきで並ぶ（呼び出し元はメンバー本人）。
    const members = await api.listCircleMembers(circle.id, hanako.memberId);
    check(
      '家族メンバー一覧に花子と太郎が並ぶ',
      members.map((m) => m.name).join(',') === '花子,太郎'
    );

    // 4. 花子が太郎宛てに確認要求を作る。
    const request = await api.createRequest({
      circleId: circle.id,
      requesterMemberId: hanako.memberId,
      targetMemberId: taro.memberId,
      subject: 'お金を送ってほしいと言われた',
      amount: 5000,
      beneficiary: '○○銀行 1234567',
      reason: '会社のお金をなくしたと言われた',
      deadline: deadline(),
    });
    check('作成直後は未応答である', request.status === 'unanswered');

    // 5. 太郎の受信箱に届いている。
    const inbox = await api.listRequests(circle.id, {
      memberId: taro.memberId,
      targetMemberId: taro.memberId,
    });
    check(
      '太郎の受信箱に要求が届く',
      inbox.some((r) => r.id === request.id)
    );

    // 6. 太郎が承認署名する。初回送金先のため 30 分の待機に入る（即時承認しない）。
    const approveSig = await sign(taro, request, 'approve');
    const afterApprove = await respondAndFetchRequest(api, request.id, {
      deviceId: taro.deviceId,
      kind: 'approve',
      signature: approveSig,
    });
    check(
      '初回送金先への承認は 30 分の待機に入る（即時確認済みにしない）',
      afterApprove.status === 'waiting'
    );

    // 7. 30 分経過後に取得すると確認済みへ確定する。
    clock.advanceMinutes(31);
    const settled = await api.getRequest(request.id);
    check('待機満了後の取得で確認済みになる', settled.status === 'approved');

    // 8. 別要求を太郎が拒否すると即座に拒否で確定する。
    const request2 = await api.createRequest({
      circleId: circle.id,
      requesterMemberId: hanako.memberId,
      targetMemberId: taro.memberId,
      subject: '送金先を変えてと言われた',
      amount: 3000,
      beneficiary: '△△銀行 7654321',
      reason: '身に覚えがない',
      deadline: deadline(),
    });
    const rejectSig = await sign(taro, request2, 'reject');
    const rejected = await respondAndFetchRequest(api, request2.id, {
      deviceId: taro.deviceId,
      kind: 'reject',
      signature: rejectSig,
    });
    check('拒否署名で拒否に確定する', rejected.status === 'rejected');

    // 9. 偽署名は確認済みにならない（fail-safe）。
    const request3 = await api.createRequest({
      circleId: circle.id,
      requesterMemberId: hanako.memberId,
      targetMemberId: taro.memberId,
      subject: 'なりすましのテスト',
      amount: 4000,
      beneficiary: '○○銀行 1234567',
      reason: 'テスト',
      deadline: deadline(),
    });
    // 署名内容を改ざん（金額を変えたペイロードに署名）。
    const tampered = await signPayload(
      taro.privateKey,
      canonicalize(
        payloadFromRequest({ ...request3, amount: 999999 }, 'approve')
      )
    );
    let verificationRejected = false;
    try {
      await api.respondToRequest(request3.id, {
        deviceId: taro.deviceId,
        kind: 'approve',
        signature: tampered,
      });
    } catch {
      verificationRejected = true;
    }
    const after = await api.getRequest(request3.id);
    check('改ざん署名は応答が拒否される', verificationRejected);
    check('改ざん署名で確認済みにならない', after.status !== 'approved');

    // 10. 監査証跡: 家族メンバーは時系列の証跡を取得でき、機微情報を含まない。
    //     UI 化は別 Issue のため、ここでは API を直接叩いて契約を確認する。
    const base = `http://localhost:${server.port}`;
    const auditRes = await fetch(
      `${base}/api/circles/${circle.id}/audit?memberId=${hanako.memberId}`
    );
    const auditJson = (await auditRes.json()) as {
      entries: { eventType: string; summary: string }[];
    };
    const auditTypes = new Set(auditJson.entries.map((e) => e.eventType));
    check(
      '証跡に家族作成・要求作成・承認・拒否・検証失敗が記録される',
      auditRes.status === 200 &&
        auditTypes.has('circle_created') &&
        auditTypes.has('request_created') &&
        auditTypes.has('request_approved') &&
        auditTypes.has('request_rejected') &&
        auditTypes.has('request_verification_failed')
    );
    check(
      '証跡が時系列（古い順）で家族作成から始まる',
      auditJson.entries[0]?.eventType === 'circle_created'
    );
    const auditSerialized = JSON.stringify(auditJson.entries);
    check(
      '証跡に送金先・理由などの機微情報が含まれない',
      !auditSerialized.includes('○○銀行 1234567') &&
        !auditSerialized.includes('会社のお金をなくしたと言われた')
    );

    // 11. 非メンバー（家族コードのみ知る者）は証跡を取得できない。
    const outsider = await register(api, '部外者');
    const deniedRes = await fetch(
      `${base}/api/circles/${circle.id}/audit?memberId=${outsider.memberId}`
    );
    check('非メンバーは証跡を取得できない', deniedRes.status === 403);
  } finally {
    server.stop(true);
    db.close();
  }

  if (failures > 0) {
    console.error(`\nE2E 失敗: ${failures} 件`);
    process.exit(1);
  }
  console.log('\nE2E 成功: Phase 1 の核ジャーニーが実バックエンドで通った。');
}

await main();
