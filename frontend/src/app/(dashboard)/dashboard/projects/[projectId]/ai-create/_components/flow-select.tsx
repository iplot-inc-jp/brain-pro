'use client';

/** 業務フローのセレクタ。ASIS / TOBE を optgroup でグループ分けして表示する。 */

import { useMemo } from 'react';
import type { BusinessFlowItem } from './types';

export function FlowSelect({
  flows,
  value,
  onChange,
  placeholder = 'フローを選択…',
  allowEmpty = false,
  emptyLabel = '指定なし',
  className,
}: {
  flows: BusinessFlowItem[];
  value: string;
  onChange: (flowId: string) => void;
  placeholder?: string;
  /** true のとき「指定なし」を選択肢に含める（任意選択） */
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const asis = useMemo(() => flows.filter((f) => f.kind === 'ASIS'), [flows]);
  const tobe = useMemo(() => flows.filter((f) => f.kind === 'TOBE'), [flows]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        'w-full max-w-md rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400'
      }
    >
      {allowEmpty ? (
        <option value="">{emptyLabel}</option>
      ) : (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {asis.length > 0 && (
        <optgroup label="ASIS（現状業務フロー）">
          {asis.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </optgroup>
      )}
      {tobe.length > 0 && (
        <optgroup label="TOBE（あるべき業務フロー）">
          {tobe.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
