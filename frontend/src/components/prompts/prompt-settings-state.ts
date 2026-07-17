export interface PromptSettingsDraft {
  model: string
  systemPrompt: string
}

export interface PromptSettingsErrors {
  model?: string
  systemPrompt?: string
}

export function promptSettingsDirty(
  active: PromptSettingsDraft,
  draft: PromptSettingsDraft,
): boolean {
  return active.model !== draft.model || active.systemPrompt !== draft.systemPrompt
}

export function validatePromptSettingsDraft(
  draft: PromptSettingsDraft,
  allowedModels: string[],
  maxLength = 20_000,
  // 環境変数で許可リスト外の既定モデルを使う運用では、現行モデルの維持を許す
  currentModel?: string,
): PromptSettingsErrors {
  const errors: PromptSettingsErrors = {}
  if (!allowedModels.includes(draft.model) && draft.model !== currentModel) {
    errors.model = '許可されたClaudeモデルを選択してください'
  }
  const prompt = draft.systemPrompt.trim()
  if (!prompt) {
    errors.systemPrompt = 'システムプロンプトを入力してください'
  } else if (prompt.length > maxLength) {
    errors.systemPrompt = `システムプロンプトは${maxLength.toLocaleString()}文字以内にしてください`
  }
  return errors
}
