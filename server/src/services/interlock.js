// 안전 인터록: 하나라도 걸리면 차는 움직이지 않는다.
// 차량 앱이 보낸 센서 스냅샷을 서버에서도 같은 규칙으로 다시 판정한다.

export const INTERLOCK_MESSAGES = {
  CHARGING: '충전 중이라 움직일 수 없어요',
  DOOR_OPEN: '문이나 트렁크가 열려 있어 움직일 수 없어요',
  OCCUPANT: '차 안에 사람이나 반려동물이 있어 움직일 수 없어요',
  SLOPE: '경사 구역이라 비켜줘를 쓸 수 없어요',
  LOW_HV: '배터리가 부족해 요청을 받을 수 없어요',
  LOW_12V: '12V 배터리 전압이 낮아 요청을 받을 수 없어요',
  NOT_PARKED: '차가 주차 상태(P/N)가 아니에요',
  NO_DATA: '차량 상태를 확인하지 못했어요',
};

/** owner 알림이 필요한 항목 */
const OWNER_ALERT = new Set(['DOOR_OPEN', 'OCCUPANT', 'LOW_12V']);

/**
 * @param {object} s 센서 스냅샷
 *   { gear, charging, doors:{ROW_1_LEFT:0|1,..., REAR}, occupied:{ROW_1_LEFT:bool,...},
 *     slope, soc, lowVoltage12v }
 * @param {{minSocPercent:number}} rules
 */
export function evaluateInterlock(s, rules) {
  const fails = [];
  if (!s) return { ok: false, fails: [{ code: 'NO_DATA', message: INTERLOCK_MESSAGES.NO_DATA, ownerAlert: false }] };
  const add = (code) => fails.push({ code, message: INTERLOCK_MESSAGES[code], ownerAlert: OWNER_ALERT.has(code) });

  if (s.charging === true) add('CHARGING');
  if (s.doors && Object.values(s.doors).some((v) => Number(v) > 0)) add('DOOR_OPEN');
  if (s.occupied && Object.values(s.occupied).some(Boolean)) add('OCCUPANT');
  if (s.slope === true) add('SLOPE');
  if (typeof s.soc === 'number' && s.soc < rules.minSocPercent) add('LOW_HV');
  if (s.lowVoltage12v === true) add('LOW_12V');
  if (s.gear && !['P', 'N'].includes(s.gear)) add('NOT_PARKED');

  return { ok: fails.length === 0, fails, checkedAt: s.at ?? null };
}
