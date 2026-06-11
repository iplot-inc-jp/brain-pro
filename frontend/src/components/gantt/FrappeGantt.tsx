'use client';

// frappe-gantt（MIT）のクライアント専用ラッパー。
//
// frappe-gantt は素の DOM/SVG を直接操作する命令型ライブラリのため、
// ページ側からは next/dynamic({ ssr:false }) で読み込み、ここで CSS を取り込む。
// React の管理する <div> に new Gantt(el, tasks, options) でマウントし、
// tasks の変化では refresh()、viewMode の変化では change_view_mode() を呼ぶ。
//
// コールバック（on_date_change / on_progress_change / on_click / onArrowClick）は
// ref 経由で最新の関数を呼ぶようにし、インスタンスを毎回作り直さなくても済むようにする。
//
// 依存（矢印）編集のため:
//  - mode='connect' のときはコンテナに接続用クラスを付け、バークリックを接続ロジックに回す
//    （実際のモード分岐はページ側 onClick が担う。ここでは見た目だけ切り替える）。
//  - pendingFromId のバーをハイライト（接続元の見える化）。
//  - 矢印 <path data-from data-to> の委譲クリックで onArrowClick(from,to) を呼ぶ。

import { useEffect, useRef } from 'react';
// frappe-gantt v1.2.2（MIT）の src をベンダリングしたローカルソース（./vendor/）。
// スクロール暴れ・カクカクドラッグ・矢印経路をソースレベルで修正している
// （変更点は ./vendor/README.md 参照）。型は既存の ambient 宣言を流用。
import Gantt, {
  type FrappeTask,
  type FrappeViewMode,
} from './vendor/index';
// frappe-gantt の package.json exports は CSS サブパスを公開しないため、
// dist/frappe-gantt.css をローカルにベンダリングして読み込む（MIT）。
import './frappe-gantt.vendor.css';

export type { FrappeTask, FrappeViewMode };

export interface FrappeGanttProps {
  tasks: FrappeTask[];
  viewMode: FrappeViewMode;
  /** バー本体ドラッグ／端リサイズ確定時。start/end はその日 0:00 / 終了日。 */
  onDateChange: (id: string, start: Date, end: Date) => void;
  /** 進捗ハンドル操作時（0..100）。 */
  onProgressChange: (id: string, progress: number) => void;
  /** バークリック時。 */
  onClick: (id: string) => void;
  /** 依存（矢印）クリック時。data-from=先行, data-to=後続。 */
  onArrowClick: (fromId: string, toId: string) => void;
  /** 'navigate'=クリックで詳細へ / 'connect'=クリックで依存を引く接続モード。 */
  mode: 'navigate' | 'connect';
  /** 接続モードで選択済みの先行タスク id（未選択は null）。バーをハイライトする。 */
  pendingFromId: string | null;
}

// frappe-gantt の内部 API（型定義が無い）に触れるための最小ナロー型。
// bars: 各バーは .task.id と .group（SVG <g class="bar-wrapper">）を持つ。
type GanttInternal = {
  bars?: { task: { id: string }; group: SVGGElement }[];
};

export default function FrappeGantt({
  tasks,
  viewMode,
  onDateChange,
  onProgressChange,
  onClick,
  onArrowClick,
  mode,
  pendingFromId,
}: FrappeGanttProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ganttRef = useRef<Gantt | null>(null);
  // インスタンス生成直後の tasks effect 1 回分を refresh せずスキップするためのフラグ。
  // マウント effect（生成側）が立て、tasks effect が消費する。
  const skipNextRefreshRef = useRef(false);

  // コールバックは最新参照を ref に保持（インスタンスは初回のみ生成するため）。
  const cbRef = useRef({ onDateChange, onProgressChange, onClick, onArrowClick });
  cbRef.current = { onDateChange, onProgressChange, onClick, onArrowClick };

  // 初回マウント: Gantt インスタンス生成 + 矢印クリックの委譲リスナー登録。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // frappe-gantt は渡したタスクオブジェクトを破壊的に書き換える（id/dependencies の
    // 正規化など）。React state を汚さないようプレーンコピーを渡す。
    const initial = tasks.map((t) => ({ ...t }));

    const gantt = new Gantt(el, initial, {
      view_mode: viewMode,
      language: 'ja',
      bar_height: 22,
      padding: 14,
      popup_on: 'hover',
      // 端に近づくと列を継ぎ足して scrollLeft を付け替える無限パディングは
      // 「瞬間移動・ズレ」の原因なので無効化（vendor 既定も false だが明示）。
      infinite_padding: false,
      on_date_change: (task, start, end) => {
        cbRef.current.onDateChange(String(task.id), start, end);
      },
      on_progress_change: (task, progress) => {
        cbRef.current.onProgressChange(String(task.id), progress);
      },
      on_click: (task) => {
        cbRef.current.onClick(String(task.id));
      },
    });
    ganttRef.current = gantt;
    // この直後に流れる tasks effect の refresh は不要（初期タスクは渡し済み）。
    // 実行させると scroll_to:'today' の初期スクロールが scrollLeft=0 で上書きされる。
    skipNextRefreshRef.current = true;

    // 矢印クリックは委譲リスナーで拾う。refresh() で矢印 <path> が作り直されても、
    // コンテナ自体は残るのでリスナーは生き続ける。
    const handleArrowClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const path = target?.closest?.('path[data-from]') as SVGPathElement | null;
      if (!path) return;
      const from = path.getAttribute('data-from');
      const to = path.getAttribute('data-to');
      if (from && to) cbRef.current.onArrowClick(from, to);
    };
    el.addEventListener('click', handleArrowClick);

    return () => {
      el.removeEventListener('click', handleArrowClick);
      // vendor 独自の destroy() で document に登録された mouseup リスナー等を
      // 解除してから DOM を空にする（再マウントのたびにリスナーが蓄積し
      // デタッチ済み DOM ごとリークするのを防ぐ）。
      ganttRef.current?.destroy();
      ganttRef.current = null;
      if (el) el.innerHTML = '';
    };
    // 初回のみ。tasks/viewMode の更新は別 effect で反映する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tasks 変化: refresh（現在の表示モードは維持される）。
  // vendor 側 refresh が「左端に見えている日付」を保ったまま再描画するため、
  // 保存→refresh のたびに today へスクロールが飛ぶことはない。
  // インスタンス生成直後の 1 回はスキップする: 初期タスクはコンストラクタに渡し済みで
  // refresh は不要な上、マウント直後の refresh が scroll_to:'today' の smooth スクロールを
  // scrollLeft=0 の保存/復元で中断し、初期表示が today でなく左端になってしまうため。
  // （単純な「初回フラグ」だと StrictMode の二重マウントで再マウント後の refresh を
  //  スキップできないので、生成側 effect が立てるフラグを消費する形にする。）
  useEffect(() => {
    if (skipNextRefreshRef.current) {
      skipNextRefreshRef.current = false;
      return;
    }
    const gantt = ganttRef.current;
    if (!gantt) return;
    gantt.refresh(tasks.map((t) => ({ ...t })));
  }, [tasks]);

  // viewMode 変化: change_view_mode（maintain_pos=true で現在位置を保つ）。
  // tasks 変化のたびに呼ぶと毎回 today へスクロールしてしまうため、
  // 実際に viewMode が変わったときだけ呼ぶ。
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    const gantt = ganttRef.current;
    if (!gantt || viewModeRef.current === viewMode) return;
    viewModeRef.current = viewMode;
    gantt.change_view_mode(viewMode, true);
  }, [viewMode]);

  // 接続モードの見た目（カーソル等）をコンテナのクラスで切り替える。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.classList.toggle('connect-mode', mode === 'connect');
  }, [mode]);

  // 接続元バーのハイライト。pendingFromId が変わるたびに前回分をクリアして付け直す。
  // refresh() でも DOM が作り直されるが、tasks 変化時はこの effect も pendingFromId
  // を維持したまま再評価されないため、refresh 直後はハイライトが外れる場合がある。
  // その場合 pendingFromId は接続成立時にクリアされる運用なので実害は無い。
  useEffect(() => {
    const gantt = ganttRef.current as (Gantt & GanttInternal) | null;
    if (!gantt) return;
    try {
      // frappe 内部 API（bars）に触れるため try/catch で囲う。
      const bars = gantt.bars ?? [];
      bars.forEach((b) => b.group?.classList?.remove('connect-source'));
      if (pendingFromId) {
        const bar = bars.find((b) => b.task.id === pendingFromId);
        bar?.group?.classList?.add('connect-source');
      }
    } catch (err) {
      console.error('Failed to highlight connect source:', err);
    }
  }, [pendingFromId, tasks]);

  return <div ref={containerRef} className="frappe-gantt-host" />;
}
