import { classifyDriveFetchError } from './drive-error';

describe('classifyDriveFetchError', () => {
  it('接続が無い → unlinked（連携を促す）', () => {
    const r = classifyDriveFetchError(
      'このプロジェクトには Google Drive 接続がありません',
    );
    expect(r.kind).toBe('unlinked');
    expect(r.userMessage).toContain('連携');
  });

  it('access_token 更新失敗 → unlinked（再連携を促す）', () => {
    const r = classifyDriveFetchError(
      'Google access_token の更新に失敗しました（400）: invalid_grant',
    );
    expect(r.kind).toBe('unlinked');
  });

  it('サーバー未構成 → unconfigured', () => {
    const r = classifyDriveFetchError(
      'Google Drive 連携が未構成です（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI を設定してください）',
    );
    expect(r.kind).toBe('unconfigured');
  });

  it('files.get 404 → forbidden（共有設定を促す）', () => {
    const r = classifyDriveFetchError(
      'Drive files.get(meta) に失敗しました（404）: File not found',
    );
    expect(r.kind).toBe('forbidden');
    expect(r.userMessage).toContain('共有');
  });

  it('files.get media 403 → forbidden', () => {
    const r = classifyDriveFetchError(
      'Drive files.get(media) に失敗しました（403）: insufficientPermissions',
    );
    expect(r.kind).toBe('forbidden');
  });

  it('未知のエラー → unknown（原文を残す）', () => {
    const r = classifyDriveFetchError('something unexpected happened');
    expect(r.kind).toBe('unknown');
    expect(r.userMessage).toContain('something unexpected happened');
  });

  it('空文字でも落ちない', () => {
    const r = classifyDriveFetchError('');
    expect(r.kind).toBe('unknown');
  });
});
