import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, notes, kst, ble } from './helpers.js';

// ---------------- 중립 표시 ----------------
test('중립 표시: N 주차한 차는 바로 "밀어주세요", 아니면 차주 폰과 차량 화면에 알림', () => {
  const { app, ctx } = setup(kst(2026, 11, 2, 20));
  const vehicleEvents = [];
  ctx.bus.subscribe((e) => { if (e.channel === 'vehicle:veh_grandeur') vehicleEvents.push(e.type); });

  const ok = app.neutral.check({ plate: '90마3344', requesterId: 'usr_jieun' });
  assert.equal(ok.neutral, true);
  assert.equal(ok.message, '중립이에요, 평지에서 천천히 밀어주세요');

  const no = app.neutral.check({ plate: '56다7890', requesterId: 'usr_jieun' });
  assert.equal(no.neutral, false);
  assert.equal(no.message, '중립이 아니에요, 차주에게 알림을 보냈어요');
  assert.ok(notes(ctx, 'usr_sujin').some((m) => m.includes('빼 달라고')));
  assert.ok(vehicleEvents.includes('neutral.notice'));

  const visitor = app.neutral.check({ plate: '56다7890' });
  assert.equal(visitor.fallback, 'contact');
  const unknown = app.neutral.check({ plate: '00허0000' });
  assert.equal(unknown.participant, false);
});

test('중립 등록: 기어가 N이 아니거나 경사 구역이면 거절, 기어를 바꾸면 자동 해제', () => {
  const { app, ctx } = setup(kst(2026, 11, 2, 20));
  assert.throws(() => app.neutral.register('usr_sujin', 'veh_grandeur', true), /N으로 두고/);
  app.vehicleState.update('veh_grandeur', { gear: 'N' }, 'app');
  app.neutral.register('usr_sujin', 'veh_grandeur', true);
  assert.equal(ctx.vehicle('veh_grandeur').state.neutral, true);
  app.vehicleState.update('veh_grandeur', { gear: 'P' }, 'app');
  assert.equal(ctx.vehicle('veh_grandeur').state.neutral, false);
  app.vehicleState.update('veh_grandeur', { gear: 'N', zoneId: 'B1-ramp' }, 'app');
  assert.throws(() => app.neutral.register('usr_sujin', 'veh_grandeur', true), /경사/);
});

// ---------------- 빈자리 레이더 ----------------
test('빈자리 레이더: 출차 신호 → 입차 차량에 안내 → 응 → 자리 확보 → 주차하면 찼음', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const sorentoEvents = [];
  ctx.bus.subscribe((e) => { if (e.channel === 'vehicle:veh_sorento') sorentoEvents.push(e); });

  // 쏘렌토가 입차 게이트 통과
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'D' }, 'app');
  // 그랜저 출차 (주차 → 주행 전환)
  app.vehicleState.update('veh_grandeur', { gear: 'D' }, 'app');
  assert.equal(ctx.user('usr_sujin').credits, 10, '출차 신호 크레딧');

  const offerEv = sorentoEvents.find((e) => e.type === 'vacancy.offer');
  assert.ok(offerEv, '빈자리 안내');
  assert.match(offerEv.payload.message, /B2 7열 근처에 방금 한 자리 비었어요/);
  assert.equal(offerEv.payload.spot.id, 'B2-7-06');

  clock.advance(20_000);
  const res = app.vacancy.respond(offerEv.payload.offerId, 'veh_sorento', true);
  assert.equal(res.status, 'accepted');
  const vac = [...ctx.db.vacancies.values()][0];
  assert.equal(vac.status, 'held');

  // 쏘렌토가 그 자리에 주차 → 찼음, 쏘렌토의 새 자리로 기록
  app.vehicleState.update('veh_sorento', { gear: 'P', spotId: 'B2-7-06' }, 'app');
  assert.equal(vac.status, 'filled');
  assert.equal(ctx.vehicle('veh_sorento').home.spotId, 'B2-7-06');
});

test('빈자리 레이더: 안내한 자리를 다른 차가 먼저 차지하면 "자리가 찼어요"', () => {
  const { app, ctx } = setup(kst(2026, 11, 2, 20));
  const events = [];
  ctx.bus.subscribe((e) => { if (e.channel === 'vehicle:veh_sorento') events.push(e); });
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'D' }, 'app');
  app.vehicleState.update('veh_grandeur', { gear: 'D' }, 'app');
  const offer = events.find((e) => e.type === 'vacancy.offer').payload;
  app.vacancy.respond(offer.offerId, 'veh_sorento', true);
  // 지은 씨 아반떼가 먼저 그 자리에 섬
  app.vehicleState.setHome('veh_avante', 'B2-7-06');
  assert.ok(events.some((e) => e.type === 'vacancy.filled' && e.payload.message === '자리가 찼어요'));
});

test('빈자리 레이더: 60초 무응답이면 다음 순위, 한 번 입차에 최대 2건', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const offers = [];
  ctx.bus.subscribe((e) => { if (e.type === 'vacancy.offer') offers.push(e.payload); });

  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'D' }, 'app');
  clock.advance(1_000);
  app.vehicleState.update('veh_grandeur', { gear: 'D' }, 'app');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].vehicleId, 'veh_sorento');

  // 지은 씨 아반떼가 나갔다가 들어오는 중 (게이트 통과가 쏘렌토보다 늦음)
  app.vehicleState.update('veh_avante', { gear: 'D' }, 'app');
  // 아반떼 출차로 두 번째 빈자리 → 쏘렌토는 이미 안내 대기 중이라 대기
  app.vehicleState.update('veh_avante', { inComplex: false }, 'app');
  app.vehicleState.update('veh_avante', { inComplex: true }, 'app');
  clock.advance(10);
  // 아반떼가 받은 안내는 B2-7-05가 아닌 다른 자리여야 한다 (한 자리는 한 대에게만)
  const avanteOffer = offers.find((o) => o.vehicleId === 'veh_avante');
  if (avanteOffer) assert.notEqual(avanteOffer.spot.id, offers[0].spot.id);

  clock.advance(61_000); // 쏘렌토 무응답
  const second = offers.filter((o) => o.vehicleId === 'veh_sorento');
  assert.ok(second.length <= 2, '한 번 입차에 최대 2건');
  clock.advance(61_000);
  clock.advance(61_000);
  assert.ok(offers.filter((o) => o.vehicleId === 'veh_sorento').length <= 2);
});

test('빈자리 레이더: 장애인 칸 제외, 충전기 칸은 충전이 필요한 전기차에게만', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const offers = [];
  ctx.bus.subscribe((e) => { if (e.type === 'vacancy.offer') offers.push(e.payload); });
  // 그랜저를 장애인 칸(B2-7-08)으로 옮겨 두었다가 출차
  app.vehicleState.setHome('veh_grandeur', 'B2-7-08');
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'D' }, 'app');
  app.vehicleState.update('veh_grandeur', { gear: 'D' }, 'app');
  assert.equal(offers.length, 0, '장애인 칸은 안내하지 않음');

  // 충전기 칸(B2-7-01)이 비면 쏘렌토(내연기관)에게는 안내하지 않음
  app.vehicleState.update('veh_grandeur', { gear: 'P', spotId: 'B2-7-01' }, 'app');
  app.vehicleState.setHome('veh_grandeur', 'B2-7-01');
  app.vehicleState.update('veh_grandeur', { gear: 'D' }, 'app');
  clock.advance(10);
  assert.equal(offers.length, 0);
});

test('주차를 마치면 차량 화면이 비켜줘를 켤지 묻는다', () => {
  const { app, ctx } = setup(kst(2026, 11, 2, 20));
  const prompts = [];
  ctx.bus.subscribe((e) => { if (e.channel === 'vehicle:veh_sorento' && e.type === 'parked.prompt') prompts.push(e.payload); });
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'D' }, 'app');
  app.vehicleState.update('veh_sorento', { gear: 'P', spotId: 'B2-8-03' }, 'app');
  assert.ok(prompts[0].prompts.some((p) => p.text === '오늘 밤 비켜줘를 켜 둘까요?'));
  assert.equal(ctx.vehicle('veh_sorento').home.spotId, 'B2-8-03');
});

// ---------------- 트렁크 드롭 ----------------
test('트렁크 드롭: 귀중품 확인 → 지정 계정만 열기 → 닫으면 "물건이 도착했어요"', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 12));
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'P', spotId: 'B2-8-02' }, 'app');
  assert.throws(() => app.trunk.issue('usr_hyunwoo', { vehicleId: 'veh_sorento', giverNickname: '수진', valuablesRemoved: false }), /귀중품/);
  const t = app.trunk.issue('usr_hyunwoo', { vehicleId: 'veh_sorento', giverNickname: '수진', valuablesRemoved: true, note: '유모차' });
  assert.equal(t.firstTrade, true);
  assert.ok(t.warnings.some((w) => w.includes('실내가 이어진')), '트렁크 스루 차종 경고');

  assert.throws(() => (ble(app, t.vehicle.id, 'rear', 1.0), app.trunk.open('usr_jieun', t.id)), /지정한 계정만/);
  (ble(app, t.vehicle.id, 'rear', 1.0), app.trunk.open('usr_sujin', t.id));
  clock.advance(1_000);
  assert.equal(app.trunk.get(t.id).status, 'open');
  assert.equal(ctx.vehicle('veh_sorento').state.doors.REAR, 1);

  app.agent.closeTrunk('veh_sorento');
  const done = app.trunk.get(t.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.clipIds.length, 2);
  assert.ok(notes(ctx, 'usr_hyunwoo').some((m) => m.startsWith('물건이 도착했어요')));
  assert.equal(ctx.user('usr_hyunwoo').credits, 20);
  assert.throws(() => (ble(app, t.vehicle.id, 'rear', 1.0), app.trunk.open('usr_sujin', t.id)), /이미 쓰였거나/);
});

test('트렁크 드롭: 10분 지나면 소멸, 닫힘 미감지 시 차주 알림 → 관리사무소 알림', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 12));
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'P' }, 'app');
  const t1 = app.trunk.issue('usr_hyunwoo', { vehicleId: 'veh_sorento', giverNickname: '수진', valuablesRemoved: true });
  clock.advance(10 * 60_000 + 1);
  assert.equal(app.trunk.get(t1.id).status, 'expired');

  // 차량 앱이 연결된 상황 (가상 에이전트가 자동으로 닫지 않음)
  ctx.presence.set('veh_sorento', 1);
  const t2 = app.trunk.issue('usr_hyunwoo', { vehicleId: 'veh_sorento', giverNickname: '수진', valuablesRemoved: true });
  (ble(app, t2.vehicle.id, 'rear', 1.0), app.trunk.open('usr_sujin', t2.id));
  app.trunk.onState('veh_sorento', t2.id, 'opened');
  clock.advance(3 * 60_000 + 1);
  assert.equal(app.trunk.get(t2.id).status, 'unclosed');
  assert.ok(notes(ctx, 'usr_hyunwoo').some((m) => m.includes('아직 열려 있어요')));
  clock.advance(7 * 60_000 + 1);
  assert.ok(notes(ctx, 'usr_office').some((m) => m.includes('10분 넘게')));
});

test('트렁크 드롭: 하루 3회 한도', () => {
  const { app, ctx } = setup(kst(2026, 11, 2, 12));
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'P' }, 'app');
  for (let i = 0; i < 3; i++) {
    const t = app.trunk.issue('usr_hyunwoo', { vehicleId: 'veh_sorento', giverNickname: '수진', valuablesRemoved: true });
    app.trunk.cancel('usr_hyunwoo', t.id);
    ctx.db.trunkTokens.get(t.id).status = 'expired';
  }
  assert.throws(() => app.trunk.issue('usr_hyunwoo', { vehicleId: 'veh_sorento', giverNickname: '수진', valuablesRemoved: true }), /하루 3회/);
});

// ---------------- 공통 기반 ----------------
test('입주민·실명 인증을 마쳐야 차량 등록, 세대 등록 대수 초과 불가', () => {
  const { app } = setup(kst(2026, 11, 2, 12));
  const u = app.accounts.registerUser({ name: '신규', phone: '010-1' });
  assert.throws(() => app.accounts.registerVehicle(u.id, { plate: '11가1111' }), /인증/);
  app.accounts.verifyPhone(u.id, '000000');
  app.accounts.verifyResident(u.id, { complexId: 'cpx_hanbit1', joinCode: 'HB-2026', dong: '103', ho: '302' });
  // 103-302 세대는 이미 1대(아반떼) 등록, 한도 1
  assert.throws(() => app.accounts.registerVehicle(u.id, { plate: '11가1111' }), /세대 차량 대수/);
});

test('위임 범위: 특정 동으로 좁히면 다른 동 주민은 요청 불가, 오늘은 안 됨 토글', () => {
  const { app } = setup(kst(2026, 11, 2, 20));
  app.delegation.updatePolicy('usr_minsu', 'veh_ioniq5', { scope: { type: 'dongs', dongs: ['104'] } });
  assert.equal(app.move.create('usr_jieun', { targets: [{ plate: '12가3456' }] }).denyCode, 'OUT_OF_SCOPE');
  app.delegation.updatePolicy('usr_minsu', 'veh_ioniq5', { scope: { type: 'complex' }, pausedToday: true });
  assert.equal(app.move.create('usr_jieun', { targets: [{ plate: '12가3456' }] }).denyCode, 'PAUSED_TODAY');
});

test('지하주차장 밖에서는 토큰 무효', () => {
  const { app, clock } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: '12가3456' }] });
  clock.advance(31_000);
  app.ctx.vehicle('veh_ioniq5').state.inComplex = false;
  ble(app, 'veh_ioniq5');
  assert.throws(() => app.move.hold('usr_jieun', req.id), /지하주차장 밖/);
});

test('영상은 72시간 뒤 자동 삭제, 관리사무소는 분쟁 건만 열람', () => {
  const { app, clock } = setup(kst(2026, 11, 2, 12));
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'P' }, 'app');
  const t = app.trunk.issue('usr_hyunwoo', { vehicleId: 'veh_sorento', giverNickname: '수진', valuablesRemoved: true });
  (ble(app, t.vehicle.id, 'rear', 1.0), app.trunk.open('usr_sujin', t.id));
  clock.advance(1_000);
  app.agent.closeTrunk('veh_sorento');
  assert.equal(app.audit.clipsFor('usr_sujin', t.id).length, 2);
  assert.equal(app.audit.clipsFor('usr_office', t.id).length, 0);
  assert.equal(app.audit.clipsFor('usr_jieun', t.id).length, 0);
  app.audit.openDispute({ reporterId: 'usr_hyunwoo', refType: 'trunk', refId: t.id, reason: '파손' });
  assert.equal(app.audit.clipsFor('usr_office', t.id).length, 2);
  clock.advance(73 * 3600_000);
  app.audit.purgeExpired();
  assert.equal(app.audit.clipsFor('usr_sujin', t.id).length, 2, '분쟁 건은 30일 보관');
});

// ---------------- 추가: 옆 차 빈자리 확인 · 트렁크 꺼내 가기 · 밀착 구역 ----------------
test('빈자리 레이더: 양옆에 주차된 참여 차가 빈 칸을 함께 확인하고 안내 문구에 들어간다', () => {
  const { app, ctx } = setup(kst(2026, 11, 2, 20));
  const offers = [];
  ctx.bus.subscribe((e) => { if (e.type === 'vacancy.offer') offers.push(e.payload); });
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'D' }, 'app');
  app.vehicleState.update('veh_grandeur', { gear: 'D' }, 'app');
  const vac = [...ctx.db.vacancies.values()][0];
  assert.deepEqual(vac.witnesses.map((w) => w.vehicleId).sort(), ['veh_kona', 'veh_palisade']);
  assert.match(offers[0].message, /옆 차 2대가 확인했어요/);
  assert.equal(ctx.user('usr_seoyeon').credits, 5, '센서 확인 크레딧');
});

test('트렁크 드롭: "꺼내 가세요" 토큰은 닫히면 "물건을 가져갔어요"', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 12));
  const t = app.trunk.issue('usr_minsu', { vehicleId: 'veh_ioniq5', giverNickname: '수진', valuablesRemoved: true, note: '빌려준 캠핑의자', purpose: 'pickup' });
  assert.equal(t.purpose, 'pickup');
  assert.ok(notes(ctx, 'usr_sujin').some((m) => m.includes('물건을 꺼내 가세요')));
  (ble(app, t.vehicle.id, 'rear', 1.0), app.trunk.open('usr_sujin', t.id));
  clock.advance(1_000);
  app.agent.closeTrunk('veh_ioniq5');
  assert.ok(notes(ctx, 'usr_minsu').some((m) => m.startsWith('물건을 가져갔어요')));
});

test('밀착 구역: 비켜줘를 켠 차만 · 칸 앞에 세우고 내려서 누르는 동안만 들어간다', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 21));
  const info = app.compact.zoneInfo('cpx_hanbit1');
  assert.equal(info.total, 4);
  assert.equal(info.normalEquivalent, 3, '같은 폭이면 일반 구획 3칸');
  assert.equal(info.free, 1);

  // 원격 전·후진이 없는 차는 안 됨
  app.vehicleState.update('veh_avante', { gear: 'D' }, 'app');
  assert.throws(() => app.compact.start('usr_jieun', 'veh_avante'), /원격 비켜줘를 켠 차만/);

  app.vehicleState.update('veh_ev6', { inComplex: true, gear: 'D' }, 'app');
  const s = app.compact.start('usr_harin', 'veh_ev6');
  assert.equal(s.spotId, 'B2-C-04');
  app.compact.atFront('usr_harin', s.id);
  ble(app, 'veh_ev6', 'inside', 0.4); // 아직 차 안
  assert.throws(() => app.compact.hold('usr_harin', s.id), /내려/);
  ble(app, 'veh_ev6', 'side', 2.0); // 내려서 차 옆

  // 2초 누르고 손 떼기 → 멈춤
  for (let t = 0; t < 2000; t += 300) { app.compact.hold('usr_harin', s.id); clock.advance(300); }
  clock.advance(1500);
  const mid = app.compact.get(s.id);
  assert.equal(mid.status, 'paused');
  assert.ok(mid.distance > 1 && mid.distance < 2.5);

  // 다시 눌러 끝까지
  for (let t = 0; t < 6000; t += 300) { app.compact.hold('usr_harin', s.id); clock.advance(300); }
  assert.equal(app.compact.get(s.id).status, 'parked');
  const v = ctx.vehicle('veh_ev6');
  assert.equal(v.state.spotId, 'B2-C-04');
  assert.equal(v.home.spotId, 'B2-C-04');
  assert.equal(app.compact.zoneInfo('cpx_hanbit1').free, 0);
  assert.throws(() => { app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'D' }, 'app'); app.delegation.updatePolicy('usr_hyunwoo', 'veh_sorento', { functions: { move: true } }); app.compact.start('usr_hyunwoo', 'veh_sorento'); }, /다 찼어요/);
});

test('차량 화면 빈자리 레이더: 그 열의 칸 배치 · 방금 나간 차 · 확인한 옆 차를 함께 보낸다', () => {
  const { app, ctx } = setup(kst(2026, 11, 2, 20));
  const offers = [];
  ctx.bus.subscribe((e) => { if (e.type === 'vacancy.offer') offers.push(e.payload); });
  app.vehicleState.update('veh_grandeur', { gear: 'D' }, 'app');
  app.vehicleState.update('veh_ioniq5', { gear: 'D' }, 'app');
  app.vehicleState.update('veh_ioniq5', { inComplex: false }, 'app');
  app.vehicleState.update('veh_ioniq5', { inComplex: true }, 'app');
  const r = offers.at(-1).radar;
  assert.equal(r.departed.model, '그랜저');
  const vacant = r.spots.filter((s) => s.state === 'vacant');
  assert.equal(vacant.length, 1);
  assert.equal(r.spots.filter((s) => s.state === 'witness').length, 2, '양옆 참여 차 2대');
});

test('밀착 구역: 안내할 빈자리가 없으면 입차한 차량 화면에 밀착 구역을 안내하고, 차량에서 시작·칸 앞 도착', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 21));
  const events = [];
  ctx.bus.subscribe((e) => { if (e.channel === 'vehicle:veh_ioniq5') events.push(e); });
  app.vehicleState.update('veh_ioniq5', { gear: 'D' }, 'app');
  app.vehicleState.update('veh_ioniq5', { inComplex: false }, 'app');
  app.vehicleState.update('veh_ioniq5', { inComplex: true }, 'app');
  const offer = events.find((e) => e.type === 'compact.offer');
  assert.ok(offer, '밀착 구역 안내');
  assert.equal(offer.payload.next.id, 'B2-C-04');

  const s = app.compact.start('usr_minsu', 'veh_ioniq5');
  app.vehicleState.update('veh_ioniq5', { gear: 'P' }, 'app'); // 칸 앞에서 P
  app.compact.atFront('usr_minsu', s.id);
  assert.ok(!events.some((e) => e.type === 'parked.prompt'), '밀착 안내 중에는 주차 질문 없음');
  assert.ok(events.some((e) => e.type === 'compact.update' && e.payload.status === 'ready'));
  ble(app, 'veh_ioniq5', 'side', 2.0);
  for (let t = 0; t < 7000; t += 300) { app.compact.hold('usr_minsu', s.id); clock.advance(300); }
  assert.equal(app.compact.get(s.id).status, 'parked');
});

test('같은 날 이미 비켜줘를 켜 둔 차는 다시 주차해도 묻지 않는다', () => {
  const { app, ctx } = setup(kst(2026, 11, 2, 21));
  const prompts = [];
  ctx.bus.subscribe((e) => { if (e.type === 'parked.prompt' && e.channel === 'vehicle:veh_ioniq5') prompts.push(e.payload); });
  app.vehicleState.update('veh_ioniq5', { gear: 'D' }, 'app');
  app.vehicleState.update('veh_ioniq5', { gear: 'P' }, 'app');
  app.vehicleState.update('veh_ioniq5', { gear: 'D' }, 'app');
  app.vehicleState.update('veh_ioniq5', { gear: 'P' }, 'app');
  assert.equal(prompts.filter((p) => p.prompts.some((x) => x.kind === 'enable_move')).length, 1);
});
