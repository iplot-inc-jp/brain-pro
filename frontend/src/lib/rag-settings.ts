const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

export interface RagPromptVersion {
  id: string
  projectId: string
  version: number
  model: string
  systemPrompt: string
  isActive: boolean
  createdById: string | null
  createdBy?: { id: string; name: string; email: string } | null
  createdAt: string
}

export interface RagSettingsResponse {
  active: RagPromptVersion
  history: RagPromptVersion[]
  defaults: { model: string; systemPrompt: string }
  allowedModels: string[]
}

export interface UpdateRagSettingsInput {
  model: string
  systemPrompt: string
}

function headers(): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (token) result.Authorization = `Bearer ${token}`
  return result
}

async function read<T>(response: Response, fallback: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>
  let message = fallback
  try {
    const body = await response.json()
    if (body?.message) message = Array.isArray(body.message) ? body.message.join(' / ') : body.message
  } catch {
    // JSONでないエラーではfallbackを表示する。
  }
  throw new Error(message)
}

export async function getRagSettings(projectId: string): Promise<RagSettingsResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/rag/settings`, {
    headers: headers(),
  })
  return read(response, 'RAG設定を取得できませんでした')
}

export async function updateRagSettings(
  projectId: string,
  input: UpdateRagSettingsInput,
): Promise<RagPromptVersion> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/rag/settings`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(input),
  })
  return read(response, 'RAG設定を保存できませんでした')
}

export async function resetRagSettings(projectId: string): Promise<RagPromptVersion> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/rag/settings/reset`, {
    method: 'POST',
    headers: headers(),
  })
  return read(response, 'RAG設定を既定値へ戻せませんでした')
}
