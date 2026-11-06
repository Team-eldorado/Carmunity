import { id, dayKey } from '../util.js';

// 틈 크레딧 원장. 잔액이 마이너스여도 요청은 가능하고, 마이너스는 관리비와 함께 정산한다.
export function createCredits(ctx) {
  const { db } = ctx;

  function grant(userId, delta, reason, ref = {}) {
    if (!delta) return null;
    const u = ctx.user(userId);
    const entry = { id: id('crd'), userId, delta: Math.round(delta), reason, ref, at: ctx.now() };
    db.ledger.push(entry);
    u.credits = (u.credits || 0) + entry.delta;
    ctx.bus.publish(`user:${userId}`, 'credit', { balance: u.credits, entry });
    for (const v of db.vehicles.values()) {
      if (v.ownerId === userId) ctx.toVehicle(v.id, 'credit.update', { balance: u.credits, entry });
    }
    return entry;
  }

  /** 같은 두 사람 사이 반복 거래는 하루 1회만 크레딧 인정 */
  function pairCreditedToday(a, b, kind) {
    const today = ctx.today();
    return db.ledger.some(
      (e) => e.reason === kind && dayKey(e.at) === today &&
        ((e.ref.requesterId === a && e.ref.ownerId === b) || (e.ref.requesterId === b && e.ref.ownerId === a)),
    );
  }

  function summary(userId) {
    const u = ctx.user(userId);
    const month = dayKey(ctx.now()).slice(0, 7);
    const mine = db.ledger.filter((e) => e.userId === userId);
    const thisMonth = mine.filter((e) => dayKey(e.at).startsWith(month));
    return {
      balance: u.credits || 0,
      monthMovesProvided: thisMonth.filter((e) => e.reason === 'MOVE_PROVIDE').length,
      monthTrunkProvided: thisMonth.filter((e) => e.reason === 'TRUNK_PROVIDE').length,
      monthVacancySignals: thisMonth.filter((e) => ['VACANCY_SIGNAL', 'SENSOR_SCAN'].includes(e.reason)).length,
      thanks: thisMonth.filter((e) => e.reason === 'MOVE_PROVIDE').map((e) => e.ref.thanks).filter(Boolean).slice(-5),
      recent: mine.slice(-20).reverse(),
      // 환원처: 관리비 차감(관리사무소 협약), E-pit 충전 할인, 블루링크 포인트 (시범 단지에서 단가 결정)
      redeemOptions: ['관리비 차감', 'E-pit 충전 할인', '블루링크 포인트'],
    };
  }

  return { grant, pairCreditedToday, summary };
}
