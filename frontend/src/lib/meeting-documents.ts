// ミーティングドキュメント API クライアント（会議ごとに複数）。
// INTERNAL の本文は Liveblocks(Yjs) ルーム roomId が真実源（DBには本文を持たない）。
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export type MeetingDocumentKind = 'INTERNAL' | 'GOOGLE_DOC';

export interface MeetingDocument {
  id: string;
  projectId: string;
  meetingId: string;
  kind: MeetingDocumentKind;
  title: string;
  googleDocUrl: string | null;
  order: number;
  /** Liveblocks ルームID（INTERNAL の共同編集本文はこのルームの Yjs が真実源）。 */
  roomId: string;
  /** GOOGLE_DOC を Drive 連携経由で取り込んだ本文スナップショットのメタ。 */
  hasFetchedContent?: boolean;
  fetchedTitle?: string | null;
  fetchedMime?: string | null;
  fetchedAt?: string | null;
  /** 単体取得（get）/取り込み（fetchGoogle）時のみ本文を含む。 */
  fetchedContent?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const meetingDocumentApi = {
  /** プロジェクトの全ドキュメント一覧（会議別はフロントでグルーピング）。 */
  async list(projectId: string, meetingId?: string): Promise<MeetingDocument[]> {
    const qs = meetingId ? `?meetingId=${meetingId}` : '';
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/meeting-documents${qs}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error('ミーティングドキュメントの取得に失敗しました');
    return res.json();
  },

  /** 新規作成（会議に紐づける）。 */
  async create(
    projectId: string,
    body: {
      meetingId: string;
      kind?: MeetingDocumentKind;
      title?: string;
      googleDocUrl?: string | null;
    },
  ): Promise<MeetingDocument> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/meeting-documents`,
      { method: 'POST', headers: headers(), body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error('ドキュメントの作成に失敗しました');
    return res.json();
  },

  async get(id: string): Promise<MeetingDocument> {
    const res = await fetch(`${API_URL}/api/meeting-documents/${id}`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error('ドキュメントの取得に失敗しました');
    return res.json();
  },

  /** 更新（title/googleDocUrl/meetingId/order）。 */
  async update(
    id: string,
    patch: {
      title?: string;
      googleDocUrl?: string | null;
      meetingId?: string;
      order?: number;
    },
  ): Promise<MeetingDocument> {
    const res = await fetch(`${API_URL}/api/meeting-documents/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('ドキュメントの保存に失敗しました');
    return res.json();
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/meeting-documents/${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!res.ok && res.status !== 204) {
      throw new Error('ドキュメントの削除に失敗しました');
    }
  },

  /**
   * GOOGLE_DOC の本文を Drive 連携経由で取得し DB に保存（fetchedContent）。
   * 要: プロジェクトの Drive 連携 + 対象ファイルの共有設定。
   */
  async fetchGoogle(id: string): Promise<MeetingDocument> {
    const res = await fetch(`${API_URL}/api/meeting-documents/${id}/fetch`, {
      method: 'POST',
      headers: headers(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(
        (data && (Array.isArray(data.message) ? data.message.join(' / ') : data.message)) ||
          'Google ドキュメント本文の取り込みに失敗しました',
      );
    }
    return res.json();
  },
};
