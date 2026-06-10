/** 確認要求フォームの必須項目（金額・送金先・理由）の入力値。 */
export interface RequestFormInput {
  amount: string;
  beneficiary: string;
  reason: string;
}

/**
 * 金額・送金先・理由がすべて入力されているかを判定する。
 * 1 つでも欠けていれば送信ボタンを無効化する（W-02）。
 * サーバー側でも同じ必須判定を行うため、これはあくまで UI の補助である。
 */
export function validateRequestForm(input: RequestFormInput): boolean {
  const amount = Number(input.amount);
  return (
    input.amount.trim() !== '' &&
    Number.isFinite(amount) &&
    amount > 0 &&
    input.beneficiary.trim() !== '' &&
    input.reason.trim() !== ''
  );
}
