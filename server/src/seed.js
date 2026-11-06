import { DEV_OTP } from './services/accounts.js';

// 시연용 단지와 등장인물 (기획안 '사용 장면'과 같은 구성)
// 좌표 x,y는 지하주차장 평면도 위의 미터 단위. lat/lng는 Pleos Connect 에뮬레이터 기본 위치 근처.
export const DEMO = {
  complexId: 'cpx_hanbit1',
  joinCode: 'HB-2026',
  center: { lat: 37.48544722, lng: 127.03636666 },
};

function grid(prefix, zoneId, y, count, startX, opts = {}) {
  const step = opts.step ?? 2.5; // 칸 간격(m): 직각 주차 2.5m, 이중주차 줄(평행) 5.5m
  const out = [];
  for (let i = 0; i < count; i++) {
    const n = String(i + 1).padStart(2, '0');
    const x = startX + i * step;
    out.push({
      id: `${prefix}-${n}`,
      zoneId,
      label: `${prefix} ${n}번`,
      type: opts.types?.[i + 1] || 'normal',
      x,
      y,
      nearDong: opts.nearDong ?? null,
      lat: DEMO.center.lat + y * 0.000009,
      lng: DEMO.center.lng + x * 0.0000113,
    });
  }
  return out;
}

export function seed(app) {
  const { ctx, accounts, delegation, vehicleState } = app;
  ctx.reset();

  accounts.createComplex({
    id: DEMO.complexId,
    name: '한빛마을 1단지 (1997년 입주 · 1,000세대)',
    joinCode: DEMO.joinCode,
    geofence: { lat: DEMO.center.lat, lng: DEMO.center.lng, radiusM: 150 },
    gate: { x: -9.5, y: 7.5 },
    zones: [
      { id: 'B1-gate', name: 'B1 입차 게이트', floor: -1, type: 'aisle', slope: false, x: -8, y: -6 },
      { id: 'B1-ramp', name: 'B1→B2 경사로', floor: -1, type: 'ramp', slope: true, x: -4, y: 0 },
      { id: 'B2-7', name: 'B2 7열', floor: -2, type: 'parking', slope: false, x: 10, y: 0 },
      { id: 'B2-8', name: 'B2 8열', floor: -2, type: 'parking', slope: false, x: 10, y: 12.5 },
      { id: 'B2-aisle', name: 'B2 7열 이중주차 줄', floor: -2, type: 'aisle', slope: false, x: 10, y: 4.1 },
      // 확장 기능 · 밀착 구역: 관리사무소가 기둥 사이 자투리를 임시 구역으로 지정 (원격 비켜줘를 켠 차만)
      { id: 'B2-C', name: '밀착 임시 구역', floor: -2, type: 'compact', slope: false, x: -6.9, y: 0 },
    ],
    spots: [
      ...grid('B2-7', 'B2-7', 0, 8, 0, { nearDong: '103', types: { 1: 'ev_charger', 8: 'disabled' } }),
      ...grid('B2-8', 'B2-8', 12.5, 8, 0, { nearDong: '101', types: { 4: 'wide' } }),
      ...[1.5, 6, 13.5, 19].map((x, i) => ({ ...grid('B2-A', 'B2-aisle', 4.1, 1, x)[0], id: `B2-A-0${i + 1}`, label: `B2-A 0${i + 1}번` })),
      ...grid('B2-C', 'B2-C', 0, 4, -10.2, { step: 2.2, types: { 1: 'compact', 2: 'compact', 3: 'compact', 4: 'compact' } }),
    ],
    householdLimits: { '101-1201': 2, '103-302': 1, '102-805': 2, '104-1104': 1, '103-1502': 2, '105-903': 2, '106-402': 2 },
    officeUserIds: ['usr_office'],
    // 앱을 쓰지 않는 이웃 차 (지도에 회색으로만 표시) · 단지가 거의 꽉 찬 저녁 시간
    decor: [
      { spotId: 'B2-7-02', color: '#8a94a3' }, { spotId: 'B2-7-04', color: '#5b6577' },
      { spotId: 'B2-8-01', color: '#6f7d92' }, { spotId: 'B2-8-02', color: '#a3acb9' }, { spotId: 'B2-8-03', color: '#4b5568' }, { spotId: 'B2-8-04', color: '#c2c8d0' },
      { spotId: 'B2-8-05', color: '#7c8799' }, { spotId: 'B2-8-06', color: '#596377' }, { spotId: 'B2-8-07', color: '#949eac' },
      { spotId: 'B2-8-08', color: '#687387' },
    ],
  });

  const mk = (id, name, nickname, phone, dong, ho, role = 'resident') => {
    const u = accounts.registerUser({ id, name, nickname, phone, role });
    accounts.verifyPhone(u.id, DEV_OTP);
    accounts.verifyResident(u.id, { complexId: DEMO.complexId, joinCode: DEMO.joinCode, dong, ho });
    return u;
  };
  const minsu = mk('usr_minsu', '김민수', '민수', '010-0000-1001', '101', '1201');
  const jieun = mk('usr_jieun', '이지은', '지은', '010-0000-1002', '103', '302');
  const hyunwoo = mk('usr_hyunwoo', '박현우', '현우', '010-0000-1003', '102', '805');
  const sujin = mk('usr_sujin', '최수진', '수진', '010-0000-1004', '104', '1104');
  mk('usr_office', '관리사무소', '관리사무소', '010-0000-0000', '관리동', '1', 'office');

  // 아이오닉 5: 이중주차 줄에 선 차, 원격 비켜줘 위임 (야간 허용)
  const ioniq = accounts.registerVehicle(minsu.id, {
    id: 'veh_ioniq5', plate: '12가3456', model: '아이오닉 5', isEv: true, hasRspa: true, hasPleos: true, trunkThrough: false,
  });
  ioniq.appKey = 'demo';
  vehicleState.update(ioniq.id, { inComplex: true, gear: 'P', spotId: 'B2-A-02', soc: 64, clearance: { front: 3.2, back: 1.4 } }, 'seed');
  vehicleState.setHome(ioniq.id, 'B2-A-02');
  delegation.updatePolicy(minsu.id, ioniq.id, { enabled: true, functions: { move: true, trunk: true, sensor: true }, allowNight: true });

  // 지은 씨 차: 아이오닉에 막힌 정식 칸
  const jieunCar = accounts.registerVehicle(jieun.id, { id: 'veh_avante', plate: '78라1122', model: '아반떼', hasRspa: false, hasPleos: false });
  jieunCar.appKey = 'demo';
  vehicleState.update(jieunCar.id, { inComplex: true, gear: 'P', spotId: 'B2-7-03' }, 'seed');
  vehicleState.setHome(jieunCar.id, 'B2-7-03');

  // 쏘렌토: 현우 씨, 단지 밖에서 들어오는 중 (빈자리 안내 수혜자)
  const sorento = accounts.registerVehicle(hyunwoo.id, {
    id: 'veh_sorento', plate: '34나5678', model: '쏘렌토', isEv: false, hasRspa: true, hasPleos: true, trunkThrough: true,
  });
  sorento.appKey = 'demo';
  vehicleState.update(sorento.id, { inComplex: false, gear: 'D', soc: null, clearance: { front: 2.5, back: 2.5 } }, 'seed');
  delegation.updatePolicy(hyunwoo.id, sorento.id, { enabled: true, functions: { move: false, trunk: true, sensor: true } });

  // 그랜저: B2 7열에 주차, 곧 출차 (출차 신호 → 방금 빈 자리)
  const grandeur = accounts.registerVehicle(sujin.id, { id: 'veh_grandeur', plate: '56다7890', model: '그랜저', hasRspa: false, hasPleos: true });
  grandeur.appKey = 'demo';
  vehicleState.update(grandeur.id, { inComplex: true, gear: 'P', spotId: 'B2-7-06' }, 'seed');
  vehicleState.setHome(grandeur.id, 'B2-7-06');

  // 레이 EV: 이중주차 줄, N 주차 (중립 표시 시연)
  const ray = accounts.registerVehicle(hyunwoo.id, {
    id: 'veh_ray', plate: '90마3344', model: '레이 EV', isEv: true, hasRspa: false, hasPleos: false,
  });
  ray.appKey = 'demo';
  vehicleState.update(ray.id, { inComplex: true, gear: 'N', spotId: 'B2-A-04', soc: 55 }, 'seed');
  vehicleState.setHome(ray.id, 'B2-A-04');
  app.neutral.register(hyunwoo.id, ray.id, true);

  // 그랜저 양옆 칸의 참여 차: 그랜저가 나가면 옆 칸이 빈 것을 함께 확인해 준다 (센서 공유 ON이 기본값)
  const seoyeon = mk('usr_seoyeon', '정서연', '서연', '010-0000-1005', '103', '1502');
  const doyun = mk('usr_doyun', '한도윤', '도윤', '010-0000-1006', '105', '903');
  const harin = mk('usr_harin', '윤하린', '하린', '010-0000-1007', '106', '402');
  const parkAt = (owner, input, spotId, policy) => {
    const v = accounts.registerVehicle(owner.id, input);
    v.appKey = 'demo';
    vehicleState.update(v.id, { inComplex: true, gear: 'P', spotId }, 'seed');
    vehicleState.setHome(v.id, spotId);
    if (policy) delegation.updatePolicy(owner.id, v.id, policy);
    return v;
  };
  const nightMove = { enabled: true, functions: { move: true, trunk: false, sensor: true }, allowNight: true };
  parkAt(seoyeon, { id: 'veh_kona', plate: '23버4567', model: '코나 일렉트릭', isEv: true, hasRspa: false, hasPleos: true }, 'B2-7-05');
  parkAt(doyun, { id: 'veh_palisade', plate: '45서6789', model: '팰리세이드', isEv: false, hasRspa: true, hasPleos: true }, 'B2-7-07');

  // 밀착 임시 구역: 원격 비켜줘를 켠 차만, 문 열 간격 없이 나란히
  parkAt(seoyeon, { id: 'veh_ev9', plate: '31거2233', model: 'EV9', isEv: true, hasRspa: true, hasPleos: true }, 'B2-C-01', nightMove);
  parkAt(doyun, { id: 'veh_ioniq6', plate: '52너3344', model: '아이오닉 6', isEv: true, hasRspa: true, hasPleos: true }, 'B2-C-02', nightMove);
  parkAt(harin, { id: 'veh_gv60', plate: '17더4455', model: 'GV60', isEv: true, hasRspa: true, hasPleos: true }, 'B2-C-03', nightMove);
  // 하린 씨 EV6: 퇴근길, 단지 밖 (밀착 구역 시연)
  const ev6 = accounts.registerVehicle(harin.id, { id: 'veh_ev6', plate: '64러5566', model: 'EV6', isEv: true, hasRspa: true, hasPleos: true });
  ev6.appKey = 'demo';
  vehicleState.update(ev6.id, { inComplex: false, gear: 'D', soc: 71 }, 'seed');
  delegation.updatePolicy(harin.id, ev6.id, nightMove);

  ctx.db.logs.length = 0;
  ctx.db.notifications.length = 0;
  ctx.log('seed', { complexId: DEMO.complexId });
  return { minsu, jieun, hyunwoo, sujin };
}
