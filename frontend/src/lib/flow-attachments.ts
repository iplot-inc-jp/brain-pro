const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

/** 業務フローに紐づく添付ファイル（Attachment.flowId） */
export interface FlowAttachment {
  id: string;
  projectId: string;
  flowId: string | null;
  kind: 'IMAGE' | 'PDF' | 'FILE';
  filename: string;
  mimeType: string;
  url: string;
  size: number;
  pageRange: string | null;
  caption: string | null;
  order: number;
  createdAt: string;
}

function authHeader(): Record<string, string> {
  const h: Record<string, string> = {};
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export const flowAttachmentApi = {
  /** GET /api/business-flows/:flowId/attachments */
  async list(flowId: string): Promise<FlowAttachment[]> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/attachments`, {
      headers: authHeader(),
    });
    if (!res.ok) throw new Error('添付ファイル一覧の取得に失敗しました');
    return res.json();
  },

  /** POST /api/business-flows/:flowId/attachments （multipart, field 名 'file'） */
  async upload(flowId: string, file: File): Promise<FlowAttachment> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/attachments`, {
      method: 'POST',
      headers: authHeader(),
      body: form,
    });
    if (!res.ok) throw new Error('添付ファイルのアップロードに失敗しました');
    return res.json();
  },

  /** DELETE /api/attachments/:id */
  async remove(attachmentId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/attachments/${attachmentId}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    if (!res.ok) throw new Error('添付ファイルの削除に失敗しました');
  },

  /** 添付ファイル実体の配信 URL（認証不要） */
  fileUrl(attachmentId: string): string {
    return `${API_URL}/api/attachments/${attachmentId}/file`;
  },
};
