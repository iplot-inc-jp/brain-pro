const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

export const RAG_FEATURE_TYPES = [
  'BUSINESS_FLOW',
  'REQUIREMENT',
  'ISSUE_TREE',
  'TASK',
  'STAKEHOLDER',
  'RISK',
  'KPI',
  'SYSTEM',
  'DATA_CATALOG',
  'MEETING',
] as const

export type RagFeatureType = (typeof RAG_FEATURE_TYPES)[number]
export type RagScopeLevel = 'OVERVIEW' | 'COMPONENT'
export type RagIndexState = 'UNGENERATED' | 'FRESH' | 'STALE'

export const RAG_FEATURE_LABELS: Record<RagFeatureType, string> = {
  BUSINESS_FLOW: '業務フロー',
  REQUIREMENT: '要件',
  ISSUE_TREE: 'イシューツリー',
  TASK: 'タスク',
  STAKEHOLDER: 'ステークホルダー',
  RISK: 'リスク',
  KPI: 'KPI',
  SYSTEM: 'システム',
  DATA_CATALOG: 'データカタログ／オブジェクト',
  MEETING: '会議・議事録',
}

export interface RagRouteResolution {
  supported: boolean
  label: string
  featureType?: RagFeatureType
  targetId?: string
}

export interface RagStatus {
  state: RagIndexState
  documentCount: number
  generatedAt: string | null
  model: string | null
  overviewSummary: string | null
  sourceHash: string | null
}

export interface RagDocument {
  id: string
  projectId: string
  featureType: RagFeatureType
  scopeLevel: RagScopeLevel
  sourceKey: string
  sourceUrl: string
  title: string
  summary: string
  content: string
  keywords: string[]
  aliases: string[]
  questions: string[]
  metadata: Record<string, unknown>
  generatedAt: string
  score?: number
}

export interface RagSearchInput {
  q?: string
  featureType?: RagFeatureType
  scopeLevel?: RagScopeLevel
  limit?: number
}

const supported = (
  featureType: RagFeatureType,
  targetId?: string,
): RagRouteResolution => ({
  supported: true,
  featureType,
  targetId,
  label: RAG_FEATURE_LABELS[featureType],
})

export function resolveRagRoute(
  pathname: string,
  projectId: string,
): RagRouteResolution | null {
  const base = `/dashboard/projects/${projectId}`
  if (!pathname.startsWith(base)) return null
  const relative = pathname.slice(base.length).replace(/\/+$/, '') || '/'
  if (relative === '/rag' || relative.startsWith('/rag/')) return null

  const flow = relative.match(/^\/flows\/([^/]+)$/)
  if (flow && !['folders', 'compare', 'hierarchy'].includes(flow[1])) {
    return supported('BUSINESS_FLOW', flow[1])
  }
  if (
    relative === '/flows' ||
    relative.startsWith('/flows/') ||
    relative === '/business-list' ||
    relative === '/business-definition'
  ) return supported('BUSINESS_FLOW')

  if (relative.startsWith('/requirements')) return supported('REQUIREMENT')
  const issueTree = relative.match(/^\/issue-trees\/([^/]+)$/)
  if (issueTree) return supported('ISSUE_TREE', issueTree[1])
  if (relative.startsWith('/issue-trees')) return supported('ISSUE_TREE')
  if (relative.startsWith('/tasks')) return supported('TASK')
  if (relative.startsWith('/stakeholder-management')) return supported('STAKEHOLDER')
  if (relative.startsWith('/risk-management')) return supported('RISK')
  if (relative.startsWith('/business-kpi') || relative.startsWith('/ai-accuracy')) {
    return supported('KPI')
  }
  if (relative.startsWith('/systems')) return supported('SYSTEM')
  if (
    relative.startsWith('/catalog') ||
    relative.startsWith('/object-map') ||
    relative.startsWith('/er-diagram')
  ) return supported('DATA_CATALOG')
  if (
    relative.startsWith('/meetings') ||
    relative.startsWith('/meeting-occurrences') ||
    relative.startsWith('/meeting-documents')
  ) return supported('MEETING')

  return { supported: false, label: 'この機能' }
}

function headers(): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (token) result.Authorization = `Bearer ${token}`
  return result
}

async function read<T>(res: Response, fallback: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>
  let message = fallback
  try {
    const body = await res.json()
    if (body?.message) message = Array.isArray(body.message) ? body.message.join(' / ') : body.message
  } catch {
    // JSONでないエラーはfallbackを使う。
  }
  throw new Error(message)
}

export async function generateRagIndex(
  projectId: string,
  featureType: RagFeatureType,
  targetId?: string,
): Promise<{ jobId: string; status: string }> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/rag/generate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ featureType, ...(targetId ? { targetId } : {}) }),
  })
  return read(res, 'RAG概要の生成を開始できませんでした')
}

export async function getRagStatus(
  projectId: string,
  featureType: RagFeatureType,
  targetId?: string,
): Promise<RagStatus> {
  const query = new URLSearchParams({ featureType })
  if (targetId) query.set('targetId', targetId)
  const res = await fetch(`${API_URL}/api/projects/${projectId}/rag/status?${query}`, {
    headers: headers(),
  })
  return read(res, 'RAG概要の状態を取得できませんでした')
}

function searchParams(input: RagSearchInput): URLSearchParams {
  const query = new URLSearchParams()
  if (input.q) query.set('q', input.q)
  if (input.featureType) query.set('featureType', input.featureType)
  if (input.scopeLevel) query.set('scopeLevel', input.scopeLevel)
  if (input.limit) query.set('limit', String(input.limit))
  return query
}

export async function listRagDocuments(
  projectId: string,
  input: Omit<RagSearchInput, 'q'> = {},
): Promise<RagDocument[]> {
  const query = searchParams(input)
  const suffix = query.size ? `?${query}` : ''
  const res = await fetch(`${API_URL}/api/projects/${projectId}/rag/documents${suffix}`, {
    headers: headers(),
  })
  return read(res, 'RAG索引を取得できませんでした')
}

export async function searchRagDocuments(
  projectId: string,
  input: RagSearchInput,
): Promise<RagDocument[]> {
  const query = searchParams(input)
  const res = await fetch(`${API_URL}/api/projects/${projectId}/rag/search?${query}`, {
    headers: headers(),
  })
  return read(res, 'RAG索引を検索できませんでした')
}
