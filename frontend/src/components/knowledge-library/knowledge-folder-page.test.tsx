import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import KnowledgeFoldersPage from '@/app/(dashboard)/dashboard/projects/[projectId]/knowledge/folders/page'

vi.mock('next/navigation', () => ({ useParams: () => ({ projectId: 'project-42' }) }))
vi.mock('./knowledge-folder-workspace', () => ({
  KnowledgeFolderWorkspace: ({ projectId }: { projectId: string }) => <div data-testid="folder-workspace" data-project-id={projectId} />,
}))

describe('KnowledgeFoldersPage', () => {
  it('opens the folder workspace for the current project', () => {
    render(<KnowledgeFoldersPage />)
    expect(screen.getByRole('heading', { name: 'ナレッジフォルダ' })).toBeInTheDocument()
    expect(screen.getByTestId('folder-workspace')).toHaveAttribute('data-project-id', 'project-42')
  })
})
