import { id, dist, fail, forbidden } from '../util.js';

// 빈자리 레이더 1단계 · 출차 신호
// 참여 차량이 출차하면 그 자리가 '방금 빈 자리'로 공유되고, 입차 게이트를 지나 아직 주차하지 않은 차에게 안내한다.
export function createVacancy(ctx, deps) {
  const { db, rules } = ctx;
  const R = rules.vacancy;

  // ---------- 이벤트 ----------
  function onArrived(v) {
    for (const a of db.arrivals.values()) {
      if (a.vehicleId === v.id && a.status === 'waiting') a.status = 'left';
    }
    const a = {
      id: id('arr'),
      vehicleId: v.id,
      complexId: v.complexId,
      gateAt: ctx.now(),
      offersMade: 0,
      status: 'waiting', // waiting → parked | left
      heldVacancyId: null,
    };
    db.arrivals.set(a.id, a);
    // 입차 = 게이트 통과: 지도에서도 게이트에서 출발한다
    v.state.pos = { ...ctx.complex(v.complexId).gate };
    ctx.log('vacancy.arrived', { vehicleId: v.id });
    match(v.complexId);
    // 안내할 빈자리가 없으면, 자격 있는 차에게 밀착 구역을 안내한다
    const offered = [...db.offers.values()].some((o) => o.arrivalId === a.id && o.status === 'pending');
    if (!offered) deps.compact()?.offerOnArrival(v);
  }

  function onLeft(v) {
    for (const a of db.arrivals.values()) {
      if (a.vehicleId === v.id && a.status === 'waiting') a.status = 'left';
    }
    for (const o of db.offers.values()) {
      if (o.vehicleId === v.id && o.status === 'pending') closeOffer(o, 'left');
    }
  }

  function onDeparted(v) {
    const home = v.home;
    v.home = null;
    v.state.neutral = false;
    v.state.doubleParked = false;
    if (!home || !home.spotId) return null;
    if (!v.policy.functions.sensor) return null; // 차주가 센서·출차 신호 공유를 껐으면 공유하지 않음
    const spot = ctx.spot(v.complexId, home.spotId);
    if (!spot) return null;
    // 이중주차 줄은 빈자리 안내 대상이 아님, 밀착 구역은 자격 있는 차에게만 따로 안내
    if (['aisle', 'compact'].includes(ctx.zone(v.complexId, spot.zoneId)?.type)) return null;
    const vac = {
      id: id('vac'),
      complexId: v.complexId,
      spotId: spot.id,
      zoneId: spot.zoneId,
      pos: { x: spot.x, y: spot.y },
      fromVehicleId: v.id,
      createdAt: ctx.now(),
      status: 'open', // open → offered → held → filled | expired
      offerId: null,
      heldBy: null,
    };
    // 양옆에 주차된 참여 차가 빈 칸을 함께 확인 (2단계 센서 스캔의 자리. 지금은 주차 위치로 판정)
    vac.witnesses = witnessesOf(v, vac);
    db.vacancies.set(vac.id, vac);
    deps.credits().grant(v.ownerId, rules.credits.vacancySignal, 'VACANCY_SIGNAL', { vacancyId: vac.id });
    for (const w of vac.witnesses) {
      deps.credits().grant(db.vehicles.get(w.vehicleId).ownerId, rules.credits.sensorScan, 'SENSOR_SCAN', { vacancyId: vac.id });
    }
    ctx.log('vacancy.created', { vacancyId: vac.id, spotId: spot.id, from: v.id, witnesses: vac.witnesses.length });
    ctx.bus.publish('admin', 'vacancy', vac);
    match(v.complexId);
    return vac;
  }

  function witnessesOf(departed, vac) {
    const out = [];
    for (const o of db.vehicles.values()) {
      if (o.id === departed.id || o.complexId !== departed.complexId || !o.state.inComplex) continue;
      if (!o.home?.pos || !['P', 'N'].includes(o.state.gear) || !o.policy?.functions?.sensor) continue;
      if (dist(o.home.pos, vac.pos) > R.witnessRadiusM) continue;
      out.push({ vehicleId: o.id, plate: o.plate, model: o.model, spotId: o.home.spotId || null, pos: { ...o.home.pos } });
    }
    return out;
  }

  function onParked(v) {
    for (const a of db.arrivals.values()) {
      if (a.vehicleId === v.id && a.status === 'waiting') a.status = 'parked';
    }
    for (const o of db.offers.values()) {
      if (o.vehicleId === v.id && o.status === 'pending') closeOffer(o, 'parked');
    }
    if (v.state.spotId) {
      v.home = { spotId: v.state.spotId, zoneId: v.state.zoneId, pos: v.state.pos };
      onSpotTaken(v, v.state.spotId);
    }
    // 주차를 마치면 차량 화면이 묻는다
    const zone = v.state.zoneId ? ctx.zone(v.complexId, v.state.zoneId) : null;
    const prompts = [];
    // 밀착 구역에 세우는 중이면 차량 화면이 밀착 안내를 이어 가므로 질문하지 않는다
    if (deps.compact()?.activeFor(v.id)) {
      ctx.log('vacancy.parked', { vehicleId: v.id, spotId: v.state.spotId, compact: true });
      return;
    }
    if (!v.state.spotId) prompts.push({ kind: 'pick_spot', text: '어디에 세우셨나요? 내 자리를 골라 주세요' });
    if (v.hasRspa) {
      // 이미 켜져 있어도 매번 묻는다: '응'이면 유지, '아니'면 오늘은 쉼
      const on = v.policy.enabled && v.policy.functions.move && v.policy.pausedDay !== ctx.today();
      // 같은 날 이미 '응'으로 켜 둔 차는 다시 묻지 않는다
      if (!(on && v.movePromptDay === ctx.today())) prompts.push({ kind: 'enable_move', text: on ? '오늘 밤도 비켜줘를 켜 둘까요?' : '오늘 밤 비켜줘를 켜 둘까요?' });
    } else if (!v.hasRspa && (zone?.type === 'aisle' || v.state.doubleParked)) {
      prompts.push({ kind: 'register_neutral', text: '이중주차하셨네요. N으로 두셨으면 밀어도 되는 차로 등록할까요?' });
    }
    if (prompts.some((p) => p.kind === 'enable_move')) v.movePromptDay = ctx.today();
    if (prompts.length) ctx.toVehicle(v.id, 'parked.prompt', { prompts });
    ctx.log('vacancy.parked', { vehicleId: v.id, spotId: v.state.spotId });
  }

  /** 어떤 차가 자리에 섰다 → 그 자리의 빈자리는 '찼음' */
  function onSpotTaken(v, spotId) {
    for (const vac of db.vacancies.values()) {
      if (vac.spotId !== spotId || ['filled', 'expired'].includes(vac.status)) continue;
      const holder = vac.heldBy || (vac.offerId && db.offers.get(vac.offerId)?.vehicleId);
      vac.status = 'filled';
      if (vac.offerId) {
        const o = db.offers.get(vac.offerId);
        if (o && o.status === 'pending') closeOffer(o, 'filled', false);
      }
      if (holder && holder !== v.id) {
        ctx.toVehicle(holder, 'vacancy.filled', { message: '자리가 찼어요' });
        const a = activeArrival(holder);
        if (a) a.heldVacancyId = null;
      }
      ctx.bus.publish('admin', 'vacancy', vac);
    }
    match(v.complexId);
  }

  // ---------- 매칭 ----------
  function activeArrival(vehicleId) {
    for (const a of db.arrivals.values()) if (a.vehicleId === vehicleId && a.status === 'waiting') return a;
    return null;
  }

  function eligible(vac, vehicle) {
    const c = ctx.complex(vehicle.complexId);
    const spot = c.spots.find((s) => s.id === vac.spotId);
    if (!spot) return false;
    if (spot.type === 'disabled') return false; // 장애인 칸 제외
    if (spot.type === 'ev_charger') return vehicle.isEv && (vehicle.state.soc ?? 100) < R.chargerNeedSoc;
    // 비켜줘 실행 중 '잠시 비운 자리'는 안내하지 않음
    for (const other of db.vehicles.values()) {
      if (other.home?.spotId === vac.spotId && other.state.tempVacated) return false;
    }
    return true;
  }

  function score(vac, vehicle) {
    const c = ctx.complex(vehicle.complexId);
    const zoneOf = (zid) => c.zones.find((z) => z.id === zid);
    const vz = zoneOf(vehicle.state.zoneId);
    const sz = zoneOf(vac.zoneId);
    const spot = c.spots.find((s) => s.id === vac.spotId);
    const owner = db.users.get(vehicle.ownerId);
    let s = dist(vehicle.state.pos, vac.pos); // 가까운 순
    if (vz && sz && vz.floor !== sz.floor) s += 1000; // 같은 층 우선
    if (vz && sz && vz.id !== sz.id) s += 100; // 같은 구역 우선
    if (owner && spot?.nearDong && String(spot.nearDong) === String(owner.dong)) s -= 30; // 우리 동 입구 근처 선호
    if (vehicle.prefs?.wide && spot?.type === 'wide') s -= 20;
    return s;
  }

  function match(complexId) {
    const now = ctx.now();
    const open = [...db.vacancies.values()].filter((v) => v.complexId === complexId && v.status === 'open');
    for (const vac of open) {
      if (now - vac.createdAt > R.recentWindowMin * 60_000) vac.status = 'expired';
    }
    const arrivals = [...db.arrivals.values()]
      .filter((a) => a.complexId === complexId && a.status === 'waiting' && !a.heldVacancyId)
      .filter((a) => a.offersMade < R.maxOffersPerArrival)
      .filter((a) => ![...db.offers.values()].some((o) => o.arrivalId === a.id && o.status === 'pending'))
      .sort((a, b) => a.gateAt - b.gateAt); // 게이트 통과 시각 순
    for (const a of arrivals) {
      const vehicle = db.vehicles.get(a.vehicleId);
      if (!vehicle) continue;
      const declined = new Set([...db.offers.values()].filter((o) => o.arrivalId === a.id).map((o) => o.vacancyId));
      const candidates = [...db.vacancies.values()]
        .filter((v) => v.complexId === complexId && v.status === 'open' && !declined.has(v.id))
        .filter((v) => v.fromVehicleId !== a.vehicleId)
        .filter((v) => eligible(v, vehicle))
        .sort((x, y) => score(x, vehicle) - score(y, vehicle));
      if (candidates.length) offer(candidates[0], a, vehicle);
    }
  }

  function offer(vac, arrival, vehicle) {
    const c = ctx.complex(vehicle.complexId);
    const zone = c.zones.find((z) => z.id === vac.zoneId);
    const spot = c.spots.find((s) => s.id === vac.spotId);
    const agoMin = Math.max(0, Math.round((ctx.now() - vac.createdAt) / 60_000));
    const o = {
      id: id('ofr'),
      vacancyId: vac.id,
      arrivalId: arrival.id,
      vehicleId: vehicle.id,
      offeredAt: ctx.now(),
      expiresAt: ctx.now() + R.offerTimeoutSec * 1000,
      status: 'pending', // pending → accepted | declined | timeout | filled | left | parked
    };
    db.offers.set(o.id, o);
    vac.status = 'offered';
    vac.offerId = o.id;
    arrival.offersMade += 1;
    const when = agoMin === 0 ? '방금' : `${agoMin}분 전`;
    const seen = vac.witnesses?.length ? ` · 옆 차 ${vac.witnesses.length}대가 확인했어요` : '';
    const message = `${zone?.name || ''} 근처에 ${when} 한 자리 비었어요${seen}`;
    ctx.toVehicle(vehicle.id, 'vacancy.offer', {
      offerId: o.id,
      message,
      spot: { id: spot.id, label: spot.label, type: spot.type, x: spot.x, y: spot.y, lat: spot.lat, lng: spot.lng },
      zone: zone ? { id: zone.id, name: zone.name, floor: zone.floor } : null,
      expiresAt: o.expiresAt,
      witnesses: vac.witnesses?.length || 0,
      radar: radarOf(vac),
      speakOnce: true, // 운전 중에는 음성 1회와 화면 표시
    });
    ctx.schedule(`offer:${o.id}`, R.offerTimeoutSec * 1000, () => {
      if (o.status === 'pending') closeOffer(o, 'timeout');
    });
    ctx.log('vacancy.offered', { offerId: o.id, vacancyId: vac.id, vehicleId: vehicle.id });
    ctx.bus.publish('admin', 'vacancy', vac);
    return o;
  }

  /** 차량 화면용 빈자리 레이더: 그 열의 칸 배치, 방금 나간 차, 빈 칸을 확인한 옆 차 */
  function radarOf(vac) {
    const c = ctx.complex(vac.complexId);
    const zone = c.zones.find((z) => z.id === vac.zoneId);
    const witnessBySpot = new Map((vac.witnesses || []).filter((w) => w.spotId).map((w) => [w.spotId, w]));
    const takenBy = new Map();
    for (const o of db.vehicles.values()) {
      if (o.complexId !== vac.complexId || !o.state.inComplex) continue;
      const sid = o.home?.spotId || o.state.spotId;
      if (sid) takenBy.set(sid, o);
    }
    const from = db.vehicles.get(vac.fromVehicleId);
    return {
      zone: zone ? { id: zone.id, name: zone.name } : null,
      departed: from ? { plate: from.plate, model: from.model } : null,
      spots: c.spots.filter((s) => s.zoneId === vac.zoneId).sort((a, b) => a.x - b.x).map((s) => {
        const w = witnessBySpot.get(s.id);
        const o = takenBy.get(s.id);
        const state = s.id === vac.spotId ? 'vacant' : w ? 'witness' : o ? 'taken' : 'free';
        return { id: s.id, label: s.label, no: s.id.split('-').pop(), state, model: (w || o)?.model || null };
      }),
    };
  }

  function closeOffer(o, status, rematch = true) {
    ctx.cancel(`offer:${o.id}`);
    o.status = status;
    const vac = db.vacancies.get(o.vacancyId);
    if (vac && vac.offerId === o.id && vac.status === 'offered') {
      vac.status = 'open';
      vac.offerId = null;
    }
    if (status === 'timeout') ctx.toVehicle(o.vehicleId, 'vacancy.expired', { offerId: o.id });
    if (vac) {
      ctx.bus.publish('admin', 'vacancy', vac);
      if (rematch) match(vac.complexId);
    }
  }

  /** '응'(갈게요) / '아니' 응답 */
  function respond(offerId, vehicleId, accept) {
    const o = db.offers.get(offerId);
    if (!o) throw fail('OFFER_INVALID', '안내가 없어요');
    if (o.vehicleId !== vehicleId) throw forbidden('NOT_YOURS', '다른 차에 간 안내예요');
    if (o.status !== 'pending') throw fail('OFFER_CLOSED', o.status === 'filled' ? '자리가 찼어요' : '이미 지난 안내예요');
    const vac = db.vacancies.get(o.vacancyId);
    if (!accept) {
      closeOffer(o, 'declined');
      return { ok: true, status: 'declined' };
    }
    ctx.cancel(`offer:${o.id}`);
    o.status = 'accepted';
    vac.status = 'held';
    vac.heldBy = vehicleId;
    const a = db.arrivals.get(o.arrivalId);
    if (a) a.heldVacancyId = vac.id;
    ctx.log('vacancy.accepted', { offerId, vehicleId });
    ctx.bus.publish('admin', 'vacancy', vac);
    const spot = ctx.spot(vac.complexId, vac.spotId);
    return { ok: true, status: 'accepted', spot };
  }

  function list(complexId) {
    return [...db.vacancies.values()].filter((v) => v.complexId === complexId);
  }

  return { onArrived, onLeft, onDeparted, onParked, onSpotTaken, respond, match, list };
}
