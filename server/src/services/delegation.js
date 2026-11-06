import { fail, forbidden, id, isQuietHour } from '../util.js';

// 위임 토큰: 차주가 한 번 정해 두는 조건. 조건에 맞는 요청이 오면 1회용 토큰을 발급한다.
export function createDelegation(ctx) {
  const { db, rules } = ctx;

  function updatePolicy(ownerId, vehicleId, patch) {
    const v = ctx.vehicle(vehicleId);
    if (v.ownerId !== ownerId) throw forbidden('NOT_OWNER', '내 차만 설정할 수 있어요');
    const p = structuredClone(v.policy);
    if (patch.enabled !== undefined) p.enabled = !!patch.enabled;
    if (patch.functions) {
      for (const k of ['move', 'trunk', 'sensor']) {
        if (patch.functions[k] !== undefined) p.functions[k] = !!patch.functions[k];
      }
    }
    if (patch.scope) {
      const type = patch.scope.type === 'dongs' ? 'dongs' : 'complex';
      const dongs = Array.isArray(patch.scope.dongs) ? patch.scope.dongs.map(String) : [];
      if (type === 'dongs' && dongs.length === 0) throw fail('INVALID', '허용할 동을 하나 이상 골라 주세요');
      p.scope = { type, dongs };
    }
    if (patch.dailyMoveLimit !== undefined) {
      const n = Number(patch.dailyMoveLimit);
      if (!Number.isInteger(n) || n < 0 || n > rules.move.defaultVehicleDaily) {
        throw fail('INVALID', `하루 횟수는 0~${rules.move.defaultVehicleDaily}회로 정할 수 있어요`);
      }
      p.dailyMoveLimit = n;
    }
    if (patch.allowNight !== undefined) p.allowNight = !!patch.allowNight;
    if (patch.pausedToday !== undefined) p.pausedDay = patch.pausedToday ? ctx.today() : null;
    if (p.functions.move && !v.hasRspa) {
      // 원격 전·후진이 없는 차는 이동 위임 대신 중립 표시로 참여
      p.functions.move = false;
    }
    p.updatedAt = ctx.now();
    v.policy = p;
    ctx.log('policy.updated', { vehicleId, ownerId, policy: p });
    ctx.toVehicle(vehicleId, 'policy.update', { policy: p });
    ctx.bus.publish(`user:${ownerId}`, 'policy', { vehicleId, policy: p });
    return p;
  }

  /** 철회: 즉시 모든 위임을 끄고 남은 토큰을 무효화 */
  function revokeAll(ownerId, vehicleId) {
    updatePolicy(ownerId, vehicleId, { enabled: false });
    for (const t of db.tokens.values()) {
      if (t.vehicleId === vehicleId && t.status === 'active') {
        t.status = 'revoked';
        t.closedAt = ctx.now();
      }
    }
    ctx.toVehicle(vehicleId, 'move.abort', { reason: 'REVOKED' });
  }

  /**
   * 위임 조건 검사. fn: 'move' | 'trunk' | 'sensor'
   * @returns {{ok:boolean, code?:string, message?:string, night?:boolean}}
   */
  function check(vehicle, requester, fn) {
    const p = vehicle.policy;
    const no = (code, message) => ({ ok: false, code, message });
    if (!p.enabled || !p.functions[fn]) return no('NOT_DELEGATED', '차주가 이 기능을 허락하지 않았어요');
    if (p.pausedDay === ctx.today()) return no('PAUSED_TODAY', '차주가 오늘은 쉬기로 했어요');
    if (requester.complexId !== vehicle.complexId) return no('OTHER_COMPLEX', '같은 단지 입주민만 요청할 수 있어요');
    if (p.scope.type === 'dongs' && !p.scope.dongs.includes(String(requester.dong))) {
      return no('OUT_OF_SCOPE', '차주가 허락한 동이 아니에요');
    }
    if (!vehicle.state.inComplex) return no('OUT_OF_GEOFENCE', '지하주차장 밖에서는 위임이 무효예요');
    const night = isQuietHour(ctx.now(), rules.quietHours);
    if (fn === 'move' && night && !p.allowNight) return no('QUIET_HOURS', '23시~06시에는 차주가 허락한 경우에만 움직여요');
    return { ok: true, night };
  }

  function issueToken({ vehicleId, grantedTo, kind, requestId = null, maxMeters = 0 }) {
    const t = {
      id: id('tok'),
      vehicleId,
      grantedTo,
      kind, // 'move' | 'trunk'
      requestId,
      maxMeters,
      issuedAt: ctx.now(),
      expiresAt: ctx.now() + rules.token.ttlMin * 60_000,
      status: 'active', // active → used | expired | revoked
      usedAt: null,
      closedAt: null,
    };
    db.tokens.set(t.id, t);
    ctx.schedule(`token:${t.id}`, rules.token.ttlMin * 60_000, () => expireToken(t.id));
    return t;
  }

  function expireToken(tokenId) {
    const t = db.tokens.get(tokenId);
    if (t && t.status === 'active') {
      t.status = 'expired';
      t.closedAt = ctx.now();
      ctx.bus.publish('admin', 'token.expired', { tokenId });
    }
  }

  /** 토큰 검증: 지정 계정만, 지오펜스 안에서만, 유효기간 안에서만 */
  function validateToken(tokenId, userId, kind) {
    const t = db.tokens.get(tokenId);
    if (!t) throw fail('TOKEN_INVALID', '토큰이 없어요');
    if (t.kind !== kind) throw fail('TOKEN_INVALID', '용도가 다른 토큰이에요');
    if (t.grantedTo !== userId) throw forbidden('TOKEN_NOT_YOURS', '토큰은 차주가 지정한 계정만 쓸 수 있어요');
    if (t.status !== 'active') throw fail('TOKEN_CLOSED', '이미 쓰였거나 만료된 토큰이에요');
    if (t.expiresAt <= ctx.now()) {
      expireToken(t.id);
      throw fail('TOKEN_EXPIRED', '토큰이 만료됐어요');
    }
    const v = ctx.vehicle(t.vehicleId);
    if (!v.state.inComplex) throw fail('OUT_OF_GEOFENCE', '지하주차장 밖에서는 토큰이 무효예요');
    return t;
  }

  function consumeToken(tokenId) {
    const t = db.tokens.get(tokenId);
    if (!t) return;
    ctx.cancel(`token:${t.id}`);
    if (t.status === 'active') {
      t.status = 'used';
      t.usedAt = ctx.now();
      t.closedAt = ctx.now();
    }
  }

  return { updatePolicy, revokeAll, check, issueToken, validateToken, consumeToken, expireToken };
}
