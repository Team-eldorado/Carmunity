import { fail } from '../util.js';

// 요청자 근접 확인 (BLE)
// 요청자 폰은 1회용 토큰과 함께 받은 키로 차량과 BLE 연결을 맺고, 차량이 신호 세기로 폰까지의 거리와 방향을 잰다.
// (디지털 키 2 차량은 UWB로 더 정확하게 잴 수 있다.) 서버는 폰이 보낸 값이 아니라 차량이 잰 값만 믿는다.
// 에뮬레이터에는 BLE가 없어서, 시연에서는 데모 콘솔이 차량 앱에 측정값을 넣고 차량 앱이 그 값을 보고한다.
//
// zone: side(차 옆) · front / rear(앞뒤 진로) · inside(차 안) · far(범위 밖)
const ZONES = new Set(['side', 'front', 'rear', 'inside', 'far']);

export function createProximity(ctx) {
  const { db, rules } = ctx;
  const P = rules.proximity;
  if (!db.proximity) db.proximity = new Map(); // vehicleId → 최근 측정값

  const round = (n) => Math.round(n * 10) / 10;
  const lastSent = new Map();

  /** 지금 이 차에 다가와야 하는 사람: 비켜줘 요청자 · 트렁크 토큰 사용자 · 밀착 구역 차주 */
  function holderOf(vehicleId) {
    const v = db.vehicles.get(vehicleId);
    if (v?.activeMoveId) return db.moveRequests.get(v.activeMoveId)?.requesterId || null;
    for (const t of db.trunkTokens?.values?.() || []) {
      if (t.vehicleId === vehicleId && ['issued', 'opening', 'open'].includes(t.status)) return t.giverId;
    }
    for (const s of db.compacts?.values?.() || []) {
      if (s.vehicleId === vehicleId && ['guide', 'ready', 'moving', 'paused'].includes(s.status)) return s.ownerId;
    }
    return null;
  }

  /** 차량이 잰 값 보고. source: vehicle(차량 앱) · virtual(서버 가상 차량) */
  function report(vehicleId, { distanceM, zone } = {}, source = 'vehicle') {
    if (!db.vehicles.has(vehicleId)) return null;
    if (zone == null || zone === 'clear') {
      db.proximity.delete(vehicleId);
    } else {
      if (!ZONES.has(zone)) throw fail('INVALID', `알 수 없는 위치: ${zone}`);
      db.proximity.set(vehicleId, { vehicleId, distanceM: round(Number(distanceM) || 0), zone, at: ctx.now(), source });
    }
    const vw = view(vehicleId);
    const prev = lastSent.get(vehicleId);
    const key = `${vw.zone}|${vw.distanceM}`;
    if (prev === key) return vw;
    lastSent.set(vehicleId, key);
    const holder = holderOf(vehicleId);
    if (holder) ctx.bus.publish(`user:${holder}`, 'proximity', vw);
    ctx.bus.publish('admin', 'proximity', vw);
    return vw;
  }

  /** 최근 측정값. 차량 앱 값은 보고가 끊기면(기본 3초) 무효, 가상 차량 값은 바뀔 때까지 유지 */
  function get(vehicleId) {
    const p = db.proximity.get(vehicleId);
    if (!p) return null;
    if (p.source === 'vehicle' && ctx.now() - p.at > P.freshMs) return null;
    return p;
  }

  function view(vehicleId) {
    const p = get(vehicleId);
    return p ? { vehicleId, distanceM: p.distanceM, zone: p.zone, at: p.at } : { vehicleId, distanceM: null, zone: null, at: null };
  }

  /** 비켜줘: 차 옆 2m 안, 앞뒤 진로 밖 */
  function requireMove(vehicleId) {
    const p = get(vehicleId);
    if (!p || p.zone === 'far') throw fail('NOT_NEAR', `차량이 폰을 찾지 못했어요. 차 옆 ${P.moveMaxM}m 안으로 와 주세요`);
    if (p.zone === 'front' || p.zone === 'rear') throw fail('IN_PATH', '차의 앞뒤 진로에서 비켜 서 주세요');
    if (p.zone !== 'side' || p.distanceM > P.moveMaxM) throw fail('NOT_NEAR', `차 옆 ${P.moveMaxM}m 안으로 와 주세요`);
    return p;
  }

  /** 복귀: 요청자는 출차한 자기 차 안에서 누른다 → 차에서 6m 안, 복귀 경로(남은 거리 + 1m) 밖 */
  function requireReturn(vehicleId, { pathZone = 'rear', pathM = 3 } = {}) {
    const p = get(vehicleId);
    if (!p || p.zone === 'far') throw fail('NOT_NEAR', `차량이 폰을 찾지 못했어요. 차에서 ${P.returnMaxM}m 안에서 눌러 주세요`);
    if (p.zone === 'inside') throw fail('NOT_OUTSIDE', '차 밖에서 눌러 주세요');
    if (p.distanceM > P.returnMaxM) throw fail('NOT_NEAR', `차에서 ${P.returnMaxM}m 안에서 눌러 주세요`);
    if (p.zone === pathZone && p.distanceM <= pathM + P.returnPathMarginM) throw fail('IN_PATH', '복귀 경로에서 비켜 주세요');
    return p;
  }

  /** 트렁크 드롭: 트렁크 뒤나 차 옆 2m 안 */
  function requireTrunk(vehicleId) {
    const p = get(vehicleId);
    if (!p || !['rear', 'side'].includes(p.zone) || p.distanceM > P.trunkMaxM) throw fail('NOT_NEAR', '차 옆에서 눌러 주세요 (차량이 BLE로 확인해요)');
    return p;
  }

  /** 밀착 구역: 차에서 내려 차 밖 4m 안 */
  function requireOutside(vehicleId) {
    const p = get(vehicleId);
    if (p?.zone === 'inside') throw fail('NOT_OUTSIDE', '차에서 내려 문을 닫은 뒤 눌러 주세요');
    if (!p || p.zone === 'far' || p.distanceM > P.compactMaxM) throw fail('NOT_NEAR', `차 밖 ${P.compactMaxM}m 안에서 눌러 주세요`);
    return p;
  }

  return { report, get, view, holderOf, requireMove, requireReturn, requireTrunk, requireOutside };
}
