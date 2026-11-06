// 가상 차량 에이전트
// 차량 앱(Pleos Connect)이 연결되지 않은 참여 차량을 서버 안에서 대신 연기한다.
// 차량 앱의 SimulatedRspaAdapter와 같은 규칙(누르는 동안만, 보행 속도, 장애물 재시도, 접촉 정지)을 따른다.
// 데모 콘솔에서 충전 케이블·탑승자·장애물 등을 바꿔 시나리오를 재현할 수 있다.

const TICK_MS = 100;
const REPORT_EVERY = 5;

export function createVirtualAgent(ctx, deps) {
  const { rules } = ctx;
  const M = rules.move;
  const sessions = new Map(); // vehicleId → session

  ctx.presence = ctx.presence || new Map(); // vehicleId → 연결 수

  const isVirtual = (vehicleId) => !(ctx.presence.get(vehicleId) > 0);

  ctx.bus.subscribe((ev) => {
    if (!ev.channel.startsWith('vehicle:')) return;
    const vehicleId = ev.channel.slice('vehicle:'.length);
    if (!isVirtual(vehicleId) || !ctx.db.vehicles.has(vehicleId)) return;
    // 이벤트 루프를 한 번 넘겨 처리 (서비스 호출 중 재진입 방지)
    ctx.clock.setTimeout(() => handle(vehicleId, ev.type, ev.payload), 0);
  });

  function snapshot(v) {
    const s = v.state;
    return {
      gear: s.gear,
      charging: s.charging,
      doors: { ...s.doors },
      occupied: { ...s.occupied },
      slope: s.slope,
      soc: s.soc,
      lowVoltage12v: s.lowVoltage12v,
      at: ctx.now(),
      source: 'virtual',
    };
  }

  function handle(vehicleId, type, p) {
    const v = ctx.db.vehicles.get(vehicleId);
    if (!v) return;
    try {
      switch (type) {
        case 'interlock.check':
          ctx.schedule(`agentcheck:${vehicleId}`, 300, () => {
            deps.move().onInterlockResult(vehicleId, p.requestId, snapshot(v));
          });
          break;
        case 'move.prepare':
          sessions.set(vehicleId, {
            requestId: p.requestId, mode: p.mode, direction: p.direction, max: p.maxMeters,
            distance: 0, lastHold: 0, running: false, ticks: 0, retries: 0, waitingRetry: false, done: false,
          });
          break;
        case 'move.hold':
          onHold(v, p);
          break;
        case 'move.release': {
          const s = sessions.get(vehicleId);
          if (s) s.lastHold = 0;
          break;
        }
        case 'move.finish': {
          const s = sessions.get(vehicleId);
          if (s && !s.done) complete(v, s);
          break;
        }
        case 'move.abort':
        case 'move.closed':
          stop(vehicleId);
          sessions.delete(vehicleId);
          break;
        case 'trunk.open':
          ctx.schedule(`agenttrunk:${vehicleId}`, 800, () => {
            v.state.doors.REAR = 1;
            deps.vehicleState().publish(v);
            deps.trunk().onState(vehicleId, p.tokenId, 'opened');
          });
          break;
        case 'trunk.close':
          closeTrunk(vehicleId, p.tokenId);
          break;
        default:
          break;
      }
    } catch (e) {
      ctx.log('agent.error', { vehicleId, type, message: e.message });
    }
  }

  function onHold(v, p) {
    let s = sessions.get(v.id);
    if (!s || s.requestId !== p.requestId || s.mode !== p.mode) {
      s = { requestId: p.requestId, mode: p.mode, direction: p.direction, max: p.maxMeters, distance: 0, lastHold: 0, running: false, ticks: 0, retries: 0, waitingRetry: false, done: false };
      sessions.set(v.id, s);
    }
    if (s.done) return;
    s.lastHold = ctx.now();
    if (s.mode === 'return' && v.state.returnSpotOccupied) {
      s.done = true;
      report(v, s, 'blocked');
      return;
    }
    if (!s.running && !s.waitingRetry) {
      s.running = true;
      s.lastTick = ctx.now();
      ctx.schedule(`agent:${v.id}`, TICK_MS, () => tick(v.id));
    }
  }

  function tick(vehicleId) {
    const v = ctx.db.vehicles.get(vehicleId);
    const s = sessions.get(vehicleId);
    if (!v || !s || !s.running || s.done) return;
    const now = ctx.now();
    if (v.state.contact) {
      s.running = false;
      s.done = true;
      report(v, s, 'contact');
      return;
    }
    if (v.state.obstacle) {
      s.running = false;
      s.retries += 1;
      if (s.retries > M.obstacleMaxRetries) {
        s.done = true;
        report(v, s, 'aborted', 'OBSTACLE');
        return;
      }
      report(v, s, 'obstacle');
      s.waitingRetry = true;
      // 5초 뒤 자동 재시도 (그때도 버튼을 누르고 있어야 움직인다)
      ctx.schedule(`agentretry:${vehicleId}`, M.obstacleRetrySec * 1000, () => {
        s.waitingRetry = false;
        s.running = true;
        s.lastTick = ctx.now();
        tick(vehicleId);
      });
      return;
    }
    if (!s.lastHold || now - s.lastHold > M.holdTimeoutMs) {
      // 버튼에서 손을 떼면 즉시 정지
      s.running = false;
      report(v, s, 'paused');
      return;
    }
    const dt = Math.max(0, now - (s.lastTick || now)) / 1000;
    s.lastTick = now;
    s.distance = Math.min(s.max, s.distance + M.speedMps * dt);
    s.ticks += 1;
    if (s.distance >= s.max - 1e-6) {
      s.distance = s.max;
      complete(v, s);
      return;
    }
    if (s.ticks % REPORT_EVERY === 1) report(v, s, 'moving');
    ctx.schedule(`agent:${vehicleId}`, TICK_MS, () => tick(vehicleId));
  }

  function complete(v, s) {
    s.running = false;
    s.done = true;
    stop(v.id);
    report(v, s, 'completed'); // 완료 시 P·EPB 자동 체결
  }

  function report(v, s, status, reason = null) {
    deps.move().onProgress(v.id, { requestId: s.requestId, status, distance: s.distance, reason });
  }

  function stop(vehicleId) {
    for (const k of ['agent', 'agentretry']) ctx.cancel(`${k}:${vehicleId}`);
  }

  function closeTrunk(vehicleId, tokenId = null) {
    const v = ctx.db.vehicles.get(vehicleId);
    if (!v) return null;
    v.state.doors.REAR = 0;
    deps.vehicleState().publish(v);
    const t = tokenId
      ? ctx.db.trunkTokens.get(tokenId)
      : [...ctx.db.trunkTokens.values()].find((x) => x.vehicleId === vehicleId && ['open', 'opening', 'unclosed'].includes(x.status));
    if (t) return deps.trunk().onState(vehicleId, t.id, 'closed');
    return null;
  }

  return { isVirtual, closeTrunk, sessions };
}
