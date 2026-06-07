'use client';

import { useCallback, useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function getHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * 既存の RecordSheet API（GET/PUT /api/projects/:projectId/record-sheets/:templateKey,
 * body は {rows:any[]}）を、分析ツールごとの入力行を保存する汎用ストアとして使うフック。
 * 列の意味づけはツール側が自由に決めるため（{colKey:value}）、ここでは any[] のまま扱う。
 * バックエンドは新規追加せず、この既存エンドポイントのみを利用する。
 */
export function useRecordSheet<T extends Record<string, unknown>>(
  projectId: string,
  templateKey: string,
  initial: T[],
) {
  const [rows, setRows] = useState<T[]>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSheet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/record-sheets/${encodeURIComponent(
          templateKey,
        )}`,
        { headers: getHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        const fetched = Array.isArray(data?.rows) ? (data.rows as T[]) : [];
        if (fetched.length > 0) setRows(fetched);
      } else if (res.status !== 404) {
        setError('読み込みに失敗しました');
      }
    } catch (err) {
      console.error('Failed to fetch record sheet:', err);
      setError('読み込み中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
    // initial を依存に含めると毎レンダー再フェッチになるため意図的に除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, templateKey]);

  useEffect(() => {
    fetchSheet();
  }, [fetchSheet]);

  const save = useCallback(
    async (next?: T[]) => {
      const payload = next ?? rows;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_URL}/api/projects/${projectId}/record-sheets/${encodeURIComponent(
            templateKey,
          )}`,
          {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({ rows: payload }),
          },
        );
        if (res.ok) {
          setSavedAt(Date.now());
        } else {
          setError('保存に失敗しました');
        }
      } catch (err) {
        console.error('Failed to save record sheet:', err);
        setError('保存中にエラーが発生しました');
      } finally {
        setSaving(false);
      }
    },
    [projectId, templateKey, rows],
  );

  const update = useCallback((updater: (prev: T[]) => T[]) => {
    setRows((prev) => updater(prev));
    setSavedAt(null);
  }, []);

  return { rows, setRows: update, loading, saving, savedAt, error, save };
}

/** GAP item を既存の作成APIで起票する（分析結果→打ち手）。 */
export async function createGapItem(
  projectId: string,
  body: {
    businessArea: string;
    asisDescription?: string;
    tobeDescription?: string;
    gapDescription?: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    ownerName?: string;
  },
): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/gap-items`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to create gap item:', err);
    return false;
  }
}
