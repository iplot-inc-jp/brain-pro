// 全添付の共有アップロード経路。
// Blob token があればブラウザ→Vercel Blob 直アップロード→register（関数を通らず大ファイル可）、
// token 未設定（ローカル等）や失敗時は従来のサーバ経由 multipart 添付（4MB）にフォールバック。
import { upload } from '@vercel/blob/client';
import {
  projectAttachmentApi,
  type ProjectAttachment,
} from '@/lib/project-attachments';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

/** 添付のスコープ（どの対象に紐づけるか）。未指定はプロジェクト直下。 */
export interface UploadScope {
  phaseId?: string;
  taskId?: string;
  flowId?: string;
  informationTypeId?: string;
  folder?: string;
  displayName?: string;
}

function authHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const t =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

/**
 * 1ファイルをアップロードして Attachment を返す（共有プール）。
 * client直（Blob）を試し、token未設定/失敗時はサーバ経由(4MB)にフォールバック。
 * scope を渡すと register でその対象に紐づける（client直経路）。
 *
 * @param serverFallback フォールバック時に使うサーバ経由アップロード。スコープ付き添付の画面は
 *   ここに既存のスコープ付き upload API を渡すこと（フォールバックでもスコープを保つ）。
 *   省略時はプロジェクト直下添付（projectAttachmentApi.upload）。
 */
/**
 * 既存の Blob URL（例: スクリーンショットの blobUrl）を Attachment として登録する。
 * register-blob は blobUrl で冪等なので、同じ画像を複数ノードに付けても Attachment は1つ。
 */
export async function registerBlobAttachment(
  projectId: string,
  input: { blobUrl: string; filename: string; mimeType?: string; size?: number },
): Promise<ProjectAttachment> {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/attachments/register-blob`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        blobUrl: input.blobUrl,
        filename: input.filename,
        mimeType: input.mimeType || 'image/png',
        size: input.size ?? 0,
      }),
    },
  );
  if (!res.ok) throw new Error('スクリーンショットの添付登録に失敗しました');
  return (await res.json()) as ProjectAttachment;
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  scope: UploadScope = {},
  serverFallback?: (projectId: string, file: File) => Promise<unknown>,
): Promise<ProjectAttachment> {
  try {
    // 1) ブラウザ→Blob 直アップロード（token は handleUploadUrl 経由で発行）。
    //    Authorization は handleUpload ルートへ転送される（JwtAuthGuard 配下）。
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: `${API_URL}/api/projects/${projectId}/blob/upload-token`,
      headers: authHeaders(false),
    });
    // 2) register（冪等）で Attachment 作成
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/attachments/register-blob`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          blobUrl: blob.url,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          ...scope,
        }),
      },
    );
    if (!res.ok) throw new Error('register-blob に失敗しました');
    return (await res.json()) as ProjectAttachment;
  } catch {
    // 3) フォールバック: サーバ経由 multipart（4MB）。
    //    token 未設定（{enabled:false}）でも upload() が失敗するためここに来る。
    //    スコープ付き画面は serverFallback で既存スコープ付き API を使い、挙動を不変に保つ。
    const fb = serverFallback ?? projectAttachmentApi.upload;
    return (await fb(projectId, file)) as ProjectAttachment;
  }
}
