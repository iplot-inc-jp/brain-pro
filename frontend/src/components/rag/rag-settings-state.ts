export interface RagSettingsDraft {
  model: string
  systemPrompt: string
}

export interface RagSettingsErrors {
  model?: string
  systemPrompt?: string
}

export function ragSettingsDirty(
  active: RagSettingsDraft,
  draft: RagSettingsDraft,
): boolean {
  return active.model !== draft.model || active.systemPrompt !== draft.systemPrompt
}

export function validateRagSettingsDraft(
  draft: RagSettingsDraft,
  allowedModels: string[],
): RagSettingsErrors {
  const errors: RagSettingsErrors = {}
  if (!allowedModels.includes(draft.model)) {
    errors.model = '許可されたClaudeモデルを選択してください'
  }
  const prompt = draft.systemPrompt.trim()
  if (!prompt) {
    errors.systemPrompt = 'システムプロンプトを入力してください'
  } else if (prompt.length > 20_000) {
    errors.systemPrompt = 'システムプロンプトは20,000文字以内にしてください'
  }
  return errors
}
