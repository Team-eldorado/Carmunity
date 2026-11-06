import { randomBytes } from 'node:crypto';

export function id(prefix) {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const fail = (code, message, extra) => new AppError(400, code, message, extra);
export const notFound = (what) => new AppError(404, 'NOT_FOUND', `${what}을(를) 찾을 수 없어요`);
export const forbidden = (code, message) => new AppError(403, code, message);

/** 번호판 비교용 정규화: 공백 제거 */
export function normalizePlate(p) {
  return String(p || '').replace(/\s+/g, '').trim();
}

/** 한국 시간 기준 날짜 키 (하루 횟수 집계용) */
export function dayKey(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export function hourKst(ms) {
  return new Date(ms + 9 * 3600 * 1000).getUTCHours();
}

export function isQuietHour(ms, { start, end }) {
  const h = hourKst(ms);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/** 평면 좌표(m) 거리 */
export function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
