/**
 * 共有リンクのOGP画像（URL貼付時のプレビュー）共通レンダラ。
 *
 * /share/** の各ルートの opengraph-image.tsx から使う。
 * - PUBLIC リンク: 図の簡易描画（ノード=色付きカード / 接続線=SVGパス）を画像化。
 *   Slack/Notion 等にURLを貼ると図のプレビューが展開される。
 * - ORG リンク / 無効トークン: 図の中身は出さず、プレースホルダカードを返す
 *   （unfurl は未認証で行われるため、組織限定の内容は漏らさない）。
 *
 * ImageResponse(Satori) は CJK グリフを動的ロードするため、日本語ラベルも描画される。
 * 描画は server（opengraph-image）で行うのでブラウザ非依存・常に図全体が入る。
 */

import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';
const NAVY = '#050f3e';

export interface OgBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** アクセント色（左帯・枠に使用） */
  color: string;
  label?: string;
}

export interface OgEdgeLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OgDiagramModel {
  title: string;
  subtitle?: string | null;
  /** ヘッダー右側の種別バッジ（例: 業務フロー / DFD） */
  badge: string;
  boxes: OgBox[];
  edges: OgEdgeLine[];
}

/** 共有閲覧APIを未認証で叩く（OG用）。401/403/404 は null（プレースホルダへ）。 */
export async function fetchForOg<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** ボックス群のバウンディングボックス。 */
function boundsOf(boxes: OgBox[]): { x: number; y: number; w: number; h: number } {
  if (boxes.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
}

const HEADER_H = 72;
const PAD = 36;

/** 図の簡易描画つきOGP画像。 */
export function renderShareOgImage(model: OgDiagramModel): ImageResponse {
  const bodyW = OG_SIZE.width - PAD * 2;
  const bodyH = OG_SIZE.height - HEADER_H - PAD * 2;
  const bb = boundsOf(model.boxes);
  const s = Math.min(bodyW / bb.w, bodyH / bb.h, 1.2);
  const offX = PAD + (bodyW - bb.w * s) / 2 - bb.x * s;
  const offY = HEADER_H + PAD + (bodyH - bb.h * s) / 2 - bb.y * s;
  // 縮尺が小さすぎるときはラベルを省く（読めないため）
  const showLabels = s >= 0.3;
  const fontSize = Math.max(11, Math.min(18, Math.round(15 * s)));

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#f8fafc',
          fontFamily: 'sans-serif',
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            height: HEADER_H,
            padding: '0 28px',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: NAVY,
              color: '#ffffff',
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            B
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: '#111827' }}>
              {model.title.slice(0, 40)}
            </div>
            {model.subtitle ? (
              <div style={{ display: 'flex', fontSize: 14, color: '#9ca3af' }}>
                {model.subtitle.slice(0, 60)}
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: 'flex',
              marginLeft: 'auto',
              padding: '6px 14px',
              borderRadius: 9999,
              backgroundColor: '#eef2ff',
              color: '#4f46e5',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {model.badge}
          </div>
        </div>

        {/* 図（接続線 → ノードの順に重ねる）。
            接続線は Satori の svg パス座標が不安定なため、回転divの直線で描く。 */}
        <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
          {model.edges.map((e, i) => {
            const x1 = e.x1 * s + offX;
            const y1 = e.y1 * s + offY - HEADER_H;
            const x2 = e.x2 * s + offX;
            const y2 = e.y2 * s + offY - HEADER_H;
            const len = Math.hypot(x2 - x1, y2 - y1);
            const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
            // Satori は transform-origin を無視して要素中心で回転するため、
            // 線分の中点に中心を合わせて置き、中心回転で両端点を一致させる。
            return (
              <div
                key={`e${i}`}
                style={{
                  position: 'absolute',
                  left: (x1 + x2) / 2 - len / 2,
                  top: (y1 + y2) / 2 - 1,
                  width: len,
                  height: 2,
                  backgroundColor: '#cbd5e1',
                  transform: `rotate(${ang}deg)`,
                }}
              />
            );
          })}
          {model.boxes.map((b, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: b.x * s + offX,
                top: b.y * s + offY - HEADER_H,
                width: Math.max(b.w * s, 8),
                height: Math.max(b.h * s, 8),
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderLeft: `${Math.max(3, Math.round(5 * s))}px solid ${b.color}`,
                borderRadius: Math.max(4, Math.round(8 * s)),
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                padding: `0 ${Math.max(4, Math.round(8 * s))}px`,
              }}
            >
              {showLabels && b.label ? (
                <div
                  style={{
                    display: 'flex',
                    fontSize,
                    color: '#1f2937',
                    overflow: 'hidden',
                  }}
                >
                  {b.label.slice(0, 24)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}

/** ORGリンク/無効トークン用のプレースホルダカード（図の中身は出さない）。 */
export function renderShareOgFallback(badge: string): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          backgroundColor: NAVY,
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 88,
            height: 88,
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.12)',
            fontSize: 48,
            fontWeight: 700,
          }}
        >
          B
        </div>
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 700 }}>Brain Pro</div>
        <div style={{ display: 'flex', fontSize: 22, color: 'rgba(255,255,255,0.75)' }}>
          {badge}の共有リンク（開いて閲覧）
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
