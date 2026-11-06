import { createApp } from '../src/app.js';
import { FakeClock } from '../src/core.js';
import { seed } from '../src/seed.js';

/** 시드된 데모 단지 + 수동 시계 */
export function setup(startMs) {
  const clock = new FakeClock(startMs);
  const app = createApp({ clock });
  seed(app);
  clock.advance(10);
  return { app, clock, ctx: app.ctx };
}

/** 차량이 BLE로 잰 요청자 폰 위치 (가상 차량 값) */
export function ble(app, vehicleId, zone = 'side', distanceM = 1.4) {
  app.proximity.report(vehicleId, { zone, distanceM }, 'virtual');
}

/** 요청자가 버튼을 ms 동안 누르고 있음 (300ms 간격 신호). 차량은 요청자가 차 옆 1.4m에 있다고 잰다 */
export function holdFor(app, clock, userId, requestId, ms, pos = { nearSide: true, inPath: false }) {
  for (let t = 0; t < ms; t += 300) {
    const r = app.move.get(requestId);
    const it = r.items[r.cursor];
    if (it) ble(app, it.vehicleId, pos.inPath ? 'front' : 'side', pos.nearSide ? 1.4 : 3.5);
    try {
      app.move.hold(userId, requestId);
    } catch (e) {
      if (!['NOT_READY'].includes(e.code)) throw e;
    }
    clock.advance(300);
  }
}

export function notes(ctx, userId) {
  return ctx.db.notifications.filter((n) => n.userId === userId).map((n) => n.message);
}

/** KST 시각으로 시계 맞추기 */
export function kst(y, m, d, h, min = 0) {
  return Date.UTC(y, m - 1, d, h - 9, min, 0);
}
