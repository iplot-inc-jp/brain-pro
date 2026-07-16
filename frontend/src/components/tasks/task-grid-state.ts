export type TaskGridColumnId =
  | 'status'
  | 'priority'
  | 'title'
  | 'assignee'
  | 'dueDate'
  | 'progress'
  | 'issueType'
  | 'epic'
  | 'storyPoints'
  | 'sprint'
  | 'actions'

export type TaskGridColumnSpec = {
  id: TaskGridColumnId
  label: string
  size: number
  minSize: number
  maxSize: number
  enableResizing: boolean
}

export const TASK_GRID_COLUMNS: readonly TaskGridColumnSpec[] = [
  { id: 'status', label: '状態', size: 120, minSize: 104, maxSize: 180, enableResizing: true },
  { id: 'priority', label: '優先度', size: 100, minSize: 84, maxSize: 160, enableResizing: true },
  { id: 'title', label: 'タイトル', size: 360, minSize: 220, maxSize: 720, enableResizing: true },
  { id: 'assignee', label: '担当', size: 160, minSize: 110, maxSize: 260, enableResizing: true },
  { id: 'dueDate', label: '期限', size: 120, minSize: 104, maxSize: 180, enableResizing: true },
  { id: 'progress', label: '進捗', size: 150, minSize: 120, maxSize: 220, enableResizing: true },
  { id: 'issueType', label: '種別', size: 100, minSize: 84, maxSize: 160, enableResizing: true },
  { id: 'epic', label: 'エピック', size: 180, minSize: 120, maxSize: 320, enableResizing: true },
  { id: 'storyPoints', label: 'SP', size: 80, minSize: 64, maxSize: 120, enableResizing: true },
  { id: 'sprint', label: 'スプリント', size: 140, minSize: 104, maxSize: 240, enableResizing: true },
  { id: 'actions', label: '操作', size: 110, minSize: 110, maxSize: 110, enableResizing: false },
] as const

export function isTextOverflowing(element: Pick<HTMLElement, 'clientWidth' | 'scrollWidth'>): boolean {
  return element.scrollWidth > element.clientWidth
}
