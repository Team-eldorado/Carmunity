import { id, fail, forbidden, notFound, dayKey } from '../util.js';
import { evaluateInterlock } from './interlock.js';

// 기능 1 · 비켜줘
// 조건부 위임 실행 흐름: 요청 → 위임 조건 확인 → 30초 거부 창 → 토큰 발급 → 차량 자가 점검(인터록)
// → 요청자가 차 옆에서 버튼을 누르는 동안만 보행 속도로 최대 3m 이동 → P 체결, 전후 영상·로그, 크레딧 → 복귀.
// 어느 단계에서든 조건에 안 맞으면 차는 움직이지 않고 '차주에게 연락'으로 넘어간다.

const TERMINAL = new Set(['DENIED', 'REJECTED', 'INTERLOCK_FAILED', 'ABORTED', 'EXPIRED', 'CANCELLED', 'RETURNED', 'CONTACT_STOPPED', 'RETURN_BLOCKED']);
const COUNTED = (r) => !['DENIED', 'REJECTED', 'INTERLOCK_FAILED', 'CANCELLED'].includes(r.status);
const INTERLOCK_TIMEOUT_MS = 10_000;

export function createMoveRequests(ctx, deps) {
  const { db, rules } = ctx;
  const M = rules.move;

  // ---------------- 조회/표시 ----------------
  function get(requestId) {
    const r = db.moveRequests.get(requestId);
    if (!r) throw notFound('요청');
    return r;
  }

  function view(r, forUserId = null) {
    const requester = db.users.get(r.requesterId);
    return {
      id: r.id,
      status: r.status,
      night: r.night,
      createdAt: r.createdAt,
      vetoEndsAt: r.vetoEndsAt,
      returnDeadline: r.returnDeadline,
      cursor: r.cursor,
      tidyAvailable: r.tidyAvailable,
      requester: deps.accounts().publicUser(requester),
      isRequester: forUserId === r.requesterId,
      items: r.items.map((it) => {
        const v = db.vehicles.get(it.vehicleId);
        return {
          vehicleId: it.vehicleId,
          plate: v?.plate,
          model: v?.model,
          direction: it.direction,
          maxMeters: it.maxMeters,
          veto: it.veto,
          status: it.status,
          distance: round(it.distance),
          returned: round(it.returned),
          retries: it.retries,
          interlock: it.interlock,
          proximity: deps.proximity().view(it.vehicleId),
          isOwner: forUserId === it.ownerId,
        };
      }),
      timeline: r.timeline.slice(-30),
      fallback: r.fallback,
    };
  }

  function push(r, text, kind = 'info') {
    r.timeline.push({ at: ctx.now(), text, kind });
    const parties = new Set([r.requesterId, ...r.items.map((i) => i.ownerId)]);
    for (const uid of parties) ctx.bus.publish(`user:${uid}`, 'move', view(r, uid));
    for (const it of r.items) ctx.toVehicle(it.vehicleId, 'move.update', { request: view(r, it.ownerId) });
    ctx.bus.publish('admin', 'move', view(r));
  }

  // ---------------- 생성 ----------------
  /**
   * @param {string} requesterId
   * @param {{targets: {plate:string, direction?:'forward'|'backward'}[]}} input
   *   targets: 막힌 차를 바깥쪽부터 순서대로
   */
  function create(requesterId, input) {
    const requester = ctx.user(requesterId);
    deps.accounts().assertActive(requester);
    const targets = (input.targets || []).filter((t) => t && t.plate);
    if (targets.length === 0) throw fail('INVALID', '막힌 차 번호판을 입력해 주세요');
    if (targets.length > 4) throw fail('INVALID', '한 번에 4대까지 요청할 수 있어요');

    const today = ctx.today();
    const mineToday = [...db.moveRequests.values()].filter(
      (r) => r.requesterId === requesterId && dayKey(r.createdAt) === today && COUNTED(r),
    );
    if (mineToday.length >= M.perRequesterDaily) {
      return deny(requester, null, 'REQUESTER_DAILY', `요청은 하루 ${M.perRequesterDaily}회까지예요. 차주에게 연락할게요`, targets);
    }

    const items = [];
    for (const t of targets) {
      const v = ctx.vehicleByPlate(t.plate);
      if (!v) return deny(requester, null, 'NOT_PARTICIPANT', `${t.plate}은(는) 참여 차량이 아니에요. 안심번호로 연락해 주세요`, targets);
      const reason = validateTarget(v, requester, t, mineToday);
      if (reason) return deny(requester, v, reason.code, reason.message, targets, reason.extra);
      items.push({
        vehicleId: v.id,
        ownerId: v.ownerId,
        direction: chooseDirection(v, t.direction),
        maxMeters: Math.min(M.maxMeters, clearanceOf(v, chooseDirection(v, t.direction))),
        veto: 'pending',
        tokenId: null,
        status: 'waiting',
        distance: 0,
        returned: 0,
        retries: 0,
        interlock: null,
        pausedAt: null,
        clipIds: [],
        tidyUsed: false,
      });
    }

    const night = items.some((it) => deps.delegation().check(ctx.vehicle(it.vehicleId), requester, 'move').night);
    const r = {
      id: id('mov'),
      complexId: requester.complexId,
      requesterId,
      createdAt: ctx.now(),
      status: 'VETO',
      night,
      items,
      cursor: 0,
      vetoEndsAt: ctx.now() + M.vetoWindowSec * 1000,
      movedAt: null,
      returnDeadline: null,
      tidyAvailable: false,
      timeline: [],
      fallback: null,
    };
    db.moveRequests.set(r.id, r);

    // 차주 폰에 30초 거부 창 (차량 화면에도 동시에)
    const who = `${requester.dong}동 ${requester.nickname}`;
    for (const it of items) {
      const v = ctx.vehicle(it.vehicleId);
      ctx.notify(it.ownerId, 'move.veto', `${who}님이 ${v.plate} 비켜줘를 요청했어요. ${M.vetoWindowSec}초 안에 거부하지 않으면 허락한 조건대로 진행돼요`, {
        requestId: r.id, vehicleId: v.id, expiresAt: r.vetoEndsAt,
      });
      ctx.toVehicle(v.id, 'move.veto', { requestId: r.id, requester: who, expiresAt: r.vetoEndsAt });
    }
    ctx.schedule(`veto:${r.id}`, M.vetoWindowSec * 1000, () => afterVeto(r.id));
    ctx.log('move.created', { requestId: r.id, requesterId, vehicles: items.map((i) => i.vehicleId) });
    push(r, `차주에게 알렸어요. ${M.vetoWindowSec}초 동안 거부가 없으면 진행돼요`);
    return view(r, requesterId);
  }

  function chooseDirection(v, wanted) {
    const c = v.state.clearance || { front: 0, back: 0 };
    if (wanted === 'forward' || wanted === 'backward') return wanted;
    return (c.front ?? 0) >= (c.back ?? 0) ? 'forward' : 'backward';
  }
  function clearanceOf(v, dir) {
    const c = v.state.clearance || {};
    return Number(dir === 'forward' ? c.front : c.back) || 0;
  }

  function validateTarget(v, requester, t, mineToday) {
    const no = (code, message, extra) => ({ code, message, extra });
    if (v.ownerId === requester.id) return no('OWN_VEHICLE', '내 차는 직접 움직여 주세요');
    if (!v.hasRspa) return no('NO_REMOTE_MOVE', '원격 이동을 지원하지 않는 차예요. 중립 여부를 확인하거나 차주에게 연락해 주세요');
    const pol = deps.delegation().check(v, requester, 'move');
    if (!pol.ok) return no(pol.code, pol.message);
    // 요청 대상: 차주가 '이중주차'로 표시했거나 통로 지오펜스 안에 선 차만
    if (!v.state.doubleParked) return no('NOT_DOUBLE_PARKED', '정식 칸에 선 차에는 요청할 수 없어요');
    if (v.state.slope) return no('SLOPE', '경사 구역이라 비켜줘를 쓸 수 없어요');
    if (v.state.charging) return no('CHARGING', '충전 중이라 움직일 수 없어요');
    if (v.state.lowVoltage12v || (typeof v.state.soc === 'number' && v.state.soc < M.minSocPercent)) {
      return no('LOW_BATTERY', '배터리가 부족해 요청을 받을 수 없어요');
    }
    if (v.activeMoveId) return no('BUSY', '다른 요청을 처리 중인 차예요');
    // 횟수 제한
    const today = ctx.today();
    const vehicleMovesToday = [...db.moveRequests.values()].filter(
      (r) => dayKey(r.createdAt) === today && COUNTED(r) && r.items.some((i) => i.vehicleId === v.id),
    ).length;
    if (vehicleMovesToday >= v.policy.dailyMoveLimit) return no('VEHICLE_DAILY', '이 차는 오늘 허락한 횟수를 다 썼어요');
    if (mineToday.some((r) => r.items.some((i) => i.vehicleId === v.id)) && M.perPairDaily <= 1) {
      return no('PAIR_DAILY', '같은 차에는 하루 한 번만 요청할 수 있어요');
    }
    // 이동 공간
    const dir = chooseDirection(v, t.direction);
    if (clearanceOf(v, dir) < M.minClearanceM) {
      const other = dir === 'forward' ? 'backward' : 'forward';
      if (clearanceOf(v, other) >= M.minClearanceM && !t.direction) return null;
      return no('NO_SPACE', '지금은 비킬 공간이 없어요', {
        suggestChain: v.state.blockedByPlate || null,
        hint: v.state.blockedByPlate ? `막고 있는 ${v.state.blockedByPlate}에도 함께 요청해 보세요` : null,
      });
    }
    return null;
  }

  /** 거절: 차는 움직이지 않고 지금 방식(차주에게 연락)으로 넘어간다 */
  function deny(requester, vehicle, code, message, targets, extra = {}) {
    const r = {
      id: id('mov'),
      complexId: requester.complexId,
      requesterId: requester.id,
      createdAt: ctx.now(),
      status: 'DENIED',
      night: false,
      items: [],
      cursor: 0,
      timeline: [{ at: ctx.now(), text: message, kind: 'warn' }],
      fallback: 'contact',
      denyCode: code,
      targets,
    };
    db.moveRequests.set(r.id, r);
    if (vehicle) contactOwner(vehicle, requester, message);
    ctx.log('move.denied', { requestId: r.id, code });
    return { ...view(r, requester.id), denyCode: code, message, ...extra };
  }

  function contactOwner(v, requester, reason) {
    const who = requester ? `${requester.dong}동 주민` : '이웃';
    ctx.notify(v.ownerId, 'contact', `${who}이(가) ${v.plate}을(를) 빼 달라고 요청했어요. 직접 처리해 주세요`, { vehicleId: v.id, reason });
    ctx.toVehicle(v.id, 'notice', { message: `${who}이(가) 차를 빼 달라고 요청했어요` });
  }

  // ---------------- 30초 거부 창 ----------------
  function ownerDecision(ownerId, requestId, decision) {
    const r = get(requestId);
    const it = r.items.find((i) => i.ownerId === ownerId);
    if (!it) throw forbidden('NOT_OWNER', '내 차에 온 요청이 아니에요');
    if (r.status !== 'VETO') throw fail('VETO_CLOSED', '거부 창이 이미 닫혔어요');
    const v = ctx.vehicle(it.vehicleId);
    v.stats.rejects.push({ at: ctx.now(), rejected: decision === 'reject' });
    v.stats.rejects = v.stats.rejects.slice(-5);
    if (decision === 'reject') {
      it.veto = 'rejected';
      ctx.cancel(`veto:${r.id}`);
      finish(r, 'REJECTED', '차주가 직접 처리합니다', 'warn');
      ctx.notify(r.requesterId, 'move', '차주가 직접 처리합니다. 크레딧은 차감되지 않아요', { requestId: r.id });
      for (const other of r.items) {
        if (other !== it) contactOwner(ctx.vehicle(other.vehicleId), ctx.user(r.requesterId), '연쇄 요청 중 다른 차주 거부');
      }
      // 거부가 잦은 차주에게는 위임을 끄라고 제안
      const recent = v.stats.rejects.filter((x) => x.rejected).length;
      if (recent >= M.frequentRejectThreshold) {
        ctx.notify(ownerId, 'suggest', '최근 거부가 잦아요. 비켜줘 위임을 잠시 꺼 두는 건 어때요?', { vehicleId: v.id });
      }
      return view(r, ownerId);
    }
    it.veto = 'approved';
    push(r, `${v.plate} 차주가 바로 허락했어요`);
    if (r.items.every((i) => i.veto === 'approved')) {
      ctx.cancel(`veto:${r.id}`);
      afterVeto(r.id);
    }
    return view(r, ownerId);
  }

  function afterVeto(requestId) {
    const r = db.moveRequests.get(requestId);
    if (!r || r.status !== 'VETO') return;
    for (const it of r.items) {
      if (it.veto === 'pending') it.veto = 'approved'; // 거부 없음 = 사전 허락대로 진행
      ctx.toVehicle(it.vehicleId, 'move.veto.closed', { requestId });
    }
    // 바깥쪽 차부터 토큰을 차례로 발급하고, 모든 차가 자가 점검을 통과해야 시작
    r.status = 'PRECHECK';
    for (const it of r.items) {
      const t = deps.delegation().issueToken({
        vehicleId: it.vehicleId, grantedTo: r.requesterId, kind: 'move', requestId: r.id, maxMeters: it.maxMeters,
      });
      it.tokenId = t.id;
      it.status = 'checking';
      const v = ctx.vehicle(it.vehicleId);
      v.activeMoveId = r.id;
      const zone = v.state.zoneId ? ctx.zone(v.complexId, v.state.zoneId) : null;
      ctx.toVehicle(it.vehicleId, 'interlock.check', { requestId: r.id, slope: !!v.state.slope, zone: zone?.name || null, lowVoltage12v: !!v.state.lowVoltage12v });
    }
    ctx.schedule(`interlock:${r.id}`, INTERLOCK_TIMEOUT_MS, () => {
      const rr = db.moveRequests.get(requestId);
      if (!rr || rr.status !== 'PRECHECK') return;
      for (const it of rr.items) {
        if (!it.interlock) it.interlock = evaluateInterlock(null, M);
      }
      resolvePrecheck(rr);
    });
    push(r, '차량이 스스로 안전 점검을 하고 있어요');
  }

  // ---------------- 인터록 ----------------
  function onInterlockResult(vehicleId, requestId, snapshot) {
    const r = get(requestId);
    const it = r.items.find((i) => i.vehicleId === vehicleId);
    if (!it || r.status !== 'PRECHECK') return view(r);
    // 차량 앱이 보낸 실제 센서 값에 서버가 아는 단지 지도 정보(경사 구역)를 더해 다시 판정
    const v = ctx.vehicle(vehicleId);
    const snap = { ...snapshot, slope: snapshot.slope || v.state.slope, lowVoltage12v: snapshot.lowVoltage12v || v.state.lowVoltage12v };
    it.interlock = evaluateInterlock(snap, M);
    if (it.interlock.fails.some((f) => f.ownerAlert)) {
      ctx.notify(it.ownerId, 'interlock', `비켜줘 요청을 막았어요: ${it.interlock.fails.map((f) => f.message).join(', ')}`, { requestId, vehicleId });
    }
    if (r.items.every((i) => i.interlock)) resolvePrecheck(r);
    return view(r);
  }

  function resolvePrecheck(r) {
    ctx.cancel(`interlock:${r.id}`);
    const failed = r.items.find((i) => !i.interlock.ok);
    if (failed) {
      const v = ctx.vehicle(failed.vehicleId);
      const msg = failed.interlock.fails.map((f) => f.message).join(', ');
      // 한 대라도 불가면 전체 중단하고 그 차주에게 연락
      contactOwner(v, ctx.user(r.requesterId), msg);
      finish(r, 'INTERLOCK_FAILED', `${v.plate}: ${msg}. 차주에게 연락했어요`, 'warn');
      return;
    }
    for (const it of r.items) {
      const v = ctx.vehicle(it.vehicleId);
      v.state.tempVacated = true; // 빈자리 안내에서 제외
    }
    r.status = 'READY';
    readyItem(r);
  }

  function readyItem(r) {
    const it = r.items[r.cursor];
    it.status = 'ready';
    const v = ctx.vehicle(it.vehicleId);
    const clip = deps.audit().recordClip({ vehicleId: v.id, kind: 'pre', refType: 'move', refId: r.id, parties: [r.requesterId, it.ownerId] });
    it.clipIds.push(clip.id);
    ctx.toVehicle(v.id, 'move.prepare', { requestId: r.id, direction: it.direction, maxMeters: it.maxMeters, mode: 'move' });
    const dirText = it.direction === 'forward' ? '앞으로' : '뒤로';
    push(r, `${v.plate} 준비 완료. 차 옆 2m 안, 진로 밖에서 버튼을 누르는 동안 ${dirText} 최대 ${it.maxMeters}m 움직여요`);
  }

  // ---------------- 버튼을 누르는 동안만 ----------------
  function hold(requesterId, requestId) {
    const r = get(requestId);
    if (r.requesterId !== requesterId) throw forbidden('NOT_REQUESTER', '요청한 사람만 조작할 수 있어요');
    // 요청자 위치는 차량이 BLE로 잰 값으로 확인: 차 측면 2m 안, 앞뒤 진로에 서 있으면 시작되지 않음
    const cur = r.items[r.cursor];
    if (cur && r.status === 'RETURNING') {
      // 복귀는 출차한 요청자가 자기 차 안에서: 6m 안, 복귀 경로 밖 (앞으로 비켰으면 경로는 차 뒤쪽)
      deps.proximity().requireReturn(cur.vehicleId, { pathZone: cur.direction === 'forward' ? 'rear' : 'front', pathM: Math.max(0, cur.distance - cur.returned) });
    } else if (cur && ['READY', 'MOVING', 'PAUSED', 'TIDY'].includes(r.status)) deps.proximity().requireMove(cur.vehicleId);

    const mode = r.status === 'RETURNING' ? 'return' : r.status === 'TIDY' ? 'tidy' : 'move';
    // 이동이 끝난 직후 늦게 도착한 버튼 신호는 조용히 무시
    if (!['READY', 'MOVING', 'PAUSED', 'RETURNING', 'TIDY'].includes(r.status)) return { ok: false, status: r.status, cursor: r.cursor };
    const it = r.items[r.cursor];
    if (mode === 'move') {
      deps.delegation().validateToken(it.tokenId, requesterId, 'move');
    } else {
      validateUsedToken(it.tokenId, requesterId);
    }
    const params = holdParams(it, mode);
    if (params.maxMeters <= 0.001) return view(r, requesterId);
    ctx.toVehicle(it.vehicleId, 'move.hold', { requestId: r.id, ...params, mode });
    return { ok: true, status: r.status, cursor: r.cursor };
  }

  function holdParams(it, mode) {
    if (mode === 'return') {
      return {
        direction: it.direction === 'forward' ? 'backward' : 'forward',
        maxMeters: round(Math.max(0, it.distance - it.returned)),
      };
    }
    if (mode === 'tidy') return { direction: it.tidyDirection || it.direction, maxMeters: M.tidyMoveMeters };
    return { direction: it.direction, maxMeters: round(Math.max(0, it.maxMeters - it.distance)) };
  }

  function validateUsedToken(tokenId, requesterId) {
    const t = db.tokens.get(tokenId);
    if (!t || t.grantedTo !== requesterId) throw forbidden('TOKEN_NOT_YOURS', '토큰은 차주가 지정한 계정만 쓸 수 있어요');
    const v = ctx.vehicle(t.vehicleId);
    if (!v.state.inComplex) throw fail('OUT_OF_GEOFENCE', '지하주차장 밖에서는 토큰이 무효예요');
    return t;
  }

  function release(requesterId, requestId) {
    const r = get(requestId);
    if (r.requesterId !== requesterId) throw forbidden('NOT_REQUESTER', '요청한 사람만 조작할 수 있어요');
    const it = r.items[r.cursor];
    if (it) ctx.toVehicle(it.vehicleId, 'move.release', { requestId });
    return { ok: true };
  }

  /** '충분히 비켰어요': 지금 위치에서 멈추고 P 체결 */
  function finishMove(requesterId, requestId) {
    const r = get(requestId);
    if (r.requesterId !== requesterId) throw forbidden('NOT_REQUESTER', '요청한 사람만 조작할 수 있어요');
    const it = r.items[r.cursor];
    if (!it || !['moving', 'paused', 'ready', 'returning', 'tidying'].includes(it.status)) throw fail('NOT_MOVING', '움직이는 중이 아니에요');
    ctx.toVehicle(it.vehicleId, 'move.finish', { requestId });
    return { ok: true };
  }

  // ---------------- 차량 진행 보고 ----------------
  function onProgress(vehicleId, { requestId, status, distance = 0, reason = null }) {
    const r = get(requestId);
    const idx = r.items.findIndex((i) => i.vehicleId === vehicleId);
    if (idx < 0) throw fail('INVALID', '요청에 포함된 차가 아니에요');
    const it = r.items[idx];
    const v = ctx.vehicle(vehicleId);
    const mode = r.status === 'RETURNING' ? 'return' : r.status === 'TIDY' ? 'tidy' : 'move';
    // 이미 끝난 단계에 늦게 도착한 보고는 무시 (예: 3m 도착 직후 차가 받은 버튼 신호로 시작된 0.1m 이동)
    const live = { move: ['READY', 'MOVING', 'PAUSED'], return: ['RETURNING'], tidy: ['TIDY'] }[mode];
    if (!live.includes(r.status) || idx !== r.cursor) return view(r);
    const d = round(Math.max(0, Number(distance) || 0));
    if (mode === 'move') it.distance = Math.min(it.maxMeters, d);
    else if (mode === 'return') it.returned = Math.min(it.distance, d);
    v.state.offsetM = round((it.direction === 'forward' ? 1 : -1) * (it.distance - it.returned) + (it.tidyOffset || 0));
    ctx.cancel(`pause:${r.id}`);

    switch (status) {
      case 'moving':
        it.status = mode === 'return' ? 'returning' : mode === 'tidy' ? 'tidying' : 'moving';
        if (r.status === 'READY' || r.status === 'PAUSED') r.status = 'MOVING';
        it.pausedAt = null;
        push(r, `${v.plate} ${mode === 'return' ? '복귀' : '이동'} 중 · ${round(mode === 'return' ? it.returned : it.distance)}m`);
        break;
      case 'paused':
        it.pausedAt = ctx.now();
        if (r.status === 'MOVING') r.status = 'PAUSED';
        push(r, `손을 떼서 멈췄어요. ${M.resumeWindowSec}초 안에 다시 누르면 이어서 움직여요`, 'warn');
        ctx.schedule(`pause:${r.id}`, M.resumeWindowSec * 1000, () => pauseExpired(r.id));
        break;
      case 'obstacle':
        it.retries += 1;
        push(r, `진로에 무언가 있어 멈췄어요. ${M.obstacleRetrySec}초 뒤 다시 시도해요 (${it.retries}/${M.obstacleMaxRetries})`, 'warn');
        break;
      case 'aborted':
        abortForObstacle(r, it, v);
        break;
      case 'contact':
        contactStop(r, it, v);
        break;
      case 'blocked':
        returnBlocked(r, it, v);
        break;
      case 'completed':
        if (mode === 'move') moveCompleted(r, it, v);
        else if (mode === 'return') returnCompleted(r, it, v);
        else tidyCompleted(r, it, v);
        break;
      default:
        throw fail('INVALID', `알 수 없는 상태: ${status}`);
    }
    return view(r);
  }

  function pauseExpired(requestId) {
    const r = db.moveRequests.get(requestId);
    if (!r || !['PAUSED', 'MOVING', 'RETURNING', 'TIDY'].includes(r.status)) return;
    const it = r.items[r.cursor];
    if (!it?.pausedAt) return;
    deps.delegation().expireToken(it.tokenId);
    ctx.toVehicle(it.vehicleId, 'move.abort', { requestId, reason: 'RESUME_TIMEOUT' });
    const v = ctx.vehicle(it.vehicleId);
    ctx.notify(it.ownerId, 'move', `${v.plate}이(가) 원위치에서 ${round(Math.abs(v.state.offsetM))}m 떨어진 곳에 P로 멈춰 있어요`, { requestId });
    finish(r, 'EXPIRED', '1분이 지나 토큰이 소멸했어요. 차는 지금 위치에 P로 멈췄어요', 'warn');
  }

  function abortForObstacle(r, it, v) {
    it.status = 'aborted';
    ctx.notify(it.ownerId, 'move', `${v.plate} 비켜줘가 장애물로 중단됐어요`, { requestId: r.id });
    finish(r, 'ABORTED', '계속 막혀 중단했어요. 진로를 비워 주세요', 'warn');
  }

  function contactStop(r, it, v) {
    it.status = 'contact';
    const clip = deps.audit().recordClip({ vehicleId: v.id, kind: 'post', refType: 'move', refId: r.id, parties: [r.requesterId, it.ownerId] });
    it.clipIds.push(clip.id);
    // 즉시 정지, 양측에 영상·로그 전송, 복귀 금지, 운영사에 자동 접수
    deps.audit().openDispute({ reporterId: null, refType: 'move', refId: r.id, reason: 'CONTACT', auto: true });
    ctx.notify(it.ownerId, 'contact_detected', `${v.plate} 이동 중 접촉이 감지돼 멈췄어요. 영상과 기록을 확인해 주세요`, { requestId: r.id, clipIds: it.clipIds });
    ctx.notify(r.requesterId, 'contact_detected', '이동 중 접촉이 감지돼 멈췄어요. 운영사에 자동으로 접수됐어요', { requestId: r.id, clipIds: it.clipIds });
    finish(r, 'CONTACT_STOPPED', '접촉 감지 · 즉시 정지. 운영사에 자동 접수됐어요', 'error');
  }

  function moveCompleted(r, it, v) {
    it.status = 'moved';
    deps.delegation().consumeToken(it.tokenId);
    const clip = deps.audit().recordClip({ vehicleId: v.id, kind: 'post', refType: 'move', refId: r.id, parties: [r.requesterId, it.ownerId] });
    it.clipIds.push(clip.id);
    // 크레딧: 같은 두 사람 사이는 하루 1회만 인정
    const credits = deps.credits();
    if (!credits.pairCreditedToday(r.requesterId, it.ownerId, 'MOVE_PROVIDE')) {
      const requester = ctx.user(r.requesterId);
      const gain = rules.credits.moveProvide * (r.night ? rules.credits.nightMultiplier : 1);
      credits.grant(it.ownerId, gain, 'MOVE_PROVIDE', {
        requestId: r.id, requesterId: r.requesterId, ownerId: it.ownerId, night: r.night,
        thanks: `${requester.dong}동 이웃이 고마워해요`,
      });
      credits.grant(r.requesterId, rules.credits.moveRequest, 'MOVE_REQUEST', { requestId: r.id, requesterId: r.requesterId, ownerId: it.ownerId });
    }
    const requester = ctx.user(r.requesterId);
    ctx.notify(it.ownerId, 'move.done', `${requester.dong}동 주민이 비켜줘를 썼어요${r.night ? ', 야간 크레딧 적립' : ''}`, { requestId: r.id, clipIds: it.clipIds });
    ctx.log('move.moved', { requestId: r.id, vehicleId: v.id, distance: it.distance });
    if (r.cursor < r.items.length - 1) {
      r.cursor += 1;
      r.status = 'READY';
      push(r, `${v.plate} ${round(it.distance)}m 이동 완료, P 체결. 다음 차로 넘어가요`);
      readyItem(r);
      return;
    }
    r.status = 'MOVED';
    r.movedAt = ctx.now();
    r.returnDeadline = ctx.now() + M.returnWindowMin * 60_000;
    ctx.schedule(`return:${r.id}`, M.returnWindowMin * 60_000, () => returnOverdue(r.id));
    push(r, `이동 완료, P 체결. 출차한 뒤 ${M.returnWindowMin}분 안에 '복귀'를 눌러 주세요`);
  }

  function returnOverdue(requestId) {
    const r = db.moveRequests.get(requestId);
    if (!r || r.status !== 'MOVED') return;
    r.status = 'RETURN_OVERDUE';
    deps.credits().grant(r.requesterId, rules.credits.lateReturnPenalty, 'LATE_RETURN', { requestId });
    for (const it of r.items) {
      ctx.notify(it.ownerId, 'move', '요청자가 10분 안에 복귀를 실행하지 않았어요. 차는 비켜준 위치에 P로 서 있어요', { requestId });
    }
    push(r, '복귀 기한이 지나 크레딧이 추가로 차감됐어요. 지금이라도 복귀를 눌러 주세요', 'warn');
  }

  // ---------------- 복귀 ----------------
  function startReturn(requesterId, requestId) {
    const r = get(requestId);
    if (r.requesterId !== requesterId) throw forbidden('NOT_REQUESTER', '요청한 사람만 조작할 수 있어요');
    if (!['MOVED', 'RETURN_OVERDUE'].includes(r.status)) throw fail('NOT_MOVED', '복귀할 수 있는 상태가 아니에요');
    ctx.cancel(`return:${r.id}`);
    r.status = 'RETURNING';
    r.cursor = r.items.length - 1; // 마지막으로 비켜준 차부터
    const it = r.items[r.cursor];
    it.status = 'return_ready';
    ctx.toVehicle(it.vehicleId, 'move.prepare', { requestId, ...holdParams(it, 'return'), mode: 'return' });
    push(r, `복귀: 버튼을 누르는 동안 ${ctx.vehicle(it.vehicleId).plate}이(가) 기억한 거리만큼 원위치로 돌아가요`);
    return view(r, requesterId);
  }

  function returnCompleted(r, it, v) {
    it.status = 'returned';
    v.state.offsetM = 0;
    v.state.tempVacated = false;
    const clip = deps.audit().recordClip({ vehicleId: v.id, kind: 'post', refType: 'move', refId: r.id, parties: [r.requesterId, it.ownerId] });
    it.clipIds.push(clip.id);
    if (r.cursor > 0) {
      r.cursor -= 1;
      const next = r.items[r.cursor];
      next.status = 'return_ready';
      ctx.toVehicle(next.vehicleId, 'move.prepare', { requestId: r.id, ...holdParams(next, 'return'), mode: 'return' });
      push(r, `${v.plate} 원위치 복귀, P 체결. 다음 차를 복귀해요`);
      return;
    }
    for (const x of r.items) ctx.notify(x.ownerId, 'move', `${ctx.vehicle(x.vehicleId).plate}이(가) 원위치로 돌아왔어요`, { requestId: r.id });
    finish(r, 'RETURNED', '모든 차가 원위치로 돌아갔어요. 감사합니다', 'success');
  }

  /** 복귀하려는데 원래 자리에 다른 차가 선 경우 */
  function returnBlocked(r, it, v) {
    it.status = 'return_blocked';
    ctx.notify(it.ownerId, 'move', `원래 자리에 다른 차가 있어 ${v.plate}을(를) 지금 위치에 P로 세웠어요`, { requestId: r.id });
    if (v.state.doubleParked && !it.tidyUsed) {
      // 현 위치가 통로를 막으면 같은 토큰으로 앞뒤 1m 안에서 정리 이동 1회 허용
      r.status = 'TIDY';
      r.tidyAvailable = true;
      push(r, '원래 자리가 막혀 있어요. 통로를 막지 않게 1m 안에서 한 번 정리해 주세요', 'warn');
      return;
    }
    finish(r, 'RETURN_BLOCKED', '원래 자리가 막혀 지금 위치에 P로 세웠어요. 차주에게 알렸어요', 'warn');
  }

  function setTidyDirection(requesterId, requestId, direction) {
    const r = get(requestId);
    if (r.requesterId !== requesterId || r.status !== 'TIDY') throw fail('NOT_TIDY', '정리 이동 단계가 아니에요');
    r.items[r.cursor].tidyDirection = direction === 'backward' ? 'backward' : 'forward';
    return view(r, requesterId);
  }

  function tidyCompleted(r, it, v) {
    it.tidyUsed = true;
    r.tidyAvailable = false;
    finish(r, 'RETURN_BLOCKED', '정리 이동을 마쳤어요. 차주에게 위치를 알렸어요', 'warn');
    ctx.notify(it.ownerId, 'move', `${v.plate}을(를) 통로 정리 위치에 P로 세웠어요`, { requestId: r.id });
  }

  // ---------------- 종료 ----------------
  function cancel(requesterId, requestId) {
    const r = get(requestId);
    if (r.requesterId !== requesterId) throw forbidden('NOT_REQUESTER', '요청한 사람만 취소할 수 있어요');
    if (!['VETO', 'PRECHECK', 'READY'].includes(r.status) || r.items.some((i) => i.distance > 0)) {
      throw fail('CANNOT_CANCEL', '이미 차가 움직여 취소할 수 없어요. 복귀를 눌러 주세요');
    }
    ctx.cancel(`veto:${r.id}`);
    finish(r, 'CANCELLED', '요청을 취소했어요', 'info');
    return view(r, requesterId);
  }

  function finish(r, status, text, kind) {
    r.status = status;
    for (const k of ['veto', 'interlock', 'pause', 'return']) ctx.cancel(`${k}:${r.id}`);
    for (const it of r.items) {
      const t = it.tokenId && db.tokens.get(it.tokenId);
      if (t && t.status === 'active') {
        t.status = status === 'EXPIRED' ? 'expired' : 'revoked';
        t.closedAt = ctx.now();
      }
      const v = db.vehicles.get(it.vehicleId);
      if (v && v.activeMoveId === r.id) {
        v.activeMoveId = null;
        if (status === 'RETURNED' || Math.abs(v.state.offsetM || 0) < 0.01) v.state.tempVacated = false;
        ctx.toVehicle(v.id, 'move.closed', { requestId: r.id, status });
      }
    }
    ctx.log('move.finished', { requestId: r.id, status });
    push(r, text, kind);
  }

  function listFor(userId) {
    return [...db.moveRequests.values()]
      .filter((r) => r.requesterId === userId || r.items.some((i) => i.ownerId === userId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((r) => view(r, userId));
  }

  return {
    create, ownerDecision, onInterlockResult, hold, release, finishMove, onProgress, startReturn,
    setTidyDirection, cancel, get, view, listFor, isTerminal: (r) => TERMINAL.has(r.status),
  };
}

function round(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}
