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
import { systemClock } from '../packages/backend/src/clock';
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

async function sign(
  person: Person,
  request: {
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
  },
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
  const app = createApp({ db, clock: systemClock });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  const api = new ApiClient(`http://localhost:${server.port}`);

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

    // 3. 家族メンバー一覧に二人が表示名つきで並ぶ。
    const members = await api.listCircleMembers(circle.id);
    check(
      '家族メンバー一覧に花子と太郎が並ぶ',
      members.map((m) => m.name).join(',') === '花子,太郎'
    );

    // 4. 花子が太郎宛てに確認要求を作る（低額・高リスクなし）。
    const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
    const request = await api.createRequest({
      circleId: circle.id,
      requesterMemberId: hanako.memberId,
      targetMemberId: taro.memberId,
      subject: 'お金を送ってほしいと言われた',
      amount: 5000,
      beneficiary: '○○銀行 1234567',
      reason: '会社のお金をなくしたと言われた',
      deadline,
    });
    check('作成直後は未応答である', request.status === 'unanswered');

    // 5. 太郎の受信箱に届いている。
    const inbox = await api.listRequests(circle.id, {
      targetMemberId: taro.memberId,
    });
    check(
      '太郎の受信箱に要求が届く',
      inbox.some((r) => r.id === request.id)
    );

    // 6. 太郎が自分の端末鍵で承認署名する → 確認済みになる。
    const approveSig = await sign(taro, request, 'approve');
    const approved = await respondAndFetchRequest(api, request.id, {
      deviceId: taro.deviceId,
      kind: 'approve',
      signature: approveSig,
    });
    check('対象本人の承認署名で確認済みになる', approved.status === 'approved');

    // 7. 花子が結果を取得しても確認済み。
    const fetched = await api.getRequest(request.id);
    check('送信者の取得でも確認済み', fetched.status === 'approved');

    // 8. 別要求を太郎が拒否すると拒否で確定する。
    const request2 = await api.createRequest({
      circleId: circle.id,
      requesterMemberId: hanako.memberId,
      targetMemberId: taro.memberId,
      subject: '送金先を変えてと言われた',
      amount: 3000,
      beneficiary: '△△銀行 7654321',
      reason: '身に覚えがない',
      deadline,
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
      deadline,
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
    check(
      '改ざん署名は確認済みにならない',
      verificationRejected || after.status !== 'approved'
    );
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
