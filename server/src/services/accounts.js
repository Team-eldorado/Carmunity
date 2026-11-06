import { id, fail, forbidden, normalizePlate } from '../util.js';

export const DEV_OTP = '000000'; // 시범 운영용 고정 인증번호 (실서비스는 SMS 연동)

export function defaultPolicy(rules) {
  return {
    enabled: false,
    functions: { move: false, trunk: false, sensor: true },
    scope: { type: 'complex', dongs: [] }, // 우리 단지 등록 입주민 (특정 동으로 좁힐 수 있음)
    dailyMoveLimit: rules.move.defaultVehicleDaily,
    allowNight: false, // 23~06시 허용 여부
    pausedDay: null, // '오늘은 안 됨' 토글한 날짜
    updatedAt: null,
  };
}

export function defaultState() {
  return {
    gear: 'P',
    inComplex: false,
    zoneId: null,
    spotId: null,
    pos: null, // 단지 지도 좌표 {x,y} (m)
    doubleParked: false,
    neutral: false, // N 주차로 '밀어도 되는 차'
    charging: false,
    soc: 80,
    lowVoltage12v: false,
    doors: { ROW_1_LEFT: 0, ROW_1_RIGHT: 0, ROW_2_LEFT: 0, ROW_2_RIGHT: 0, REAR: 0 },
    occupied: { ROW_1_LEFT: false, ROW_1_RIGHT: false, ROW_2_LEFT: false, ROW_2_RIGHT: false },
    clearance: { front: 3, back: 3 }, // 앞뒤 여유 거리 (m)
    offsetM: 0, // 원위치 대비 이동량 (+앞 / -뒤)
    tempVacated: false, // 비켜줘 실행 중 '잠시 비운 자리'
    returnSpotOccupied: false, // 데모: 복귀 자리를 다른 차가 막음
    obstacle: false, // 데모: 이동 경로 장애물
    contact: false, // 데모: 이동 중 접촉
    updatedAt: null,
  };
}

export function createAccounts(ctx) {
  const { db, rules } = ctx;

  function createComplex(input) {
    const c = {
      id: input.id || id('cpx'),
      name: input.name,
      joinCode: input.joinCode, // 관리사무소 코드
      geofence: input.geofence, // {lat,lng,radiusM}
      gate: input.gate || { x: 0, y: 0 },
      zones: input.zones || [], // {id,name,floor,type:'parking'|'aisle'|'ramp',slope,x,y}
      spots: input.spots || [], // {id,zoneId,label,type:'normal'|'ev_charger'|'disabled'|'wide',x,y,nearDong}
      householdLimits: input.householdLimits || {}, // 'dong-ho' → 관리사무소 등록 대수
      officeUserIds: input.officeUserIds || [],
      decor: input.decor || [], // 앱을 쓰지 않는 차 (지도 표시용): {spotId, color}
    };
    db.complexes.set(c.id, c);
    return c;
  }

  function registerUser(input) {
    if (!input.name || !input.phone) throw fail('INVALID', '이름과 휴대폰 번호가 필요해요');
    const u = {
      id: input.id || id('usr'),
      name: input.name, // 실명은 운영사만 보유
      nickname: input.nickname || input.name.slice(0, 1) + '**',
      phone: input.phone,
      complexId: input.complexId || null,
      dong: input.dong || null,
      ho: input.ho || null,
      role: input.role || 'resident', // resident | office | visitor
      phoneVerified: false,
      residentVerified: false,
      credits: 0,
      suspendedUntil: null,
      reports: 0,
      createdAt: ctx.now(),
    };
    db.users.set(u.id, u);
    ctx.log('user.registered', { userId: u.id });
    return u;
  }

  function verifyPhone(userId, code) {
    const u = ctx.user(userId);
    if (code !== DEV_OTP) throw fail('OTP_MISMATCH', '인증번호가 맞지 않아요');
    u.phoneVerified = true;
    return u;
  }

  /** 입주민 인증: 관리사무소 코드 (기존 입주민 앱 연동은 같은 자리에 붙는다) */
  function verifyResident(userId, { complexId, joinCode, dong, ho }) {
    const u = ctx.user(userId);
    const c = ctx.complex(complexId);
    if (c.joinCode !== joinCode) throw fail('JOIN_CODE', '관리사무소 코드가 맞지 않아요');
    Object.assign(u, { complexId, dong, ho, residentVerified: true });
    return u;
  }

  function registerVehicle(userId, input) {
    const u = ctx.user(userId);
    if (!u.phoneVerified || !u.residentVerified) {
      throw forbidden('NOT_VERIFIED', '차량 등록은 실명·입주민 인증을 마친 뒤에 할 수 있어요');
    }
    const plate = normalizePlate(input.plate);
    if (!plate) throw fail('INVALID', '차량 번호가 필요해요');
    if (ctx.vehicleByPlate(plate)) throw fail('DUPLICATE', '이미 등록된 차량이에요');
    const c = ctx.complex(u.complexId);
    const key = `${u.dong}-${u.ho}`;
    const limit = c.householdLimits[key];
    const owned = [...db.vehicles.values()].filter((v) => {
      const o = db.users.get(v.ownerId);
      return o && o.complexId === u.complexId && `${o.dong}-${o.ho}` === key;
    }).length;
    if (limit !== undefined && owned >= limit) {
      throw fail('HOUSEHOLD_LIMIT', `관리사무소에 등록된 세대 차량 대수(${limit}대)를 넘을 수 없어요`);
    }
    const v = {
      id: input.id || id('veh'),
      plate,
      ownerId: userId,
      complexId: u.complexId,
      model: input.model || '',
      isEv: !!input.isEv,
      hasRspa: !!input.hasRspa, // 원격 전·후진 (원격 스마트 주차 보조)
      hasPleos: !!input.hasPleos, // Pleos Connect 차량 앱
      trunkThrough: !!input.trunkThrough, // 트렁크와 실내가 이어진 차종 (SUV 등)
      vin: input.vin || null,
      appKey: input.appKey || id('key').slice(4), // 차량 앱 페어링 키 (차주 앱에서 확인)
      policy: defaultPolicy(rules),
      state: defaultState(),
      home: null, // 원래 자리 (zoneId, spotId, pos)
      stats: { rejects: [] }, // 최근 거부/허락 이력
      createdAt: ctx.now(),
    };
    db.vehicles.set(v.id, v);
    ctx.log('vehicle.registered', { vehicleId: v.id, ownerId: userId });
    return v;
  }

  function assertActive(user) {
    if (!user.phoneVerified || !user.residentVerified) {
      throw forbidden('NOT_VERIFIED', '단지 입주민 인증과 실명 휴대폰 인증을 마친 계정만 쓸 수 있어요');
    }
    if (user.suspendedUntil && user.suspendedUntil > ctx.now()) {
      throw forbidden('SUSPENDED', '신고 누적으로 이용이 정지된 계정이에요');
    }
  }

  /** 화면에 보이는 사용자 정보: 닉네임과 동만 */
  function publicUser(u) {
    if (!u) return null;
    return { id: u.id, nickname: u.nickname, dong: u.dong };
  }

  return { createComplex, registerUser, verifyPhone, verifyResident, registerVehicle, assertActive, publicUser };
}
