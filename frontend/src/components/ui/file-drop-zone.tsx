'use client';

/**
 * FileDropZone — 添付ファイル用の共有ドラッグ&ドロップ領域。
 *
 * - クリックでファイル選択ダイアログも開ける（input[type=file] hidden 連動）。
 * - ドラッグオーバー中は青ハイライト＋「ここにドロップ」を表示。
 * - accept（MIME / 拡張子のカンマ区切り）は input にも DnD のフィルタにも適用し、
 *   合致するファイルだけを onFiles に渡す（全部弾かれたら何もしない）。
 * - dragenter/dragleave のネストはカウンタで対策。
 * - busy 中は Loader2 を表示し、クリック・ドロップを無効化。
 * - className で高さなどを上書きしてコンパクト版にできる。
 */

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileDropZoneProps {
  /** フィルタ済みのファイル（accept に合致したもののみ）を受け取る。 */
  onFiles: (files: File[]) => void;
  /** input[type=file] と同形式（例: "image/*,.pdf"）。DnD にも適用。 */
  accept?: string;
  /** 複数ファイルを許可するか（既定 true）。false なら先頭 1 件のみ渡す。 */
  multiple?: boolean;
  disabled?: boolean;
  /** アップロード中表示（Loader2）。操作も無効化。 */
  busy?: boolean;
  className?: string;
  /** 通常時のカスタム文言・内容（未指定なら既定文言）。 */
  children?: ReactNode;
}

/** ファイルが accept（MIME / 拡張子のカンマ区切り）に合致するか。 */
function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const specs = accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (specs.length === 0) return true;
  const name = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  return specs.some((spec) => {
    if (spec === '*' || spec === '*/*') return true; // 全許可
    if (spec.startsWith('.')) return name.endsWith(spec);
    if (spec.endsWith('/*')) return mime.startsWith(spec.slice(0, -1));
    return mime === spec;
  });
}

export function FileDropZone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  busy = false,
  className,
  children,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter のネスト対策（子要素への enter/leave で消えないようカウント）
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  // 非対応形式だけがドロップされた時の一時メッセージ（無反応に見えないように）
  const [rejectedMsg, setRejectedMsg] = useState<string | null>(null);
  const rejectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const interactive = !disabled && !busy;

  const emitFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      let files = Array.from(list).filter((f) => matchesAccept(f, accept));
      if (!multiple) files = files.slice(0, 1);
      if (files.length === 0) {
        // accept に合うものが無い: 黙って無視せず一時メッセージで知らせる
        setRejectedMsg('対応していないファイル形式です');
        if (rejectedTimer.current) clearTimeout(rejectedTimer.current);
        rejectedTimer.current = setTimeout(() => setRejectedMsg(null), 3000);
        return;
      }
      setRejectedMsg(null);
      onFiles(files);
    },
    [accept, multiple, onFiles],
  );

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!interactive) return;
      // テキスト/URL等のドラッグではハイライトしない（ファイルのみ）
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    [interactive],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // drop を許可
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!interactive) return;
      emitFiles(e.dataTransfer.files);
    },
    [interactive, emitFiles],
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      emitFiles(e.target.files);
      e.target.value = ''; // 同じファイルの再選択を許可
    },
    [emitFiles],
  );

  const openPicker = useCallback(() => {
    if (interactive) inputRef.current?.click();
  }, [interactive]);

  return (
    <div
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-disabled={!interactive}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-gray-300 bg-white/60 px-3 py-4 text-center text-xs text-gray-500 transition-colors hover:border-gray-400 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        dragging && 'border-blue-500 bg-blue-50 text-blue-600',
        (disabled || busy) && 'cursor-not-allowed opacity-60 hover:border-gray-300 hover:bg-white/60',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={!interactive}
        className="hidden"
        onChange={handleInputChange}
      />
      {busy ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          アップロード中…
        </span>
      ) : dragging ? (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Upload className="h-4 w-4" />
          ここにドロップ
        </span>
      ) : (
        children ?? (
          <span className="inline-flex items-center gap-1.5">
            <Upload className="h-4 w-4 text-gray-400" />
            ファイルをドラッグ＆ドロップ、またはクリックして選択
          </span>
        )
      )}
      {rejectedMsg && !busy && (
        <span className="text-[11px] text-rose-600">{rejectedMsg}</span>
      )}
    </div>
  );
}
