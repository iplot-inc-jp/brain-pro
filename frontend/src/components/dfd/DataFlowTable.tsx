'use client';

/**
 * DataFlowTable — DFD のデータフロー一覧表。
 *
 * buildDataFlowRows(diagram.nodes, diagram.flows) で行を組み、
 * No./源泉/データ項目/宛先/方向/関連処理/帳票種別 を白テーマで描画する。
 * 帳票種別は Phase 3 で名前表示（現状は ID の有無のみチップ表示）。
 */

import { buildDataFlowRows, type DfdDiagram } from '@/lib/dfd';
import { ArrowDownLeft, ArrowUpRight, FileText } from 'lucide-react';

export function DataFlowTable({ diagram }: { diagram: DfdDiagram }) {
  const rows = buildDataFlowRows(diagram.nodes, diagram.flows);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-400">
        データフローがありません。図のノードをハンドルで接続するとデータフローが追加されます。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
            <th className="px-3 py-2 w-12">No.</th>
            <th className="px-3 py-2">源泉</th>
            <th className="px-3 py-2">データ項目</th>
            <th className="px-3 py-2">宛先</th>
            <th className="px-3 py-2 w-20">方向</th>
            <th className="px-3 py-2">関連処理</th>
            <th className="px-3 py-2 w-28">帳票種別</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.no} className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40">
              <td className="px-3 py-2 text-gray-500">{r.no}</td>
              <td className="px-3 py-2 text-gray-900">{r.source}</td>
              <td className="px-3 py-2 font-medium text-gray-900">{r.dataItem}</td>
              <td className="px-3 py-2 text-gray-900">{r.target}</td>
              <td className="px-3 py-2">
                {r.direction === 'IN' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                    <ArrowDownLeft className="h-3 w-3" />IN
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <ArrowUpRight className="h-3 w-3" />OUT
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-700">{r.relatedFunction || '—'}</td>
              <td className="px-3 py-2">
                {r.reportTypeId ? (
                  <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
                    <FileText className="h-3 w-3" />帳票
                  </span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
