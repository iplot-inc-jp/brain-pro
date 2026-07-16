import type {
  FrappeViewMode,
  FrappeViewModeDefinition,
} from 'frappe-gantt'

export type GanttZoomMode = 'day' | 'week' | 'two-weeks' | 'month'

export type GanttZoomOption = {
  mode: GanttZoomMode
  label: string
  title: string
}

function shortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export const TWO_WEEKS_VIEW_MODE: FrappeViewModeDefinition = {
  name: 'Two Weeks',
  padding: '2m',
  step: '14d',
  column_width: 168,
  date_format: 'YYYY-MM-DD',
  snap_at: '7d',
  lower_text: (date) => {
    const end = new Date(date)
    end.setDate(end.getDate() + 13)
    return `${shortDate(date)}–${shortDate(end)}`
  },
  upper_text: (date, previous) =>
    !previous ||
    date.getMonth() !== previous.getMonth() ||
    date.getFullYear() !== previous.getFullYear()
      ? `${date.getFullYear()}年${date.getMonth() + 1}月`
      : '',
  thick_line: (date) => date.getDate() <= 14,
}

export const GANTT_ZOOM_OPTIONS: readonly GanttZoomOption[] = [
  { mode: 'day', label: '日', title: '日単位で表示' },
  { mode: 'week', label: '1週', title: '1週間単位で表示' },
  { mode: 'two-weeks', label: '2週', title: '2週間単位で表示' },
  { mode: 'month', label: '1か月', title: '1か月単位で表示' },
] as const

export const GANTT_VIEW_MODES: readonly (
  | FrappeViewMode
  | FrappeViewModeDefinition
)[] = ['Day', 'Week', TWO_WEEKS_VIEW_MODE, 'Month']

const FRAPPE_VIEW_MODE_BY_ZOOM: Record<GanttZoomMode, FrappeViewMode> = {
  day: 'Day',
  week: 'Week',
  'two-weeks': 'Two Weeks',
  month: 'Month',
}

export function frappeViewModeForZoom(mode: GanttZoomMode): FrappeViewMode {
  return FRAPPE_VIEW_MODE_BY_ZOOM[mode]
}

export function prioritizeFrappeViewMode(
  modes: readonly (FrappeViewMode | FrappeViewModeDefinition)[],
  selected: FrappeViewMode,
): (FrappeViewMode | FrappeViewModeDefinition)[] {
  const selectedIndex = modes.findIndex((mode) =>
    typeof mode === 'string' ? mode === selected : mode.name === selected,
  )
  if (selectedIndex <= 0) return [...modes]
  return [
    modes[selectedIndex],
    ...modes.slice(0, selectedIndex),
    ...modes.slice(selectedIndex + 1),
  ]
}
