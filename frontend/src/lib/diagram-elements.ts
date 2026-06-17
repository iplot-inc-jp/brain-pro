const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export type DiagramKind = 'FLOW' | 'DFD' | 'OBJECT_MAP';

export interface DiagramElementDto {
  id: string;
  projectId: string;
  diagramKind: DiagramKind;
  diagramId: string;
  type: 'IMAGE' | 'ICON' | 'TEXT' | 'SHAPE' | 'ARROW';
  positionX: number;
  positionY: number;
  width: number | null;
  height: number | null;
  rotation: number;
  z: number;
  attachmentId: string | null;
  text: string;
  color: string | null;
}

export const diagramElementApi = {
  async list(projectId: string, diagramKind: DiagramKind, diagramId: string): Promise<DiagramElementDto[]> {
    const q = new URLSearchParams({ diagramKind, diagramId });
    const res = await fetch(`${API_URL}/api/projects/${projectId}/diagram-elements?${q}`, { headers: headers() });
    if (!res.ok) throw new Error('図要素の取得に失敗しました');
    return res.json();
  },

  async create(
    projectId: string,
    body: Partial<DiagramElementDto> & { diagramKind: DiagramKind; diagramId: string },
  ): Promise<DiagramElementDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/diagram-elements`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('図要素の作成に失敗しました');
    return res.json();
  },

  async patch(id: string, body: Partial<DiagramElementDto>): Promise<DiagramElementDto> {
    const res = await fetch(`${API_URL}/api/diagram-elements/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('図要素の更新に失敗しました');
    return res.json();
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/diagram-elements/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok && res.status !== 204) throw new Error('図要素の削除に失敗しました');
  },
};
