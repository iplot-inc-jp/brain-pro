'use client';

// タスク取り込みの入口モーダル。取り込み元（Backlog / Jira / Excel(AI)）を選ぶと、
// 親が対応する取り込みダイアログを開く。
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FileSpreadsheet, Sparkles, ChevronRight } from 'lucide-react';

export type ImportSource = 'backlog' | 'jira' | 'excel';

const SOURCES: {
  key: ImportSource;
  title: string;
  desc: string;
  icon: typeof FileSpreadsheet;
  accent: string;
}[] = [
  {
    key: 'excel',
    title: 'Excel（AI生成）',
    desc: '.xlsx をアップロードすると、生成AIが大項目/中項目などの列を読み取り、階層付きタスクを自動生成します。',
    icon: Sparkles,
    accent: 'text-purple-600 group-hover:border-purple-300 group-hover:bg-purple-50',
  },
  {
    key: 'backlog',
    title: 'Backlog（CSV）',
    desc: 'Backlog（nulab）の課題エクスポート CSV を取り込みます。親課題キーは親子関係に解決されます。',
    icon: FileSpreadsheet,
    accent: 'text-blue-600 group-hover:border-blue-300 group-hover:bg-blue-50',
  },
  {
    key: 'jira',
    title: 'Jira（CSV）',
    desc: 'Jira（Atlassian）の課題エクスポート CSV を取り込みます。Issue key で冪等に更新されます。',
    icon: FileSpreadsheet,
    accent: 'text-sky-600 group-hover:border-sky-300 group-hover:bg-sky-50',
  },
];

export function ImportSourceDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (source: ImportSource) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle>タスクの取り込み</DialogTitle>
          <DialogDescription>取り込み元を選択してください。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onSelect(s.key)}
                className="group flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-left transition-colors hover:bg-gray-50"
              >
                <span
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 transition-colors ${s.accent}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">{s.title}</span>
                  <span className="block text-xs text-gray-500">{s.desc}</span>
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300 group-hover:text-gray-500" />
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
