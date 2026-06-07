'use client';

import { Button } from '@/components/ui/button';
import { Plus, Save, Loader2, Check } from 'lucide-react';

/** 分析ツール共通のツールバー（行追加・保存・保存ステータス）。 */
export function SheetToolbar({
  onAdd,
  onSave,
  saving,
  savedAt,
  addLabel = '行を追加',
}: {
  onAdd: () => void;
  onSave: () => void;
  saving: boolean;
  savedAt: number | null;
  addLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={onAdd} className="gap-1.5">
        <Plus className="h-4 w-4" />
        {addLabel}
      </Button>
      <Button
        size="sm"
        onClick={onSave}
        disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 gap-1.5"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : savedAt ? (
          <Check className="h-4 w-4" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {saving ? '保存中...' : savedAt ? '保存しました' : '保存'}
      </Button>
    </div>
  );
}
