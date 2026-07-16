'use client'

import { useParams } from 'next/navigation'

import { ActivityHistoryView } from '@/components/knowledge/activity-history-view'

export default function ChatHistoryPage() {
  const params = useParams()
  return <ActivityHistoryView projectId={params.projectId as string} kind="chat" />
}
