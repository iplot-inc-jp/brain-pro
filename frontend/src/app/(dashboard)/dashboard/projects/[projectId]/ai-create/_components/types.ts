// AI作成（KPI）ページ内で共有する補助型。
// 業務フロー・ロールは専用 lib クライアントが無いため、ASIS/ロールページと同じ
// 生 fetch（accessToken ヘッダ）で取得する。取得処理は page.tsx に集約する。

/** 業務フロー（ASIS/TOBE）の一覧アイテム。GET /api/business-flows/project/:projectId/all */
export interface BusinessFlowItem {
  id: string;
  name: string;
  kind: 'ASIS' | 'TOBE';
  subProjectId?: string | null;
  description?: string | null;
}

/** ロール一覧アイテム。GET /api/roles/project/:projectId */
export interface RoleItem {
  id: string;
  name: string;
  type: string;
}
