import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, holdFor, notes, kst, ble } from './helpers.js';

const IONIQ = '12가3456';

test('비켜줘 전체 흐름: 30초 거부 창 → 인터록 → 누르는 동안 3m 이동 → 크레딧 → 복귀', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ, direction: 'forward' }] });
  assert.equal(req.status, 'VETO');
  assert.ok(notes(ctx, 'usr_minsu').some((m) => m.includes('30초 안에 거부하지 않으면')));

  clock.advance(29_000);
  assert.equal(app.move.get(req.id).status, 'VETO');
  clock.advance(1_000);
  assert.equal(app.move.get(req.id).status, 'PRECHECK');
  clock.advance(500); // 가상 차량 자가 점검
  const r = app.move.get(req.id);
  assert.equal(r.status, 'READY');
  assert.ok(ctx.vehicle('veh_ioniq5').state.tempVacated, '이동 중인 자리는 빈자리 안내에서 제외');

  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  const moved = app.move.get(req.id);
  assert.equal(moved.status, 'MOVED');
  assert.equal(moved.items[0].distance, 3);
  assert.equal(ctx.db.tokens.get(moved.items[0].tokenId).status, 'used');
  assert.equal(ctx.user('usr_minsu').credits, 100);
  assert.equal(ctx.user('usr_jieun').credits, -100);
  assert.ok(ctx.db.clips.size >= 2, '전후 영상 기록');

  app.move.startReturn('usr_jieun', req.id);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  const done = app.move.get(req.id);
  assert.equal(done.status, 'RETURNED');
  assert.equal(ctx.vehicle('veh_ioniq5').state.offsetM, 0);
  assert.equal(ctx.vehicle('veh_ioniq5').activeMoveId, null);
});

test('차주가 30초 안에 거부하면 차주가 직접 처리, 크레딧 차감 없음', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  app.move.ownerDecision('usr_minsu', req.id, 'reject');
  clock.advance(40_000);
  assert.equal(app.move.get(req.id).status, 'REJECTED');
  assert.equal(ctx.user('usr_jieun').credits, 0);
  assert.ok(notes(ctx, 'usr_jieun').some((m) => m.includes('차주가 직접 처리합니다')));
});

test('차 안에 사람이 있으면 인터록이 막고 차주에게 알림', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  app.vehicleState.update('veh_ioniq5', { occupied: { ROW_2_RIGHT: true } }, 'sim');
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  const r = app.move.get(req.id);
  assert.equal(r.status, 'INTERLOCK_FAILED');
  assert.ok(notes(ctx, 'usr_minsu').some((m) => m.includes('사람이나 반려동물')));
  assert.equal(ctx.vehicle('veh_ioniq5').activeMoveId, null);
});

test('충전 케이블이 연결돼 있으면 요청 단계에서 거절', () => {
  const { app } = setup(kst(2026, 11, 2, 20));
  app.vehicleState.update('veh_ioniq5', { charging: true }, 'sim');
  const res = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  assert.equal(res.status, 'DENIED');
  assert.equal(res.denyCode, 'CHARGING');
  assert.equal(res.fallback, 'contact');
});

test('버튼에서 손을 떼면 즉시 정지, 1분 지나면 토큰 소멸', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  holdFor(app, clock, 'usr_jieun', req.id, 2_100);
  clock.advance(1_500);
  let r = app.move.get(req.id);
  assert.equal(r.status, 'PAUSED');
  const d = r.items[0].distance;
  assert.ok(d > 0.5 && d < 1.5, `중간에 멈춤 (${d}m)`);
  clock.advance(61_000);
  r = app.move.get(req.id);
  assert.equal(r.status, 'EXPIRED');
  assert.equal(ctx.db.tokens.get(r.items[0].tokenId).status, 'expired');
});

test('진로 장애물: 5초 뒤 재시도 3회, 계속 막히면 중단', () => {
  const { app, clock } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  holdFor(app, clock, 'usr_jieun', req.id, 1_000);
  app.vehicleState.update('veh_ioniq5', { obstacle: true }, 'sim');
  holdFor(app, clock, 'usr_jieun', req.id, 25_000);
  const r = app.move.get(req.id);
  assert.equal(r.status, 'ABORTED');
  assert.ok(r.items[0].retries >= 3);
});

test('이동 중 접촉 감지: 즉시 정지, 복귀 금지, 운영사 자동 접수', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  holdFor(app, clock, 'usr_jieun', req.id, 1_000);
  app.vehicleState.update('veh_ioniq5', { contact: true }, 'sim');
  holdFor(app, clock, 'usr_jieun', req.id, 600);
  const r = app.move.get(req.id);
  assert.equal(r.status, 'CONTACT_STOPPED');
  assert.equal(ctx.db.disputes.size, 1);
  assert.throws(() => app.move.startReturn('usr_jieun', req.id), /복귀할 수 있는 상태가 아니에요/);
  const clips = [...ctx.db.clips.values()].filter((c) => c.refId === req.id);
  assert.ok(clips.every((c) => c.disputeId), '분쟁 건 영상은 30일로 연장');
});

test('요청자 위치: 진로에 서 있거나 멀리 있으면 시작되지 않음', () => {
  const { app, clock } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  // 요청자가 폰에서 체크하는 게 아니라 차량이 BLE로 잰 위치로 판단
  assert.throws(() => app.move.hold('usr_jieun', req.id), /2m/, '차량이 폰을 못 찾음');
  ble(app, 'veh_ioniq5', 'front', 1.2);
  assert.throws(() => app.move.hold('usr_jieun', req.id), /진로/);
  ble(app, 'veh_ioniq5', 'side', 3.5);
  assert.throws(() => app.move.hold('usr_jieun', req.id), /2m/);
  ble(app, 'veh_ioniq5', 'side', 1.4);
  assert.equal(app.move.hold('usr_jieun', req.id).ok, true);
  assert.throws(() => app.move.hold('usr_hyunwoo', req.id), /요청한 사람만/);
});

test('심야(23~06시): 허락하지 않은 차는 거절, 허락한 차는 야간 크레딧 가중', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 3, 5));
  // 아이오닉은 야간 허용 → 1.5배
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  assert.equal(req.night, true);
  clock.advance(31_000);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  assert.equal(ctx.user('usr_minsu').credits, 150);
  // 야간 비허용으로 바꾸면 거절
  app.delegation.updatePolicy('usr_minsu', 'veh_ioniq5', { allowNight: false });
  const res = app.move.create('usr_sujin', { targets: [{ plate: IONIQ }] });
  assert.equal(res.denyCode, 'QUIET_HOURS');
});

test('횟수 제한: 같은 차는 하루 1회, 요청자는 하루 3회, 차는 위임한 횟수까지', () => {
  const { app, clock } = setup(kst(2026, 11, 2, 20));
  const a = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  app.move.cancel('usr_jieun', a.id);
  // 취소는 횟수에 들어가지 않는다
  const b = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  holdFor(app, clock, 'usr_jieun', b.id, 8_000);
  app.move.startReturn('usr_jieun', b.id);
  holdFor(app, clock, 'usr_jieun', b.id, 8_000);
  const again = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  assert.equal(again.denyCode, 'PAIR_DAILY');
  // 다른 이웃의 두 번째 요청까지 허용(기본 하루 2회), 세 번째는 거절
  const c = app.move.create('usr_sujin', { targets: [{ plate: IONIQ }] });
  assert.equal(c.status, 'VETO');
  app.move.ownerDecision('usr_minsu', c.id, 'approve');
  clock.advance(1_000);
  holdFor(app, clock, 'usr_sujin', c.id, 8_000);
  app.move.startReturn('usr_sujin', c.id);
  holdFor(app, clock, 'usr_sujin', c.id, 8_000);
  const d = app.move.create('usr_hyunwoo', { targets: [{ plate: IONIQ }] });
  assert.equal(d.denyCode, 'VEHICLE_DAILY');
});

test('정식 칸에 선 차, 원격 이동이 없는 차, 경사 구역은 요청 불가', () => {
  const { app } = setup(kst(2026, 11, 2, 20));
  app.vehicleState.update('veh_ioniq5', { spotId: 'B2-7-07', doubleParked: false }, 'sim');
  assert.equal(app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] }).denyCode, 'NOT_DOUBLE_PARKED');
  assert.equal(app.move.create('usr_minsu', { targets: [{ plate: '78라1122' }] }).denyCode, 'NO_REMOTE_MOVE');
  app.vehicleState.update('veh_ioniq5', { zoneId: 'B1-ramp', doubleParked: true }, 'sim');
  assert.equal(app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] }).denyCode, 'SLOPE');
});

test('앞뒤 공간이 1m 미만이면 요청 단계에서 안내하고 연쇄 요청을 제안', () => {
  const { app } = setup(kst(2026, 11, 2, 20));
  app.vehicleState.update('veh_ioniq5', { clearance: { front: 0.5, back: 0.4 } }, 'sim');
  app.ctx.vehicle('veh_ioniq5').state.blockedByPlate = '34나5678';
  const res = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  assert.equal(res.denyCode, 'NO_SPACE');
  assert.equal(res.suggestChain, '34나5678');
});

test('연쇄 이중주차: 바깥쪽 차부터 차례로, 한 대라도 거부하면 전체 중단', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  // 쏘렌토를 이중주차 줄에 세우고 이동 위임
  app.vehicleState.update('veh_sorento', { inComplex: true, gear: 'P', spotId: 'B2-A-01' }, 'sim');
  app.delegation.updatePolicy('usr_hyunwoo', 'veh_sorento', { enabled: true, functions: { move: true } });
  const req = app.move.create('usr_jieun', { targets: [{ plate: '34나5678' }, { plate: IONIQ }] });
  assert.equal(req.items.length, 2);
  clock.advance(31_000);
  holdFor(app, clock, 'usr_jieun', req.id, 7_000);
  let r = app.move.get(req.id);
  assert.equal(r.items[0].status, 'moved');
  assert.equal(r.cursor, 1);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  r = app.move.get(req.id);
  assert.equal(r.status, 'MOVED');
  // 복귀는 마지막으로 비켜준 차부터
  app.move.startReturn('usr_jieun', req.id);
  assert.equal(app.move.get(req.id).cursor, 1);
  holdFor(app, clock, 'usr_jieun', req.id, 16_000);
  assert.equal(app.move.get(req.id).status, 'RETURNED');
  assert.equal(ctx.vehicle('veh_sorento').state.offsetM, 0);

  const req2 = app.move.create('usr_sujin', { targets: [{ plate: '34나5678' }, { plate: IONIQ }] });
  app.move.ownerDecision('usr_minsu', req2.id, 'reject');
  assert.equal(app.move.get(req2.id).status, 'REJECTED');
  assert.ok(notes(ctx, 'usr_hyunwoo').some((m) => m.includes('직접 처리')));
});

test('복귀 자리가 막히면 P로 세우고, 통로를 막으면 1m 정리 이동 1회', () => {
  const { app, clock } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  app.vehicleState.update('veh_ioniq5', { returnSpotOccupied: true }, 'sim');
  app.move.startReturn('usr_jieun', req.id);
  holdFor(app, clock, 'usr_jieun', req.id, 600);
  let r = app.move.get(req.id);
  assert.equal(r.status, 'TIDY');
  app.move.setTidyDirection('usr_jieun', req.id, 'backward');
  app.vehicleState.update('veh_ioniq5', { returnSpotOccupied: false }, 'sim');
  holdFor(app, clock, 'usr_jieun', req.id, 3_000);
  r = app.move.get(req.id);
  assert.equal(r.status, 'RETURN_BLOCKED');
});

test('출차 후 10분 안에 복귀하지 않으면 차주 알림과 요청자 크레딧 추가 차감', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  clock.advance(10 * 60_000 + 1);
  assert.equal(app.move.get(req.id).status, 'RETURN_OVERDUE');
  assert.equal(ctx.user('usr_jieun').credits, -150);
  assert.ok(notes(ctx, 'usr_minsu').some((m) => m.includes('복귀를 실행하지 않았어요')));
  // 늦게라도 복귀 가능, 차가 혼자 복귀하지는 않음
  assert.notEqual(ctx.vehicle('veh_ioniq5').state.offsetM, 0);
  app.move.startReturn('usr_jieun', req.id);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  assert.equal(app.move.get(req.id).status, 'RETURNED');
});

test('인증하지 않은 계정과 신고 누적 계정은 요청할 수 없음', () => {
  const { app } = setup(kst(2026, 11, 2, 20));
  const u = app.accounts.registerUser({ name: '방문자', phone: '010-9' });
  assert.throws(() => app.move.create(u.id, { targets: [{ plate: IONIQ }] }), /인증/);
  app.audit.report('usr_minsu', 'usr_sujin', 'spam');
  app.audit.report('usr_hyunwoo', 'usr_sujin', 'spam');
  app.audit.report('usr_jieun', 'usr_sujin', 'spam');
  assert.throws(() => app.move.create('usr_sujin', { targets: [{ plate: IONIQ }] }), /정지/);
});

test('위임 철회: 남은 토큰이 즉시 무효', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  app.delegation.revokeAll('usr_minsu', 'veh_ioniq5');
  const tok = ctx.db.tokens.get(app.move.get(req.id).items[0].tokenId);
  assert.equal(tok.status, 'revoked');
  ble(app, 'veh_ioniq5');
  assert.throws(() => app.move.hold('usr_jieun', req.id), /만료된 토큰/);
});

test('3m 이동이 끝난 뒤 늦게 도착한 진행 보고는 이동 거리를 덮어쓰지 않음', () => {
  const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ, direction: 'forward' }] });
  clock.advance(30_500);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  assert.equal(app.move.get(req.id).status, 'MOVED');
  // 도착 직전 서버가 보낸 '남은 0.1m' 버튼 신호로 차가 새로 움직이고 보고한 경우
  app.move.onProgress('veh_ioniq5', { requestId: req.id, status: 'moving', distance: 0.1 });
  app.move.onProgress('veh_ioniq5', { requestId: req.id, status: 'completed', distance: 0.1 });
  const r = app.move.get(req.id);
  assert.equal(r.status, 'MOVED');
  assert.equal(r.items[0].distance, 3);
  assert.equal(ctx.vehicle('veh_ioniq5').state.offsetM, 3);
  assert.equal(ctx.user('usr_minsu').credits, 100, '크레딧이 두 번 쌓이지 않음');

  app.move.startReturn('usr_jieun', req.id);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  assert.equal(app.move.get(req.id).status, 'RETURNED');
  assert.equal(ctx.vehicle('veh_ioniq5').state.offsetM, 0);
});

test('요청자 근접은 차량 앱이 BLE로 잰 값: 보고가 3초 넘게 끊기면 버튼 신호를 받지 않음', () => {
  const { app, clock } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
  clock.advance(31_000);
  app.proximity.report('veh_ioniq5', { zone: 'side', distanceM: 1.3 }, 'vehicle');
  assert.equal(app.move.hold('usr_jieun', req.id).ok, true);
  assert.equal(app.move.view(app.move.get(req.id), 'usr_jieun').items[0].proximity.distanceM, 1.3, '요청자 화면에 차량이 잰 거리 표시');
  clock.advance(3_500);
  assert.throws(() => app.move.hold('usr_jieun', req.id), /폰을 찾지 못했어요/);
});

test('자가 점검: 요청 뒤 바뀐 경사·12V 저전압도 차량 스냅샷과 합쳐 거절', () => {
  for (const patch of [{ tilted: true }, { lowVoltage12v: true }]) {
    const { app, clock, ctx } = setup(kst(2026, 11, 2, 20));
    const events = [];
    ctx.bus.subscribe((e) => { if (e.type === 'interlock.check') events.push(e.payload); });
    ctx.presence.set('veh_ioniq5', 1); // 차량 앱이 연결된 차로 취급 (가상 차량이 대신 답하지 않게)
    const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ }] });
    app.vehicleState.update('veh_ioniq5', patch, 'sim'); // 거부 창이 열려 있는 동안 상태가 바뀜
    clock.advance(30_100);
    assert.equal(events.at(-1).slope || events.at(-1).lowVoltage12v, true, '차량 화면에 보여 줄 값도 함께 보냄');
    const snap = { gear: 'P', charging: false, doors: {}, occupied: {}, soc: 90, at: ctx.now() };
    app.move.onInterlockResult('veh_ioniq5', req.id, snap);
    assert.equal(app.move.get(req.id).status, 'INTERLOCK_FAILED');
  }
});

test('복귀: 요청자는 빠져나온 자기 차 안에서 · 차에서 6m 안, 복귀 경로 밖이면 됨', () => {
  const { app, clock } = setup(kst(2026, 11, 2, 20));
  const req = app.move.create('usr_jieun', { targets: [{ plate: IONIQ, direction: 'forward' }] });
  clock.advance(30_500);
  holdFor(app, clock, 'usr_jieun', req.id, 8_000);
  assert.equal(app.move.get(req.id).status, 'MOVED');
  app.move.startReturn('usr_jieun', req.id);
  ble(app, 'veh_ioniq5', 'rear', 2.5); // 앞으로 비켰으니 복귀 경로는 차 뒤쪽
  assert.throws(() => app.move.hold('usr_jieun', req.id), /복귀 경로/);
  ble(app, 'veh_ioniq5', 'side', 7.5);
  assert.throws(() => app.move.hold('usr_jieun', req.id), /6m/);
  ble(app, 'veh_ioniq5', 'side', 4.8); // 옆 차로에 세운 자기 차 안
  for (let t = 0; t < 8_000; t += 300) { app.move.hold('usr_jieun', req.id); clock.advance(300); }
  assert.equal(app.move.get(req.id).status, 'RETURNED');
});
