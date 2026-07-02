/**
 * DriveService.downloadFile / accessTokenFor が投げる生のエラーメッセージを、
 * ユーザー向けの「具体的な原因＋次の一手」に分類する純粋関数。
 *
 * 取り込みコントローラは従来 catch でこれらを握りつぶし
 * 「Drive 連携と共有設定を確認してください」という汎用文だけを返していたため、
 * ユーザーは未連携なのか共有漏れなのか判別できなかった。ここで分類して具体化する。
 */
export type DriveFetchErrorKind =
  | 'unlinked' // プロジェクトが未連携 / トークン失効 → 連携（再連携）が必要
  | 'unconfigured' // サーバー側 env 未設定 → 管理者対応
  | 'forbidden' // ファイルにアクセス不可（未共有 / 不在）→ 共有設定
  | 'unknown'; // それ以外

export interface DriveFetchErrorInfo {
  kind: DriveFetchErrorKind;
  /** ユーザー向けの具体的・実行可能なメッセージ。 */
  userMessage: string;
}

export function classifyDriveFetchError(rawMessage: string): DriveFetchErrorInfo {
  const m = rawMessage ?? '';

  // 未連携 / トークン失効（再連携で解決）。
  if (/接続がありません|access_token/.test(m)) {
    return {
      kind: 'unlinked',
      userMessage:
        'このプロジェクトはまだ Google Drive と連携していない（または連携の有効期限が切れた）可能性があります。ドキュメント上部の「Google Driveと連携」から接続し直してください。',
    };
  }

  // サーバー側の構成不足。
  if (/未構成/.test(m)) {
    return {
      kind: 'unconfigured',
      userMessage:
        'サーバー側で Google Drive 連携が未構成です（GOOGLE_CLIENT_ID などの設定が必要）。管理者にお問い合わせください。',
    };
  }

  // GCP プロジェクト側で API が無効（Docs/Sheets API 未有効化）。403 だが共有設定の問題ではない。
  if (/SERVICE_DISABLED|accessNotConfigured|has not been used in project/i.test(m)) {
    return {
      kind: 'unconfigured',
      userMessage:
        'サーバー側の Google Cloud プロジェクトで必要な API（Google Docs API / Google Sheets API）が有効化されていません。管理者にお問い合わせください。',
    };
  }

  // ファイルにアクセスできない（未共有 / 権限不足 / 不在）。
  if (/files\.get|（401）|（403）|（404）|not found|forbidden|permission/i.test(m)) {
    return {
      kind: 'forbidden',
      userMessage:
        '対象ファイルにアクセスできませんでした。連携した Google アカウントにそのファイルが共有されているか（少なくとも閲覧権限があるか）をご確認ください。',
    };
  }

  return {
    kind: 'unknown',
    userMessage: `Google Drive からの取得に失敗しました（${m || '不明なエラー'}）。`,
  };
}
