const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

interface RequestOptions extends RequestInit {
  auth?: boolean
}

export async function api<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { auth = true, headers = {}, ...rest } = options

  const requestHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...headers,
  }

  if (auth) {
    // login/register が保存するキーは 'accessToken'（'token' は誤りで常に未認証になる）
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
    if (token) {
      (requestHeaders as Record<string, string>)['Authorization'] = `Bearer ${token}`
    }
  }

  const response = await fetch(`${API_URL}/api${endpoint}`, {
    headers: requestHeaders,
    ...rest,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `API Error: ${response.status}`)
  }

  return response.json()
}

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api<{
      accessToken: string
      user: { id: string; email: string; name: string | null }
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      auth: false,
    }),
  register: (email: string, password: string, name?: string) =>
    api<{
      accessToken: string
      user: { id: string; email: string; name: string | null }
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
      auth: false,
    }),
  me: () => api<any>('/auth/me'),
}

// Organizations
export const organizationsApi = {
  list: () => api<any[]>('/organizations'),
  get: (id: string) => api<any>(`/organizations/${id}`),
  create: (data: { name: string; slug: string; description?: string }) =>
    api<any>('/organizations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; description?: string }) =>
    api<any>(`/organizations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    api<void>(`/organizations/${id}`, { method: 'DELETE' }),
}

// Projects
export const projectsApi = {
  list: (organizationId: string) =>
    api<any[]>(`/projects?organizationId=${organizationId}`),
  get: (id: string) => api<any>(`/projects/${id}`),
  create: (organizationId: string, data: { name: string; slug: string; description?: string }) =>
    api<any>(`/projects?organizationId=${organizationId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; description?: string }) =>
    api<any>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => api<void>(`/projects/${id}`, { method: 'DELETE' }),
}

// Tables
/** カタログ表（Table）。informationTypeId で情報種別に紐づく。 */
export interface Table {
  id: string
  name: string
  displayName?: string
  description?: string
  /** 紐づく情報種別ID。未指定なら null。 */
  informationTypeId: string | null
  [key: string]: any
}

export const tablesApi = {
  list: (projectId: string) => api<Table[]>(`/tables/project/${projectId}`),
  get: (id: string) => api<Table>(`/tables/${id}`),
  create: (projectId: string, data: { name: string; displayName?: string; description?: string; tags?: string[] }) =>
    api<Table>(`/tables`, {
      method: 'POST',
      body: JSON.stringify({ projectId, ...data }),
    }),
  update: (id: string, data: { name?: string; displayName?: string; description?: string; tags?: string[]; informationTypeId?: string | null; [key: string]: any }) =>
    api<Table>(`/tables/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => api<void>(`/tables/${id}`, { method: 'DELETE' }),
}

// Columns
export const columnsApi = {
  list: (tableId: string) => api<any[]>(`/columns?tableId=${tableId}`),
  get: (id: string) => api<any>(`/columns/${id}`),
  create: (tableId: string, data: any) =>
    api<any>(`/columns?tableId=${tableId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: any) =>
    api<any>(`/columns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => api<void>(`/columns/${id}`, { method: 'DELETE' }),
}

// Roles
/** ロール種別: 人 / システム / その他。 */
export type RoleType = 'HUMAN' | 'SYSTEM' | 'OTHER'

/** ロール（Role）。type=SYSTEM のときは systemId でシステムマスタに紐づく。 */
export interface Role {
  id: string
  projectId: string
  name: string
  type: RoleType
  /** 紐づくシステムID（type=SYSTEM のとき）。未指定なら null。 */
  systemId: string | null
  /** 所属する領域（サブプロジェクト）ID。未指定なら null。 */
  subProjectId: string | null
  description?: string | null
  color?: string | null
  order?: number
  [key: string]: any
}

export const rolesApi = {
  list: (projectId: string) => api<Role[]>(`/roles?projectId=${projectId}`),
  get: (id: string) => api<Role>(`/roles/${id}`),
  create: (
    projectId: string,
    data: {
      name: string
      type?: RoleType
      description?: string
      color?: string
      systemId?: string | null
      subProjectId?: string | null
    },
  ) =>
    api<Role>(`/roles?projectId=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: {
      name?: string
      type?: RoleType
      description?: string
      color?: string
      systemId?: string | null
      subProjectId?: string | null
      [key: string]: any
    },
  ) =>
    api<Role>(`/roles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => api<void>(`/roles/${id}`, { method: 'DELETE' }),
}

// Flows
export const flowsApi = {
  list: (projectId: string) => api<any[]>(`/flows?projectId=${projectId}`),
  get: (id: string) => api<any>(`/flows/${id}`),
  create: (projectId: string, data: { name: string; description?: string }) =>
    api<any>(`/flows?projectId=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: any) =>
    api<any>(`/flows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => api<void>(`/flows/${id}`, { method: 'DELETE' }),
}

// Flow Nodes
export const flowNodesApi = {
  list: (flowId: string) => api<any[]>(`/flow-nodes?flowId=${flowId}`),
  create: (flowId: string, data: any) =>
    api<any>(`/flow-nodes?flowId=${flowId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: any) =>
    api<any>(`/flow-nodes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => api<void>(`/flow-nodes/${id}`, { method: 'DELETE' }),
}

// Flow Edges
export const flowEdgesApi = {
  list: (flowId: string) => api<any[]>(`/flow-edges?flowId=${flowId}`),
  create: (flowId: string, data: any) =>
    api<any>(`/flow-edges?flowId=${flowId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: any) =>
    api<any>(`/flow-edges/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => api<void>(`/flow-edges/${id}`, { method: 'DELETE' }),
}

// ===== 業務フローの矢印 × API 紐づけ =====

/** 矢印に紐づくAPIエンドポイント（FlowEdgeApiLink のレスポンス形）。 */
export type EdgeApiLink = {
  id: string
  apiEndpointId: string
  method: string
  path: string
  summary?: string | null
}

/** コード抽出で登録された API エンドポイント（GET /projects/:projectId/api-endpoints）。 */
export type ApiEndpointItem = {
  id: string
  projectId: string
  method: string
  path: string
  summary?: string | null
  sourceFile?: string | null
}

/** 矢印に紐づくAPIエンドポイントを全置換する（PUT /flow-edges/:id/api-links）。 */
export const updateEdgeApiLinks = (edgeId: string, apiEndpointIds: string[]) =>
  api<EdgeApiLink[]>(`/flow-edges/${edgeId}/api-links`, {
    method: 'PUT',
    body: JSON.stringify({ apiEndpointIds }),
  })

/** プロジェクトのAPIエンドポイント一覧を取得する（GET /projects/:projectId/api-endpoints）。 */
export const listApiEndpoints = (projectId: string) =>
  api<ApiEndpointItem[]>(`/projects/${projectId}/api-endpoints`)

// Export
export const exportApi = {
  flowMermaid: (flowId: string) => api<{ mermaid: string }>(`/export/flow/${flowId}/mermaid`),
  projectMermaid: (projectId: string) => api<any>(`/export/project/${projectId}/mermaid`),
  projectAi: (projectId: string) => api<any>(`/export/project/${projectId}/ai`),
}

