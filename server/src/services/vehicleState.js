import { pick } from '../util.js';

const SCALAR_KEYS = [
  'gear', 'inComplex', 'zoneId', 'spotId', 'pos', 'doubleParked', 'charging', 'soc', 'lowVoltage12v',
  'clearance', 'tilted', 'returnSpotOccupied', 'obstacle', 'contact', 'offsetM', 'lat', 'lng', 'heading',
];
const PARKED_GEARS = new Set(['P', 'N']);

// 차량 상태 갱신. 차량 앱(실제 SDK 값)이나 데모 콘솔(모의 값)이 같은 경로로 보낸다.
// 기어·지오펜스 변화에서 입차·주차·출차 이벤트를 만들어 빈자리 레이더로 넘긴다.
export function createVehicleState(ctx, deps) {
  function derive(v) {
    const s = v.state;
    const zone = s.zoneId ? ctx.zone(v.complexId, s.zoneId) : null;
    s.slope = !!(s.tilted || (zone && (zone.slope || zone.type === 'ramp')));
    if (zone && zone.type === 'aisle') s.doubleParked = true; // 통로 지오펜스 안에 선 차
  }

  function update(vehicleId, patch = {}, source = 'app') {
    const v = ctx.vehicle(vehicleId);
    const prev = { gear: v.state.gear, inComplex: v.state.inComplex };
    Object.assign(v.state, pick(patch, SCALAR_KEYS));
    if (patch.doors) Object.assign(v.state.doors, patch.doors);
    if (patch.occupied) Object.assign(v.state.occupied, patch.occupied);
    if (patch.spotId) v.state.heading = null; // 칸에 서면 칸 방향을 따른다
    if (patch.spotId && !patch.zoneId) {
      const spot = ctx.spot(v.complexId, patch.spotId);
      if (spot) {
        v.state.zoneId = spot.zoneId;
        v.state.pos = { x: spot.x, y: spot.y };
      }
    }
    if (patch.neutral !== undefined) v.state.neutral = !!patch.neutral;
    // 기어가 N에서 벗어나면 '밀어도 되는 차' 표시를 자동으로 내린다
    if (patch.gear && patch.gear !== 'N' && v.state.neutral && source === 'app') v.state.neutral = false;
    v.state.updatedAt = ctx.now();
    v.state.source = source;
    derive(v);

    const activeMove = !!v.activeMoveId;
    // 지오펜스 진입 = 입차 게이트 통과 (이미 주차된 채로 배치된 차는 제외)
    const placedParked = PARKED_GEARS.has(v.state.gear) && !!v.state.spotId;
    if (!prev.inComplex && v.state.inComplex && !placedParked) deps.vacancy().onArrived(v);
    if (prev.inComplex && !v.state.inComplex) {
      // 단지를 나가면 이전 칸 정보는 지운다 (다시 들어오면 게이트에서 새로 시작)
      if (!patch.spotId) Object.assign(v.state, { spotId: null, zoneId: null, doubleParked: false, heading: null });
      deps.vacancy().onLeft(v);
    }
    // 주차 → 주행 전환 = 출차 (비켜줘 이동 중에는 제외)
    if (PARKED_GEARS.has(prev.gear) && patch.gear && !PARKED_GEARS.has(patch.gear) && v.state.inComplex && !activeMove) {
      deps.vacancy().onDeparted(v);
    }
    // 주행 → 주차 전환 = 주차 완료
    if (prev.gear && !PARKED_GEARS.has(prev.gear) && patch.gear && PARKED_GEARS.has(patch.gear) && v.state.inComplex && !activeMove) {
      deps.vacancy().onParked(v);
    }
    publish(v);
    return v.state;
  }

  /** 주차 후 '내 자리' 선택 (지하에서는 위치 오차가 커서 처음 몇 번은 차주가 고른다) */
  function setHome(vehicleId, spotId) {
    const v = ctx.vehicle(vehicleId);
    const spot = ctx.spot(v.complexId, spotId);
    if (!spot) return null;
    v.state.spotId = spot.id;
    v.state.zoneId = spot.zoneId;
    v.state.pos = { x: spot.x, y: spot.y };
    v.home = { spotId: spot.id, zoneId: spot.zoneId, pos: { x: spot.x, y: spot.y } };
    derive(v);
    deps.vacancy().onSpotTaken(v, spot.id);
    publish(v);
    return v.home;
  }

  function publish(v) {
    const view = { vehicleId: v.id, plate: v.plate, state: v.state, home: v.home };
    ctx.bus.publish('admin', 'vehicle.state', view);
    ctx.bus.publish(`user:${v.ownerId}`, 'vehicle.state', view);
  }

  return { update, setHome, publish };
}
