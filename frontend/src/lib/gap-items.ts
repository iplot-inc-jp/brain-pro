// GAP item 作成ヘルパー。
// 旧 _lib/use-record-sheet.ts から RecordSheet 廃止に伴い移設（分析結果→打ち手 の起票で使用）。

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function getHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/** GAP item（ピッカー等の一覧表示に必要な最小情報）。 */
export interface GapItemLite {
  id: string;
  businessArea: string;
  gapDescription: string | null;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: string;
  outOfScope: boolean;
}

/** プロジェクトの GAP 一覧を取得する。失敗時は空配列（ピッカーは黙って空表示）。 */
export async function listGapItems(projectId: string): Promise<GapItemLite[]> {
  try {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/gap-items`, {
      headers: getHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as GapItemLite[]) : [];
  } catch (err) {
    console.error('Failed to list gap items:', err);
    return [];
  }
}

/** GAP item を既存の作成APIで起票する（分析結果→打ち手）。 */
export async function createGapItem(
  projectId: string,
  body: {
    businessArea: string;
    asisDescription?: string;
    tobeDescription?: string;
    gapDescription?: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    ownerName?: string;
  },
): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/gap-items`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to create gap item:', err);
    return false;
  }
}
