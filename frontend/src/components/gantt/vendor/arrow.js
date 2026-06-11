/*
 * Vendored from frappe-gantt v1.2.2 (MIT) — 変更点は ./README.md を参照。
 * calculate_path を「from バー右端中央 → to バー左端中央」の三次ベジェ曲線に書き換え。
 */
import { createSVG } from './svg_utils';

export default class Arrow {
    constructor(gantt, from_task, to_task) {
        this.gantt = gantt;
        this.from_task = from_task;
        this.to_task = to_task;

        this.calculate_path();
        this.draw();
    }

    calculate_path() {
        const from_bar = this.from_task.$bar;
        const to_bar = this.to_task.$bar;

        // 始点: from バーの右端中央。
        const start_x = from_bar.getEndX();
        const start_y = from_bar.getY() + from_bar.getHeight() / 2;

        // 終点: to バーの左端中央（バー外周の線にめり込まない程度に 2px 手前）。
        const end_x = to_bar.getX() - 2;
        const end_y = to_bar.getY() + to_bar.getHeight() / 2;

        const dx = end_x - start_x;
        const dy = end_y - start_y;

        // 三次ベジェの水平制御点オフセット。
        // - 通常（to が右）: 距離の半分（20〜120px にクランプ）でなだらかな S 字。
        // - to が左にある場合: 右に少し出てから回り込むよう大きめに取る。
        let c_off;
        if (dx >= 0) {
            c_off = Math.min(Math.max(dx / 2, 20), 120);
        } else {
            c_off = Math.min(40 + Math.abs(dx) / 2, 200);
        }

        // 制御点は基本的に水平（始点・終点それぞれの高さ）。
        // 同じ行で左へ戻るケースだけは下に膨らませて自分自身と重ならないようにする。
        let c1y = start_y;
        let c2y = end_y;
        if (dx < 0 && Math.abs(dy) < 1) {
            const bow =
                this.gantt.options.bar_height + this.gantt.options.padding / 2;
            c1y += bow;
            c2y += bow;
        }

        // 矢じり（m -5 -5 l 5 5 l -5 5）は従来実装と同じ。終端は水平制御点の
        // おかげで右向き（to バーの左側面に刺さる向き）に入る。
        this.path = `
            M ${start_x} ${start_y}
            C ${start_x + c_off} ${c1y},
              ${end_x - c_off} ${c2y},
              ${end_x} ${end_y}
            m -5 -5
            l 5 5
            l -5 5`;
    }

    draw() {
        // data-from / data-to はページ側の「矢印クリックで依存削除」が依存するため維持。
        this.element = createSVG('path', {
            d: this.path,
            'data-from': this.from_task.task.id,
            'data-to': this.to_task.task.id,
        });
    }

    update() {
        this.calculate_path();
        this.element.setAttribute('d', this.path);
    }
}
