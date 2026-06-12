'use client';

/**
 * CreateObjectDialog — ER図ページからデータオブジェクトを新規作成するダイアログ。
 *
 * 名前（必須）と説明（任意）だけを入力し、作成APIの呼び出し自体はページ側の
 * onSubmit に委ねる（色・座標・order の既定値はページ側で決める）。
 * データオブジェクトは DFD のデータストア・関係性マップ・ER図囲みを貫く共通マスタ。
 */

import { useEffect, useState } from 'react';
import { Boxes, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface CreateObjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 作成処理（API呼び出し）はページ側に置く。resolve したらダイアログを閉じ、
   * reject したら開いたまま（入力保持）ダイアログ内にエラーを表示する。
   */
  onSubmit: (name: string, description: string) => Promise<void>;
}

export function CreateObjectDialog({ open, onOpenChange, onSubmit }: CreateObjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 開くたびに入力をリセット（前回の入力が残らないように）
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setSubmitting(false);
      setSubmitError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(trimmed, description.trim());
      onOpenChange(false);
    } catch (err) {
      // 失敗時はダイアログを開いたまま入力を保持し、エラーを表示して再試行できるようにする
      setSubmitError(err instanceof Error ? err.message : 'オブジェクトの作成に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        // submit中は閉じさせない（二重送信・状態不整合の防止）
        if (!submitting) onOpenChange(value);
      }}
    >
      <DialogContent className="bg-white border-gray-200 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-gray-900 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-blue-600" />
            オブジェクトを追加
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            DFDのデータストア・関係性マップ・ER図囲みと共通のマスタとして作成されます
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="create-object-name" className="text-gray-700">
              名前 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="create-object-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 受注、顧客、在庫"
              className="bg-white border-gray-300"
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-object-description" className="text-gray-700">
              説明（任意）
            </Label>
            <Textarea
              id="create-object-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="このオブジェクトが表すデータのまとまりを説明します"
              className="bg-white border-gray-300"
              rows={3}
              disabled={submitting}
            />
          </div>
          {submitError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {submitError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            キャンセル
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || submitting}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                作成中...
              </>
            ) : (
              '作成'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
