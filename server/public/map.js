// 지하주차장 평면도 (데모 콘솔 · 영상용 스테이지)
// 좌표는 서버 단지 데이터의 미터 단위를 그대로 쓰고, S(px/m)로 확대한다.
// 정적 레이어(벽·기둥·주차선)는 한 번만 그리고, 차량은 키로 재사용한다.
// 입차·출차처럼 크게 움직일 때는 차로를 따라 운전하는 경로(전진 → 후진 주차)를 만들어 그 위로 움직인다.

const NS = 'http://www.w3.org/2000/svg';
const S = 24; // px per meter
const B = { minX: -14.5, minY: -5.6, maxX: 23.5, maxY: 17.4 };
const W = (B.maxX - B.minX) * S;
const H = (B.maxY - B.minY) * S;
const X = (x) => (x - B.minX) * S;
const Y = (y) => (y - B.minY) * S;
const CAR_L = 4.6;
const CAR_W = 1.9;
const MAP_V = '6';

const COLORS = {
  '12가3456': { body: '#d7dbe0', roof: '#aeb4bb' }, // 아이오닉 5 (그래비티 그레이)
  '34나5678': { body: '#24324a', roof: '#18223a' }, // 쏘렌토
  '56다7890': { body: '#1c1d21', roof: '#0f1012' }, // 그랜저
  '90마3344': { body: '#f2c94c', roof: '#d9ad2c' }, // 레이 EV
  '78라1122': { body: '#b3332e', roof: '#8e2420' }, // 아반떼
  '23버4567': { body: '#3aa6a0', roof: '#2b8681' }, // 코나 일렉트릭
  '45서6789': { body: '#ebe7df', roof: '#c9c4b8' }, // 팰리세이드
  '31거2233': { body: '#35584d', roof: '#26433a' }, // EV9
  '52너3344': { body: '#7a2e3a', roof: '#5d212b' }, // 아이오닉 6
  '17더4455': { body: '#d27a35', roof: '#ad5f24' }, // GV60
  '64러5566': { body: '#5468d4', roof: '#3f51b0' }, // EV6
};

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

const SHORT = { '코나 일렉트릭': '코나 EV' };
const headingOfZone = (z) => (z === 'B2-7' ? 90 : z === 'B2-8' || z === 'B2-C' ? -90 : 0);

// ---------------------------------------------------------------- 정적 레이어
function staticLayer(c) {
  const g = el('g', { class: 'pk-static' });
  const defs = el('defs');
  defs.innerHTML = `
    <pattern id="pk-floor" width="${S * 2}" height="${S * 2}" patternUnits="userSpaceOnUse">
      <rect width="${S * 2}" height="${S * 2}" fill="#171d28"/>
      <path d="M ${S * 2} 0 L 0 0 0 ${S * 2}" fill="none" stroke="#1d2431" stroke-width="1"/>
    </pattern>
    <pattern id="pk-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="12" height="12" fill="#1f1d1b"/>
      <line x1="0" y1="0" x2="0" y2="12" stroke="#4a3f25" stroke-width="5"/>
    </pattern>
    <pattern id="pk-zebra" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="14" height="14" fill="transparent"/>
      <line x1="0" y1="0" x2="0" y2="14" stroke="#e2b93b" stroke-width="5" opacity="0.55"/>
    </pattern>
    <pattern id="pk-compact" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
      <rect width="10" height="10" fill="rgba(61,214,245,0.05)"/>
      <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(61,214,245,0.10)" stroke-width="3"/>
    </pattern>
    <linearGradient id="pk-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></linearGradient>
    <radialGradient id="pk-beam" cx="0" cy="0.5" r="1"><stop offset="0" stop-color="#fff6d5" stop-opacity="0.55"/><stop offset="1" stop-color="#fff6d5" stop-opacity="0"/></radialGradient>
    <radialGradient id="pk-vac"><stop offset="0" stop-color="#2ee6a6" stop-opacity="0.35"/><stop offset="1" stop-color="#2ee6a6" stop-opacity="0.05"/></radialGradient>
    <radialGradient id="pk-cyan"><stop offset="0" stop-color="#3dd6f5" stop-opacity="0.35"/><stop offset="1" stop-color="#3dd6f5" stop-opacity="0.04"/></radialGradient>
    <filter id="pk-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#000" flood-opacity="0.55"/></filter>
    <clipPath id="pk-clip"><rect x="0" y="0" width="${W}" height="${H}" rx="8"/></clipPath>
    <marker id="pk-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#2ee6a6"/>
    </marker>
    <marker id="pk-arrow-c" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#3dd6f5"/>
    </marker>
    <marker id="pk-arrow-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#8a96ab"/>
    </marker>
    <marker id="pk-arrow-y" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#facc15"/>
    </marker>`;
  g.append(defs);

  // 바닥과 외벽
  g.append(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#0b1019' }));
  g.append(el('rect', { x: X(-14), y: Y(-3.4), width: 37 * S, height: 20.2 * S, fill: 'url(#pk-floor)', rx: 6 }));
  g.append(el('rect', { x: X(-14), y: Y(-3.4), width: 37 * S, height: 20.2 * S, fill: 'none', stroke: '#2c3545', 'stroke-width': 7, rx: 8 }));

  // 램프 (B1 → B2, 경사 구역)
  g.append(el('rect', { x: X(-14), y: Y(6.3), width: 9.5 * S, height: 3.6 * S, fill: 'url(#pk-hatch)' }));

  for (const x of [-12.5, -9.5, -6.5]) {
    g.append(el('path', { d: `M ${X(x)} ${Y(8.3)} l ${S * 1.2} 0`, stroke: '#facc15', 'stroke-width': 3, 'marker-end': 'url(#pk-arrow-y)' }));
  }
  g.append(el('text', { x: X(-9.3), y: Y(9.55), class: 'pk-t pk-warn', 'text-anchor': 'middle' }, '⚠ B1→B2 경사로 · 비켜줘·N 주차 금지'));

  // 입차 게이트 (차단기)
  g.append(el('rect', { x: X(-13.8), y: Y(3.2), width: 1.4 * S, height: 1.6 * S, fill: '#3b4250', stroke: '#6b7686', rx: 3 }));
  g.append(el('text', { x: X(-13.1), y: Y(4.2), class: 'pk-t pk-xs', 'text-anchor': 'middle' }, '정산'));
  g.append(el('rect', { x: X(-12.4), y: Y(4.85), width: 0.25 * S, height: 4.8 * S, fill: 'url(#pk-zebra)', stroke: '#e2b93b', 'stroke-width': 1.5 }));
  g.append(el('text', { x: X(-12.3), y: Y(10.6), class: 'pk-t pk-gate', 'text-anchor': 'start' }, '▲ 입차 게이트 (지오펜스 진입)'));

  // 기둥
  for (const x of [-1.25, 6.25, 13.75, 21.25]) {
    for (const y of [-3.1, 15.7]) g.append(el('rect', { x: X(x) - 9, y: Y(y) - 9, width: 18, height: 18, fill: '#3a4456', stroke: '#566177', 'stroke-width': 1.5, rx: 3 }));
  }

  // 주행 차선: 중앙선 + 방향 화살표
  g.append(el('line', { x1: X(-4), y1: Y(7.6), x2: X(22.8), y2: Y(7.6), stroke: '#c9a33a', 'stroke-width': 2, 'stroke-dasharray': '18 14', opacity: 0.7 }));
  for (let x = -2; x < 22; x += 6) {
    g.append(el('path', { d: `M ${X(x + 1.6)} ${Y(6.6)} l ${-S * 1.6} 0`, stroke: '#8a96ab', 'stroke-width': 3, opacity: 0.7, 'marker-end': 'url(#pk-arrow-g)' }));
    g.append(el('path', { d: `M ${X(x + 3)} ${Y(8.6)} l ${S * 1.6} 0`, stroke: '#8a96ab', 'stroke-width': 3, opacity: 0.7, 'marker-end': 'url(#pk-arrow-g)' }));
  }
  g.append(el('text', { x: X(9), y: Y(7.25), class: 'pk-t pk-dim', 'text-anchor': 'middle' }, '주행 통로 · 우측통행'));

  // 이중주차 줄
  g.append(el('rect', { x: X(-1.2), y: Y(3.0), width: 22.4 * S, height: 2.2 * S, fill: 'rgba(245, 197, 66, 0.04)', stroke: '#f5c542', 'stroke-width': 1.5, 'stroke-dasharray': '10 7', rx: 6, opacity: 0.8 }));
  g.append(el('text', { x: X(21.0), y: Y(5.75), class: 'pk-t pk-warn', 'text-anchor': 'end' }, '이중주차 줄 (통로 지오펜스 · 비켜줘 대상)'));

  // 주차 칸
  const rows = { 'B2-7': { y0: -2.5, y1: 2.5, label: Y(-3.6) }, 'B2-8': { y0: 10.2, y1: 15.2, label: Y(16.6) } };
  for (const [zoneId, r] of Object.entries(rows)) {
    const spots = c.spots.filter((s) => s.zoneId === zoneId).sort((a, b) => a.x - b.x);
    if (!spots.length) continue;
    const zone = c.zones.find((z) => z.id === zoneId);
    for (const s of spots) {
      if (s.type === 'disabled') g.append(el('rect', { x: X(s.x - 1.25), y: Y(r.y0), width: 2.5 * S, height: 5 * S, fill: 'rgba(76,141,255,0.16)' }));
      if (s.type === 'ev_charger') g.append(el('rect', { x: X(s.x - 1.25), y: Y(r.y0), width: 2.5 * S, height: 5 * S, fill: 'rgba(61,214,245,0.08)' }));
      g.append(el('line', { x1: X(s.x - 1.25), y1: Y(r.y0), x2: X(s.x - 1.25), y2: Y(r.y1), stroke: '#c9d1dc', 'stroke-width': 2.5, opacity: 0.8 }));
      const backY = zoneId === 'B2-7' ? r.y0 + 0.55 : r.y1 - 0.35;
      g.append(el('text', { x: X(s.x), y: Y(backY), class: 'pk-t pk-num', 'text-anchor': 'middle' }, s.id.split('-').pop()));
      const iconY = zoneId === 'B2-7' ? r.y0 + 1.4 : r.y1 - 1.1;
      if (s.type === 'ev_charger') {
        const cy = zoneId === 'B2-7' ? r.y0 - 0.45 : r.y1 + 0.1;
        g.append(el('rect', { x: X(s.x) - 9, y: Y(cy), width: 18, height: 9, fill: '#3dd6f5', rx: 2 }));
        g.append(el('text', { x: X(s.x), y: Y(iconY), class: 'pk-t pk-icon', 'text-anchor': 'middle' }, '⚡ 충전'));
      }
      if (s.type === 'disabled') g.append(el('text', { x: X(s.x), y: Y(iconY), class: 'pk-t pk-icon', 'text-anchor': 'middle' }, '♿'));
      if (s.type === 'wide') g.append(el('text', { x: X(s.x), y: Y(iconY), class: 'pk-t pk-xs', 'text-anchor': 'middle' }, '확장형'));
    }
    const last = spots[spots.length - 1];
    g.append(el('line', { x1: X(last.x + 1.25), y1: Y(r.y0), x2: X(last.x + 1.25), y2: Y(r.y1), stroke: '#c9d1dc', 'stroke-width': 2.5, opacity: 0.8 }));
    const stopY = zoneId === 'B2-7' ? r.y0 : r.y1;
    g.append(el('line', { x1: X(spots[0].x - 1.25), y1: Y(stopY), x2: X(last.x + 1.25), y2: Y(stopY), stroke: '#c9d1dc', 'stroke-width': 2.5, opacity: 0.8 }));
    const zt = el('text', { x: X(spots[0].x - 1.2), y: r.label, class: 'pk-t pk-zone' }, `${zone?.name || zoneId}${zone?.slope ? ' · 경사' : ''}`);
    zt.append(el('tspan', { class: 'pk-zone-sub', dx: 10 }, spots[0].nearDong ? `${spots[0].nearDong}동 입구 쪽` : ''));
    g.append(zt);
  }

  // 밀착 임시 구역 (확장 기능): 칸 폭 2.2m, 비켜줘를 켠 차만
  const cz = c.zones.find((z) => z.type === 'compact');
  const cs = c.spots.filter((s) => s.zoneId === cz?.id).sort((a, b) => a.x - b.x);
  if (cs.length) {
    const half = 1.1;
    const x0 = cs[0].x - half;
    const x1 = cs[cs.length - 1].x + half;
    g.append(el('rect', { x: X(x0), y: Y(-2.5), width: (x1 - x0) * S, height: 5 * S, fill: 'url(#pk-compact)' }));
    g.append(el('rect', { x: X(x0), y: Y(-2.5), width: (x1 - x0) * S, height: 5 * S, fill: 'none', stroke: '#3dd6f5', 'stroke-width': 1.6, 'stroke-dasharray': '9 6', rx: 5, opacity: 0.75 }));
    for (const s of cs) {
      g.append(el('line', { x1: X(s.x + half), y1: Y(-2.5), x2: X(s.x + half), y2: Y(2.5), stroke: '#5fd4f5', 'stroke-width': 1.6, opacity: 0.5 }));
      g.append(el('text', { x: X(s.x), y: Y(-1.95), class: 'pk-t pk-num', 'text-anchor': 'middle', fill: '#5fd4f5' }, s.id.split('-').pop()));
    }
    const zt = el('text', { x: X(x0 + 0.05), y: Y(-3.6), class: 'pk-t pk-zone', fill: '#7fe3f8' }, cz.name);
    zt.append(el('tspan', { class: 'pk-zone-sub', dx: 8 }, '칸 폭 2.2m'));
    g.append(zt);
  }

  // 축척 · 방위
  g.append(el('line', { x1: X(17.5), y1: Y(-4.1), x2: X(22.5), y2: Y(-4.1), stroke: '#cbd5e1', 'stroke-width': 3 }));
  for (const x of [17.5, 22.5]) g.append(el('line', { x1: X(x), y1: Y(-4.35), x2: X(x), y2: Y(-3.85), stroke: '#cbd5e1', 'stroke-width': 3 }));
  g.append(el('text', { x: X(20), y: Y(-4.3), class: 'pk-t pk-xs', 'text-anchor': 'middle' }, '5 m'));
  g.append(el('text', { x: X(-13.8), y: Y(-4.4), class: 'pk-t pk-title' }, `${(c.name || '').split('(')[0].trim()} · B2 지하주차장`));

  // 앱을 쓰지 않는 이웃 차 (회색, 번호판 없음)
  for (const d of c.decor || []) {
    const s = c.spots.find((x) => x.id === d.spotId);
    if (!s) continue;
    const body = carBody({ plate: '', color: d.color }, {});
    body.setAttribute('transform', `translate(${X(s.x)} ${Y(s.y)}) rotate(${headingOfZone(s.zoneId)})`);
    body.setAttribute('opacity', '0.72');
    g.append(body);
  }
  return g;
}

// ---------------------------------------------------------------- 차량
function basePos(v, c) {
  const home = v.home?.pos || v.state.pos;
  if (home && v.state.spotId) return { x: home.x, y: home.y };
  if (v.state.pos) return v.state.pos;
  return c.gate;
}

function carPos(v, c) {
  const p = basePos(v, c);
  const z = v.state.zoneId || null;
  // 칸 밖 차로에 잠깐 선 차는 지정된 방향(예: 출구 쪽 180°)
  const h = !v.state.spotId && v.state.heading != null ? v.state.heading : headingOfZone(z);
  const off = v.state.offsetM || 0;
  const rad = (h * Math.PI) / 180;
  // 경로 계산용 구역: 칸에 선 차와 밀착 구역 칸 앞에 선 차만 구역으로 본다 (나머지는 통로 위)
  const zone = v.state.spotId || z === 'B2-C' ? z : null;
  return { x: p.x + Math.cos(rad) * off, y: p.y + Math.sin(rad) * off, h, z: zone };
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}

function carBody(v, flags) {
  const L = CAR_L * S;
  const Wd = CAR_W * S;
  const col = v.color ? { body: v.color, roof: shade(v.color, 0.8) } : COLORS[v.plate] || (v.isEv ? { body: '#a7d8f0', roof: '#7fb9d6' } : { body: '#cfd4da', roof: '#a8afb7' });
  const g = el('g');
  g.append(el('ellipse', { cx: L / 2 + 34, cy: 0, rx: 46, ry: Wd / 2 + 8, fill: 'url(#pk-beam)', class: 'pk-beam' })); // 전조등 빛
  g.append(el('ellipse', { cx: 0, cy: 3, rx: L / 2 + 5, ry: Wd / 2 + 6, fill: 'rgba(0,0,0,0.45)' })); // 그림자
  for (const [dx, dy] of [[-0.32, -1], [0.32, -1], [-0.32, 1], [0.32, 1]]) {
    g.append(el('rect', { x: dx * L - 9, y: dy * (Wd / 2) - 4, width: 18, height: 8, rx: 3, fill: '#0b0d10' })); // 바퀴
  }
  g.append(el('rect', { x: -L / 2, y: -Wd / 2, width: L, height: Wd, rx: 13, fill: col.body, stroke: 'rgba(0,0,0,0.5)', 'stroke-width': 1.5 }));
  g.append(el('rect', { x: -L / 2, y: -Wd / 2, width: L, height: Wd, rx: 13, fill: 'url(#pk-gloss)' }));
  g.append(el('rect', { x: -L * 0.2, y: -Wd / 2 + 5, width: L * 0.42, height: Wd - 10, rx: 7, fill: col.roof })); // 지붕
  g.append(el('path', { d: `M ${L * 0.22} ${-Wd / 2 + 5} q ${L * 0.1} ${Wd / 2 - 5} 0 ${Wd - 10} l ${-L * 0.06} 0 q ${L * 0.06} ${-(Wd / 2 - 5)} 0 ${-(Wd - 10)} z`, fill: '#1e2a38', opacity: 0.9 })); // 앞유리
  g.append(el('path', { d: `M ${-L * 0.2} ${-Wd / 2 + 6} q ${-L * 0.07} ${Wd / 2 - 6} 0 ${Wd - 12} l ${-L * 0.05} 0 q ${-L * 0.05} ${-(Wd / 2 - 6)} 0 ${-(Wd - 12)} z`, fill: '#1e2a38', opacity: 0.85 })); // 뒷유리
  g.append(el('rect', { x: L * 0.13, y: -Wd / 2 - 3, width: 5, height: 4, fill: col.body })); // 사이드미러
  g.append(el('rect', { x: L * 0.13, y: Wd / 2 - 1, width: 5, height: 4, fill: col.body }));
  // 전조등 / 후미등 (이동 중이면 미등 점멸) / 후진등
  g.append(el('rect', { x: L / 2 - 5, y: -Wd / 2 + 4, width: 4, height: 9, rx: 2, fill: '#fef3c7' }));
  g.append(el('rect', { x: L / 2 - 5, y: Wd / 2 - 13, width: 4, height: 9, rx: 2, fill: '#fef3c7' }));
  const tail = { fill: '#ef4444', class: flags.blink ? 'pk-blink' : null };
  g.append(el('rect', { x: -L / 2 + 1, y: -Wd / 2 + 3, width: 4, height: 11, rx: 2, ...tail }));
  g.append(el('rect', { x: -L / 2 + 1, y: Wd / 2 - 14, width: 4, height: 11, rx: 2, ...tail }));
  g.append(el('rect', { x: -L / 2 + 1, y: -4, width: 4, height: 8, rx: 2, fill: '#ffffff', class: 'pk-rev' }));
  if (flags.trunkOpen) {
    g.append(el('rect', { x: -L / 2 - 0.9 * S, y: -Wd / 2 + 2, width: 0.9 * S, height: Wd - 4, rx: 5, fill: col.roof, stroke: '#fbbf24', 'stroke-width': 2 }));
  }
  if (flags.charging) {
    g.append(el('path', { d: `M ${L * 0.38} ${-Wd / 2} q 10 -18 34 -30`, stroke: '#0ea5e9', 'stroke-width': 3, fill: 'none' }));
  }
  if (flags.selected) g.append(el('rect', { x: -L / 2 - 6, y: -Wd / 2 - 6, width: L + 12, height: Wd + 12, rx: 16, fill: 'none', stroke: '#4c8dff', 'stroke-width': 3, class: 'pk-pulse' }));
  if (flags.blocked) g.append(el('rect', { x: -L / 2 - 5, y: -Wd / 2 - 5, width: L + 10, height: Wd + 10, rx: 15, fill: 'none', stroke: '#ff5d6c', 'stroke-width': 3, 'stroke-dasharray': '8 5' }));
  if (flags.compact) g.append(el('rect', { x: -L / 2 - 4, y: -Wd / 2 - 4, width: L + 8, height: Wd + 8, rx: 15, fill: 'none', stroke: '#3dd6f5', 'stroke-width': 2.5, class: 'pk-pulse' }));
  return g;
}

function badges(v, flags) {
  const out = [];
  if (flags.app) out.push(['● Pleos 차량 앱', '#2ee6a6']);
  if (v.state.neutral) out.push(['N 밀어도 돼요', '#facc15']);
  if (v.policy?.enabled && v.policy?.functions?.move && v.state.zoneId !== 'B2-C') out.push(['비켜줘 ON', '#6ea2ff']); // 밀착 구역은 모두 ON이라 생략
  if (v.state.charging) out.push(['⚡ 충전 중', '#0ea5e9']);
  if (Object.values(v.state.occupied || {}).some(Boolean)) out.push(['🧍 탑승자', '#f97316']);
  if (['ROW_1_LEFT', 'ROW_1_RIGHT', 'ROW_2_LEFT', 'ROW_2_RIGHT'].some((k) => v.state.doors?.[k])) out.push(['🚪 문 열림', '#f97316']);
  if (flags.trunkOpen) out.push(['트렁크 열림', '#fbbf24']);
  return out;
}

// ---------------------------------------------------------------- 사람 · 말풍선
function person(x, y, name, sub, color = '#b197fc', holding = false) {
  const g = el('g', { class: 'pk-person' });
  if (holding) {
    for (const d of [0, 0.7]) {
      const r = el('circle', { cx: X(x), cy: Y(y), r: 14, fill: 'none', stroke: color, 'stroke-width': 2, class: 'pk-ripple' });
      r.style.animationDelay = `${d}s`;
      g.append(r);
    }
  }
  g.append(el('circle', { cx: X(x), cy: Y(y), r: 13, fill: color, stroke: '#0b1019', 'stroke-width': 3, filter: 'url(#pk-shadow)' }));
  g.append(el('text', { x: X(x), y: Y(y) + 4.5, class: 'pk-t pk-xs', 'text-anchor': 'middle', fill: '#0b1019', 'font-weight': 900 }, name.slice(0, 1)));
  const w = Math.max(54, name.length * 13 + (sub ? sub.length * 11.5 + 12 : 0) + 22);
  const lx = X(x) + 18;
  g.append(el('rect', { x: lx, y: Y(y) - 12, width: w, height: 24, rx: 12, fill: 'rgba(8,12,20,0.92)', stroke: color, 'stroke-width': 1.2 }));
  const t = el('text', { x: lx + 11, y: Y(y) + 4.5, class: 'pk-t pk-sm' }, name);
  if (sub) t.append(el('tspan', { dx: 7, fill: color }, sub));
  g.append(t);
  return g;
}

function bubble(x, y, text, color, pop = true) {
  const g = el('g', { class: pop ? 'pk-pop' : null });
  const w = Math.max(80, text.length * 12.6 + 30);
  g.append(el('rect', { x: X(x) - w / 2, y: Y(y) - 15, width: w, height: 30, rx: 15, fill: 'rgba(8,12,20,0.94)', stroke: color, 'stroke-width': 1.6, filter: 'url(#pk-shadow)' }));
  g.append(el('circle', { cx: X(x) - w / 2 + 14, cy: Y(y), r: 4, fill: color }));
  g.append(el('text', { x: X(x) + 5, y: Y(y) + 4.8, class: 'pk-t pk-sm', 'text-anchor': 'middle', fill: color, 'font-weight': 800 }, text));
  return g;
}

// 레이더 파동 (빈 칸을 확인하는 옆 차, 알림을 받는 차)
function radar(x, y, color, r = 30) {
  const g = el('g');
  for (const d of [0, 0.6, 1.2]) {
    const c = el('circle', { cx: X(x), cy: Y(y), r, fill: 'none', stroke: color, 'stroke-width': 2.2, class: 'pk-radar' });
    c.style.animationDelay = `${d}s`;
    g.append(c);
  }
  return g;
}

// ---------------------------------------------------------------- 주행 경로
// 차로 (우측통행): 안쪽(→)으로 가는 차는 아래 차로 y 8.6, 게이트 쪽(←)으로 가는 차는 위 차로 y 6.6.
// 칸에는 후진으로 넣고 전진으로 뺀다.
const LANE_UP = 6.6; // ← 게이트 쪽으로
const LANE_DOWN = 8.6; // → 안쪽으로
const OUT_X = B.minX - 3.5;
const laneY = (dir) => (dir > 0 ? LANE_DOWN : LANE_UP);
const P = (x, y) => ({ x, y });
const line = (a, b, rev = false) => ({ k: 'L', pts: [a, b], rev });
const curve = (a, b, c, d, rev = false) => ({ k: 'C', pts: [a, b, c, d], rev });

function exitLegs(f, dir) {
  const { x, y } = f;
  const ly = laneY(dir);
  if (f.z === 'B2-7') return [line(P(x, y), P(x, 2.6)), curve(P(x, 2.6), P(x, (2.6 + ly) / 2 + 0.6), P(x + dir * 1.2, ly), P(x + dir * 3.2, ly))];
  if (f.z === 'B2-8') return [line(P(x, y), P(x, 10.0)), curve(P(x, 10.0), P(x, (10 + ly) / 2), P(x + dir * 1.2, ly), P(x + dir * 3.2, ly))];
  if (f.z === 'B2-aisle') {
    // 이중주차 줄 차는 앞(→)으로 빠져 아래 차로에 합류, 게이트로 가려면 왼쪽으로 유턴해 위 차로로
    const out = [curve(P(x, y), P(x + 2, y), P(x + 2.4, LANE_DOWN), P(x + 4.4, LANE_DOWN))];
    if (dir < 0) out.push(curve(P(x + 4.4, LANE_DOWN), P(x + 7, LANE_DOWN), P(x + 7, LANE_UP), P(x + 4.4, LANE_UP)));
    return out;
  }
  if (!f.z && Math.abs(y - LANE_DOWN) < 0.4 && dir < 0) {
    // 안쪽 차로(→)에 잠깐 선 차: 앞으로 가서 유턴해 위 차로(←)로
    return [curve(P(x, y), P(x + 2.8, y), P(x + 2.8, LANE_UP), P(x, LANE_UP))];
  }
  if (f.z === 'B2-C') {
    const out = [];
    if (y < 4.2) out.push(line(P(x, y), P(x, 4.2), true));
    out.push(curve(P(x, 4.2), P(x, ly - 0.6), P(x - dir * 1.2, ly), P(x - dir * 3.0, ly), true));
    return out;
  }
  return [];
}

function entryLegs(t, dir) {
  const { x, y } = t;
  const ly = laneY(dir);
  if (t.z === 'B2-7') return [curve(P(x + dir * 4, ly), P(x + dir * 1.5, ly), P(x, 4.8), P(x, 2.6), true), line(P(x, 2.6), P(x, y), true)];
  if (t.z === 'B2-8') return [curve(P(x + dir * 4, ly), P(x + dir * 1.5, ly), P(x, (ly + 10.2) / 2), P(x, 10.2), true), line(P(x, 10.2), P(x, y), true)];
  if (t.z === 'B2-aisle') return [curve(P(x - 4.6, ly), P(x - 2.4, ly), P(x - 2.4, y), P(x, y))];
  if (t.z === 'B2-C') {
    const yy = Math.max(y, 4.2);
    const out = [curve(P(x - dir * 3.4, ly), P(x - dir * 1.2, ly), P(x, ly - 1.4), P(x, yy))];
    if (y < yy - 0.01) out.push(line(P(x, yy), P(x, y)));
    return out;
  }
  return [];
}

const startOf = (legs, fallback) => (legs.length ? legs[0].pts[0] : fallback);
const endOf = (legs, fallback) => (legs.length ? legs[legs.length - 1].pts.at(-1) : fallback);

/** 현재 자세 f에서 목표 자세 t까지 운전 경로 (t.out이면 게이트 밖으로) */
function planRoute(f, t) {
  // 칸(B2-7)에서 나와 바로 앞 위 차로(←)에 출구 쪽을 보고 서는 경우: 짧게 꺾어 그 자리에 선다
  if (f.z === 'B2-7' && !t.z && !t.out && Math.abs(t.y - LANE_UP) < 0.4 && t.x <= f.x && t.x > f.x - 3.2) {
    return [line(P(f.x, f.y), P(f.x, 2.6)), curve(P(f.x, 2.6), P(f.x, 5.4), P(t.x + 1.0, LANE_UP), P(t.x, LANE_UP))];
  }
  const dir = t.out ? -1 : t.x + (t.z === 'B2-7' || t.z === 'B2-8' ? 4 : 0) >= f.x ? 1 : -1;
  const ex = exitLegs(f, dir);
  const en = t.out ? [] : entryLegs(t, dir);
  const a = endOf(ex, P(f.x, f.y));
  const b = t.out ? P(OUT_X, laneY(-1)) : startOf(en, P(t.x, t.y));
  const mid = [];
  if (Math.hypot(b.x - a.x, b.y - a.y) > 0.05) {
    const mx = a.x + (b.x - a.x) / 2;
    mid.push(Math.abs(b.y - a.y) < 0.05 ? line(a, b) : curve(a, P(mx, a.y), P(mx, b.y), b));
  }
  return [...ex, ...mid, ...en];
}

function bez(p, u) {
  if (p.length === 2) return P(p[0].x + (p[1].x - p[0].x) * u, p[0].y + (p[1].y - p[0].y) * u);
  const v = 1 - u;
  return P(
    v * v * v * p[0].x + 3 * v * v * u * p[1].x + 3 * v * u * u * p[2].x + u * u * u * p[3].x,
    v * v * v * p[0].y + 3 * v * v * u * p[1].y + 3 * v * u * u * p[2].y + u * u * u * p[3].y,
  );
}

/** 경로를 촘촘한 점으로 바꾸고 같은 방향(전진/후진) 구간끼리 묶는다 */
function sampleRoute(legs) {
  const runs = [];
  for (const leg of legs) {
    const n = leg.k === 'L' ? 12 : 40;
    let run = runs.at(-1);
    if (!run || run.rev !== leg.rev) {
      run = { rev: leg.rev, pts: [], cum: [] };
      runs.push(run);
    }
    for (let i = run.pts.length ? 1 : 0; i <= n; i++) {
      const p = bez(leg.pts, i / n);
      const prev = run.pts.at(-1);
      run.cum.push(prev ? run.cum.at(-1) + Math.hypot(p.x - prev.x, p.y - prev.y) : 0);
      run.pts.push(p);
    }
  }
  return runs.filter((r) => r.cum.at(-1) > 0.01);
}

function routePath(legs) {
  return legs.map((l, i) => {
    const [a, ...rest] = l.pts.map((p) => `${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`);
    return `${i === 0 ? `M ${a} ` : ''}${l.k === 'L' ? 'L' : 'C'} ${rest.join(', ')}`;
  }).join(' ');
}

const ease = (u) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;

function poseAt(run, s) {
  const { cum, pts } = run;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const u = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
  let h = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (run.rev) h += 180;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, h };
}

function applyPose(g, p) {
  g._pose = p;
  g.setAttribute('transform', `translate(${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)})`);
  if (g._rot) g._rot.setAttribute('transform', `rotate(${p.h.toFixed(1)})`);
}

/** 경로를 따라 운전: 전진은 빠르게, 후진은 천천히, 방향을 바꿀 때 잠깐 멈춤 */
function drive(g, legs, done) {
  const runs = sampleRoute(legs);
  if (!runs.length) { done?.(); return; }
  const plan = [];
  let t = 0;
  for (const r of runs) {
    const len = r.cum.at(-1);
    const dur = Math.max(650, (len / (r.rev ? 2.6 : 7.5)) * 1000);
    plan.push({ r, t0: t, dur, len });
    t += dur + 320;
  }
  const total = t - 320;
  const start = performance.now();
  cancelAnimationFrame(g._raf);
  g.classList.add('driving');
  const frame = (now) => {
    const el2 = now - start;
    let cur = plan[plan.length - 1];
    for (const p of plan) if (el2 < p.t0 + p.dur + 320) { cur = p; break; }
    const u = (el2 - cur.t0) / cur.dur;
    g.classList.toggle('reversing', cur.r.rev && u >= 0 && u <= 1);
    applyPose(g, poseAt(cur.r, cur.len * ease(u)));
    if (el2 < total) g._raf = requestAnimationFrame(frame);
    else {
      g.classList.remove('driving', 'reversing');
      g._anim = null;
      done?.();
    }
  };
  g._raf = requestAnimationFrame(frame);
}

/** 버튼을 누르는 동안의 짧은 이동: 직전 위치에서 새 위치까지 일정한 속도로 */
function glide(g, to, ms = 330) {
  const from = g._pose || to;
  const start = performance.now();
  cancelAnimationFrame(g._raf);
  const frame = (now) => {
    const u = Math.min(1, (now - start) / ms);
    applyPose(g, { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, h: to.h });
    if (u < 1) g._raf = requestAnimationFrame(frame);
    else g._anim = null;
  };
  g._raf = requestAnimationFrame(frame);
}

/** 목표 자세가 바뀌면 운전 경로 또는 짧은 이동으로 옮긴다 */
function moveCar(g, target, booted) {
  const key = `${target.x.toFixed(2)},${target.y.toFixed(2)},${target.h}`;
  if (g._target === key) return;
  const prevTarget = g._targetPose;
  g._target = key;
  g._targetPose = target;
  if (!booted || !g._pose) { applyPose(g, target); return; }
  const cur = g._pose;
  const d = Math.hypot(target.x - cur.x, target.y - cur.y);
  if (d < 0.01 && Math.abs(target.h - cur.h) < 1) return;
  // 비켜줘·밀착 구역처럼 차가 바라보는 방향으로 앞뒤만 움직일 때는 거리와 상관없이 직선으로만 옮긴다
  const rad = (cur.h * Math.PI) / 180;
  const lateral = Math.abs(-Math.sin(rad) * (target.x - cur.x) + Math.cos(rad) * (target.y - cur.y));
  if (Math.abs(target.h - cur.h) < 1 && (d < 1.6 || (lateral < 0.3 && (target.z || prevTarget?.z)))) {
    g._anim = 'glide';
    glide(g, target, Math.max(330, (d / 1.2) * 1000));
    return;
  }
  // 큰 이동: 지금 자세(운전 중이었다면 통로 위)에서 경로 계획
  const from = g._anim === 'drive' ? { ...cur, z: null } : { ...cur, z: prevTarget?.z ?? null };
  g._anim = 'drive';
  g._legs = planRoute(from, target);
  drive(g, g._legs);
}

// 같은 내용의 오버레이는 그대로 두어 애니메이션이 처음부터 다시 시작되지 않게 한다
function reconcile(layer, items) {
  const want = new Map();
  for (const it of items) {
    const k = it.outerHTML;
    want.set(k, (want.get(k) || 0) + 1);
  }
  for (const ch of [...layer.children]) {
    const k = ch.outerHTML;
    const n = want.get(k) || 0;
    if (n > 0) want.set(k, n - 1);
    else ch.remove();
  }
  for (const it of items) {
    const k = it.outerHTML;
    const n = want.get(k) || 0;
    if (n > 0) { layer.append(it); want.set(k, n - 1); }
  }
}

// ---------------------------------------------------------------- 렌더
const ACTIVE = new Set(['VETO', 'PRECHECK', 'READY', 'MOVING', 'PAUSED', 'MOVED', 'RETURNING', 'RETURN_OVERDUE', 'TIDY']);

export function renderParkingMap(container, snap, { stage = false } = {}) {
  const c = snap.complexes[0];
  if (!c) return;
  let svg = container.querySelector('svg.pk-map');
  if (!svg || svg.dataset.complex !== c.id || svg.dataset.v !== MAP_V) {
    container.replaceChildren();
    svg = el('svg', { class: 'pk-map', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
    svg.dataset.complex = c.id;
    svg.dataset.v = MAP_V;
    svg.append(staticLayer(c));
    svg.append(el('g', { class: 'pk-under' }));
    svg.append(el('g', { class: 'pk-cars', 'clip-path': 'url(#pk-clip)' }));
    svg.append(el('g', { class: 'pk-over' }));
    svg._cars = new Map();
    svg._booted = false;
    container.append(svg);
  }
  const booted = svg._booted;
  const under = svg.querySelector('.pk-under');
  const carsLayer = svg.querySelector('.pk-cars');
  const over = svg.querySelector('.pk-over');
  const U = [];
  const O = [];

  const vehicles = snap.vehicles.filter((v) => v.state.inComplex);
  const pos = new Map(vehicles.map((v) => [v.id, carPos(v, c)]));
  const userName = (uid) => snap.users?.find((u) => u.id === uid)?.nickname || '이웃';
  const moveByVehicle = new Map();
  for (const m of snap.moves) {
    if (!ACTIVE.has(m.status)) continue;
    for (const it of m.items) if (!moveByVehicle.has(it.vehicleId)) moveByVehicle.set(it.vehicleId, { m, it });
  }
  const trunkByVehicle = new Map();
  for (const t of snap.trunks) if (['issued', 'opening', 'open', 'unclosed'].includes(t.status) && t.vehicle) trunkByVehicle.set(t.vehicle.id, t);
  const proxByVehicle = new Map((snap.proximity || []).filter((p) => p.zone).map((p) => [p.vehicleId, p]));
  const bleOverlay = (v, p, kind, tx, ty) => {
    const pr = proxByVehicle.get(v);
    if (!pr) return;
    const ok = kind === 'trunk' ? ['rear', 'side'].includes(pr.zone) && pr.distanceM <= 2
      : kind === 'return' ? pr.distanceM <= 6 && !(pr.zone === 'rear' && pr.distanceM <= 4)
      : pr.zone === 'side' && pr.distanceM <= 2;
    const col = ok ? '#2ee6a6' : '#f5c542';
    const g = el('g', { transform: `translate(${X(p.x)} ${Y(p.y)}) rotate(${p.h})`, opacity: 0.9 });
    const zone = (x, y, w, hh) => g.append(el('rect', { x: x * S, y: y * S, width: w * S, height: hh * S, rx: 6, fill: ok ? 'rgba(46,230,166,0.10)' : 'rgba(245,197,66,0.08)', stroke: col, 'stroke-width': 1.6, 'stroke-dasharray': '6 5' }));
    if (kind === 'trunk') zone(-CAR_L / 2 - 2, -CAR_W / 2 - 0.2, 2, CAR_W + 0.4);
    else if (kind === 'return') g.append(el('rect', { x: (-CAR_L / 2 - 4) * S, y: (-CAR_W / 2) * S, width: 4 * S, height: CAR_W * S, rx: 6, fill: 'rgba(255,93,108,0.10)', stroke: '#ff5d6c', 'stroke-width': 1.6, 'stroke-dasharray': '6 5' }));
    else { zone(-CAR_L / 2, CAR_W / 2, CAR_L, 2); zone(-CAR_L / 2, -CAR_W / 2 - 2, CAR_L, 2); }
    U.push(g);
    O.push(el('path', { d: `M ${X(p.x)} ${Y(p.y)} L ${X(tx)} ${Y(ty)}`, stroke: col, 'stroke-width': 2.2, 'stroke-dasharray': '3 5', fill: 'none' }));
    O.push(bubble(tx - 2.6, ty + 0.05, `BLE ${pr.distanceM.toFixed(1)}m${ok ? ' ✓' : ''}`, col, false));
  };
  const compactByVehicle = new Map();
  for (const s of snap.compacts || []) if (!compactByVehicle.has(s.vehicleId)) compactByVehicle.set(s.vehicleId, s);

  // ---- 빈자리 · 옆 차 확인 신호 · 알림 · 안내 경로
  const offersPending = new Map(snap.offers.filter((o) => o.status === 'pending').map((o) => [o.vacancyId, o]));
  for (const vac of snap.vacancies) {
    if (!['open', 'offered', 'held'].includes(vac.status)) continue;
    const s = c.spots.find((x) => x.id === vac.spotId);
    if (!s) continue;
    const y0 = s.zoneId === 'B2-7' ? -2.5 : 10.2;
    const color = '#2ee6a6';
    U.push(el('rect', { x: X(s.x - 1.2), y: Y(y0 + 0.05), width: 2.4 * S, height: 4.9 * S, fill: 'url(#pk-vac)', stroke: color, 'stroke-width': 3, class: 'pk-pulse', rx: 6 }));
    const wit = vac.witnesses || [];
    const o = offersPending.get(vac.id);
    const p = (o && pos.get(o.vehicleId)) || (vac.heldBy && pos.get(vac.heldBy));
    if (vac.status !== 'held') {
      // 옆 칸 차가 빈 칸을 확인하는 신호
      for (const w of wit) {
        const wp = pos.get(w.vehicleId) || w.pos;
        O.push(radar(wp.x, wp.y, '#3dd6f5', 34));
        O.push(el('path', { d: `M ${X(wp.x)} ${Y(wp.y)} Q ${X((wp.x + s.x) / 2)} ${Y(s.y - 2.2)} ${X(s.x)} ${Y(s.y)}`, fill: 'none', stroke: '#3dd6f5', 'stroke-width': 2.5, 'stroke-dasharray': '4 7', 'stroke-linecap': 'round', class: 'pk-signal' }));
      }
    }
    const txt = vac.status === 'held' ? '확보됨 · 안내 중' : wit.length ? `방금 빈 자리 · 옆 차 ${wit.length}대 확인` : '방금 빈 자리';
    O.push(bubble(s.x, s.zoneId === 'B2-7' ? -1.0 : 11.6, txt, color));
    if (p && vac.status === 'offered') {
      // 빈 칸에서 들어오는 차로 알림 신호
      const mx = (p.x + s.x) / 2;
      U.push(el('path', { d: `M ${X(s.x)} ${Y(s.y)} C ${X(s.x)} ${Y(-4.6)}, ${X(mx)} ${Y(-4.6)}, ${X(p.x)} ${Y(p.y)}`, fill: 'none', stroke: '#3dd6f5', 'stroke-width': 3, 'stroke-dasharray': '3 9', 'stroke-linecap': 'round', class: 'pk-signal', 'marker-end': 'url(#pk-arrow-c)' }));
      for (const w of wit) {
        const wp = pos.get(w.vehicleId) || w.pos;
        U.push(el('path', { d: `M ${X(wp.x)} ${Y(wp.y)} C ${X(wp.x)} ${Y(-4.2)}, ${X(mx)} ${Y(-4.2)}, ${X(p.x)} ${Y(p.y)}`, fill: 'none', stroke: '#3dd6f5', 'stroke-width': 1.6, 'stroke-dasharray': '3 9', 'stroke-linecap': 'round', opacity: 0.55, class: 'pk-signal' }));
      }
      U.push(radar(p.x, p.y, '#3dd6f5', 34));
      O.push(bubble(p.x + 1.6, p.y - 2.3, '📡 빈자리 알림 받음', '#3dd6f5'));
    }
    if (p && vac.status === 'held') {
      const target = { x: s.x, y: s.y, h: headingOfZone(s.zoneId), z: s.zoneId };
      U.push(el('path', { d: routePath(planRoute({ ...p, z: null }, target)), fill: 'none', stroke: '#2ee6a6', 'stroke-width': 3.5, 'stroke-dasharray': '10 8', class: 'pk-dash', 'marker-end': 'url(#pk-arrow)' }));
    }
  }

  // ---- 막힘 판정: 7열 정식 칸 차 앞을 이중주차 줄 차가 가로막는지
  const aisleCars = vehicles.filter((v) => v.state.zoneId === 'B2-aisle');
  const blockedBy = new Map();
  for (const v of vehicles) {
    if (v.state.zoneId !== 'B2-7') continue;
    const p = pos.get(v.id);
    // 비켜줘로 잠시 옮겨진 차는 곧 돌아가므로 막힘으로 보지 않는다
    const blocker = aisleCars.find((a) => Math.abs(a.state.offsetM || 0) < 0.01 && Math.abs(pos.get(a.id).x - p.x) < CAR_L / 2 + 0.95);
    if (blocker) blockedBy.set(v.id, blocker);
  }

  // ---- 차량
  const seen = new Set();
  for (const v of vehicles) {
    seen.add(v.id);
    const p = pos.get(v.id);
    const mv = moveByVehicle.get(v.id);
    const trunk = trunkByVehicle.get(v.id);
    const cp = compactByVehicle.get(v.id);
    const moving = mv && ['moving', 'returning', 'tidying'].includes(mv.it.status);
    const flags = {
      blink: !!moving || (trunk && ['opening', 'open', 'unclosed'].includes(trunk.status)) || cp?.status === 'moving',
      trunkOpen: !!v.state.doors?.REAR,
      charging: !!v.state.charging,
      selected: !!mv,
      blocked: blockedBy.has(v.id),
      app: !!v.appConnected,
      compact: !!cp && ['ready', 'moving', 'paused'].includes(cp.status),
    };
    let g = svg._cars.get(v.id);
    const fresh = !g || g._leaving;
    if (!g) {
      g = el('g', { class: 'pk-car' });
      svg._cars.set(v.id, g);
      carsLayer.append(g);
    }
    if (g._leaving) { g._leaving = false; g.classList.remove('pk-fade'); }
    // 다시 그릴 내용이 같으면 그대로 둔다
    const body = carBody(v, flags);
    const bs = flags.selected || flags.compact || Math.abs(v.state.offsetM || 0) > 0.01 ? [] : badges(v, flags);
    const sig = `${body.outerHTML}|${v.plate}|${v.model}|${bs.map((b) => b[0]).join(',')}|${p.z}`;
    if (g._sig !== sig) {
      g._sig = sig;
      g.replaceChildren();
      g._rot = body;
      g.append(body);
      // 번호판: 나란히 선 차는 칸 폭에 맞춰 작게
      const pw = p.z === 'B2-C' ? 50 : p.z === 'B2-7' || p.z === 'B2-8' ? 57 : 80;
      const small = pw < 80;
      const plate = el('g');
      plate.append(el('rect', { x: -pw / 2, y: small ? -9 : -11, width: pw, height: small ? 18 : 22, rx: 4, fill: '#f8fafc', stroke: '#0f172a', 'stroke-width': 1.5 }));
      plate.append(el('text', { x: 0, y: small ? 4 : 5, class: `pk-t pk-plate${small ? ' s' : ''}${pw === 50 ? ' xs' : ''}`, 'text-anchor': 'middle' }, v.plate));
      g.append(plate);
      g.append(el('text', { x: 0, y: small ? 23 : 26, class: `pk-t pk-model${small ? ' s' : ''}`, 'text-anchor': 'middle' }, SHORT[v.model] || v.model));
      // 상태 배지: 차 위(B2-8은 아래)에 가로 한 줄로
      const vertical = Math.abs(p.h) === 90;
      let by = vertical ? -(CAR_L / 2) * S - 10 : -(CAR_W / 2) * S - 12;
      if (v.state.zoneId === 'B2-8') by = (CAR_L / 2) * S + 22;
      const items = bs.slice(0, 3).map(([t, col]) => ({ t, col, w: t.length * 10.5 + 16 }));
      const total = items.reduce((s2, x) => s2 + x.w, 0) + Math.max(0, items.length - 1) * 5;
      let bx = -total / 2;
      const bg = el('g', { class: 'pk-badges' });
      for (const { t, col, w } of items) {
        bg.append(el('rect', { x: bx, y: by - 15, width: w, height: 19, rx: 9.5, fill: 'rgba(8,12,20,0.9)', stroke: col, 'stroke-width': 1.2 }));
        bg.append(el('text', { x: bx + w / 2, y: by - 1.5, class: 'pk-t pk-xs', 'text-anchor': 'middle', fill: col }, t));
        bx += w + 5;
      }
      g.append(bg);
      if (g._pose) applyPose(g, g._pose);
    }
    g.classList.toggle('lit', !!flags.blink);
    if (fresh && booted && !g._pose) {
      // 새로 들어온 차: 통로에 나타나면 게이트 밖에서 운전해 들어오고, 칸에 바로 놓이면 서서히 나타난다
      if (!p.z) {
        applyPose(g, { x: OUT_X, y: p.y, h: 0 });
        g._target = null;
      } else {
        g.classList.add('pk-appear');
      }
    }
    moveCar(g, p, booted);
  }
  for (const [id, g] of svg._cars) {
    if (seen.has(id) || g._leaving) continue;
    if (!booted || !g._pose) { g.remove(); svg._cars.delete(id); continue; }
    // 단지를 떠난 차: 칸에서 빠져나와 게이트 밖으로
    g._leaving = true;
    g.querySelector('.pk-badges')?.remove();
    g._anim = 'drive';
    g._target = 'out';
    drive(g, planRoute({ ...g._pose, z: g._targetPose?.z ?? null }, { out: true }), () => {
      if (!g._leaving) return;
      g.classList.add('pk-fade');
      setTimeout(() => { if (g._leaving) { g.remove(); svg._cars.delete(id); } }, 600);
    });
  }

  // ---- 막힘 / 출차 가능 표시
  for (const v of vehicles) {
    if (v.state.zoneId !== 'B2-7') continue;
    const p = pos.get(v.id);
    const blocker = blockedBy.get(v.id);
    if (blocker) {
      O.push(el('path', { d: `M ${X(p.x)} ${Y(2.4)} l 0 ${S * 0.5}`, stroke: '#ff5d6c', 'stroke-width': 4 }));
      O.push(bubble(p.x, 0.75, `출차 막힘 · ${blocker.model || blocker.plate.slice(-4)}`, '#ff8a95'));
    } else if (aisleCars.some((a) => Math.abs((a.home?.pos?.x ?? 999) - p.x) < CAR_L / 2 + 0.95 && Math.abs(a.state.offsetM || 0) > 0.01)) {
      // 막고 있던 차가 비켜서 길이 열림
      O.push(el('path', { d: `M ${X(p.x)} ${Y(2.6)} C ${X(p.x)} ${Y(5.2)}, ${X(p.x - 1.2)} ${Y(6.6)}, ${X(p.x - 4)} ${Y(6.6)}`, stroke: '#2ee6a6', 'stroke-width': 4, fill: 'none', 'stroke-dasharray': '10 7', class: 'pk-dash', 'marker-end': 'url(#pk-arrow)' }));
      O.push(bubble(p.x, 0.75, '출차 가능', '#2ee6a6'));
    }
  }

  // ---- 비켜줘: 원래 자리 · 이동량 · 요청자
  for (const v of vehicles) {
    const p = pos.get(v.id);
    const mv = moveByVehicle.get(v.id);
    const off = v.state.offsetM || 0;
    if (Math.abs(off) > 0.01 || mv) {
      const home = basePos(v, c);
      const ghost = el('g', { transform: `translate(${X(home.x)} ${Y(home.y)}) rotate(${p.h})` });
      ghost.append(el('rect', { x: -(CAR_L / 2) * S, y: -(CAR_W / 2) * S, width: CAR_L * S, height: CAR_W * S, rx: 13, fill: 'none', stroke: '#6f7a8e', 'stroke-width': 2, 'stroke-dasharray': '7 6' }));
      U.push(ghost);
      if (Math.abs(off) > 0.01) {
        const ay = p.y - (CAR_W / 2 + 0.3);
        O.push(el('path', { d: `M ${X(home.x)} ${Y(ay)} L ${X(p.x)} ${Y(ay)}`, stroke: '#2ee6a6', 'stroke-width': 3, 'marker-end': 'url(#pk-arrow)' }));
        O.push(bubble((home.x + p.x) / 2, ay - 0.5, `${Math.abs(off).toFixed(1)}m / 최대 3m`, '#2ee6a6', false));
      }
    }
    if (!mv) continue;
    const { m, it } = mv;
    const who = m.requester?.nickname || '이웃';
    const sx2 = p.x - 0.6;
    const sy = p.y + CAR_W / 2 + 1.2; // 차 측면 2m 안, 진로 밖
    // 복귀는 요청자가 빠져나온 자기 차 안에서
    const reqCar = m.status === 'RETURNING' ? vehicles.find((x) => x.ownerId === m.requester?.id && x.id !== v.id && !x.state.spotId) : null;
    const rp = reqCar ? pos.get(reqCar.id) : null;
    if (rp) bleOverlay(v.id, p, 'return', rp.x, rp.y - 1.7);
    else if (['READY', 'MOVING', 'PAUSED', 'TIDY'].includes(m.status)) bleOverlay(v.id, p, 'move', sx2, sy);
    if (m.status === 'VETO') {
      O.push(bubble(p.x, p.y + CAR_W / 2 + 2.55, `차주 확인 중 · ${Math.max(0, Math.ceil((m.vetoEndsAt - snap.now) / 1000))}초`, '#f5c542', false));
      O.push(person(sx2, sy, who, '요청함'));
    } else if (m.status === 'PRECHECK') {
      O.push(bubble(p.x, p.y + CAR_W / 2 + 2.55, '차량 자가 점검 중', '#3dd6f5'));
      O.push(person(sx2, sy, who, '대기'));
    } else {
      const holding = ['moving', 'returning', 'tidying'].includes(it.status);
      const sub = holding ? '버튼 누르는 중' : it.status === 'paused' || m.status === 'PAUSED' ? '손 뗌 · 정지' : it.status === 'moved' ? '출차 중' : '대기';
      O.push(person(rp ? rp.x : sx2, rp ? rp.y - 1.7 : sy, who, rp ? (holding ? '차 안에서 복귀 중' : '차 안') : sub, holding ? '#2ee6a6' : '#b197fc', holding));
      if (m.status === 'MOVED' || m.status === 'RETURN_OVERDUE') O.push(bubble(p.x, p.y + CAR_W / 2 + 2.55, 'P 체결 · 복귀 대기', '#2ee6a6'));
      if (m.status === 'RETURNING') O.push(bubble(p.x, p.y + CAR_W / 2 + 2.55, '원위치로 복귀 중', '#3dd6f5'));
    }
  }

  // ---- 트렁크 드롭: 물건을 넣거나 꺼내는 이웃
  for (const [vid, t] of trunkByVehicle) {
    const p = pos.get(vid);
    if (!p) continue;
    const rad = (p.h * Math.PI) / 180;
    const rx = p.x - Math.cos(rad) * (CAR_L / 2 + 1.2);
    const ry = p.y - Math.sin(rad) * (CAR_L / 2 + 1.2);
    const doing = t.purpose === 'pickup' ? '물건 꺼내는 중' : '물건 넣는 중';
    const sub = t.status === 'issued' ? '토큰 받음' : t.status === 'unclosed' ? '닫힘 미감지' : doing;
    if (t.status === 'issued') bleOverlay(vid, p, 'trunk', rx, ry);
    O.push(person(rx, ry, t.giver?.nickname || '이웃', sub, '#f5c542'));
  }

  // ---- 밀착 구역: 안내받은 칸 · 칸 앞에서 누르는 동안 들어가기
  const now = snap.now;
  for (const s of snap.compacts || []) {
    const spot = c.spots.find((x) => x.id === s.spotId);
    const p = pos.get(s.vehicleId);
    if (!spot) continue;
    const cyan = '#3dd6f5';
    if (s.status === 'guide') {
      U.push(el('rect', { x: X(spot.x - 1.05), y: Y(-2.45), width: 2.1 * S, height: 4.9 * S, fill: 'url(#pk-cyan)', stroke: cyan, 'stroke-width': 3, rx: 5, class: 'pk-pulse' }));
      O.push(bubble(spot.x, -0.2, `${spot.id.split('-').pop()}번 칸`, cyan));
      if (p) U.push(el('path', { d: routePath(planRoute({ ...p, z: null }, { x: spot.x, y: spot.y + s.total, h: -90, z: 'B2-C' })), fill: 'none', stroke: cyan, 'stroke-width': 3.5, 'stroke-dasharray': '10 8', class: 'pk-dash', 'marker-end': 'url(#pk-arrow-c)' }));
    } else if (['ready', 'moving', 'paused'].includes(s.status)) {
      const ghost = el('g', { transform: `translate(${X(spot.x)} ${Y(spot.y)}) rotate(-90)` });
      ghost.append(el('rect', { x: -(CAR_L / 2) * S, y: -(CAR_W / 2) * S, width: CAR_L * S, height: CAR_W * S, rx: 13, fill: 'rgba(61,214,245,0.08)', stroke: cyan, 'stroke-width': 2, 'stroke-dasharray': '7 6' }));
      U.push(ghost);
      const holding = s.status === 'moving';
      const who = userName(s.ownerId);
      O.push(person(spot.x + 1.9, 6.1, who, holding ? '버튼 누르는 중' : s.status === 'paused' ? '손 뗌 · 정지' : '내려서 대기', holding ? '#2ee6a6' : cyan, holding));
      O.push(bubble(spot.x - 3.1, 4.4, `${s.distance.toFixed(1)}m / ${s.total.toFixed(1)}m`, cyan, false));
    } else if (s.status === 'parked' && now - (s.at || 0) < 25000) {
      const zs = c.spots.filter((x) => x.zoneId === spot.zoneId);
      const cx = zs.reduce((a, b) => a + b.x, 0) / zs.length;
      O.push(bubble(cx + 0.4, 3.9, `문 열 간격 없이 · ${Math.floor((zs.length * 2.2) / 2.5)}칸 → ${zs.length}칸`, cyan));
    }
  }

  // ---- 범례
  if (!stage) {
    const lg = el('g', { transform: `translate(${X(-13.4)} ${Y(12.0)})` });
    lg.append(el('rect', { x: -10, y: -22, width: 310, height: 82, rx: 10, fill: 'rgba(15,23,42,0.75)', stroke: '#334155' }));
    const items = [['#ef4444', '막힌 차'], ['#22c55e', '비켜줘 · 빈자리'], ['#3dd6f5', '빈자리 확인 신호'], ['#facc15', '이중주차 줄'], ['#a78bfa', '요청자'], ['#7fe3f8', '밀착 구역']];
    items.forEach(([col, t], i) => {
      const x = (i % 2) * 150;
      const y = Math.floor(i / 2) * 20;
      lg.append(el('rect', { x, y: y - 9, width: 12, height: 12, rx: 3, fill: col }));
      lg.append(el('text', { x: x + 17, y: y + 1.5, class: 'pk-t pk-xs' }, t));
    });
    O.push(lg);
  }

  reconcile(under, U);
  reconcile(over, O);
  svg._booted = true;
}
