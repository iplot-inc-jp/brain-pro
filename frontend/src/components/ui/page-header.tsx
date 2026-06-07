import { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { HelpTooltip } from './help-tooltip';

/**
 * 全ページ共通のページヘッダー。タイトル・説明・操作（右側）・戻るリンク・?ヘルパーを
 * 一定の余白とサイズで統一する（縦間延び防止＋デザイン統一）。
 */
export function PageHeader({
  title,
  description,
  help,
  actions,
  backHref,
  backLabel = '戻る',
}: {
  title: ReactNode;
  description?: ReactNode;
  help?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="space-y-1">
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            {title}
            {help && <HelpTooltip text={help} />}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
