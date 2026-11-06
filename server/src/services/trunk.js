import { id, fail, forbidden, notFound, dayKey } from '../util.js';

// 기능 3 · 트렁크 드롭
// 차주가 상대 계정을 지정해 트렁크 1회 개방 토큰(10분, 지하주차장 안)을 발급한다.
// 넣어 주세요(당근 거래·대신 받은 택배)와 꺼내 가세요(빌려준 물건·판 물건) 두 가지로 쓴다.
// 주는 쪽이 차 옆에서 '열기'를 누르면 테일게이트만 열리고, 닫으면 개폐 기록·전후 영상이 양쪽에 남는다.
export function createTrunk(ctx, deps) {
  const { db, rules } = ctx;
  const T = rules.trunk;

  function get(tokenId) {
    const t = db.trunkTokens.get(tokenId);
    if (!t) throw notFound('트렁크 토큰');
    return t;
  }

  function view(t, forUserId) {
    const giver = db.users.get(t.giverId);
    const owner = db.users.get(t.ownerId);
    const v = db.vehicles.get(t.vehicleId);
    return {
      id: t.id,
      status: t.status,
      vehicle: v ? { id: v.id, plate: v.plate, model: v.model, zone: v.state.zoneId ? ctx.zone(v.complexId, v.state.zoneId)?.name : null } : null,
      owner: deps.accounts().publicUser(owner),
      giver: deps.accounts().publicUser(giver),
      firstTrade: t.firstTrade,
      issuedAt: t.issuedAt,
      expiresAt: t.expiresAt,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      warnings: t.warnings,
      isOwner: forUserId === t.ownerId,
      isGiver: forUserId === t.giverId,
      clipIds: t.clipIds,
      note: t.note,
      purpose: t.purpose || 'drop',
      proximity: deps.proximity().view(t.vehicleId),
    };
  }

  function usedToday(userId) {
    const today = ctx.today();
    return [...db.trunkTokens.values()].filter(
      (t) => (t.ownerId === userId || t.giverId === userId) && dayKey(t.issuedAt) === today && t.status !== 'cancelled',
    ).length;
  }

  /**
   * 토큰 발급 (받는 쪽 차주)
   * @param {{vehicleId, giverNickname?, giverId?, valuablesRemoved:boolean, note?:string, purpose?:'drop'|'pickup'}} input
   */
  function issue(ownerId, input) {
    const owner = ctx.user(ownerId);
    deps.accounts().assertActive(owner);
    const v = ctx.vehicle(input.vehicleId);
    if (v.ownerId !== ownerId) throw forbidden('NOT_OWNER', '내 차 트렁크만 열어 줄 수 있어요');
    const giver = input.giverId
      ? ctx.user(input.giverId)
      : [...db.users.values()].find((u) => u.complexId === owner.complexId && u.nickname === input.giverNickname);
    if (!giver) throw fail('GIVER_NOT_FOUND', '상대 계정을 찾을 수 없어요');
    if (giver.id === ownerId) throw fail('INVALID', '본인에게는 발급할 수 없어요');
    deps.accounts().assertActive(giver);
    if (giver.complexId !== owner.complexId) throw forbidden('OTHER_COMPLEX', '같은 단지 입주민끼리만 쓸 수 있어요');
    // 귀중품 확인을 거쳐야 발급
    if (!input.valuablesRemoved) throw fail('VALUABLES', '트렁크 안 귀중품을 꺼냈는지 먼저 확인해 주세요');
    if (!v.state.inComplex) throw fail('OUT_OF_GEOFENCE', '차가 지하주차장 안에 있을 때만 발급할 수 있어요');
    if (usedToday(ownerId) >= T.dailyLimit || usedToday(giver.id) >= T.dailyLimit) {
      throw fail('DAILY_LIMIT', `트렁크 드롭은 하루 ${T.dailyLimit}회까지예요`);
    }
    const firstTrade = ![...db.trunkTokens.values()].some(
      (t) => t.status === 'completed' && ((t.ownerId === ownerId && t.giverId === giver.id) || (t.ownerId === giver.id && t.giverId === ownerId)),
    );
    const warnings = ['현금·귀중품·상온에서 상하는 식품·위험물·생물은 넣을 수 없어요'];
    if (v.trunkThrough) warnings.push('트렁크와 실내가 이어진 차종이에요. 뒷좌석에 물건을 두지 마세요');
    warnings.push('러기지 스크린을 닫아 두세요');
    const t = {
      id: id('trk'),
      complexId: owner.complexId,
      vehicleId: v.id,
      ownerId,
      giverId: giver.id,
      firstTrade,
      warnings,
      note: input.note || '',
      purpose: input.purpose === 'pickup' ? 'pickup' : 'drop', // drop: 넣어 주세요 · pickup: 꺼내 가세요
      issuedAt: ctx.now(),
      expiresAt: ctx.now() + T.ttlMin * 60_000,
      status: 'issued', // issued → opening → open → completed | expired | cancelled | unclosed
      openedAt: null,
      closedAt: null,
      clipIds: [],
    };
    db.trunkTokens.set(t.id, t);
    ctx.schedule(`trunk:${t.id}`, T.ttlMin * 60_000, () => {
      if (t.status === 'issued') {
        t.status = 'expired';
        publish(t, '트렁크 토큰이 만료됐어요');
      }
    });
    const ask = t.purpose === 'pickup' ? '물건을 꺼내 가세요' : '물건을 넣어 주세요';
    ctx.notify(giver.id, 'trunk', `${owner.dong}동 ${owner.nickname}님이 ${v.plate} 트렁크를 ${T.ttlMin}분 동안 열 수 있게 해 줬어요 · ${ask}${firstTrade ? ' (첫 거래)' : ''}`, { tokenId: t.id });
    ctx.log('trunk.issued', { tokenId: t.id, vehicleId: v.id, giverId: giver.id });
    publish(t);
    return view(t, ownerId);
  }

  /** 주는 쪽이 차 옆에서 '열기' */
  function open(giverId, tokenId) {
    const t = get(tokenId);
    if (t.giverId !== giverId) throw forbidden('TOKEN_NOT_YOURS', '토큰은 차주가 지정한 계정만 쓸 수 있어요');
    deps.accounts().assertActive(ctx.user(giverId));
    if (t.status !== 'issued') throw fail('TOKEN_CLOSED', '이미 쓰였거나 만료된 토큰이에요');
    if (t.expiresAt <= ctx.now()) {
      t.status = 'expired';
      throw fail('TOKEN_EXPIRED', '토큰이 만료됐어요');
    }
    // 주는 쪽이 차 옆(트렁크 뒤)에 있는지는 차량이 BLE로 확인
    deps.proximity().requireTrunk(t.vehicleId);
    const v = ctx.vehicle(t.vehicleId);
    if (!v.state.inComplex) throw fail('OUT_OF_GEOFENCE', '지하주차장 밖에서는 토큰이 무효예요');
    ctx.cancel(`trunk:${t.id}`);
    t.status = 'opening';
    // 개방 직전부터 후방 카메라 녹화 (녹화 중 미등 점멸로 촬영 고지)
    const pre = deps.audit().recordClip({ vehicleId: v.id, kind: 'pre', refType: 'trunk', refId: t.id, parties: [t.ownerId, t.giverId] });
    t.clipIds.push(pre.id);
    ctx.toVehicle(v.id, 'trunk.open', { tokenId: t.id });
    publish(t, '트렁크를 여는 중이에요');
    return view(t, giverId);
  }

  /** 차량 보고: 'opened' | 'closed' | 'failed' */
  function onState(vehicleId, tokenId, state, reason = null) {
    const t = get(tokenId);
    if (t.vehicleId !== vehicleId) throw fail('INVALID', '다른 차의 토큰이에요');
    const v = ctx.vehicle(vehicleId);
    if (state === 'opened') {
      t.status = 'open';
      t.openedAt = ctx.now();
      ctx.schedule(`trunkOwner:${t.id}`, T.unclosedOwnerAlertMin * 60_000, () => unclosedOwner(t.id));
      publish(t, `테일게이트만 열렸어요. 실내 도어는 잠긴 채예요. 물건을 ${t.purpose === 'pickup' ? '꺼내고' : '넣고'} 닫아 주세요`);
    } else if (state === 'closed') {
      if (!['open', 'opening', 'unclosed'].includes(t.status)) return view(t);
      for (const k of ['trunkOwner', 'trunkOffice']) ctx.cancel(`${k}:${t.id}`);
      t.status = 'completed';
      t.closedAt = ctx.now();
      const post = deps.audit().recordClip({ vehicleId: v.id, kind: 'post', refType: 'trunk', refId: t.id, parties: [t.ownerId, t.giverId] });
      t.clipIds.push(post.id);
      const giver = ctx.user(t.giverId);
      const done = t.purpose === 'pickup' ? '물건을 가져갔어요' : '물건이 도착했어요';
      ctx.notify(t.ownerId, 'trunk.arrived', `${done} · ${giver.nickname}님, ${fmt(t.openedAt)}~${fmt(t.closedAt)}`, { tokenId: t.id, clipIds: t.clipIds });
      ctx.notify(t.giverId, 'trunk', '전달을 마쳤어요. 개폐 기록과 영상이 남았어요', { tokenId: t.id, clipIds: t.clipIds });
      deps.credits().grant(t.ownerId, rules.credits.trunkProvide, 'TRUNK_PROVIDE', { tokenId: t.id });
      ctx.log('trunk.completed', { tokenId: t.id });
      publish(t, done);
    } else if (state === 'failed') {
      t.status = 'issued';
      t.expiresAt = Math.max(t.expiresAt, ctx.now() + 60_000);
      publish(t, `트렁크를 열지 못했어요${reason ? `: ${reason}` : ''}`);
    }
    return view(t);
  }

  /** 닫힘 미감지: 차주에게 즉시 알림, 자동 재잠금 시도, 10분 뒤에도 열려 있으면 관리사무소 알림 */
  function unclosedOwner(tokenId) {
    const t = db.trunkTokens.get(tokenId);
    if (!t || t.status !== 'open') return;
    t.status = 'unclosed';
    ctx.notify(t.ownerId, 'trunk.unclosed', '트렁크가 아직 열려 있어요. 자동으로 닫기를 시도할게요', { tokenId });
    ctx.toVehicle(t.vehicleId, 'trunk.close', { tokenId });
    ctx.schedule(`trunkOffice:${t.id}`, (T.unclosedOfficeAlertMin - T.unclosedOwnerAlertMin) * 60_000, () => {
      const tt = db.trunkTokens.get(tokenId);
      if (!tt || tt.status !== 'unclosed') return;
      const c = ctx.complex(tt.complexId);
      const v = ctx.vehicle(tt.vehicleId);
      for (const officeId of c.officeUserIds) {
        ctx.notify(officeId, 'office', `${v.plate} 트렁크가 10분 넘게 열려 있어요. 확인 부탁드려요`, { tokenId });
      }
    });
    publish(t, '트렁크가 열려 있어요. 차주에게 알렸어요');
  }

  function cancel(ownerId, tokenId) {
    const t = get(tokenId);
    if (t.ownerId !== ownerId) throw forbidden('NOT_OWNER', '발급한 차주만 취소할 수 있어요');
    if (t.status !== 'issued') throw fail('TOKEN_CLOSED', '이미 쓰인 토큰이에요');
    ctx.cancel(`trunk:${t.id}`);
    t.status = 'cancelled';
    publish(t, '차주가 토큰을 취소했어요');
    return view(t, ownerId);
  }

  function listFor(userId) {
    return [...db.trunkTokens.values()]
      .filter((t) => t.ownerId === userId || t.giverId === userId)
      .sort((a, b) => b.issuedAt - a.issuedAt)
      .slice(0, 20)
      .map((t) => view(t, userId));
  }

  function publish(t, text) {
    for (const uid of [t.ownerId, t.giverId]) ctx.bus.publish(`user:${uid}`, 'trunk', { ...view(t, uid), text });
    ctx.toVehicle(t.vehicleId, 'trunk.update', { token: view(t, t.ownerId), text });
    ctx.bus.publish('admin', 'trunk', { ...view(t), text });
  }

  return { issue, open, onState, cancel, listFor, view, get };
}

function fmt(ms) {
  const d = new Date(ms + 9 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
