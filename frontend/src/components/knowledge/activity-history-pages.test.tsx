import { render, screen } from '@testing-library/react'
import { vi, describe, expect, it } from 'vitest'

vi.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'project-42' }),
}))

vi.mock('./activity-history-view', () => ({
  ActivityHistoryView: ({ projectId, kind }: { projectId: string; kind: string }) => (
    <div data-testid="activity-history-view">{projectId}:{kind}</div>
  ),
}))

import ChatHistoryPage from '@/app/(dashboard)/dashboard/projects/[projectId]/knowledge/chat-history/page'
import ResourceHistoryPage from '@/app/(dashboard)/dashboard/projects/[projectId]/knowledge/resource-history/page'

describe('activity history pages', () => {
  it('wires the project-scoped chat history page', () => {
    render(<ChatHistoryPage />)
    expect(screen.getByTestId('activity-history-view')).toHaveTextContent('project-42:chat')
  })

  it('wires the project-scoped resource history page', () => {
    render(<ResourceHistoryPage />)
    expect(screen.getByTestId('activity-history-view')).toHaveTextContent('project-42:resource')
  })
})
