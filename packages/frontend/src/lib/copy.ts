/**
 * 画面文言の定数。
 *
 * 正本は docs/product/safety-copy-guide.md（状態別の標準文言は一字一句正とする）と
 * docs/product/wireframes.md。文言の変更は必ずガイドとの整合レビューを通す。
 */

/** 状態別の標準文言（safety-copy-guide「状態別の標準文言」の主文）。 */
export const STANDARD_COPY = {
  verified: (name: string): string =>
    `${name}さんの登録端末が、この内容に同意の署名をしました。`,
  rejected: (name: string): string =>
    `${name}さんの端末がこの内容を『身に覚えがない』と回答しました。お金を送らないでください。`,
  unanswered:
    'まだ確認できていません。応答がないことは、相手が本人であることの確認にはなりません。',
  expired: '期限までに確認できませんでした。お金を送らないでください。',
  verificationFailed:
    '応答の検証に失敗しました。安全のため、承認として扱いません。',
  offline:
    'インターネットに接続できていないため、確認の状態がわかりません。確認できるまで、お金を送らないでください。',
} as const;

/** 標準文言・画面に決して出してはならない表現（ガイド「禁止する文言」より）。 */
export const FORBIDDEN_COPY = [
  '本人確認が完了しました',
  'ご本人です',
  '本人です',
  '安全です',
] as const;

/** 画面固有の文言（wireframes.md とガイドの併記要件より）。 */
export const UI_COPY = {
  appName: 'ZeroKey Family',
  // W-01 ホーム
  createRequestButton: '家族に確認をお願いする',
  helpButton: '困ったとき（緊急停止・相談）',
  recentHeading: '最近の確認',
  // W-02 確認要求の作成
  formNotice: '金額・送金先・理由が空のままでは確認をお願いできません。',
  submitRequestButton: '確認をお願いする',
  // W-03 受信・承認
  incomingHeading: '確認のお願いが届いています',
  incomingQuestion: 'この内容に心当たりがありますか。',
  approveStep1Button: '承認にすすむ',
  approveStep2Button: '同意の署名をして承認する',
  rejectButton: '拒否する',
  callFirstButton: '本人に電話で確かめる',
  // W-04 確認済み
  verifiedHeading: '確認できました',
  verifiedLimitation:
    'これは端末の署名の確認です。少しでも不安があれば、送金の前にもう一度直接話してください。',
  // 署名日時がバックエンドから取得できない場合の表示（偽の時刻を出さない）
  signedAtUnavailable: '取得できません',
  // 確認進行中（collecting / waiting）
  collectingHeading: 'ほかの家族の確認を待っています',
  waitingHeading: '待ち時間中です',
  inProgressCancelNote: 'この間はいつでも取り消せます。',
  refreshStatusButton: '状態を確かめる',
  // 通信断以外の処理失敗（生のエラー文言・JSON を出さない）
  processFailedNotice:
    '処理を完了できませんでした。確認できるまで、お金を送らないでください。',
  // W-05 / W-05b 応答なし・期限切れ
  unansweredHeading: 'まだ確認できていません',
  noResponseFrom: (name: string): string =>
    `${name}さんの端末からの応答がありません。`,
  noResponseUntilDeadline: (name: string): string =>
    `${name}さんの端末から、期限までに応答がありませんでした。`,
  noProofNote: '応答がないことは、相手が本人であることの確認にはなりません。',
  doNotSendMoney: 'お金を送らないでください。',
  urgencyWarning:
    '急かされていませんか。「今すぐ」と言われたら詐欺の可能性があります。',
  policeConsult: '困ったときは警察相談専用電話 #9110 に相談できます。',
  askAnotherFamilyButton: '別の家族に確認する',
  cancelRequestButton: 'このお願いを取り消す',
  waitUntilDeadlineButton: '期限まで待つ',
  retryRequestButton: 'もう一度確認をお願いする',
  expiredHeading: '期限までに確認できませんでした',
  // W-06 拒否・検証失敗
  notConfirmedHeading: '確認できませんでした',
  // W-08 緊急停止
  stopHeading: '困ったとき',
  stopAllButton: 'すべての承認を今すぐ止める',
  stopNoReasonNote: '（理由の入力は不要です）',
  stopConsultButton: '詐欺かもしれない・相談したい',
  stopMistakeButton: 'まちがえて承認してしまった',
  stopReleaseNote: '止めたあとは、家族 2 人の操作がない限り再開されません。',
  stopConfirmMessage: 'すべての承認を今すぐ止めます。よろしいですか。',
  closeButton: '閉じる',
  helpShortButton: '困ったとき',
  backButton: 'もどる',
  // オンボーディング（初回の名前登録）
  onboardingHeading: 'はじめに、お名前を教えてください',
  onboardingNote:
    'この名前は家族の画面に表示されます。あなたの端末でだけ鍵を作り、家族グループも用意します。',
  onboardingNameLabel: 'お名前（必須）',
  onboardingStartButton: 'はじめる',
  // W-07 家族の管理
  familyManageHeading: '家族の管理',
  familyCodeLabel: '家族コード',
  familyMembersHeading: 'この家族のメンバー',
  familyInviteButton: 'この家族に招待する',
  familyInviteCodeLabel: '招待コード',
  familyInviteCodeNote:
    'このコードを、招待したい家族に伝えてください。相手が入力すると同じ家族になります。',
  familyJoinHeading: '別の家族に参加する',
  familyJoinCodeLabel: '招待コード',
  familyJoinButton: 'この家族に参加する',
  familyJoinedNote: '別の家族グループに参加しました。',
  // 参加中の家族の一覧・切り替え
  myCirclesHeading: '参加中の家族',
  myCirclesEmpty: 'まだ参加中の家族がありません。',
  myCirclesActiveLabel: 'いま選んでいる家族です。',
  myCirclesSwitchButton: 'この家族に切り替える',
  myCirclesStoppedNote: 'この家族は今、すべての承認を止めています。',
  // 受信箱
  inboxHeading: '届いた確認',
  inboxEmpty: 'いま確認をお願いされているものはありません。',
  inboxOpenButton: '内容を見て確認する',
  inboxButton: '届いた確認',
  manageFamilyButton: '家族の管理',
  // 宛先 0 人のとき
  noTargetsNote: '先に家族を追加してください。',
  goManageFamilyButton: '家族の管理へ',
} as const;
