import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { RULES } from './config.js';
import { notFound, normalizePlate, dayKey, id } from './util.js';

const COLLECTIONS = [
  'complexes', 'users', 'vehicles', 'tokens', 'moveRequests', 'vacancies', 'offers',
  'arrivals', 'trunkTokens', 'clips', 'disputes', 'compacts', 'proximity',
];

/** 실제 시계. 테스트에서는 FakeClock으로 바꾼다. */
export const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

export class EventBus {
  constructor() {
    this.subs = new Set();
  }
  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  publish(channel, type, payload) {
    const ev = { channel, type, payload, at: Date.now() };
    for (const fn of this.subs) {
      try { fn(ev); } catch { /* 구독자 오류는 무시 */ }
    }
  }
}

export function createContext({ clock = realClock, dataFile = null, rules = RULES } = {}) {
  const db = {};
  for (const c of COLLECTIONS) db[c] = new Map();
  db.ledger = [];
  db.logs = [];
  db.notifications = [];

  const bus = new EventBus();
  const timers = new Map(); // key → handle

  const ctx = {
    db, bus, clock, rules,
    now: () => clock.now(),
    today: () => dayKey(clock.now()),

    // ---- 타이머 (키 단위로 하나만 유지) ----
    schedule(key, ms, fn) {
      ctx.cancel(key);
      const h = clock.setTimeout(() => {
        timers.delete(key);
        fn();
      }, ms);
      timers.set(key, h);
    },
    cancel(key) {
      if (timers.has(key)) {
        clock.clearTimeout(timers.get(key));
        timers.delete(key);
      }
    },
    cancelAll() {
      for (const h of timers.values()) clock.clearTimeout(h);
      timers.clear();
    },

    // ---- 조회 ----
    user(uid) {
      const u = db.users.get(uid);
      if (!u) throw notFound('사용자');
      return u;
    },
    vehicle(vid) {
      const v = db.vehicles.get(vid);
      if (!v) throw notFound('차량');
      return v;
    },
    vehicleByPlate(plate) {
      const p = normalizePlate(plate);
      for (const v of db.vehicles.values()) if (normalizePlate(v.plate) === p) return v;
      return null;
    },
    complex(cid) {
      const c = db.complexes.get(cid);
      if (!c) throw notFound('단지');
      return c;
    },
    zone(complexId, zoneId) {
      return ctx.complex(complexId).zones.find((z) => z.id === zoneId) || null;
    },
    spot(complexId, spotId) {
      return ctx.complex(complexId).spots.find((s) => s.id === spotId) || null;
    },

    // ---- 알림 / 기록 ----
    notify(userId, kind, message, data = {}) {
      const n = { id: id('ntf'), userId, kind, message, data, at: ctx.now(), read: false };
      db.notifications.push(n);
      if (db.notifications.length > 2000) db.notifications.splice(0, 500);
      bus.publish(`user:${userId}`, 'notification', n);
      return n;
    },
    toVehicle(vehicleId, type, payload = {}) {
      bus.publish(`vehicle:${vehicleId}`, type, { vehicleId, ...payload });
    },
    log(kind, data) {
      const entry = { id: id('log'), kind, at: ctx.now(), ...data };
      db.logs.push(entry);
      if (db.logs.length > 5000) db.logs.splice(0, 1000);
      bus.publish('admin', 'log', entry);
      return entry;
    },

    save() {
      if (!dataFile) return;
      const out = {};
      for (const c of COLLECTIONS) out[c] = [...db[c].values()];
      out.ledger = db.ledger;
      out.logs = db.logs.slice(-1000);
      out.notifications = db.notifications.slice(-500);
      mkdirSync(dirname(dataFile), { recursive: true });
      writeFileSync(dataFile, JSON.stringify(out, null, 1));
    },
    load() {
      if (!dataFile || !existsSync(dataFile)) return false;
      const raw = JSON.parse(readFileSync(dataFile, 'utf8'));
      for (const c of COLLECTIONS) {
        db[c].clear();
        for (const item of raw[c] || []) db[c].set(item.id, item);
      }
      db.ledger = raw.ledger || [];
      db.logs = raw.logs || [];
      db.notifications = raw.notifications || [];
      return true;
    },
    reset() {
      ctx.cancelAll();
      for (const c of COLLECTIONS) db[c].clear();
      db.ledger.length = 0;
      db.logs.length = 0;
      db.notifications.length = 0;
    },
  };
  return ctx;
}

/** 테스트용 수동 시계 */
export class FakeClock {
  constructor(start = Date.UTC(2026, 10, 2, 11, 0, 0)) { // KST 20:00
    this.t = start;
    this.queue = [];
    this.seq = 0;
  }
  now() { return this.t; }
  setTimeout(fn, ms) {
    const h = ++this.seq;
    this.queue.push({ h, at: this.t + Math.max(0, ms), fn });
    return h;
  }
  clearTimeout(h) { this.queue = this.queue.filter((q) => q.h !== h); }
  /** ms 만큼 시간을 흘리며 예약된 콜백을 순서대로 실행 */
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.h - b.h);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

export { RULES };
