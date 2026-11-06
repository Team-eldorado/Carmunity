import { fail, forbidden } from '../util.js';

// 비켜줘 1단계 · 중립 표시 (OEM 연동 없이 동작)
// 차주가 N 주차를 해 두고 '응'이라 답하면 '밀어도 되는 차'로 등록된다.
// 막힌 이웃이 번호판을 찍으면 중립 여부가 바로 뜨고, 아니면 차주 폰과 차량 화면에 동시에 알림이 간다.
export function createNeutral(ctx, deps) {
  function register(ownerId, vehicleId, neutral) {
    const v = ctx.vehicle(vehicleId);
    if (v.ownerId !== ownerId) throw forbidden('NOT_OWNER', '내 차만 등록할 수 있어요');
    if (neutral) {
      if (v.state.slope) throw fail('SLOPE', '경사 구역에서는 N 주차를 하지 마세요. 평지로 옮겨 주세요');
      if (v.state.gear && v.state.gear !== 'N') {
        throw fail('GEAR_NOT_N', `지금 기어가 ${v.state.gear}예요. N으로 두고 다시 눌러 주세요`);
      }
    }
    deps.vehicleState().update(vehicleId, { neutral: !!neutral, doubleParked: neutral ? true : v.state.doubleParked }, 'owner');
    ctx.log('neutral.registered', { vehicleId, neutral: !!neutral });
    return v.state;
  }

  /** 번호판으로 상태 확인. 방문자(로그인 없음)는 '차주에게 연락'만 가능 */
  function check({ plate, requesterId = null }) {
    const v = ctx.vehicleByPlate(plate);
    if (!v) {
      return {
        participant: false,
        neutral: false,
        message: '참여 차량이 아니에요. 안심번호로 차주에게 연락해 주세요',
        fallback: 'contact',
      };
    }
    const requester = requesterId ? ctx.db.users.get(requesterId) : null;
    const verified = !!(requester && requester.phoneVerified && requester.residentVerified && requester.complexId === v.complexId);
    const who = verified ? `${requester.dong}동 주민` : '방문자';
    const base = {
      participant: true,
      vehicleId: v.id,
      plate: v.plate,
      model: v.model,
      zone: v.state.zoneId ? ctx.zone(v.complexId, v.state.zoneId)?.name : null,
    };

    if (!verified) {
      notifyOwner(v, `${who}이(가) 차를 빼 달라고 요청했어요`, { kind: 'contact' });
      return { ...base, neutral: false, canRequestMove: false, message: '차주에게 연락을 보냈어요', fallback: 'contact' };
    }

    const canRequestMove = v.hasRspa && deps.delegation().check(v, requester, 'move').ok;
    if (v.state.neutral && v.state.gear === 'N') {
      if (v.state.slope) {
        notifyOwner(v, `${who}이(가) 차를 빼 달라고 요청했어요 (경사 구역)`, { kind: 'contact' });
        return { ...base, neutral: true, canRequestMove, message: '중립이지만 경사 구역이라 밀면 안 돼요. 차주에게 알림을 보냈어요', fallback: 'contact' };
      }
      notifyOwner(v, `${who}이(가) 중립 상태를 확인하고 차를 밀었어요`, { kind: 'info' });
      ctx.log('neutral.checked', { vehicleId: v.id, requesterId, neutral: true });
      return { ...base, neutral: true, canRequestMove, message: '중립이에요, 평지에서 천천히 밀어주세요' };
    }
    notifyOwner(v, `${who}이(가) 차를 빼 달라고 요청했어요`, { kind: 'contact' });
    ctx.log('neutral.checked', { vehicleId: v.id, requesterId, neutral: false });
    return {
      ...base,
      neutral: false,
      canRequestMove,
      message: canRequestMove
        ? 'P로 잠겨 있어 손으로 밀 수 없는 차예요. 대신 차주가 허락해 둔 비켜줘로 옮길 수 있어요'
        : '중립이 아니에요, 차주에게 알림을 보냈어요',
      fallback: canRequestMove ? null : 'contact',
    };
  }

  function notifyOwner(v, message, data) {
    ctx.notify(v.ownerId, 'neutral', message, { vehicleId: v.id, ...data });
    ctx.toVehicle(v.id, 'neutral.notice', { message });
  }

  return { register, check };
}
