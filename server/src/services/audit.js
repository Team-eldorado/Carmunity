import { id, fail, forbidden } from '../util.js';

// 실행 기록과 전후 영상.
// 상시 녹화는 하지 않고 실행 전후 각 10초만 남긴다. 72시간 뒤 자동 삭제, 분쟁 신고 시 30일 연장.
// 차주와 요청자 양쪽이 열람하고, 관리사무소·운영사는 분쟁 건만 열람한다.
export function createAudit(ctx) {
  const { db, rules } = ctx;

  function recordClip({ vehicleId, kind, refType, refId, parties }) {
    const c = {
      id: id('clip'),
      vehicleId,
      kind, // 'pre' | 'post'
      refType, // 'move' | 'trunk'
      refId,
      parties, // 열람 가능한 당사자 userId 목록
      durationSec: rules.clips.secondsEachSide,
      camera: refType === 'trunk' ? 'rear' : 'surround',
      // 실제 차량에서는 빌트인 캠 영상 URL이 들어간다. 시범 단계에서는 메타데이터만 남긴다.
      mediaUrl: null,
      recordedAt: ctx.now(),
      expiresAt: ctx.now() + rules.clips.retentionHours * 3600_000,
      disputeId: null,
    };
    db.clips.set(c.id, c);
    return c;
  }

  function clipsFor(userId, refId) {
    const u = ctx.user(userId);
    return [...db.clips.values()].filter((c) => {
      if (refId && c.refId !== refId) return false;
      if (c.parties.includes(userId)) return true;
      if (u.role === 'office' && c.disputeId) return true; // 분쟁 건만
      return false;
    });
  }

  function purgeExpired() {
    let n = 0;
    for (const c of db.clips.values()) {
      if (c.expiresAt <= ctx.now()) {
        db.clips.delete(c.id);
        n++;
      }
    }
    return n;
  }

  function openDispute({ reporterId, refType, refId, reason, auto = false }) {
    const d = {
      id: id('dsp'),
      reporterId,
      refType,
      refId,
      reason,
      auto,
      status: 'open',
      createdAt: ctx.now(),
    };
    db.disputes.set(d.id, d);
    for (const c of db.clips.values()) {
      if (c.refId === refId) {
        c.disputeId = d.id;
        c.expiresAt = Math.max(c.expiresAt, ctx.now() + rules.clips.disputeRetentionDays * 86400_000);
      }
    }
    ctx.log('dispute.opened', { disputeId: d.id, refType, refId, auto });
    return d;
  }

  function listDisputes(userId) {
    const u = ctx.user(userId);
    if (u.role !== 'office') throw forbidden('OFFICE_ONLY', '관리사무소 계정만 볼 수 있어요');
    return [...db.disputes.values()].filter((d) => {
      const ref = d.refType === 'move' ? db.moveRequests.get(d.refId) : db.trunkTokens.get(d.refId);
      return ref && ref.complexId === u.complexId;
    });
  }

  /** 신고 누적 시 토큰 발급·사용 정지 */
  function report(reporterId, targetUserId, reason) {
    if (reporterId === targetUserId) throw fail('INVALID', '본인은 신고할 수 없어요');
    const t = ctx.user(targetUserId);
    t.reports = (t.reports || 0) + 1;
    ctx.log('user.reported', { reporterId, targetUserId, reason });
    if (t.reports >= rules.safety.reportsToSuspend) {
      t.suspendedUntil = ctx.now() + rules.safety.suspendDays * 86400_000;
      ctx.notify(targetUserId, 'suspended', '신고가 누적돼 일주일 동안 요청과 토큰 사용이 정지됐어요');
    }
    return { reports: t.reports, suspendedUntil: t.suspendedUntil };
  }

  return { recordClip, clipsFor, purgeExpired, openDispute, listDisputes, report };
}
