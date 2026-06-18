'use client';

// Liveblocks の課金は「接続中の1ユーザー×1ルーム×1分」の従量制。
// 背景タブで開きっぱなし・席を外して放置、の間も繋がっていると毎分課金されるため、
// このガードを RoomProvider 配下に置き、
//   - タブが非表示（document.hidden）になったら room を切断
//   - 一定時間（既定5分）無操作なら切断
//   - 再び表示/操作があったら再接続
// する。Yjs/プレゼンスは再接続時に再同期するためデータは失われない。
import { useEffect, useRef } from 'react';
import { useRoom } from '@/lib/liveblocks.config';

const DEFAULT_IDLE_MS = 5 * 60 * 1000; // 5分無操作で切断
const ACTIVITY_THROTTLE_MS = 1000;

export function RoomConnectionGuard({ idleMs = DEFAULT_IDLE_MS }: { idleMs?: number }) {
  const room = useRoom();
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedRef = useRef(true); // RoomProvider は既定で autoConnect=true（マウント時に接続済み）
  const lastActivityRef = useRef(0);

  useEffect(() => {
    const connect = () => {
      if (!connectedRef.current) {
        connectedRef.current = true;
        room.connect();
      }
    };
    const disconnect = () => {
      if (connectedRef.current) {
        connectedRef.current = false;
        room.disconnect();
      }
    };
    const clearIdle = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
    const armIdle = () => {
      clearIdle();
      idleTimerRef.current = setTimeout(disconnect, idleMs);
    };

    const onActivity = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      connect();
      armIdle();
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearIdle();
        disconnect();
      } else {
        connect();
        armIdle();
      }
    };

    // 初期状態：非表示で開かれたら即切断、表示中ならアイドル監視を開始。
    if (document.hidden) {
      disconnect();
    } else {
      armIdle();
    }

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'keydown',
      'pointerdown',
      'scroll',
      'touchstart',
      'wheel',
    ];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      clearIdle();
    };
  }, [room, idleMs]);

  return null;
}
