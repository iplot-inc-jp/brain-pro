export type RagActionState =
  | 'LOADING'
  | 'UNGENERATED'
  | 'RUNNING'
  | 'FRESH'
  | 'STALE'
  | 'FAILED'

export type RagActionTone =
  | 'neutral'
  | 'running'
  | 'fresh'
  | 'stale'
  | 'error'
  | 'unsupported'

export function ragActionPresentation(input: {
  supported: boolean
  state: RagActionState
  canEdit?: boolean
}): { label: string; tone: RagActionTone; disabled: boolean } {
  if (!input.supported) {
    return { label: 'RAG概要 未対応', tone: 'unsupported', disabled: true }
  }
  const canEdit = input.canEdit ?? true
  if (input.state === 'RUNNING' || input.state === 'LOADING') {
    return {
      label: input.state === 'RUNNING' ? 'RAG概要を作成中' : 'RAG概要を確認中',
      tone: 'running',
      disabled: true,
    }
  }
  if (input.state === 'FRESH') {
    return { label: 'RAG概要 作成済み', tone: 'fresh', disabled: !canEdit }
  }
  if (input.state === 'STALE') {
    return { label: 'RAG概要 要更新', tone: 'stale', disabled: !canEdit }
  }
  if (input.state === 'FAILED') {
    return { label: 'RAG概要 生成失敗', tone: 'error', disabled: !canEdit }
  }
  return { label: 'RAG用の概要を作る', tone: 'neutral', disabled: !canEdit }
}
