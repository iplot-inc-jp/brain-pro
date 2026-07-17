const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

export interface PromptVariable {
  name: string
  description: string
}

export interface PromptSummary {
  key: string
  label: string
  description: string
  category: string
  variables: PromptVariable[]
  model: string
  version: number | null
  updatedAt: string | null
  customized: boolean
}

export interface PromptListResponse {
  prompts: PromptSummary[]
  allowedModels: string[]
}

export interface PromptVersion {
  id: string
  projectId: string
  key: string
  version: number
  model: string
  systemPrompt: string
  isActive: boolean
  createdById: string | null
  createdBy?: { id: string; name: string; email: string } | null
  createdAt: string
}

export interface PromptDefinitionInfo {
  key: string
  label: string
  description: string
  category: string
  variables: PromptVariable[]
}

export interface PromptSettingsResponse {
  definition: PromptDefinitionInfo
  active: PromptVersion
  history: PromptVersion[]
  defaults: { model: string; systemPrompt: string }
  allowedModels: string[]
  maxLength: number
}

export interface UpdatePromptSettingsInput {
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

export async function getPromptList(projectId: string): Promise<PromptListResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/prompts`, {
    headers: headers(),
  })
  return read(response, 'プロンプト一覧を取得できませんでした')
}

export async function getPromptSettings(
  projectId: string,
  key: string,
): Promise<PromptSettingsResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/prompts/${key}`, {
    headers: headers(),
  })
  return read(response, 'プロンプト設定を取得できませんでした')
}

export async function updatePromptSettings(
  projectId: string,
  key: string,
  input: UpdatePromptSettingsInput,
): Promise<PromptVersion> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/prompts/${key}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(input),
  })
  return read(response, 'プロンプト設定を保存できませんでした')
}

export async function resetPromptSettings(
  projectId: string,
  key: string,
): Promise<PromptVersion> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/prompts/${key}/reset`, {
    method: 'POST',
    headers: headers(),
  })
  return read(response, 'プロンプト設定を既定値へ戻せませんでした')
}
