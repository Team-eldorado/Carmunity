import { id, fail, forbidden, notFound } from '../util.js';

// 확장 기능 · 밀착 구역 (3단계 미리보기)
// 원격 비켜줘를 켠 차끼리는 문 열 공간이 필요 없다. 관리사무소가 기둥 사이 자투리를 '밀착 임시 구역'으로 지정하면,
// 앱이 입차 순서대로 빈 칸을 정해 주고, 차주는 칸 앞에 차를 세우고 내린 뒤 버튼을 누르는 동안만 차가 칸으로 들어간다.
// 나갈 때도 같은 방식으로 차를 칸 밖으로 꺼낸 뒤 탄다. (원격 전진은 RSPA 어댑터 + 모의 구현)
const TICK_MS = 200;

export function createCompact(ctx, deps) {
  const { db, rules } = ctx;
  const C = rules.compact;

  const zoneOf = (complexId) => ctx.complex(complexId).zones.find((z) => z.type === 'compact') || null;
  const slotsOf = (complexId) => {
    const z = zoneOf(complexId);
    return z ? ctx.complex(complexId).spots.filter((s) => s.zoneId === z.id).sort((a, b) => a.x - b.x) : [];
  };
  const eligible = (v) => !!(v.hasRspa && v.policy?.enabled && v.policy?.functions?.move);
  const active = (s) => ['guide', 'ready', 'moving', 'paused'].includes(s.status);

  function taken(complexId) {
    const ids = new Set();
    for (const v of db.vehicles.values()) {
      if (v.complexId !== complexId || !v.state.inComplex) continue;
      if (v.state.spotId) ids.add(v.state.spotId);
      if (v.home?.spotId) ids.add(v.home.spotId);
    }
    for (const s of db.compacts.values()) if (active(s)) ids.add(s.spotId);
    return ids;
  }

  /** 구역 요약: 칸 수, 같은 폭에 일반 구획이면 몇 대인지, 빈 칸 */
  function zoneInfo(complexId) {
    const z = zoneOf(complexId);
    if (!z) return null;
    const slots = slotsOf(complexId);
    const used = taken(complexId);
    return {
      id: z.id,
      name: z.name,
      total: slots.length,
      normalEquivalent: Math.floor((slots.length * C.pitchM) / 2.5),
      free: slots.filter((s) => !used.has(s.id)).length,
      slots: slots.map((s) => ({ id: s.id, label: s.label, taken: used.has(s.id) })),
    };
  }

  function get(sessionId) {
    const s = db.compacts.get(sessionId);
    if (!s) throw notFound('밀착 주차');
    return s;
  }

  function view(s) {
    const v = db.vehicles.get(s.vehicleId);
    const spot = ctx.spot(v.complexId, s.spotId);
    return {
      id: s.id, vehicleId: s.vehicleId, plate: v.plate, model: v.model, ownerId: s.ownerId,
      spotId: s.spotId, label: spot?.label, status: s.status, distance: s.distance, total: s.total, at: s.updatedAt,
      proximity: deps.proximity().view(s.vehicleId),
      occupied: Object.values(v.state.occupied || {}).some(Boolean),
    };
  }

  function publish(s) {
    s.updatedAt = ctx.now();
    const vw = view(s);
    ctx.bus.publish(`user:${s.ownerId}`, 'compact', vw);
    ctx.bus.publish('admin', 'compact', vw);
    ctx.toVehicle(s.vehicleId, 'compact.update', vw);
  }

  /** 내 차 기준 상태 (폰 화면) */
  function statusFor(userId) {
    const u = ctx.user(userId);
    if (!u.complexId) return null;
    const mine = [...db.vehicles.values()].filter((v) => v.ownerId === userId);
    const sessions = [...db.compacts.values()].filter((s) => s.ownerId === userId).sort((a, b) => b.createdAt - a.createdAt);
    return {
      zone: zoneInfo(u.complexId),
      vehicles: mine.map((v) => ({ id: v.id, plate: v.plate, model: v.model, eligible: eligible(v), inComplex: !!v.state.inComplex, parkedAt: v.state.spotId || null })),
      session: sessions[0] ? view(sessions[0]) : null,
    };
  }

  /** 빈 칸 안내 받기: 입차 순서대로 안쪽 칸부터 */
  function start(ownerId, vehicleId) {
    const v = ctx.vehicle(vehicleId);
    if (v.ownerId !== ownerId) throw forbidden('NOT_OWNER', '내 차만 세울 수 있어요');
    if (!eligible(v)) throw fail('NOT_ELIGIBLE', '원격 비켜줘를 켠 차만 밀착 구역에 세울 수 있어요');
    if (!v.state.inComplex) throw fail('OUT_OF_GEOFENCE', '지하주차장에 들어온 뒤 안내받을 수 있어요');
    if (v.state.spotId) throw fail('ALREADY_PARKED', '이미 주차된 차예요');
    for (const s of db.compacts.values()) if (s.vehicleId === v.id && active(s)) return view(s);
    const used = taken(v.complexId);
    const spot = slotsOf(v.complexId).find((x) => !used.has(x.id));
    if (!spot) throw fail('ZONE_FULL', '밀착 구역이 다 찼어요');
    const s = {
      id: id('cmp'), vehicleId: v.id, ownerId, complexId: v.complexId, spotId: spot.id,
      status: 'guide', // guide → ready → moving ⇄ paused → parked
      distance: 0, total: C.approachM, holdUntil: 0, createdAt: ctx.now(), updatedAt: ctx.now(),
    };
    db.compacts.set(s.id, s);
    ctx.log('compact.guided', { sessionId: s.id, vehicleId: v.id, spotId: spot.id });
    publish(s);
    return view(s);
  }

  /** 칸 앞에 세웠어요 (운전자가 직접 세움) */
  function atFront(ownerId, sessionId) {
    const s = get(sessionId);
    if (s.ownerId !== ownerId) throw forbidden('NOT_OWNER', '내 차만 세울 수 있어요');
    if (s.status !== 'guide') return view(s);
    const v = ctx.vehicle(s.vehicleId);
    const spot = ctx.spot(v.complexId, s.spotId);
    deps.vehicleState().update(v.id, { zoneId: spot.zoneId, pos: { x: spot.x, y: spot.y + s.total } }, 'app');
    s.status = 'ready';
    ctx.log('compact.front', { sessionId: s.id });
    publish(s);
    return view(s);
  }

  /** 차에서 내려 버튼을 누르는 동안만 칸으로 들어간다 */
  function hold(ownerId, sessionId) {
    const s = get(sessionId);
    if (s.ownerId !== ownerId) throw forbidden('NOT_OWNER', '내 차만 움직일 수 있어요');
    if (!['ready', 'moving', 'paused'].includes(s.status)) return { ok: false, status: s.status };
    // 차주가 차에서 내렸는지는 차량이 확인: 폰 위치(BLE)가 차 밖 + 착석 센서 비어 있음
    deps.proximity().requireOutside(s.vehicleId);
    const v = ctx.vehicle(s.vehicleId);
    if (Object.values(v.state.occupied || {}).some(Boolean)) throw fail('OCCUPIED', '차 안에 사람이 있으면 움직이지 않아요');
    s.holdUntil = ctx.now() + C.holdTimeoutMs;
    if (s.status !== 'moving') {
      s.status = 'moving';
      publish(s);
      ctx.schedule(`compact:${s.id}`, TICK_MS, () => tick(s.id));
    }
    return { ok: true, status: s.status, distance: s.distance };
  }

  function release(ownerId, sessionId) {
    const s = get(sessionId);
    if (s.ownerId !== ownerId) throw forbidden('NOT_OWNER', '내 차만 움직일 수 있어요');
    s.holdUntil = 0;
    return { ok: true };
  }

  function tick(sessionId) {
    const s = db.compacts.get(sessionId);
    if (!s || s.status !== 'moving') return;
    const v = ctx.vehicle(s.vehicleId);
    const spot = ctx.spot(v.complexId, s.spotId);
    if (ctx.now() > s.holdUntil) {
      s.status = 'paused';
      publish(s);
      return;
    }
    s.distance = Math.min(s.total, Math.round((s.distance + (C.speedMps * TICK_MS) / 1000) * 100) / 100);
    if (s.distance >= s.total) return complete(s, v, spot);
    v.state.pos = { x: spot.x, y: Math.round((spot.y + s.total - s.distance) * 100) / 100 };
    deps.vehicleState().publish(v);
    publish(s);
    ctx.schedule(`compact:${s.id}`, TICK_MS, () => tick(s.id));
  }

  function complete(s, v, spot) {
    s.status = 'parked';
    deps.vehicleState().update(v.id, { gear: 'P', spotId: spot.id }, 'app');
    deps.vehicleState().setHome(v.id, spot.id);
    ctx.notify(s.ownerId, 'compact', `${spot.label}에 문 열 간격 없이 세웠어요. 나갈 때도 버튼을 누르는 동안 차가 칸에서 나와요`, { sessionId: s.id });
    ctx.log('compact.parked', { sessionId: s.id, spotId: spot.id });
    publish(s);
  }

  /** 입차 직후 안내할 빈자리가 없을 때: 차량 화면에 밀착 구역 빈 칸을 알려 준다 */
  function offerOnArrival(v) {
    if (!eligible(v) || v.state.spotId) return null;
    if ([...db.compacts.values()].some((s) => s.vehicleId === v.id && active(s))) return null;
    const info = zoneInfo(v.complexId);
    if (!info || info.free <= 0) return null;
    const next = info.slots.find((s) => !s.taken);
    ctx.toVehicle(v.id, 'compact.offer', { zone: info, next, message: `가까운 빈자리가 없어요. ${info.name}에 ${info.free}칸 남았어요` });
    ctx.log('compact.offered', { vehicleId: v.id, spotId: next?.id });
    return info;
  }

  const activeFor = (vehicleId) => [...db.compacts.values()].some((s) => s.vehicleId === vehicleId && active(s));

  function list(complexId) {
    return [...db.compacts.values()].filter((s) => s.complexId === complexId).map(view);
  }

  return { start, atFront, hold, release, statusFor, zoneInfo, list, view, get, offerOnArrival, activeFor };
}
