import { Router, openStream, requireUser, requireVehicle } from './http.js';
import { fail, forbidden, dayKey } from './util.js';
import { seed } from './seed.js';

const PARKED = new Set(['P', 'N']);

export function buildRoutes(app) {
  const { ctx } = app;
  const r = new Router();
  const me = (h, q) => requireUser(ctx, h, q);
  const vehicleView = (v) => ({
    id: v.id, plate: v.plate, model: v.model, isEv: v.isEv, hasRspa: v.hasRspa, hasPleos: v.hasPleos,
    trunkThrough: v.trunkThrough, policy: v.policy, state: v.state, home: v.home, complexId: v.complexId,
    activeMoveId: v.activeMoveId || null,
  });
  const ownerOnly = (user, vehicleId) => {
    const v = ctx.vehicle(vehicleId);
    if (v.ownerId !== user.id) throw forbidden('NOT_OWNER', '내 차만 설정할 수 있어요');
    return v;
  };
  const after = (x) => { ctx.save(); return x; };

  // ---------------- 공용 ----------------
  r.get('/api/health', () => ({ ok: true, at: ctx.now() }));
  r.get('/api/complexes/:id', ({ params }) => {
    const c = ctx.complex(params.id);
    return { id: c.id, name: c.name, geofence: c.geofence, gate: c.gate, zones: c.zones, spots: c.spots };
  });
  r.get('/api/demo/users', () => [...ctx.db.users.values()].map((u) => ({
    id: u.id, nickname: u.nickname, name: u.name, dong: u.dong, ho: u.ho, role: u.role,
    vehicles: [...ctx.db.vehicles.values()].filter((v) => v.ownerId === u.id).map((v) => ({ id: v.id, plate: v.plate, model: v.model })),
  })));

  // 번호판으로 중립 여부 확인 (방문자는 로그인 없이 '차주에게 연락'만)
  r.post('/api/neutral-check', ({ body, headers }) => after(app.neutral.check({ plate: body.plate, requesterId: headers['x-user-id'] || null })));

  // ---------------- 계정 ----------------
  r.post('/api/users', ({ body }) => after(app.accounts.registerUser(body)));
  r.post('/api/users/:id/verify-phone', ({ params, body }) => after(app.accounts.verifyPhone(params.id, body.code)));
  r.post('/api/users/:id/verify-resident', ({ params, body }) => after(app.accounts.verifyResident(params.id, body)));

  r.get('/api/me', ({ headers, query }) => {
    const u = me(headers, query);
    return {
      user: { ...u, phone: undefined },
      vehicles: [...ctx.db.vehicles.values()].filter((v) => v.ownerId === u.id).map((v) => ({ ...vehicleView(v), appKey: v.appKey })),
      credits: app.credits.summary(u.id),
      notifications: ctx.db.notifications.filter((n) => n.userId === u.id).slice(-30).reverse(),
      moves: app.move.listFor(u.id),
      trunks: app.trunk.listFor(u.id),
    };
  });
  r.get('/api/credits', ({ headers, query }) => app.credits.summary(me(headers, query).id));
  r.get('/api/stream', ({ req, res, query }) => {
    const u = ctx.user(query.userId);
    openStream(req, res, ctx.bus, (ev) => ev.channel === `user:${u.id}`);
  });

  // ---------------- 차량 (차주 폰) ----------------
  r.post('/api/vehicles', ({ headers, body }) => after(vehicleView(app.accounts.registerVehicle(me(headers).id, body))));
  r.patch('/api/vehicles/:id/policy', ({ headers, params, body }) => after(app.delegation.updatePolicy(me(headers).id, params.id, body)));
  r.post('/api/vehicles/:id/revoke', ({ headers, params }) => {
    app.delegation.revokeAll(me(headers).id, params.id);
    return after({ ok: true });
  });
  r.post('/api/vehicles/:id/neutral', ({ headers, params, body }) => after(app.neutral.register(me(headers).id, params.id, !!body.neutral)));
  r.post('/api/vehicles/:id/home', ({ headers, params, body }) => {
    ownerOnly(me(headers), params.id);
    return after(app.vehicleState.setHome(params.id, body.spotId));
  });

  // ---------------- 비켜줘 ----------------
  r.post('/api/move-requests', ({ headers, body }) => after(app.move.create(me(headers).id, body)));
  r.get('/api/move-requests', ({ headers }) => app.move.listFor(me(headers).id));
  r.get('/api/move-requests/:id', ({ headers, params }) => {
    const u = me(headers);
    const req = app.move.get(params.id);
    if (req.requesterId !== u.id && !req.items.some((i) => i.ownerId === u.id)) throw forbidden('NOT_PARTY', '당사자만 볼 수 있어요');
    return app.move.view(req, u.id);
  });
  r.post('/api/move-requests/:id/decision', ({ headers, params, body }) => after(app.move.ownerDecision(me(headers).id, params.id, body.decision)));
  r.post('/api/move-requests/:id/hold', ({ headers, params, body }) => app.move.hold(me(headers).id, params.id, body));
  r.post('/api/move-requests/:id/release', ({ headers, params }) => app.move.release(me(headers).id, params.id));
  r.post('/api/move-requests/:id/finish', ({ headers, params }) => app.move.finishMove(me(headers).id, params.id));
  r.post('/api/move-requests/:id/return', ({ headers, params }) => after(app.move.startReturn(me(headers).id, params.id)));
  r.post('/api/move-requests/:id/tidy-direction', ({ headers, params, body }) => app.move.setTidyDirection(me(headers).id, params.id, body.direction));
  r.post('/api/move-requests/:id/cancel', ({ headers, params }) => after(app.move.cancel(me(headers).id, params.id)));

  // ---------------- 트렁크 드롭 ----------------
  r.post('/api/trunk-tokens', ({ headers, body }) => after(app.trunk.issue(me(headers).id, body)));
  r.get('/api/trunk-tokens', ({ headers }) => app.trunk.listFor(me(headers).id));
  r.post('/api/trunk-tokens/:id/open', ({ headers, params, body }) => after(app.trunk.open(me(headers).id, params.id, body)));
  r.post('/api/trunk-tokens/:id/cancel', ({ headers, params }) => after(app.trunk.cancel(me(headers).id, params.id)));

  // ---------------- 밀착 구역 (확장 기능) ----------------
  r.get('/api/compact', ({ headers, query }) => app.compact.statusFor(me(headers, query).id));
  r.post('/api/compact', ({ headers, body }) => after(app.compact.start(me(headers).id, body.vehicleId)));
  r.post('/api/compact/:id/front', ({ headers, params }) => after(app.compact.atFront(me(headers).id, params.id)));
  r.post('/api/compact/:id/hold', ({ headers, params, body }) => app.compact.hold(me(headers).id, params.id, body));
  r.post('/api/compact/:id/release', ({ headers, params }) => app.compact.release(me(headers).id, params.id));

  // ---------------- 기록 · 분쟁 · 신고 ----------------
  r.get('/api/clips', ({ headers, query }) => app.audit.clipsFor(me(headers).id, query.refId || null));
  r.post('/api/disputes', ({ headers, body }) => after(app.audit.openDispute({ reporterId: me(headers).id, refType: body.refType, refId: body.refId, reason: body.reason })));
  r.get('/api/disputes', ({ headers }) => app.audit.listDisputes(me(headers).id));
  r.post('/api/reports', ({ headers, body }) => after(app.audit.report(me(headers).id, body.targetUserId, body.reason)));

  // 관리사무소: 개인을 알아볼 수 없는 단지 단위 통계만
  r.get('/api/office/stats', ({ headers }) => {
    const u = me(headers);
    if (u.role !== 'office') throw forbidden('OFFICE_ONLY', '관리사무소 계정만 볼 수 있어요');
    const reqs = [...ctx.db.moveRequests.values()].filter((x) => x.complexId === u.complexId);
    const byDay = {};
    for (const x of reqs) {
      const d = dayKey(x.createdAt);
      byDay[d] ||= { requests: 0, resolved: 0, contactFallback: 0 };
      byDay[d].requests++;
      if (['RETURNED', 'MOVED', 'RETURN_OVERDUE'].includes(x.status)) byDay[d].resolved++;
      if (x.fallback === 'contact' || ['REJECTED', 'INTERLOCK_FAILED'].includes(x.status)) byDay[d].contactFallback++;
    }
    const vacs = [...ctx.db.vacancies.values()].filter((x) => x.complexId === u.complexId);
    return {
      moveRequestsByDay: byDay,
      vacancySignals: vacs.length,
      vacancyAccepted: [...ctx.db.offers.values()].filter((o) => o.status === 'accepted').length,
      participatingVehicles: [...ctx.db.vehicles.values()].filter((v) => v.complexId === u.complexId && v.policy.enabled).length,
      openDisputes: app.audit.listDisputes(u.id).filter((d) => d.status === 'open').length,
    };
  });

  // ---------------- 차량 앱 (Pleos Connect) ----------------
  r.get('/api/vehicle/pair', ({ query }) => {
    const v = ctx.vehicleByPlate(query.plate);
    if (!v || v.appKey !== query.key) throw forbidden('PAIR_FAILED', '차량 번호나 페어링 키가 맞지 않아요');
    const owner = ctx.user(v.ownerId);
    return { vehicleId: v.id, plate: v.plate, model: v.model, owner: app.accounts.publicUser(owner), complexId: v.complexId };
  });
  r.get('/api/vehicle/:id', ({ params, headers, query }) => {
    const v = requireVehicle(ctx, params, headers, query);
    const c = ctx.complex(v.complexId);
    return {
      vehicle: vehicleView(v),
      owner: app.accounts.publicUser(ctx.user(v.ownerId)),
      credits: app.credits.summary(v.ownerId),
      complex: { id: c.id, name: c.name, geofence: c.geofence, zones: c.zones, spots: c.spots },
      moves: app.move.listFor(v.ownerId).filter((m) => m.items.some((i) => i.vehicleId === v.id)).slice(0, 5),
    };
  });
  r.get('/api/vehicle/:id/stream', ({ req, res, params, headers, query }) => {
    const v = requireVehicle(ctx, params, headers, query);
    ctx.presence.set(v.id, (ctx.presence.get(v.id) || 0) + 1);
    ctx.log('vehicle.app.connected', { vehicleId: v.id });
    openStream(req, res, ctx.bus, (ev) => ev.channel === `vehicle:${v.id}`, () => {
      ctx.presence.set(v.id, Math.max(0, (ctx.presence.get(v.id) || 1) - 1));
      ctx.log('vehicle.app.disconnected', { vehicleId: v.id });
    });
  });
  r.post('/api/vehicle/:id/state', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.vehicleState.update(v.id, body, 'app'));
  });
  r.post('/api/vehicle/:id/interlock', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.move.onInterlockResult(v.id, body.requestId, body.snapshot));
  });
  r.post('/api/vehicle/:id/move-progress', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.move.onProgress(v.id, body));
  });
  r.post('/api/vehicle/:id/trunk-state', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.trunk.onState(v.id, body.tokenId, body.state, body.reason));
  });
  r.post('/api/vehicle/:id/vacancy-response', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.vacancy.respond(body.offerId, v.id, !!body.accept));
  });
  r.post('/api/vehicle/:id/home', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.vehicleState.setHome(v.id, body.spotId));
  });
  // 차량 화면에서의 설정은 정차 중에만
  const parkedOnly = (v) => {
    if (!PARKED.has(v.state.gear)) throw fail('DRIVING', '주행 중에는 설정할 수 없어요. 정차 후 다시 시도해 주세요');
  };
  r.post('/api/vehicle/:id/policy', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    parkedOnly(v);
    return after(app.delegation.updatePolicy(v.ownerId, v.id, body));
  });
  r.post('/api/vehicle/:id/voice-consent', ({ params, headers, body }) => {
    // 음성 '응' 한 마디로 켜는 경로 (주차 직후 질문에 대한 답)
    const v = requireVehicle(ctx, params, headers);
    parkedOnly(v);
    if (body.kind === 'enable_move') {
      return after(app.delegation.updatePolicy(v.ownerId, v.id, { enabled: true, functions: { move: true }, pausedToday: false }));
    }
    if (body.kind === 'decline_move') {
      // '아니': 위임 설정은 그대로 두고 오늘만 쉼
      return after(app.delegation.updatePolicy(v.ownerId, v.id, { pausedToday: true }));
    }
    if (body.kind === 'register_neutral') return after(app.neutral.register(v.ownerId, v.id, true));
    throw fail('INVALID', '알 수 없는 질문이에요');
  });
  r.post('/api/vehicle/:id/neutral', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.neutral.register(v.ownerId, v.id, !!body.neutral));
  });
  // 밀착 구역: 차량 화면에서 안내 받기 · 칸 앞 도착(P)
  r.post('/api/vehicle/:id/compact', ({ params, headers }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.compact.start(v.ownerId, v.id));
  });
  r.post('/api/vehicle/:id/compact/:sid/front', ({ params, headers }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.compact.atFront(v.ownerId, params.sid));
  });
  // 요청자 근접 (차량이 BLE로 잰 거리·방향)
  r.post('/api/vehicle/:id/proximity', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return app.proximity.report(v.id, body, 'vehicle');
  });
  r.post('/api/vehicle/:id/veto', ({ params, headers, body }) => {
    const v = requireVehicle(ctx, params, headers);
    return after(app.move.ownerDecision(v.ownerId, body.requestId, body.decision));
  });

  // ---------------- 데모 콘솔 / 시뮬레이터 ----------------
  r.get('/api/admin/snapshot', () => ({
    now: ctx.now(),
    complexes: [...ctx.db.complexes.values()],
    users: [...ctx.db.users.values()].map((u) => ({ id: u.id, nickname: u.nickname, dong: u.dong, ho: u.ho, credits: u.credits, role: u.role })),
    vehicles: [...ctx.db.vehicles.values()].map((v) => ({ ...vehicleView(v), ownerId: v.ownerId, appConnected: (ctx.presence.get(v.id) || 0) > 0 })),
    moves: [...ctx.db.moveRequests.values()].slice(-20).reverse().map((x) => app.move.view(x)),
    vacancies: [...ctx.db.vacancies.values()].slice(-20).reverse(),
    offers: [...ctx.db.offers.values()].slice(-20).reverse(),
    trunks: [...ctx.db.trunkTokens.values()].slice(-20).reverse().map((t) => app.trunk.view(t)),
    compacts: [...ctx.db.compacts.values()].slice(-10).reverse().map((s) => app.compact.view(s)),
    proximity: [...ctx.db.proximity.keys()].map((id) => app.proximity.view(id)).filter((p) => p.zone),
    logs: ctx.db.logs.slice(-80).reverse(),
  }));
  r.get('/api/admin/stream', ({ req, res }) => openStream(req, res, ctx.bus, (ev) => ev.channel === 'admin'));
  r.post('/api/sim/vehicles/:id/state', ({ params, body }) => after(app.vehicleState.update(params.id, body, 'sim')));
  // 차량 앱이 연결된 차는 앱에도 닫기 명령을 보낸다 (SDK 목표값까지 닫힘으로)
  r.post('/api/sim/vehicles/:id/trunk-close', ({ params }) => {
    if (!app.agent.isVirtual(params.id)) ctx.toVehicle(params.id, 'trunk.close', {});
    return after(app.agent.closeTrunk(params.id));
  });
  // 시연: 요청자 폰이 차에서 어디쯤 있는지 넣는다. 차량 앱이 연결된 차는 앱이 받아 재고 보고한다
  r.post('/api/sim/vehicles/:id/ble', ({ params, body }) => {
    if (!app.agent.isVirtual(params.id)) {
      ctx.toVehicle(params.id, 'sim.ble', { distanceM: body.distanceM, zone: body.zone ?? 'clear' });
      return { ok: true, via: 'vehicle' };
    }
    return app.proximity.report(params.id, body, 'virtual');
  });
  r.post('/api/sim/reset', () => {
    seed(app);
    ctx.save();
    ctx.bus.publish('admin', 'reset', {});
    return { ok: true };
  });

  return r;
}
