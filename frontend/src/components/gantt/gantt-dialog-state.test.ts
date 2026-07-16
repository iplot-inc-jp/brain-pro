import { describe, expect, it } from 'vitest'

import { isGanttTaskDialogOpen } from './gantt-dialog-state'

describe('isGanttTaskDialogOpen', () => {
  it('選択中のタスクがある場合だけ編集モーダルを開く', () => {
    expect(isGanttTaskDialogOpen('task-1')).toBe(true)
    expect(isGanttTaskDialogOpen(null)).toBe(false)
  })
})
