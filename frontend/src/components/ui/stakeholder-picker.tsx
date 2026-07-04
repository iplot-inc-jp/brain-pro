'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, User, X } from 'lucide-react';
import type { Stakeholder } from '@/lib/stakeholders';
import { normalizeSide, sideMeta } from '@/lib/stakeholders';

/**
 * 担当者ピッカー（ステークホルダーから検索して選ぶモーダル）。
 *
 * タスクの担当者は名前文字列（Task.assigneeName）で保持しているため、
 * value/onChange も「名前」を受け渡す（id ではない）。選択済み判定は名前一致。
 * ステークホルダーは多数になりうるので、プルダウンではなく中央モーダル＋検索。
 * 未登録の担当者も入れられるよう、検索語が既存名と一致しないときは
 * 「その名前を担当者にする」フォールバックも出す。
 *
 * z-index はガントの編集サイドバー（z-[60]）や Select ドロップダウン（z-[70]）より
 * 上に出す必要があるため、オーバーレイを z-[80] に置く。
 */
interface StakeholderPickerProps {
  stakeholders: Stakeholder[];
  /** 現在の担当者名（Task.assigneeName）。'' は未設定。 */
  value: string;
  /** 選んだ担当者名（未設定にするときは ''）。 */
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function StakeholderPicker({
  stakeholders,
  value,
  onChange,
  placeholder = '担当者を選択',
  disabled = false,
  className = '',
}: StakeholderPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stakeholders;
    return stakeholders.filter((s) =>
      [s.name, s.affiliation, s.role].some((f) =>
        (f ?? '').toLowerCase().includes(q),
      ),
    );
  }, [stakeholders, query]);

  // モーダルを開いたら検索へフォーカス。Esc はモーダルを閉じる。
  // 親（ガントのサイドバー）にも window の Esc ハンドラがあるため、
  // capture フェーズで先に preventDefault して親のEscより先に処理する。
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (name: string) => {
    onChange(name);
    close();
  };

  const trimmedQuery = query.trim();
  const hasExactName = stakeholders.some((s) => s.name === trimmedQuery);

  return (
    <>
      <div className={`flex items-center gap-1 ${className}`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={`flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-left text-sm hover:border-gray-400 disabled:opacity-50 ${
            value ? 'text-gray-900' : 'text-gray-400'
          }`}
        >
          <User className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="truncate">{value || placeholder}</span>
        </button>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
            title="担当者をクリア"
            aria-label="担当者をクリア"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 p-4 pt-[10vh]"
          onMouseDown={close}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="担当者を選択"
          >
            {/* 検索ヘッダー */}
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名前・所属・役割で検索"
                className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={close}
                className="shrink-0 text-gray-400 hover:text-gray-600"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 候補リスト */}
            <div className="max-h-[50vh] overflow-y-auto p-1.5">
              {/* 未設定 */}
              <button
                type="button"
                onClick={() => pick('')}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-blue-50 ${
                  value === '' ? 'bg-blue-50 text-blue-800' : 'text-gray-500'
                }`}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {value === '' && <Check className="h-3.5 w-3.5 text-blue-600" />}
                </span>
                （未設定）
              </button>

              {/* 自由入力フォールバック（検索語が既存名と一致しないとき） */}
              {trimmedQuery && !hasExactName && (
                <button
                  type="button"
                  onClick={() => pick(trimmedQuery)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-blue-50"
                >
                  <span className="flex w-4 shrink-0 justify-center">
                    {value === trimmedQuery && (
                      <Check className="h-3.5 w-3.5 text-blue-600" />
                    )}
                  </span>
                  「{trimmedQuery}」を担当者名にする
                </button>
              )}

              {filtered.map((s) => {
                const side = normalizeSide(s.side);
                const isSel = value === s.name;
                const sub = [s.affiliation, s.role].filter(Boolean).join(' / ');
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pick(s.name)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-blue-50 ${
                      isSel ? 'bg-blue-50' : ''
                    }`}
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      {isSel && <Check className="h-3.5 w-3.5 text-blue-600" />}
                    </span>
                    <span className="min-w-0 shrink-0 truncate font-medium text-gray-800">
                      {s.name}
                    </span>
                    {sub && (
                      <span className="min-w-0 flex-1 truncate text-xs text-gray-400">
                        {sub}
                      </span>
                    )}
                    <span
                      className={`ml-auto shrink-0 rounded border px-1 text-[10px] leading-4 ${sideMeta[side].badge}`}
                    >
                      {sideMeta[side].short}
                    </span>
                  </button>
                );
              })}

              {stakeholders.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-gray-400">
                  ステークホルダーが登録されていません
                </p>
              )}
              {stakeholders.length > 0 &&
                filtered.length === 0 &&
                hasExactName && (
                  <p className="px-2 py-6 text-center text-xs text-gray-400">
                    一致するステークホルダーがいません
                  </p>
                )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
