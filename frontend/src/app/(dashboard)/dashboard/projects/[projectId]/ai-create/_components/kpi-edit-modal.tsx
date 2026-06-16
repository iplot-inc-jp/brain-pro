'use client';

/**
 * KPI編集モーダル。
 *
 * 全編集可能フィールド（名称・区分・対象フロー/システム・定義・単位・
 * 基準/現在/目標値・方向・頻度・測定方法・責任者ロール・SMART採点・ステータス）と、
 * 測定対象の INPUT/OUTPUT 紐づけ（PUT information-types による全置換）を編集する。
 */

import { useCallback, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { InformationType } from '@/lib/dfd';
import type { SystemMaster } from '@/lib/masters';
import {
  kpiApi,
  KPI_CATEGORY_OPTIONS,
  KPI_DIRECTION_OPTIONS,
  KPI_FREQUENCY_OPTIONS,
  KPI_STATUS_OPTIONS,
  type KpiCategory,
  type KpiDirection,
  type KpiDto,
  type KpiFrequency,
  type KpiStatus,
  type KpiUpsertBody,
} from '@/lib/kpis';
import type { BusinessFlowItem, RoleItem } from './types';
import { IoCategoryBadge } from './kpi-format';

/** 数値入力（string）→ number | null。空・非数は null。 */
function parseNum(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** SMART採点入力 → 0〜5 に丸めた整数 | null。 */
function parseSmart(value: string): number | null {
  const n = parseNum(value);
  if (n == null) return null;
  return Math.max(0, Math.min(5, Math.round(n)));
}

const numToStr = (v: number | null): string => (v == null ? '' : String(v));

export function KpiEditModal({
  kpi,
  projectId,
  flows,
  systems,
  roles,
  informationTypes,
  onClose,
  onSaved,
  lockedCategory,
}: {
  /** 編集対象。`null` のとき空フォームで新規作成（要 projectId）。 */
  kpi: KpiDto | null;
  /** 新規作成（kpi===null）時に必須。`kpiApi.create(projectId, …)` に使う。 */
  projectId?: string;
  flows: BusinessFlowItem[];
  systems: SystemMaster[];
  roles: RoleItem[];
  informationTypes: InformationType[];
  onClose: () => void;
  /** 保存成功後に呼ばれる（KPI一覧の再読込） */
  onSaved: () => Promise<void> | void;
  /** 区分固定（業務KPI / AI精度指標 専用画面の新規作成）。指定時は区分セレクトを固定表示する。 */
  lockedCategory?: KpiCategory;
}) {
  const isCreate = kpi === null;
  const [name, setName] = useState(kpi?.name ?? '');
  const [category, setCategory] = useState<KpiCategory>(
    kpi?.category ?? lockedCategory ?? 'BUSINESS',
  );
  // 既存 flowId はモーダルでは編集しない（保存時に保持するため値だけ控える）。
  const [asisFlowId, setAsisFlowId] = useState(kpi?.asisFlowId ?? '');
  const [tobeFlowId, setTobeFlowId] = useState(kpi?.tobeFlowId ?? '');
  const [systemId, setSystemId] = useState(kpi?.systemId ?? '');
  const [description, setDescription] = useState(kpi?.description ?? '');
  const [definition, setDefinition] = useState(kpi?.definition ?? '');
  const [unit, setUnit] = useState(kpi?.unit ?? '');
  const [baseline, setBaseline] = useState(numToStr(kpi?.baselineValue ?? null));
  const [current, setCurrent] = useState(numToStr(kpi?.currentValue ?? null));
  const [target, setTarget] = useState(numToStr(kpi?.targetValue ?? null));
  const [direction, setDirection] = useState<KpiDirection>(kpi?.direction ?? 'INCREASE');
  const [frequency, setFrequency] = useState<KpiFrequency>(kpi?.frequency ?? 'MONTHLY');
  const [measurementMethod, setMeasurementMethod] = useState(kpi?.measurementMethod ?? '');
  const [ownerRoleId, setOwnerRoleId] = useState(kpi?.ownerRoleId ?? '');
  const [status, setStatus] = useState<KpiStatus>(kpi?.status ?? 'DRAFT');
  const [smartS, setSmartS] = useState(numToStr(kpi?.smartSpecific ?? null));
  const [smartM, setSmartM] = useState(numToStr(kpi?.smartMeasurable ?? null));
  const [smartA, setSmartA] = useState(numToStr(kpi?.smartAchievable ?? null));
  const [smartR, setSmartR] = useState(numToStr(kpi?.smartRelevant ?? null));
  const [smartT, setSmartT] = useState(numToStr(kpi?.smartTimeBound ?? null));
  const [smartComment, setSmartComment] = useState(kpi?.smartComment ?? '');
  const [ioIds, setIoIds] = useState<Set<string>>(
    () => new Set((kpi?.informationTypes ?? []).map((it) => it.id)),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asisFlows = useMemo(() => flows.filter((f) => f.kind === 'ASIS'), [flows]);
  const tobeFlows = useMemo(() => flows.filter((f) => f.kind === 'TOBE'), [flows]);

  const toggleIo = useCallback((id: string) => {
    setIoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('名称を入力してください');
      return;
    }
    if (isCreate && !projectId) {
      setError('プロジェクトIDが指定されていません');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: KpiUpsertBody = {
        name: trimmedName,
        category,
        // flowId はモーダルでは編集しない。既存値をそのまま保持（更新で消さない）。
        flowId: kpi?.flowId ?? null,
        asisFlowId: asisFlowId || null,
        tobeFlowId: tobeFlowId || null,
        systemId: systemId || null,
        description: description.trim() || null,
        definition: definition.trim() || null,
        unit: unit.trim() || null,
        baselineValue: parseNum(baseline),
        currentValue: parseNum(current),
        targetValue: parseNum(target),
        direction,
        frequency,
        measurementMethod: measurementMethod.trim() || null,
        ownerRoleId: ownerRoleId || null,
        smartSpecific: parseSmart(smartS),
        smartMeasurable: parseSmart(smartM),
        smartAchievable: parseSmart(smartA),
        smartRelevant: parseSmart(smartR),
        smartTimeBound: parseSmart(smartT),
        smartComment: smartComment.trim() || null,
        status,
      };

      if (isCreate) {
        // 新規作成。create 後、IO選択があれば 2段目で setInformationTypes（プリセット追加と同方式）。
        const created = await kpiApi.create(projectId as string, {
          ...body,
          name: trimmedName,
        });
        if (ioIds.size > 0) {
          await kpiApi.setInformationTypes(created.id, Array.from(ioIds));
        }
      } else {
        await kpiApi.update(kpi.id, body);

        // IO紐づけは変更があったときだけ全置換（PUT information-types）
        const before = new Set(kpi.informationTypes.map((it) => it.id));
        const changed =
          before.size !== ioIds.size || Array.from(ioIds).some((id) => !before.has(id));
        if (changed) {
          await kpiApi.setInformationTypes(kpi.id, Array.from(ioIds));
        }
      }

      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'KPIの保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }, [
    kpi,
    isCreate,
    projectId,
    name,
    category,
    asisFlowId,
    tobeFlowId,
    systemId,
    description,
    definition,
    unit,
    baseline,
    current,
    target,
    direction,
    frequency,
    measurementMethod,
    ownerRoleId,
    status,
    smartS,
    smartM,
    smartA,
    smartR,
    smartT,
    smartComment,
    ioIds,
    onSaved,
    onClose,
  ]);

  const selectClass =
    'w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreate ? 'KPIを新規作成' : 'KPIを編集'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 名称・区分 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">名称 *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="KPI名" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">区分</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as KpiCategory)}
                disabled={lockedCategory != null}
                className={`${selectClass}${lockedCategory != null ? ' cursor-not-allowed bg-gray-50 text-gray-500' : ''}`}
              >
                {(lockedCategory != null
                  ? KPI_CATEGORY_OPTIONS.filter((o) => o.value === lockedCategory)
                  : KPI_CATEGORY_OPTIONS
                ).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ASIS業務フロー / TOBE業務フロー */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">ASIS業務フロー</Label>
              <select
                value={asisFlowId}
                onChange={(e) => setAsisFlowId(e.target.value)}
                className={selectClass}
              >
                <option value="">指定なし</option>
                {asisFlows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">TOBE業務フロー</Label>
              <select
                value={tobeFlowId}
                onChange={(e) => setTobeFlowId(e.target.value)}
                className={selectClass}
              >
                <option value="">指定なし</option>
                {tobeFlows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 対象システム / 責任者 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">対象システム</Label>
              <select
                value={systemId}
                onChange={(e) => setSystemId(e.target.value)}
                className={selectClass}
              >
                <option value="">なし</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">責任者ロール</Label>
              <select
                value={ownerRoleId}
                onChange={(e) => setOwnerRoleId(e.target.value)}
                className={selectClass}
              >
                <option value="">なし</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 説明・定義 */}
          <div className="space-y-1">
            <Label className="text-xs">説明</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="このKPIで何を測り、なぜ重要か"
              className="text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">定義・計算式</Label>
              <Input
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
                placeholder="例: 欠品率 = 欠品件数 ÷ 発注明細数 × 100"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">単位</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%・件・秒 など" />
            </div>
          </div>

          {/* 値・方向・頻度 */}
          <div className="grid grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">基準値</Label>
              <Input type="number" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">現在値</Label>
              <Input type="number" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">目標値</Label>
              <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">方向</Label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as KpiDirection)}
                className={selectClass}
              >
                {KPI_DIRECTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">頻度</Label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as KpiFrequency)}
                className={selectClass}
              >
                {KPI_FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 測定方法・ステータス */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">測定方法・データソース</Label>
              <Input
                value={measurementMethod}
                onChange={(e) => setMeasurementMethod(e.target.value)}
                placeholder="例: 受発注システムの欠品ログを月次集計"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">ステータス</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as KpiStatus)}
                className={selectClass}
              >
                {KPI_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* SMART採点 */}
          <div className="space-y-2 rounded border border-gray-100 bg-gray-50/60 p-3">
            <Label className="text-xs font-medium">SMART採点（各0〜5）</Label>
            <div className="grid grid-cols-5 gap-2">
              {(
                [
                  ['S 具体的', smartS, setSmartS],
                  ['M 測定可能', smartM, setSmartM],
                  ['A 達成可能', smartA, setSmartA],
                  ['R 関連性', smartR, setSmartR],
                  ['T 期限', smartT, setSmartT],
                ] as const
              ).map(([label, value, setter]) => (
                <div key={label} className="space-y-1">
                  <Label className="text-[10px] text-gray-500">{label}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">講評</Label>
              <Textarea
                value={smartComment}
                onChange={(e) => setSmartComment(e.target.value)}
                rows={2}
                placeholder="SMART観点での講評・改善ポイント"
                className="bg-white text-sm"
              />
            </div>
          </div>

          {/* 測定対象の INPUT/OUTPUT 紐づけ（全置換） */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">
              測定対象の INPUT/OUTPUT（{ioIds.size}件選択中）
            </Label>
            {informationTypes.length === 0 ? (
              <p className="text-xs text-gray-400">
                INPUT/OUTPUT マスタが空です。「INPUT/OUTPUT」ページで追加できます。
              </p>
            ) : (
              <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded border border-gray-200 p-2">
                {informationTypes.map((it) => (
                  <li key={it.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={ioIds.has(it.id)}
                        onChange={() => toggleIo(it.id)}
                        className="h-4 w-4 accent-blue-600"
                      />
                      <IoCategoryBadge category={it.category} />
                      <span className="truncate text-gray-700">{it.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {isCreate ? '作成' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
