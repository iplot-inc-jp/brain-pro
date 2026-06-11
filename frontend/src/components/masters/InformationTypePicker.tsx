'use client';

/**
 * INPUT/OUTPUT（情報種別=InformationType）を選ぶ共通ピッカー。
 * - 既存の INPUT/OUTPUT を select で選べる。
 * - 「＋」ボタンからその場で新規追加（informationTypeApi.create）→ 作成したものを即選択。
 * IO を選ぶ箇所（データカタログ・業務フロー編集・DFD 等）で共通利用する。
 */

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Loader2 } from 'lucide-react';
import {
  informationTypeApi,
  INFORMATION_CATEGORY_LABELS,
  INFORMATION_CATEGORY_OPTIONS,
  type InformationType,
  type InformationCategory,
} from '@/lib/dfd';

const NONE = '__none__';

interface InformationTypePickerProps {
  projectId: string;
  /** 表示候補（呼び出し側が保持する一覧） */
  informationTypes: InformationType[];
  /**
   * 選択中の値。
   * - valueMode='id'（既定）: InformationType の ID（未設定は null）
   * - valueMode='name': InformationType の「名前」（未設定は null）
   */
  value: string | null;
  /**
   * 選択変更（未設定選択時は null）。
   * valueMode に応じて ID（既定）または名前を渡す。
   */
  onChange: (value: string | null) => void;
  /** 新規作成された InformationType（呼び出し側で一覧へ反映する） */
  onCreated?: (created: InformationType) => void;
  disabled?: boolean;
  /** 「未設定」を選べるようにするか（既定 true） */
  allowNone?: boolean;
  noneLabel?: string;
  triggerClassName?: string;
  /**
   * value/onChange で扱う値の種別（既定 'id'）。
   * - 'id': 従来動作（InformationType の ID で選択・新規作成時も ID を返す）
   * - 'name': InformationType の「名前」で選択（FlowDefinition.input/output 等テキスト列向け）。
   *   新規追加時は作成した種別の name を onChange する。
   */
  valueMode?: 'id' | 'name';
}

export function InformationTypePicker({
  projectId,
  informationTypes,
  value,
  onChange,
  onCreated,
  disabled,
  allowNone = true,
  noneLabel = '— 未設定 —',
  triggerClassName = 'h-8 bg-white border-gray-300 text-gray-900 text-sm',
  valueMode = 'id',
}: InformationTypePickerProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<InformationCategory>('INFORMATION');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setName('');
    setCategory('INFORMATION');
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('名称を入力してください');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await informationTypeApi.create(projectId, {
        name: trimmed,
        category,
      });
      onCreated?.(created);
      onChange(valueMode === 'name' ? created.name : created.id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'INPUT/OUTPUT の作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // valueMode='name' のとき select の option 値は種別「名前」を使う。
  // 既存のフリーテキスト値が一覧に無い場合でも選択表示が消えないよう、補助 option を足す。
  const byName = valueMode === 'name';
  const optionValueOf = (it: InformationType) => (byName ? it.name : it.id);
  // name-mode では option 値が「名前」になるため、同名種別が複数あると Radix の
  // value が衝突して選択が曖昧になる。名前単位で先勝ちで一意化する（id-mode は id で一意なのでそのまま）。
  const optionItems = byName
    ? informationTypes.filter(
        (it, i) =>
          informationTypes.findIndex((o) => o.name === it.name) === i,
      )
    : informationTypes;
  const currentInList =
    value == null ||
    optionItems.some((it) => optionValueOf(it) === value);

  return (
    <div className="flex items-center gap-1">
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder={noneLabel} />
        </SelectTrigger>
        <SelectContent className="bg-white">
          {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          {/* 一覧に無い既存値（マスタ未登録の自由入力名など）も選択肢として残す。
              Radix Select は value="" を許可しないため、空文字は補助 option を出さない。 */}
          {!currentInList && value && (
            <SelectItem value={value}>{value}</SelectItem>
          )}
          {optionItems.map((it) => (
            <SelectItem key={it.id} value={optionValueOf(it)}>
              {it.name}（{INFORMATION_CATEGORY_LABELS[it.category]}）
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        title="新規 INPUT/OUTPUT を追加"
        disabled={disabled}
        onClick={openCreate}
      >
        <Plus className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>INPUT/OUTPUT を追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-gray-600">名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 受注データ"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-gray-600">区分</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as InformationCategory)}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {INFORMATION_CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              追加して選択
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
