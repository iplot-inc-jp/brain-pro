const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export type DiagramNodeKind = 'FLOW_NODE' | 'DFD_NODE' | 'DATA_OBJECT' | 'FLOW_EDGE';

export interface AttachmentMeta {
  id: string;
  filename: string;
  displayName: string | null;
  mimeType: string;
  kind: 'IMAGE' | 'PDF' | 'FILE';
  size: number;
  url: string;
  pageRange: string | null;
}

export interface NodeAttachmentDto {
  id: string;
  projectId: string;
  nodeKind: DiagramNodeKind;
  nodeId: string;
  attachmentId: string;
  order: number;
  caption: string | null;
  attachment: AttachmentMeta | null;
}

export const nodeAttachmentApi = {
  fileUrl(attachmentId: string): string {
    return `${API_URL}/api/attachments/${attachmentId}/file`;
  },

  async list(projectId: string, nodeKind: DiagramNodeKind, nodeId: string): Promise<NodeAttachmentDto[]> {
    const q = new URLSearchParams({ nodeKind, nodeId });
    const res = await fetch(`${API_URL}/api/projects/${projectId}/node-attachments?${q}`, { headers: headers() });
    if (!res.ok) throw new Error('ノード添付の取得に失敗しました');
    return res.json();
  },

  async create(
    projectId: string,
    body: { nodeKind: DiagramNodeKind; nodeId: string; attachmentId: string; caption?: string },
  ): Promise<NodeAttachmentDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/node-attachments`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('ノード添付の作成に失敗しました');
    return res.json();
  },

  async patch(id: string, body: { order?: number; caption?: string }): Promise<NodeAttachmentDto> {
    const res = await fetch(`${API_URL}/api/node-attachments/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('ノード添付の更新に失敗しました');
    return res.json();
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/node-attachments/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok && res.status !== 204) throw new Error('ノード添付の削除に失敗しました');
  },

  async extractDocument(documentId: string): Promise<{ created: { nodes: number; mentions: number } }> {
    const res = await fetch(`${API_URL}/api/knowledge-documents/${documentId}/extract`, {
      method: 'POST',
      headers: headers(),
    });
    if (!res.ok) throw new Error('AI抽出に失敗しました');
    return res.json();
  },
};
