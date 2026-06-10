/**
 * 例外からユーザー向け通知文言への変換。
 *
 * 文言の正本は docs/product/safety-copy-guide.md。生のエラーメッセージ
 * （技術文言・JSON）をユーザーに見せない。
 */

import { ApiError } from './api';
import { STANDARD_COPY, UI_COPY } from './copy';

/** 例外を安全文言ガイドに沿ったユーザー向け文言へ変換する。 */
export function noticeForError(error: unknown): string {
  if (error instanceof ApiError) {
    // respond の 422 は検証失敗・失効端末。承認として扱わないことを伝える。
    if (error.status === 422) {
      return STANDARD_COPY.verificationFailed;
    }
    return UI_COPY.processFailedNotice;
  }
  if (error instanceof TypeError) {
    // fetch のネットワーク失敗（通信断）。
    return STANDARD_COPY.offline;
  }
  return UI_COPY.processFailedNotice;
}
