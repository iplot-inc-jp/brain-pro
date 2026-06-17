// 業務イメージ（スライド）ボード API クライアント。
// キャンバスは Excalidraw を埋め込み、ボード単位で scene(JSON) を保存する。
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export type ImageBoardKind = 'ASIS' | 'TOBE';

/** Excalidraw シーン（{ elements, appState, files }）。中身は緩く扱う。 */
export type ImageBoardScene = {
  elements?: readonly unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
} | null;

/** 一覧用の軽量サマリ（scene を含まない）。 */
export interface ImageBoardSummary {
  id: string;
  projectId: string;
  kind: ImageBoardKind;
  /** 領域（SubProject）ID。null=未分類。 */
  subProjectId: string | null;
  title: string;
  order: number;
  updatedAt: string;
}

/** 単一ボード（scene 込み）。 */
export interface ImageBoardDto {
  id: string;
  projectId: string;
  kind: ImageBoardKind;
  subProjectId: string | null;
  title: string;
  order: number;
  scene: ImageBoardScene;
  createdAt: string;
  updatedAt: string;
}

export const imageBoardApi = {
  /** プロジェクトの全ボード一覧（領域別はフロントでグルーピング）。 */
  async list(projectId: string): Promise<ImageBoardSummary[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/image-boards`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error('ボード一覧の取得に失敗しました');
    return res.json();
  },

  /** ボード新規作成（subProjectId=領域。null/未指定=未分類）。 */
  async create(
    projectId: string,
    body: { title?: string; subProjectId?: string | null; order?: number },
  ): Promise<ImageBoardDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/image-boards`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('ボードの作成に失敗しました');
    return res.json();
  },

  /** ボード取得（scene 込み）。 */
  async get(boardId: string): Promise<ImageBoardDto> {
    const res = await fetch(`${API_URL}/api/image-boards/${boardId}`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error('ボードの取得に失敗しました');
    return res.json();
  },

  /** ボード更新（title/subProjectId/order/scene）。scene 保存はここを debounce して呼ぶ。subProjectId=null で未分類へ。 */
  async update(
    boardId: string,
    patch: {
      title?: string;
      subProjectId?: string | null;
      order?: number;
      scene?: ImageBoardScene;
    },
  ): Promise<ImageBoardDto> {
    const res = await fetch(`${API_URL}/api/image-boards/${boardId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('ボードの保存に失敗しました');
    return res.json();
  },

  /** ボード削除。 */
  async remove(boardId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/image-boards/${boardId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!res.ok && res.status !== 204) throw new Error('ボードの削除に失敗しました');
  },
};
