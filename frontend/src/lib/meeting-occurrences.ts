// 実会議（MeetingOccurrence）= 会議帯(Meeting)の「1回分の開催実体」の API クライアント。
// 議事録・決定事項・ネクストアクションを持つ。会議帯に紐づく（meetingId）のが基本だが、
// 単発/例外会議は meetingId なしで作れる。画面からの手動追加・ipro-agent の自動投入の両方がこの API を使う。

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function getHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export interface MeetingOccurrence {
  id: string;
  projectId: string;
  meetingId: string | null;
  title: string;
  heldAt: string | null;
  attendees: string | null;
  agenda: string | null;
  minutes: string | null;
  decisions: string | null;
  nextActions: string | null;
  source: string | null;
  sourceRef: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingOccurrenceInput {
  title: string;
  meetingId?: string | null;
  heldAt?: string | null;
  attendees?: string | null;
  agenda?: string | null;
  minutes?: string | null;
  decisions?: string | null;
  nextActions?: string | null;
}

export async function listMeetingOccurrences(
  projectId: string,
  meetingId?: string,
): Promise<MeetingOccurrence[]> {
  const q = meetingId ? `?meetingId=${encodeURIComponent(meetingId)}` : '';
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/meeting-occurrences${q}`,
    { headers: getHeaders() },
  );
  if (!res.ok) throw new Error('実会議の読み込みに失敗しました');
  return res.json();
}

export async function createMeetingOccurrence(
  projectId: string,
  input: MeetingOccurrenceInput,
): Promise<MeetingOccurrence> {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/meeting-occurrences`,
    { method: 'POST', headers: getHeaders(), body: JSON.stringify(input) },
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || '実会議の作成に失敗しました');
  }
  return res.json();
}

export async function updateMeetingOccurrence(
  id: string,
  input: Partial<MeetingOccurrenceInput> & { order?: number },
): Promise<MeetingOccurrence> {
  const res = await fetch(`${API_URL}/api/meeting-occurrences/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || '実会議の更新に失敗しました');
  }
  return res.json();
}

export async function deleteMeetingOccurrence(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/meeting-occurrences/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('実会議の削除に失敗しました');
}
