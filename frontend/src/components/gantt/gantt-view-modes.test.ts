import { describe, expect, it } from 'vitest'

import {
  GANTT_VIEW_MODES,
  GANTT_ZOOM_OPTIONS,
  TWO_WEEKS_VIEW_MODE,
  frappeViewModeForZoom,
  prioritizeFrappeViewMode,
} from './gantt-view-modes'

describe('gantt view modes', () => {
  it('日・1週・2週・1か月を利用者向けの順で表示する', () => {
    expect(GANTT_ZOOM_OPTIONS.map((option) => option.label)).toEqual([
      '日',
      '1週',
      '2週',
      '1か月',
    ])
    expect(GANTT_ZOOM_OPTIONS.map((option) => option.mode)).toEqual([
      'day',
      'week',
      'two-weeks',
      'month',
    ])
  })

  it('2週間表示を14日刻み・週単位スナップで定義する', () => {
    expect(TWO_WEEKS_VIEW_MODE).toMatchObject({
      name: 'Two Weeks',
      step: '14d',
      snap_at: '7d',
    })
    expect(GANTT_VIEW_MODES).toEqual([
      'Day',
      'Week',
      TWO_WEEKS_VIEW_MODE,
      'Month',
    ])
    expect(frappeViewModeForZoom('two-weeks')).toBe('Two Weeks')
  })

  it('全画面切替による再マウント後も選択中の表示モードを先頭に渡す', () => {
    expect(prioritizeFrappeViewMode(GANTT_VIEW_MODES, 'Two Weeks')).toEqual([
      TWO_WEEKS_VIEW_MODE,
      'Day',
      'Week',
      'Month',
    ])
    expect(prioritizeFrappeViewMode(GANTT_VIEW_MODES, 'Month')[0]).toBe('Month')
  })
})
