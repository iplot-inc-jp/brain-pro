'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import {
  ArrowLeft,
  Loader2,
  ShieldAlert,
  Users,
  Crown,
} from 'lucide-react'
import { invalidateProjectAccess } from '@/hooks/use-project-access'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

type AccessLevel = 'EDIT' | 'VIEW' | null

interface MemberRow {
  userId: string
  email: string
  name: string | null
  orgRole: string
  explicitLevel: AccessLevel
  effectiveLevel: AccessLevel
}

// select の値（明示権限）。'NONE' は ProjectMember 行なし（既定）。
type SelectValue = 'NONE' | 'VIEW' | 'EDIT'

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

// org OWNER/ADMIN は常に編集（管理者）。select を disabled にする対象。
function isOrgAdmin(orgRole: string): boolean {
  return orgRole === 'OWNER' || orgRole === 'ADMIN'
}

function orgRoleBadge(orgRole: string) {
  const map: Record<string, { label: string; cls: string }> = {
    OWNER: { label: 'オーナー', cls: 'bg-purple-100 text-purple-700' },
    ADMIN: { label: '管理者', cls: 'bg-blue-100 text-blue-700' },
    MEMBER: { label: 'メンバー', cls: 'bg-gray-100 text-gray-600' },
    VIEWER: { label: '閲覧', cls: 'bg-gray-100 text-gray-500' },
  }
  const m = map[orgRole] ?? { label: orgRole, cls: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${m.cls}`}>
      {m.label}
    </span>
  )
}

export default function ProjectMembersPage() {
  const params = useParams()
  const projectId = params.projectId as string

  const [rows, setRows] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  // 403（非管理者）アクセス。
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 保存中の userId（select を一時 disable）
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setForbidden(false)
    setError(null)
    try {
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/members`,
        { headers: authHeaders() },
      )
      if (res.status === 403) {
        setForbidden(true)
        setRows([])
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.message || `取得に失敗しました（${res.status}）`)
        setRows([])
        return
      }
      const data = (await res.json()) as MemberRow[]
      setRows(Array.isArray(data) ? data : [])
    } catch {
      setError('ネットワークエラーが発生しました')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  // 行の明示権限を変更。EDIT/VIEW → PUT、NONE → DELETE。
  // 楽観更新 + 失敗ロールバック。
  const handleChange = async (row: MemberRow, next: SelectValue) => {
    const prevRows = rows
    setSavingUserId(row.userId)

    // 楽観更新（effectiveLevel は org 管理者でない前提で明示権限を反映）。
    const optimisticExplicit: AccessLevel = next === 'NONE' ? null : next
    setRows((cur) =>
      cur.map((r) =>
        r.userId === row.userId
          ? {
              ...r,
              explicitLevel: optimisticExplicit,
              effectiveLevel: optimisticExplicit,
            }
          : r,
      ),
    )

    try {
      let res: Response
      if (next === 'NONE') {
        res = await fetch(
          `${API_URL}/api/projects/${projectId}/members/${row.userId}`,
          { method: 'DELETE', headers: authHeaders() },
        )
      } else {
        res = await fetch(
          `${API_URL}/api/projects/${projectId}/members/${row.userId}`,
          {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ accessLevel: next }),
          },
        )
      }
      if (!res.ok) {
        throw new Error(`保存に失敗しました（${res.status}）`)
      }
      // 自分自身の権限が変わる可能性があるためキャッシュを破棄。
      invalidateProjectAccess(projectId)
      // 実効権限の再計算（メンバー0件→1件の境界等）のため再取得。
      await fetchMembers()
    } catch (e) {
      // ロールバック
      setRows(prevRows)
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingUserId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}`}>
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ArrowLeft className="w-4 h-4 mr-1" />
              戻る
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">メンバー権限</h1>
        </div>
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <ShieldAlert className="h-7 w-7 text-amber-600" />
            </div>
            <p className="text-gray-800 font-medium mb-1">管理者のみ</p>
            <p className="text-sm text-gray-500 max-w-md">
              メンバー権限の管理は、会社のオーナー・管理者（またはすべての管理者）のみが行えます。
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}`}>
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ArrowLeft className="w-4 h-4 mr-1" />
              戻る
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">メンバー権限</h1>
              <HelpTooltip text="このプロジェクトに対する会社メンバーごとの権限（閲覧／編集）を設定します。" />
            </div>
            <p className="text-gray-500 mt-1 text-sm">
              プロジェクト単位のアクセス権限を管理
            </p>
          </div>
        </div>
      </div>

      {/* 既定の挙動の説明 */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        メンバーを1人も設定しないプロジェクトは会社メンバー全員が編集できます（既定）。
        設定すると、設定したユーザーのみ指定の権限になります。
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="bg-white border-gray-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-gray-900 text-lg">
            <Users className="h-5 w-5 text-gray-400" />
            会社メンバー
            <span className="text-sm font-normal text-gray-400">
              {rows.length}人
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="px-4 py-2.5 font-medium">名前 / メール</th>
                  <th className="px-4 py-2.5 font-medium">会社ロール</th>
                  <th className="px-4 py-2.5 font-medium">このプロジェクトの権限</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const admin = isOrgAdmin(row.orgRole)
                  const selectValue: SelectValue =
                    row.explicitLevel === 'EDIT'
                      ? 'EDIT'
                      : row.explicitLevel === 'VIEW'
                        ? 'VIEW'
                        : 'NONE'
                  return (
                    <tr
                      key={row.userId}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {row.name || '（名前未設定）'}
                        </div>
                        <div className="text-xs text-gray-500">{row.email}</div>
                      </td>
                      <td className="px-4 py-3">{orgRoleBadge(row.orgRole)}</td>
                      <td className="px-4 py-3">
                        {admin ? (
                          <div className="flex items-center gap-1.5 text-sm text-gray-600">
                            <Crown className="h-4 w-4 text-amber-500" />
                            常に編集（管理者）
                          </div>
                        ) : (
                          <select
                            value={selectValue}
                            disabled={savingUserId === row.userId}
                            onChange={(e) =>
                              handleChange(row, e.target.value as SelectValue)
                            }
                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none disabled:opacity-50"
                          >
                            <option value="NONE">なし</option>
                            <option value="VIEW">閲覧</option>
                            <option value="EDIT">編集</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-10 text-center text-gray-400"
                    >
                      会社メンバーがいません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
