import { describe, expect, it } from 'bun:test';
import { ApiError } from './api';
import { STANDARD_COPY } from './copy';
import { noticeForError } from './notices';

describe('エラーからユーザー向け文言への変換', () => {
  it('respond の 422（検証失敗・失効端末）には検証失敗の標準文言を表示する', () => {
    const error = new ApiError(
      422,
      '{"error":"signature_verification_failed","status":"verification_failed"}'
    );
    expect(noticeForError(error)).toBe(STANDARD_COPY.verificationFailed);
  });

  it('通信失敗（fetch の TypeError）には通信断の標準文言を表示する', () => {
    expect(noticeForError(new TypeError('fetch failed'))).toBe(
      STANDARD_COPY.offline
    );
  });

  it('その他の API エラーで生の JSON・技術文言をユーザーに見せない', () => {
    const error = new ApiError(400, '{"error":"amount_required"}');
    const notice = noticeForError(error);
    expect(notice).not.toContain('amount_required');
    expect(notice).not.toContain('API エラー');
    expect(notice).not.toContain('{');
    expect(notice).not.toContain('status');
  });

  it('その他の API エラーでも行動の指示（お金を送らない）を曖昧にしない', () => {
    const notice = noticeForError(new ApiError(500, 'internal'));
    expect(notice).toContain('お金を送らないでください');
  });

  it('想定外の例外でも生のメッセージを表示しない', () => {
    const notice = noticeForError(new Error('ECONNRESET at socket.js:120'));
    expect(notice).not.toContain('ECONNRESET');
    expect(notice).toContain('お金を送らないでください');
  });
});
