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
 * GAP分析の各ツール（パレート/感度/ギャップ/漏れ）の入力行を、専用の実テーブル
 * エンドポイント（GET/PUT /api/projects/:projectId/<path>、body は {rows:any[]}）に
 * 保存するフック。useRecordSheet と同一の返り値API（rows/setRows/save/saving/
 * savedAt/loading/error）を保ち、保存先だけ汎用 RecordSheet から実テーブルへ移す。
 *
 * path は analysis-pareto / analysis-sensitivity / analysis-gap / analysis-leak の
 * いずれか。リクエスト/レスポンス契約（{rows}）は RecordSheet と同じ。
 */
export function useAnalysisSheet<T extends Record<string, unknown>>(
  projectId: string,
  path: string,
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
        `${API_URL}/api/projects/${projectId}/${encodeURIComponent(path)}`,
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
      console.error('Failed to fetch analysis sheet:', err);
      setError('読み込み中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
    // initial を依存に含めると毎レンダー再フェッチになるため意図的に除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path]);

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
          `${API_URL}/api/projects/${projectId}/${encodeURIComponent(path)}`,
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
        console.error('Failed to save analysis sheet:', err);
        setError('保存中にエラーが発生しました');
      } finally {
        setSaving(false);
      }
    },
    [projectId, path, rows],
  );

  const update = useCallback((updater: (prev: T[]) => T[]) => {
    setRows((prev) => updater(prev));
    setSavedAt(null);
  }, []);

  return { rows, setRows: update, loading, saving, savedAt, error, save };
}
