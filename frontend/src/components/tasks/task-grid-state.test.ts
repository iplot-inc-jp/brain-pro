import { describe, expect, it } from 'vitest'

import {
  TASK_GRID_COLUMNS,
  isTextOverflowing,
  taskGridAriaSort,
} from './task-grid-state'

describe('isTextOverflowing', () => {
  it('横幅を超えた文字だけを省略扱いにする', () => {
    expect(isTextOverflowing({ clientWidth: 120, scrollWidth: 121 })).toBe(true)
    expect(isTextOverflowing({ clientWidth: 120, scrollWidth: 120 })).toBe(false)
    expect(isTextOverflowing({ clientWidth: 120, scrollWidth: 80 })).toBe(false)
  })
})

describe('TASK_GRID_COLUMNS', () => {
  it('Excel風グリッドの列順と初期幅を固定する', () => {
    expect(TASK_GRID_COLUMNS.map((column) => column.id)).toEqual([
      'status',
      'priority',
      'title',
      'assignee',
      'dueDate',
      'progress',
      'issueType',
      'epic',
      'storyPoints',
      'sprint',
      'actions',
    ])
    expect(TASK_GRID_COLUMNS.find((column) => column.id === 'title')).toMatchObject({
      size: 360,
      minSize: 220,
      enableResizing: true,
    })
    expect(TASK_GRID_COLUMNS.at(-1)).toMatchObject({
      id: 'actions',
      enableResizing: false,
    })
  })

  it('選択中の列だけソート方向を読み上げる', () => {
    expect(taskGridAriaSort('title', 'title', 'asc')).toBe('ascending')
    expect(taskGridAriaSort('title', 'title', 'desc')).toBe('descending')
    expect(taskGridAriaSort('status', 'title', 'asc')).toBeUndefined()
  })
})
