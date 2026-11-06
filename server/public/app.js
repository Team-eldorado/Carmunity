import { renderParkingMap } from './map.js';

// 카뮤니티 모바일 웹 (요청자 · 차주 폰) + 데모 콘솔 + 영상 스튜디오
// 설치 없이 QR로 열리므로 타사 차주나 Pleos 차량이 없는 입주민도 요청할 수 있다.

// ---------------- 유틸 ----------------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const qs = new URLSearchParams(location.search);
if (qs.get('as')) sessionStorage.setItem('uid', qs.get('as'));
const S = {
  uid: qs.get('as') || sessionStorage.getItem('uid') || localStorage.getItem('uid') || null,
  me: null,
  es: null,
  complex: null,
  moves: new Map(),
  trunks: new Map(),
  holdTimer: null,
  tick: null,
  lastBalance: null,
};

const hhmm = () => new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

// 영상 녹화용 폰 화면: 상태 표시줄과 앱 머리를 단다 (?rec=1&label=...)
if (qs.get('rec')) {
  document.body.classList.add('rec-phone');
  const clock = h('b', {}, hhmm());
  setInterval(() => { clock.textContent = hhmm(); }, 10000);
  document.body.prepend(h('div', { class: 'ph-head' },
    h('div', { class: 'ph-status' }, clock, h('span', { class: 'ic' }, '▂▄▆█', ' 5G ', h('span', { class: 'bat' }))),
    h('div', { class: 'ph-bar' }, h('span', { class: 'logo' }), h('span', { class: 'app' }, '카뮤니티'), qs.get('label') ? h('span', { class: 'who' }, qs.get('label')) : null)));
  // 자동 조작이 어디를 눌렀는지 보이게 한다
  window.recTap = (x, y) => {
    const d = h('div', { class: 'tap-dot', style: `left:${x}px;top:${y}px` });
    document.body.append(d);
    setTimeout(() => d.remove(), 700);
  };
  window.recPress = (on, x, y) => {
    document.querySelectorAll('.tap-dot.hold').forEach((e) => e.remove());
    if (on) document.body.append(h('div', { class: 'tap-dot hold', style: `left:${x}px;top:${y}px` }));
  };
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(S.uid ? { 'x-user-id': S.uid } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || '요청에 실패했어요');
    Object.assign(err, data);
    throw err;
  }
  return data;
}

// 푸시 알림처럼 위에서 내려오는 배너
function toast(msg, ms = 3800) {
  const t = document.getElementById('toast');
  t.replaceChildren(
    h('div', { class: 'app-ico' }, '카'),
    h('div', { class: 't-body' }, h('div', { class: 't-head' }, '카뮤니티 · 지금'), h('div', { class: 't-msg' }, msg)),
  );
  t.classList.remove('hidden');
  t.style.animation = 'none';
  void t.offsetHeight;
  t.style.animation = '';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const secLeft = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 1000));
const view = () => document.getElementById('view');
// null/false 항목은 빼고 그린다 (DOM replaceChildren은 null을 글자로 찍음)
const setView = (...kids) => view().replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const guard = (fn) => async (...a) => {
  try { return await fn(...a); } catch (e) { toast(e.message); }
};
const m1 = (n) => Number(n || 0).toFixed(1);

const STATUS_TEXT = {
  VETO: ['차주 확인 중', 'info'], PRECHECK: ['자가 점검', 'info'], READY: ['준비 완료', 'ok'], MOVING: ['이동 중', 'ok'],
  PAUSED: ['일시 정지', 'warn'], MOVED: ['이동 완료', 'ok'], RETURNING: ['복귀 중', 'info'], RETURN_OVERDUE: ['복귀 지연', 'warn'],
  TIDY: ['정리 이동', 'warn'], RETURNED: ['복귀 완료', 'ok'], REJECTED: ['차주 직접 처리', 'warn'], DENIED: ['연락으로 전환', 'warn'],
  INTERLOCK_FAILED: ['안전 점검 불가', 'err'], ABORTED: ['중단', 'err'], EXPIRED: ['토큰 소멸', 'warn'], CANCELLED: ['취소', ''],
  CONTACT_STOPPED: ['접촉 정지', 'err'], RETURN_BLOCKED: ['복귀 불가', 'warn'],
};
const DONE = ['DENIED', 'REJECTED', 'RETURNED', 'CANCELLED', 'INTERLOCK_FAILED', 'ABORTED', 'EXPIRED', 'CONTACT_STOPPED', 'RETURN_BLOCKED'];
const pill = (status) => {
  const [t, k] = STATUS_TEXT[status] || [status, ''];
  return h('span', { class: `pill ${k}` }, t);
};
const CAR_EMOJI = (model = '') => (/레이|ray/i.test(model) ? '🚐' : /쏘렌토|sorento/i.test(model) ? '🚙' : '🚗');

// 원형 카운트다운
function ring(expiresAt, total, label = '초 남음') {
  const R = 56;
  const C = 2 * Math.PI * R;
  const el = h('div', { class: 'ring', html: `<svg viewBox="0 0 132 132"><circle class="bg" cx="66" cy="66" r="${R}"/><circle class="fg" cx="66" cy="66" r="${R}" stroke-dasharray="${C}"/></svg>` });
  const b = h('b');
  el.append(h('div', { class: 'val' }, h('div', {}, b, h('small', {}, label))));
  const fg = el.querySelector('.fg');
  const upd = () => {
    const s = secLeft(expiresAt);
    b.textContent = s;
    fg.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(1, s / total))));
  };
  upd();
  return { el, upd };
}

// ---------------- 실시간 ----------------
let homeTimer = null;
function connect() {
  if (S.es) S.es.close();
  if (!S.uid) return;
  S.es = new EventSource(`/api/stream?userId=${encodeURIComponent(S.uid)}`);
  S.es.addEventListener('notification', (e) => {
    const n = JSON.parse(e.data);
    if (n.kind === 'move.veto') openVeto(n);
    else toast(n.message, 4500);
    if (S.me) S.me.notifications.unshift(n);
    refreshHome();
  });
  S.es.addEventListener('move', (e) => {
    const m = JSON.parse(e.data);
    S.moves.set(m.id, m);
    if (location.hash === `#/move/${m.id}`) renderMove(m);
    refreshHome();
  });
  S.es.addEventListener('trunk', (e) => {
    const t = JSON.parse(e.data);
    S.trunks.set(t.id, t);
    if (location.hash.startsWith('#/trunk')) route();
  });
  S.es.addEventListener('credit', () => refreshHome());
  S.es.addEventListener('proximity', (e) => {
    const p = JSON.parse(e.data);
    document.querySelectorAll(`.ble[data-vid="${p.vehicleId}"]`).forEach((el) => el.replaceWith(bleLine(p, el.dataset.kind)));
  });
  S.es.addEventListener('compact', (e) => {
    const c = JSON.parse(e.data);
    if (!location.hash.startsWith('#/compact')) return;
    if (S.compact && c.status !== 'parked') { S.compact.session = c; drawCompact(); } else renderCompact();
  });
}
function refreshHome() {
  if (!(location.hash === '#/home' || location.hash === '')) return;
  clearTimeout(homeTimer);
  homeTimer = setTimeout(route, 350);
}

// ---------------- 차주: 30초 거부 창 (아래에서 올라오는 시트) ----------------
function openVeto(n) {
  const m = document.getElementById('modal');
  const { requestId, expiresAt } = n.data;
  const r = ring(expiresAt, 30, '초 뒤 자동 진행');
  const close = () => { clearInterval(timer); m.classList.add('hidden'); m.innerHTML = ''; };
  const timer = setInterval(() => {
    r.upd();
    if (secLeft(expiresAt) <= 0) { close(); toast('거부가 없어 미리 허락한 조건대로 진행돼요'); }
  }, 250);
  const [who] = n.message.split('님이');
  m.innerHTML = '';
  m.append(h('div', { class: 'sheet' },
    h('div', { class: 'grab' }),
    h('div', { class: 'eyebrow', style: 'text-align:center' }, '비켜줘 요청'),
    h('h2', { style: 'text-align:center' }, `${who}님이 차를 비켜 달래요`),
    r.el,
    h('div', { class: 'facts' },
      h('span', { class: 'pill info plain' }, '누르는 동안만 움직여요'),
      h('span', { class: 'pill info plain' }, '1회 최대 3m'),
      h('span', { class: 'pill info plain' }, '전후 10초 영상')),
    h('div', { class: 'grid2' },
      h('button', { class: 'danger lg', onclick: guard(async () => { await api('POST', `/api/move-requests/${requestId}/decision`, { decision: 'reject' }); close(); toast('거부했어요. 직접 처리해 주세요'); }) }, '거부'),
      h('button', { class: 'primary lg', onclick: guard(async () => { await api('POST', `/api/move-requests/${requestId}/decision`, { decision: 'approve' }); close(); toast('허락했어요. 차가 먼저 스스로 점검해요'); }) }, '지금 허락'),
    ),
  ));
  m.classList.remove('hidden');
}

// ---------------- 라우팅 ----------------
const NAV = [
  ['#/home', '내 정보'], ['#/request', '비켜줘'], ['#/trunk', '트렁크 드롭'], ['#/compact', '밀착 구역'], ['#/records', '기록'], ['#/demo', '데모 콘솔'],
];

async function route() {
  clearInterval(S.tick);
  stopHold();
  const hash = location.hash || '#/home';
  document.getElementById('nav').replaceChildren(...NAV.map(([href, t]) => h('a', { href, class: hash.startsWith(href) ? 'on' : '' }, t)));
  view().classList.toggle('wide', hash.startsWith('#/demo') || hash.startsWith('#/stage'));
  if (hash.startsWith('#/demo')) return renderDemo(false);
  if (hash.startsWith('#/stage')) return renderDemo(true);
  if (hash.startsWith('#/studio')) return renderStudio();
  if (!S.uid) return renderLogin();
  try {
    S.me = await api('GET', '/api/me');
    if (!S.complex && S.me.user.complexId) S.complex = await api('GET', `/api/complexes/${S.me.user.complexId}`);
  } catch (e) {
    S.uid = null;
    sessionStorage.removeItem('uid');
    return renderLogin();
  }
  if (hash.startsWith('#/move/')) {
    const id = hash.split('/')[2];
    const m = await api('GET', `/api/move-requests/${id}`).catch(() => null);
    if (m) { S.moves.set(m.id, m); return renderMove(m); }
  }
  if (hash.startsWith('#/request')) return renderRequest();
  if (hash.startsWith('#/trunk')) return renderTrunk();
  if (hash.startsWith('#/compact')) return renderCompact();
  if (hash.startsWith('#/records')) return renderRecords();
  if (hash.startsWith('#/office')) return renderOffice();
  return renderHome();
}
window.addEventListener('hashchange', route);

// ---------------- 로그인 (시범 운영: 인증 완료 계정 선택) ----------------
async function renderLogin() {
  const users = await api('GET', '/api/demo/users');
  setView(
    h('div', { class: 'hero' }, h('div', { class: 'eyebrow' }, '우리 단지 지하주차장'), h('h1', {}, '이웃끼리, 차 기능을\n조건부로 빌려 써요'),
      h('p', {}, '단지 입주민 인증과 실명 휴대폰 인증을 마친 계정으로 들어가요. 시범 운영에서는 인증된 계정을 골라 시작합니다.')),
    h('div', { class: 'card' },
      h('h2', {}, '계정 선택'),
      h('ul', { class: 'list' }, users.map((u) => h('li', { class: 'row between nowrap' },
        h('div', { class: 'grow' }, h('b', {}, u.nickname), ' ', h('span', { class: 'muted' }, `${u.dong}동 ${u.ho}호`), h('div', { class: 'muted small' }, u.vehicles.map((v) => `${v.model} ${v.plate}`).join(', ') || '등록 차량 없음')),
        h('button', { class: 'primary', onclick: () => { S.uid = u.id; sessionStorage.setItem('uid', u.id); localStorage.setItem('uid', u.id); connect(); location.hash = '#/home'; route(); } }, '들어가기'),
      ))),
    ),
    h('div', { class: 'card' },
      h('h2', {}, '방문자'),
      h('p', { class: 'muted' }, '방문자는 번호판으로 차주에게 연락만 보낼 수 있어요.'),
      visitorCheck(),
    ),
  );
}

function visitorCheck() {
  const input = h('input', { class: 'plate-input', placeholder: '번호판 (예: 56다7890)' });
  const out = h('div');
  return h('div', {}, input, h('div', { style: 'height:8px' }),
    h('button', { class: 'block', onclick: guard(async () => {
      const r = await fetch('/api/neutral-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plate: input.value }) }).then((x) => x.json());
      out.replaceChildren(h('div', { class: 'result warn', style: 'margin-top:10px' }, h('span', { class: 'ico' }, '!'), h('div', {}, r.message)));
    }) }, '차주에게 연락'), out);
}

// ---------------- 내 정보 (차주 폰) ----------------
function renderHome() {
  const { user, vehicles, credits, notifications, moves, trunks } = S.me;
  const active = moves.filter((m) => !DONE.includes(m.status));
  setView(
    h('div', { class: 'hero row between nowrap' },
      h('div', {}, h('div', { class: 'eyebrow' }, `${user.dong}동 · 입주민 인증 ${user.residentVerified ? '완료' : '필요'}`), h('h1', { style: 'margin-bottom:0' }, `${user.nickname}님`)),
      h('div', { class: 'row' },
        user.role === 'office' ? h('a', { class: 'btn', href: '#/office' }, '관리사무소') : null,
        qs.get('rec') ? null : h('button', { class: 'ghost', onclick: () => { sessionStorage.removeItem('uid'); localStorage.removeItem('uid'); S.uid = null; route(); } }, '계정 바꾸기'),
      ),
    ),
    creditCard(credits),
    active.length ? h('div', { class: 'card' }, h('h2', {}, '진행 중'), h('ul', { class: 'list' }, active.map((m) => h('li', { class: 'row between nowrap' },
      h('div', { class: 'grow' }, h('div', { style: 'font-weight:700' }, m.isRequester ? '내 요청' : `${m.requester?.dong || ''}동 ${m.requester?.nickname || '이웃'}님 요청`),
        h('div', { class: 'muted small' }, m.items.map((i) => `${i.plate} ${m1(i.distance)}m`).join(' · '))),
      pill(m.status),
      h('a', { class: 'btn', href: `#/move/${m.id}` }, '열기'))))) : null,
    ...vehicles.map(vehicleCard),
    h('div', { class: 'card' }, h('h2', {}, '알림'),
      notifications.length ? h('ul', { class: 'list notis' }, notifications.slice(0, 6).map((n) => h('li', {}, h('span', { class: 'nd' }), h('div', {}, h('div', { class: 'nt' }, n.message), h('time', {}, fmtTime(n.at))))))
        : h('p', { class: 'muted' }, '아직 알림이 없어요')),
    trunks.length ? h('p', { class: 'muted' }, `트렁크 드롭 기록 ${trunks.length}건 · `, h('a', { href: '#/trunk' }, '보기')) : null,
  );
}

function creditCard(c) {
  // 크레딧이 늘면 '+100'을 잠깐 띄운다 (다시 그려져도 애니메이션이 끝날 때까지 유지)
  if (S.lastBalance != null && c.balance > S.lastBalance) S.plus = { val: c.balance - S.lastBalance, until: Date.now() + 2600 };
  S.lastBalance = c.balance;
  const plus = S.plus && S.plus.until > Date.now() ? S.plus.val : 0;
  return h('div', { class: 'credit' },
    h('div', { class: 'lab' }, '틈 크레딧'),
    h('div', { class: 'bal' }, c.balance.toLocaleString(), h('small', {}, '크레딧')),
    h('div', { class: 'sub' }, c.monthMovesProvided ? `이번 달 ${c.monthMovesProvided}번 비켜줬어요` : '이번 달 아직 비켜준 기록이 없어요',
      c.monthVacancySignals ? ` · 빈자리 알림 ${c.monthVacancySignals}회` : '', c.monthTrunkProvided ? ` · 트렁크 ${c.monthTrunkProvided}회` : ''),
    c.thanks.length ? h('div', { class: 'thanks' }, '💬 ', c.thanks[c.thanks.length - 1]) : null,
    plus ? h('div', { class: 'plus' }, `+${plus}`) : null,
  );
}

function vehicleCard(v) {
  const p = v.policy;
  const s = v.state;
  const zone = S.complex?.zones.find((z) => z.id === s.zoneId);
  const save = (patch) => guard(async () => { await api('PATCH', `/api/vehicles/${v.id}/policy`, patch); toast('저장했어요'); route(); });
  const toggle = (label, sub, checked, onchange, disabled = false) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, disabled, onchange }), h('span', { class: 'lbl' }, label, sub ? h('small', {}, sub) : null));
  const spotSel = h('select', { onchange: guard(async (e) => { await api('POST', `/api/vehicles/${v.id}/home`, { spotId: e.target.value }); toast('내 자리를 저장했어요'); route(); }) },
    h('option', { value: '' }, '내 자리 고르기'),
    (S.complex?.spots || []).map((sp) => h('option', { value: sp.id, selected: v.home?.spotId === sp.id }, sp.label)));
  const moveOn = p.enabled && p.functions.move;
  return h('div', { class: 'card' },
    h('div', { class: 'car-head' },
      h('div', { class: 'car-ava' }, CAR_EMOJI(v.model)),
      h('div', { class: 'grow' }, h('div', { class: 'nm' }, v.model), h('div', { class: 'sub' }, h('span', { class: 'plate' }, v.plate), ' ', s.inComplex ? (zone?.name || '단지 안') : '단지 밖')),
      h('span', { class: `pill ${p.enabled ? 'ok' : ''}` }, p.enabled ? '위임 ON' : '위임 OFF')),
    h('div', { class: 'chips' },
      h('span', { class: 'pill plain' }, `기어 ${s.gear}`),
      s.doubleParked ? h('span', { class: 'pill warn' }, '이중주차') : null,
      s.neutral ? h('span', { class: 'pill ok' }, '밀어도 되는 차(N)') : null,
      s.charging ? h('span', { class: 'pill info' }, '충전 중') : null,
      v.hasRspa ? h('span', { class: 'pill info' }, '원격 전·후진') : h('span', { class: 'pill' }, '중립 표시로 참여'),
    ),
    h('div', { class: 'sep' }),
    toggle('비켜줘 위임', `1회 최대 3m · 하루 ${p.dailyMoveLimit}회 · 30초 거부 창`, moveOn, (e) => save({ enabled: e.target.checked, functions: { move: e.target.checked && v.hasRspa } })(), !v.hasRspa),
    toggle('트렁크 드롭', '지정한 이웃만 · 10분 1회 개방', p.enabled && p.functions.trunk, (e) => save(e.target.checked ? { enabled: true, functions: { trunk: true } } : { functions: { trunk: false } })()),
    h('details', { class: 'more' }, h('summary', {}, '위임 조건 자세히'),
      toggle('센서·출차 신호 공유', '나가면 빈자리 레이더에 알려요', p.functions.sensor, (e) => save({ functions: { sensor: e.target.checked } })()),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '누가'), h('select', { onchange: (e) => save(e.target.value === 'complex' ? { scope: { type: 'complex' } } : { scope: { type: 'dongs', dongs: [e.target.value] } })() },
          h('option', { value: 'complex', selected: p.scope.type === 'complex' }, '우리 단지 입주민'),
          ['101', '102', '103', '104'].map((d) => h('option', { value: d, selected: p.scope.type === 'dongs' && p.scope.dongs.includes(d) }, `${d}동만`)))),
        h('label', { class: 'field' }, h('span', {}, '하루 횟수'), h('select', { onchange: (e) => save({ dailyMoveLimit: Number(e.target.value) })() },
          [0, 1, 2].map((n) => h('option', { value: n, selected: p.dailyMoveLimit === n }, `${n}회`)))),
      ),
      toggle('23시~06시에도 허용', '야간 크레딧 1.5배', p.allowNight, (e) => save({ allowNight: e.target.checked })()),
      toggle('오늘은 안 됨', null, p.pausedDay != null, (e) => save({ pausedToday: e.target.checked })()),
      h('label', { class: 'field' }, h('span', {}, '내 자리 (지하에서는 위치 오차가 있어 처음 몇 번은 직접 골라요)'), spotSel),
      h('div', { class: 'grid2' },
        h('button', { class: 'danger', onclick: guard(async () => { await api('POST', `/api/vehicles/${v.id}/revoke`); toast('모든 위임을 철회했어요'); route(); }) }, '즉시 철회'),
        h('button', { onclick: guard(async () => { await api('POST', `/api/vehicles/${v.id}/neutral`, { neutral: !s.neutral }); route(); }) }, s.neutral ? '중립 표시 해제' : 'N 주차 등록'),
      ),
      h('p', { class: 'muted small' }, `차량 앱 페어링: 차량 번호 ${v.plate} · 키 ${v.appKey}`),
    ),
  );
}

// ---------------- 요청자: 번호판 → 상태 확인 → 비켜줘 ----------------
function renderRequest() {
  const plate = h('input', { class: 'plate-input', placeholder: '앞차 번호판', autocomplete: 'off' });
  const photo = h('img', { class: 'photo', style: 'display:none', alt: '' });
  const out = h('div');
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', onchange: (e) => {
    const f = e.target.files[0];
    if (!f) return;
    photo.src = URL.createObjectURL(f);
    photo.style.display = 'block';
    plate.focus();
    toast('사진의 번호판을 확인해 입력해 주세요');
  } });
  const check = guard(async () => {
    const r = await api('POST', '/api/neutral-check', { plate: plate.value });
    out.replaceChildren(resultCard(r, plate.value));
  });
  setView(
    h('div', { class: 'hero' }, h('div', { class: 'eyebrow' }, '비켜줘'), h('h1', {}, '앞차에 막혔나요?'),
      h('p', {}, '번호판만 입력하면 차주가 미리 허락한 범위에서 차를 비켜 드려요')),
    h('div', { class: 'card' },
      plate, photo,
      h('div', { class: 'grid2', style: 'margin-top:10px' }, h('button', { onclick: () => file.click() }, '📷 번호판 찍기'), h('button', { class: 'primary', onclick: check }, '상태 확인')),
      file,
    ),
    out,
  );
}

function resultCard(r, plate) {
  if (!r.participant) {
    return h('div', { class: 'card' }, h('div', { class: 'result warn' }, h('span', { class: 'ico' }, '!'), h('div', {}, r.message)), contactBox());
  }
  const kind = r.neutral ? 'ok' : r.canRequestMove ? 'info' : 'warn';
  const box = h('div', { class: 'card' },
    h('div', { class: 'car-head' },
      h('div', { class: 'car-ava' }, CAR_EMOJI(r.model)),
      h('div', { class: 'grow' }, h('div', { class: 'nm' }, r.model || '등록 차량'), h('div', { class: 'sub' }, h('span', { class: 'plate' }, r.plate), ' ', r.zone || '')),
      r.canRequestMove ? h('span', { class: 'pill ok' }, '비켜줘 가능') : null),
    h('div', { class: `result ${kind}`, style: 'margin-top:12px' }, h('span', { class: 'ico' }, r.neutral ? '✓' : r.canRequestMove ? '↔' : '!'), h('div', {}, r.message)),
  );
  if (r.canRequestMove) box.append(moveForm(plate));
  else if (!r.neutral) box.append(contactBox());
  return box;
}

function contactBox() {
  return h('div', { style: 'margin-top:10px' },
    h('button', { class: 'block', onclick: () => toast('안심번호 연결은 시범 단계에서 관리사무소 번호로 대신해요') }, '📞 안심번호로 차주에게 전화'));
}

function moveForm(firstPlate) {
  const chain = [{ plate: firstPlate, direction: '' }];
  const list = h('div');
  const draw = () => list.replaceChildren(...chain.map((c) => h('div', { class: 'chain-row' },
    h('input', { value: c.plate, placeholder: '번호판', oninput: (e) => { c.plate = e.target.value; } }),
    h('select', { onchange: (e) => { c.direction = e.target.value; } },
      h('option', { value: '' }, '방향 자동'),
      h('option', { value: 'forward', selected: c.direction === 'forward' }, '앞으로'),
      h('option', { value: 'backward', selected: c.direction === 'backward' }, '뒤로')))));
  draw();
  return h('div', { style: 'margin-top:14px' },
    h('div', { class: 'row between' }, h('h3', { style: 'margin:0' }, '막고 있는 차 (바깥쪽부터)'),
      h('button', { class: 'link', onclick: () => { chain.push({ plate: '', direction: '' }); draw(); } }, '+ 차 추가')),
    list,
    h('p', { class: 'muted small' }, '차주에게 30초 거부 창이 뜨고, 거부가 없으면 차 옆에서 버튼을 누르는 동안만 움직여요.'),
    h('button', { class: 'primary lg block', onclick: guard(async () => {
      const res = await api('POST', '/api/move-requests', { targets: chain.filter((c) => c.plate).map((c) => ({ plate: c.plate, direction: c.direction || undefined })) });
      if (res.status === 'DENIED') {
        toast(res.hint ? `${res.message} · ${res.hint}` : res.message, 5000);
        return;
      }
      location.hash = `#/move/${res.id}`;
    }) }, '비켜줘 요청'),
  );
}

// ---------------- 요청 진행 화면 ----------------
const STEPS = ['요청', '차주 확인', '자가 점검', '이동', '복귀'];
function stepState(status) {
  const map = {
    VETO: [1], PRECHECK: [2], READY: [3], MOVING: [3], PAUSED: [3], TIDY: [3], MOVED: [4], RETURN_OVERDUE: [4], RETURNING: [4], RETURNED: [5],
    REJECTED: [1, true], DENIED: [1, true], CANCELLED: [1, true], INTERLOCK_FAILED: [2, true], ABORTED: [3, true], CONTACT_STOPPED: [3, true], EXPIRED: [3, true], RETURN_BLOCKED: [4, true],
  };
  const [now, fail] = map[status] || [0];
  return h('div', { class: 'stepper' }, STEPS.map((t, i) => {
    const cls = i < now ? 'done' : i === now ? (fail ? 'fail' : 'now') : '';
    return h('div', { class: `st ${cls}` }, h('span', { class: 'b' }, i < now ? '✓' : i === now && fail ? '!' : i + 1), t);
  }));
}

function renderMove(m) {
  clearInterval(S.tick);
  const it = m.items[m.cursor] || m.items[0];
  const isReq = m.isRequester;
  const head = h('div', { class: 'row between', style: 'margin:4px 0 6px' }, h('h1', { style: 'margin:0' }, '비켜줘'), pill(m.status));
  const body = h('div');
  const tl = h('ul', { class: 'timeline' }, [...m.timeline].reverse().slice(0, 6).map((e) => h('li', { class: e.kind }, h('time', {}, fmtTime(e.at).slice(0, 5)), e.text)));

  if (m.status === 'VETO') {
    const r = ring(m.vetoEndsAt, 30, '초');
    S.tick = setInterval(r.upd, 250);
    body.append(h('div', { class: 'card', style: 'text-align:center' },
      h('h2', { style: 'margin-bottom:0' }, isReq ? '차주에게 알렸어요' : '차주 확인 중'),
      r.el,
      h('p', { class: 'muted', style: 'margin:0 0 8px' }, '거부가 없으면 미리 허락한 조건대로 진행돼요'),
      isReq ? h('button', { class: 'ghost block', onclick: guard(() => api('POST', `/api/move-requests/${m.id}/cancel`)) }, '요청 취소') : null));
  } else if (m.status === 'PRECHECK') {
    body.append(h('div', { class: 'card', style: 'text-align:center' },
      h('div', { class: 'spinner' }),
      h('h2', {}, '차가 스스로 점검하고 있어요'),
      h('ul', { class: 'checks' }, ['충전 케이블', '문 · 트렁크', '실내 탑승자', '배터리 · 경사'].map((t) => h('li', {}, t)))));
  } else if (['READY', 'MOVING', 'PAUSED', 'RETURNING', 'TIDY'].includes(m.status) && isReq) {
    body.append(holdPanel(m, it));
  } else if (['MOVED', 'RETURN_OVERDUE'].includes(m.status) && isReq) {
    const left = h('b', {}, '');
    const upd = () => { const s = secLeft(m.returnDeadline); left.textContent = `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`; };
    upd();
    S.tick = setInterval(upd, 1000);
    body.append(h('div', { class: 'card' },
      h('div', { class: 'big-state ok' }, h('div', { class: 'em' }, '✓'), h('h2', {}, '길이 열렸어요'),
        h('p', {}, `${it.model || ''} ${m1(it.distance)}m 이동 · P 체결 완료. 차를 빼고 돌아와 복귀를 눌러 주세요`)),
      h('p', { class: 'muted', style: 'text-align:center' }, '복귀까지 남은 시간 ', left),
      h('button', { class: 'primary lg block', onclick: guard(async () => { const r = await api('POST', `/api/move-requests/${m.id}/return`); renderMove(r); }) }, '출차했어요 · 복귀 시작'),
    ));
  } else if (!isReq && ['READY', 'MOVING', 'PAUSED', 'MOVED', 'RETURNING'].includes(m.status)) {
    body.append(h('div', { class: 'card' }, h('div', { class: 'result info' }, h('span', { class: 'ico' }, '↔'),
      h('div', {}, `요청자가 차 옆에서 버튼을 누르는 동안만 움직여요 · 지금 ${m1(it.distance)}m`))));
  } else {
    const kind = m.status === 'RETURNED' ? 'ok' : ['CONTACT_STOPPED', 'ABORTED', 'INTERLOCK_FAILED'].includes(m.status) ? 'err' : 'warn';
    const last = m.timeline[m.timeline.length - 1];
    const TITLE = { RETURNED: '원위치로 돌아왔어요', INTERLOCK_FAILED: '차가 스스로 멈췄어요', REJECTED: '차주가 직접 처리해요', DENIED: '차주에게 연락할게요' };
    const EM = { ok: '✓', err: '🛡', warn: '📞' };
    body.append(h('div', { class: 'card' },
      h('div', { class: `big-state ${kind}` }, h('div', { class: 'em' }, EM[kind]), h('h2', {}, TITLE[m.status] || STATUS_TEXT[m.status]?.[0] || m.status), h('p', {}, last?.text || '')),
      m.fallback === 'contact' || ['REJECTED', 'INTERLOCK_FAILED'].includes(m.status) ? contactBox() : null,
      h('div', { class: 'grid2', style: 'margin-top:10px' },
        h('a', { class: 'btn', href: '#/records' }, '영상·기록'),
        h('button', { onclick: guard(async () => { await api('POST', '/api/disputes', { refType: 'move', refId: m.id, reason: '사용자 신고' }); toast('분쟁으로 접수했어요. 영상이 30일 보관돼요'); }) }, '분쟁 신고'))));
  }
  setView(head, stepState(m.status), body, h('div', { class: 'card' }, h('h2', {}, '기록'), tl));
}

/** 차량이 BLE로 잰 내 폰 위치. kind: move(차 옆 2m, 진로 밖) · trunk(트렁크 뒤 2m) · compact(차 밖 4m) */
function bleState(p, kind) {
  const d = p?.distanceM;
  if (!p || p.zone == null) return { ok: false, text: '차량이 BLE로 내 폰을 찾는 중이에요 · 차 가까이 와 주세요' };
  if (p.zone === 'far') return { ok: false, text: '차와 너무 멀어요 · 차 가까이 와 주세요' };
  if (kind === 'compact') {
    if (p.zone === 'inside') return { ok: false, text: '폰이 아직 차 안에 있어요 · 내려서 문을 닫아 주세요' };
    return d <= 4 ? { ok: true, text: `차 밖 ${m1(d)}m · 차량이 확인했어요` } : { ok: false, text: `차 밖 ${m1(d)}m · 4m 안으로 와 주세요` };
  }
  if (kind.startsWith('return')) {
    const path = kind === 'return-front' ? 'front' : 'rear';
    if (p.zone === 'inside') return { ok: false, text: '차 밖에서 눌러 주세요' };
    if (p.zone === path && d <= 4) return { ok: false, text: '복귀 경로에 있어요 · 비켜 주세요' };
    return d <= 6 ? { ok: true, text: `차에서 ${m1(d)}m · 복귀 경로 밖 · 차량이 확인했어요` } : { ok: false, text: `차에서 ${m1(d)}m · 6m 안으로 와 주세요` };
  }
  if (kind === 'trunk') {
    return ['rear', 'side'].includes(p.zone) && d <= 2 ? { ok: true, text: `${p.zone === 'rear' ? '트렁크 뒤' : '차 옆'} ${m1(d)}m · 차량이 확인했어요` } : { ok: false, text: '트렁크 뒤로 와 주세요' };
  }
  if (p.zone === 'front' || p.zone === 'rear') return { ok: false, text: `차 ${p.zone === 'front' ? '앞' : '뒤'} 진로에 서 있어요 · 옆으로 비켜 서 주세요` };
  if (p.zone === 'inside') return { ok: false, text: '폰이 차 안에 있어요' };
  return d <= 2 ? { ok: true, text: `차 옆 ${m1(d)}m · 진로 밖 · 차량이 확인했어요` } : { ok: false, text: `차 옆 ${m1(d)}m · 2m 안으로 와 주세요` };
}
/** 차를 위에서 본 그림: 허용 구역(초록), 진로(빨강), 차량이 잰 내 폰 위치 */
function bleMap(p, kind, ok) {
  const M = kind.startsWith('return') ? 7.5 : 15; // px per m
  const W = 300, H = 132, cx = W / 2, cy = H / 2, L = 4.6 * M, CW = 1.9 * M;
  const parts = [];
  const rect = (x, y, w, hh, fill, stroke, dash = '') => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  const G = 'rgba(16,185,129,0.14)', GS = 'rgba(16,185,129,0.6)', RD = 'rgba(239,68,68,0.10)', RS = 'rgba(239,68,68,0.45)';
  if (kind === 'move') {
    parts.push(rect(cx - L / 2, cy - CW / 2 - 2 * M, L, 2 * M, G, GS, '5 4'), rect(cx - L / 2, cy + CW / 2, L, 2 * M, G, GS, '5 4'));
    parts.push(rect(cx + L / 2 + 2, cy - CW / 2, 3 * M, CW, RD, RS, '5 4'), rect(cx - L / 2 - 2 - 3 * M, cy - CW / 2, 3 * M, CW, RD, RS, '5 4'));
    parts.push(`<text x="${cx + L / 2 + 6}" y="${cy + 4}" class="t r">진로</text><text x="${cx - L / 2 - 30}" y="${cy + 4}" class="t r">진로</text><text x="${cx}" y="${cy - CW / 2 - 2 * M + 11}" class="t g" text-anchor="middle">차 옆 2m</text>`);
  } else if (kind.startsWith('return')) {
    parts.push(`<rect x="${cx - L / 2 - 6 * M}" y="${cy - 6 * M}" width="${L + 12 * M}" height="${12 * M}" rx="${6 * M}" fill="rgba(16,185,129,0.08)" stroke="${GS}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    const back = kind === 'return-front' ? cx + L / 2 + 2 : cx - L / 2 - 2 - 4 * M;
    parts.push(rect(back, cy - CW / 2, 4 * M, CW, RD, RS, '5 4'));
    parts.push(`<text x="${back + 4}" y="${cy - CW / 2 - 4}" class="t r">복귀 경로</text><text x="${cx}" y="${cy - 6 * M + 12}" class="t g" text-anchor="middle">차에서 6m</text>`);
  } else if (kind === 'trunk') {
    parts.push(rect(cx - L / 2 - 2 - 2 * M, cy - CW / 2 - 6, 2 * M, CW + 12, G, GS, '5 4'));
    parts.push(`<text x="${cx - L / 2 - 2 * M + 2}" y="${cy - CW / 2 - 11}" class="t g">트렁크 뒤 2m</text>`);
  } else {
    parts.push(`<rect x="${cx - L / 2 - 4 * M}" y="${cy - 4 * M}" width="${L + 8 * M}" height="${8 * M}" rx="${4 * M}" fill="rgba(16,185,129,0.08)" stroke="${GS}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
  }
  // 차 (오른쪽이 앞)
  parts.push(`<rect x="${cx - L / 2}" y="${cy - CW / 2}" width="${L}" height="${CW}" rx="9" fill="#e5e7eb" stroke="#9ca3af" stroke-width="1.5"/><rect x="${cx + L / 2 - 20}" y="${cy - CW / 2 + 4}" width="9" height="${CW - 8}" rx="3" fill="#9ca3af"/><text x="${cx - 6}" y="${cy + 4}" class="t c" text-anchor="middle">차</text>`);
  // 내 폰
  if (p?.zone && p.zone !== 'far') {
    const d = Math.min(p.distanceM ?? 0, kind.startsWith('return') ? 7 : 4.2) * M;
    let x = cx, y = cy;
    if (p.zone === 'side') { x = cx - 8; y = cy + CW / 2 + d; }
    else if (p.zone === 'front') { x = cx + L / 2 + d; }
    else if (p.zone === 'rear') { x = cx - L / 2 - d; }
    else if (p.zone === 'inside') { x = cx - 14; }
    const col = ok ? '#10b981' : '#f59e0b';
    parts.push(`<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${col}" stroke-width="2" class="ping"/><circle cx="${x}" cy="${y}" r="7.5" fill="${col}" stroke="#fff" stroke-width="2.5"/><text x="${x + 12}" y="${y + 16}" class="t" fill="${col}" font-weight="800">나</text>`);
  }
  return h('div', { class: 'ble-map', html: `<svg viewBox="0 0 ${W} ${H}" width="100%">${parts.join('')}</svg>` });
}
function bleLine(p, kind) {
  const s = bleState(p, kind);
  return h('div', { class: `ble ${s.ok ? 'ok' : 'warn'}`, 'data-vid': p?.vehicleId || '', 'data-kind': kind },
    h('div', { class: 'ble-head' }, h('span', { class: 'ico' }, s.ok ? '✓' : '·'), h('b', {}, kind.startsWith('return') ? '차 안에서 복귀 · 차량이 BLE로 확인해요' : '차량이 BLE로 내 위치를 확인해요'), h('span', { class: 'chip' }, s.ok ? '확인됨' : '확인 중')),
    bleMap(p, kind, s.ok),
    h('div', { class: 'ble-tx' }, s.text));
}

function holdPanel(m, it) {
  const mode = m.status === 'RETURNING' ? 'return' : m.status === 'TIDY' ? 'tidy' : 'move';
  const max = mode === 'return' ? it.distance : mode === 'tidy' ? 1 : it.maxMeters;
  const cur = mode === 'return' ? it.returned : it.distance;
  const pct = max ? Math.min(1, (cur || 0) / max) : 0;
  const btn = h('button', { class: S.holdTimer ? 'hold active' : 'hold' },
    h('b', {}, `${m1(cur)}m`), h('span', {}, mode === 'return' ? '누르는 동안 복귀' : mode === 'tidy' ? '누르는 동안 정리' : '누르는 동안 이동'));
  const start = (e) => {
    e.preventDefault();
    btn.classList.add('active');
    // 내 위치는 차량이 BLE로 확인한다. 범위를 벗어나면 서버가 거절하고 차는 멈춘다
    const send = () => api('POST', `/api/move-requests/${m.id}/hold`).catch((err) => { toast(err.message); stopHold(); });
    send();
    clearInterval(S.holdTimer);
    S.holdTimer = setInterval(send, 300);
    S.holdRelease = `/api/move-requests/${m.id}/release`;
  };
  const end = () => { if (S.holdTimer) { btn.classList.remove('active'); stopHold(); } };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('pointerleave', end);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  const R = 98;
  const C = 2 * Math.PI * R;
  const wrap = h('div', { class: 'hold-wrap', html: `<svg viewBox="0 0 210 210"><defs><linearGradient id="hold-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6bff"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs><circle class="bg" cx="105" cy="105" r="${R}"/><circle class="fg" cx="105" cy="105" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>` });
  wrap.append(btn);
  return h('div', { class: 'card' },
    h('div', { class: 'car-head' }, h('div', { class: 'car-ava' }, CAR_EMOJI(it.model)),
      h('div', { class: 'grow' }, h('div', { class: 'nm' }, it.model || ''), h('div', { class: 'sub' }, h('span', { class: 'plate' }, it.plate), ' ', mode === 'return' ? '원위치로' : it.direction === 'forward' ? '앞으로' : '뒤로'))),
    bleLine(it.proximity ? { ...it.proximity, vehicleId: it.vehicleId } : { vehicleId: it.vehicleId }, mode === 'return' ? (it.direction === 'forward' ? 'return-rear' : 'return-front') : 'move'),
    mode === 'tidy' ? h('div', { class: 'grid2' },
      h('button', { onclick: guard(() => api('POST', `/api/move-requests/${m.id}/tidy-direction`, { direction: 'forward' })) }, '앞으로 정리'),
      h('button', { onclick: guard(() => api('POST', `/api/move-requests/${m.id}/tidy-direction`, { direction: 'backward' })) }, '뒤로 정리')) : null,
    wrap,
    h('div', { class: 'hold-meta' }, h('span', {}, '보행 속도'), h('span', {}, `최대 ${m1(max)}m`), h('span', {}, '손 떼면 즉시 정지')),
    mode !== 'return' ? h('button', { class: 'link block', onclick: guard(() => api('POST', `/api/move-requests/${m.id}/finish`)) }, '충분히 비켰어요 · 여기서 멈춤') : null,
  );
}

function stopHold() {
  if (S.holdTimer) {
    clearInterval(S.holdTimer);
    S.holdTimer = null;
    if (S.holdRelease) api('POST', S.holdRelease).catch(() => {});
  }
}

// ---------------- 트렁크 드롭 ----------------
function renderTrunk() {
  const { vehicles, trunks } = S.me;
  const mineAsOwner = trunks.filter((t) => t.isOwner);
  const forMe = trunks.filter((t) => t.isGiver);
  const vSel = h('select', {}, vehicles.map((v) => h('option', { value: v.id }, `${v.model} ${v.plate}`)));
  const giver = h('input', { placeholder: '상대 닉네임 (예: 수진)' });
  const note = h('input', { placeholder: '메모 (예: 유모차)' });
  const valuables = h('input', { type: 'checkbox' });
  const purpose = S.trunkPurpose || 'drop';
  const PURPOSE = {
    drop: ['넣어 주세요', '당근 거래 물건 · 대신 받아 준 택배를 이웃이 내 트렁크에 넣어요', '물건을 넣을 이웃'],
    pickup: ['꺼내 가세요', '빌려준 공구 · 팔기로 한 물건을 이웃이 내 트렁크에서 꺼내 가요', '물건을 꺼내 갈 이웃'],
  };
  const pick = (p) => () => { S.trunkPurpose = p; S.trunkDraft = { giver: giver.value, note: note.value, valuables: valuables.checked }; renderTrunk(); };
  if (S.trunkDraft) { giver.value = S.trunkDraft.giver; note.value = S.trunkDraft.note; valuables.checked = S.trunkDraft.valuables; S.trunkDraft = null; }
  const issue = guard(async () => {
    await api('POST', '/api/trunk-tokens', { vehicleId: vSel.value, giverNickname: giver.value.trim(), note: note.value, valuablesRemoved: valuables.checked, purpose });
    toast('트렁크 1회 개방 토큰을 보냈어요 (10분)');
    route();
  });
  const activeOwner = mineAsOwner.filter((t) => ['issued', 'opening', 'open', 'unclosed', 'completed'].includes(t.status)).slice(0, 2);
  setView(
    h('div', { class: 'hero' }, h('div', { class: 'eyebrow' }, '트렁크 드롭'),
      h('h1', {}, forMe.length ? (forMe[0].purpose === 'pickup' ? '이웃 트렁크에서 꺼내 가세요' : '이웃 트렁크에 넣어 주세요') : '집에 없어도 주고받아요'),
      h('p', {}, '넣어 주기도, 꺼내 가기도 돼요. 테일게이트만 열리고 실내 도어는 잠긴 채, 열고 닫는 순간 전후 영상이 남아요.')),
    forMe.length ? forMe.slice(0, 2).map(giverItem) : null,
    activeOwner.length ? h('div', { class: 'card' }, h('h2', {}, '보낸 토큰'), h('ul', { class: 'list' }, activeOwner.map(ownerItem))) : null,
    vehicles.length && !forMe.length && !activeOwner.some((t) => t.status !== 'completed') ? h('div', { class: 'card' },
      h('h2', {}, '내 트렁크 열어 주기'),
      h('div', { class: 'seg purpose' }, Object.entries(PURPOSE).map(([k, [t]]) => h('button', { class: purpose === k ? 'on' : '', onclick: pick(k) }, t))),
      h('p', { class: 'muted small', style: 'margin:6px 2px 10px' }, PURPOSE[purpose][1]),
      h('label', { class: 'field' }, h('span', {}, '내 차'), vSel),
      h('label', { class: 'field' }, h('span', {}, `${PURPOSE[purpose][2]} (지정한 계정만 열 수 있어요)`), giver),
      h('label', { class: 'field' }, h('span', {}, '메모'), note),
      h('label', { class: 'check' }, valuables, h('span', { class: 'lbl' }, '트렁크 안 귀중품을 꺼냈어요', h('small', {}, '현금·귀중품·상하는 식품·위험물은 넣을 수 없어요'))),
      h('button', { class: 'primary lg block', style: 'margin-top:8px', onclick: issue }, '1회 개방 토큰 보내기'),
    ) : null,
  );
  S.tick = setInterval(() => document.querySelectorAll('[data-exp]').forEach((el) => {
    const s = secLeft(Number(el.dataset.exp));
    el.textContent = s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} 남음` : '만료';
  }), 1000);
}

const TRUNK_TEXT = { issued: '대기', opening: '여는 중', open: '열림', completed: '전달 완료', expired: '만료', cancelled: '취소', unclosed: '닫힘 미감지' };
const TRUNK_KIND = { issued: 'info', opening: 'info', open: 'warn', completed: 'ok', unclosed: 'err' };

function giverItem(t) {
  const head = h('div', { class: 'car-head' }, h('div', { class: 'car-ava' }, '📦'),
    h('div', { class: 'grow' }, h('div', { class: 'nm' }, `${t.owner.nickname}님의 ${t.vehicle.model}`), h('div', { class: 'sub' }, h('span', { class: 'plate' }, t.vehicle.plate), ' ', t.vehicle.zone || '')),
    h('span', { class: `pill ${TRUNK_KIND[t.status] || ''}` }, TRUNK_TEXT[t.status]));
  if (t.status === 'issued') {
    return h('div', { class: 'card' }, head,
      h('div', { class: 'chips' }, h('span', { class: 'pill ok plain' }, t.purpose === 'pickup' ? '꺼내 가기' : '넣어 주기'), t.note ? h('span', { class: 'pill plain' }, `📝 ${t.note}`) : null, t.firstTrade ? h('span', { class: 'pill warn' }, '첫 거래') : null, h('span', { class: 'pill info plain', 'data-exp': t.expiresAt }, '')),
      t.warnings.length ? h('p', { class: 'muted small' }, t.warnings.join(' · ')) : null,
      bleLine(t.proximity ? { ...t.proximity, vehicleId: t.vehicle?.id } : { vehicleId: t.vehicle?.id }, 'trunk'),
      h('button', { class: 'primary lg block', style: 'margin-top:6px', onclick: guard(async () => { await api('POST', `/api/trunk-tokens/${t.id}/open`); toast('트렁크를 여는 중이에요'); }) }, '트렁크 열기'));
  }
  if (['opening', 'open'].includes(t.status)) {
    return h('div', { class: 'card' }, head, h('div', { class: 'big-state ok' }, h('div', { class: 'em' }, '⬆'), h('h2', {}, '트렁크가 열렸어요'), h('p', {}, t.purpose === 'pickup' ? '물건을 꺼내고 트렁크를 닫아 주세요. 닫으면 차주에게 "물건을 가져갔어요"가 가요.' : '물건을 넣고 트렁크를 닫아 주세요. 닫으면 차주에게 "물건이 도착했어요"가 가요.')));
  }
  if (t.status === 'completed') {
    return h('div', { class: 'card' }, head, h('div', { class: 'big-state ok' }, h('div', { class: 'em' }, '✓'), h('h2', {}, '전달 완료'), h('p', {}, '닫힘이 확인됐어요. 개폐 기록과 전후 영상이 양쪽에 남아요.')));
  }
  return h('div', { class: 'card' }, head);
}

function ownerItem(t) {
  return h('li', { class: 'row between nowrap' },
    h('div', { class: 'grow' }, h('b', {}, `${t.giver.nickname}님 → ${t.vehicle.plate}`), h('div', { class: 'muted small' }, t.purpose === 'pickup' ? '꺼내 가기 · ' : '넣어 주기 · ', t.note || '', t.status === 'issued' ? h('span', { 'data-exp': t.expiresAt, style: 'margin-left:6px' }) : '')),
    h('span', { class: `pill ${TRUNK_KIND[t.status] || ''}` }, TRUNK_TEXT[t.status]),
    t.status === 'issued' ? h('button', { class: 'ghost', onclick: guard(async () => { await api('POST', `/api/trunk-tokens/${t.id}/cancel`); route(); }) }, '취소') : null,
  );
}

// ---------------- 밀착 구역 (확장 기능) ----------------
async function renderCompact() {
  S.compact = await api('GET', '/api/compact');
  drawCompact();
}

const COMPACT_STEPS = ['빈 칸 안내', '칸 앞에 정차', '내려서 누르기', '완료'];
function drawCompact() {
  if (!S.compact || !location.hash.startsWith('#/compact')) return;
  const { zone, vehicles, session: s } = S.compact;
  const v = vehicles.find((x) => x.id === s?.vehicleId) || vehicles.find((x) => x.eligible && x.inComplex && !x.parkedAt) || vehicles.find((x) => x.eligible) || vehicles[0];
  const live = s && ['guide', 'ready', 'moving', 'paused'].includes(s.status);
  if (!live && S.holdTimer) stopHold(); // 다 들어가면 누르기 신호를 멈춘다
  const step = !s ? 0 : { guide: 0, ready: 2, moving: 2, paused: 2, parked: 4 }[s.status] ?? 0;
  const stepper = h('div', { class: 'stepper' }, COMPACT_STEPS.map((t, i) => {
    const cls = i < step ? 'done' : i === step ? 'now' : '';
    return h('div', { class: `st ${cls}` }, h('span', { class: 'b' }, i < step ? '✓' : i + 1), t);
  }));
  const slots = h('div', { class: 'cslots' }, (zone?.slots || []).map((x) => {
    const mine = s && x.id === s.spotId;
    const cls = mine ? (s.status === 'parked' ? 'mine done' : 'mine') : x.taken ? 'taken' : '';
    return h('div', { class: `cslot ${cls}` }, h('span', {}, x.id.split('-').pop()), mine ? (s.status === 'parked' ? '🚘' : '여기') : x.taken ? '🚗' : '빈 칸');
  }));
  const zoneCard = zone ? h('div', { class: 'card' },
    h('div', { class: 'row between nowrap' }, h('h2', { style: 'margin:0' }, `B2 ${zone.name}`), h('span', { class: 'pill info' }, `빈 칸 ${zone.free}`)),
    slots,
    h('div', { class: 'chips' }, h('span', { class: 'pill plain' }, '칸 폭 2.2m · 일반 2.5m'), h('span', { class: 'pill ok plain' }, `같은 폭에 ${zone.normalEquivalent}대 → ${zone.total}대`))) : null;
  let body;
  if (s && s.status === 'parked') {
    body = h('div', { class: 'card' }, h('div', { class: 'big-state ok' }, h('div', { class: 'em' }, '✓'), h('h2', {}, '밀착 주차 완료'),
      h('p', {}, `${s.label}에 문 열 간격 없이 세웠어요. 나갈 때도 버튼을 누르는 동안 차가 칸에서 나와요.`)));
  } else if (s && s.status === 'guide') {
    body = h('div', { class: 'card' },
      h('div', { class: 'result info' }, h('span', { class: 'ico' }, '→'), h('div', {}, h('b', {}, `${s.label} 앞에 세워 주세요`), h('div', { class: 'small' }, '입차 순서대로 안쪽 칸부터 채워요 · 칸 앞 통로에 바로 세우면 돼요'))),
      h('button', { class: 'primary lg block', style: 'margin-top:10px', onclick: guard(async () => { S.compact.session = await api('POST', `/api/compact/${s.id}/front`); drawCompact(); }) }, '칸 앞에 세웠어요'));
  } else if (live) {
    body = compactHold(s, v);
  } else {
    const ok = v && v.eligible && v.inComplex && !v.parkedAt;
    body = h('div', { class: 'card' },
      v ? h('div', { class: 'car-head' }, h('div', { class: 'car-ava' }, CAR_EMOJI(v.model)),
        h('div', { class: 'grow' }, h('div', { class: 'nm' }, v.model), h('div', { class: 'sub' }, h('span', { class: 'plate' }, v.plate), ' ', v.inComplex ? '단지 안' : '단지 밖')),
        h('span', { class: `pill ${v.eligible ? 'ok' : 'warn'}` }, v.eligible ? '비켜줘 ON' : '비켜줘 OFF')) : h('p', { class: 'muted' }, '등록된 차가 없어요'),
      h('p', { class: 'muted small' }, '원격 비켜줘를 켠 차끼리는 문 열 공간이 필요 없어요. 내려서 버튼을 누르는 동안만 차가 칸으로 들어가요.'),
      h('button', { class: 'primary lg block', disabled: !ok, onclick: guard(async () => { S.compact.session = await api('POST', '/api/compact', { vehicleId: v.id }); renderCompact(); }) }, '빈 칸 안내 받기'));
  }
  setView(
    h('div', { class: 'hero' }, h('div', { class: 'eyebrow' }, '밀착 구역 · 확장 기능'), h('h1', {}, '문 열 공간 없이,\n한 칸 더'),
      h('p', {}, '관리사무소가 지정한 자투리 공간에, 원격 비켜줘를 켠 차만 나란히 세워요.')),
    stepper, zoneCard, body);
}

function compactHold(s, v) {
  const pct = s.total ? Math.min(1, s.distance / s.total) : 0;
  const btn = h('button', { class: S.holdTimer ? 'hold active' : 'hold' }, h('b', {}, `${m1(s.distance)}m`), h('span', {}, '누르는 동안 칸으로'));
  const start = (e) => {
    e.preventDefault();
    btn.classList.add('active');
    // 내렸는지는 차량이 확인: 폰 위치(BLE)가 차 밖 + 착석 센서 비어 있음
    const send = () => api('POST', `/api/compact/${s.id}/hold`).catch((err) => { toast(err.message); stopHold(); });
    send();
    clearInterval(S.holdTimer);
    S.holdTimer = setInterval(send, 300);
    S.holdRelease = `/api/compact/${s.id}/release`;
  };
  const end = () => { if (S.holdTimer) { btn.classList.remove('active'); stopHold(); } };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('pointerleave', end);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  const R = 98;
  const C = 2 * Math.PI * R;
  const wrap = h('div', { class: 'hold-wrap', html: `<svg viewBox="0 0 210 210"><defs><linearGradient id="hold-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6bff"/><stop offset="1" stop-color="#00c2e0"/></linearGradient></defs><circle class="bg" cx="105" cy="105" r="${R}"/><circle class="fg" cx="105" cy="105" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>` });
  wrap.append(btn);
  return h('div', { class: 'card' },
    h('div', { class: 'car-head' }, h('div', { class: 'car-ava' }, CAR_EMOJI(v?.model)),
      h('div', { class: 'grow' }, h('div', { class: 'nm' }, s.model), h('div', { class: 'sub' }, h('span', { class: 'plate' }, s.plate), ' ', `${s.label}으로 전진`)),
      s.status === 'paused' ? h('span', { class: 'pill warn' }, '일시 정지') : null),
    bleLine(s.proximity ? { ...s.proximity, vehicleId: s.vehicleId } : { vehicleId: s.vehicleId }, 'compact'),
    h('p', { class: 'muted small', style: 'margin:6px 2px 0' }, '실내에 사람이 있으면 차가 움직이지 않아요 · 착석 센서로 확인'),
    wrap,
    h('div', { class: 'hold-meta' }, h('span', {}, '보행 속도'), h('span', {}, `${m1(s.total)}m 전진`), h('span', {}, '손 떼면 즉시 정지')));
}

// ---------------- 기록 ----------------
async function renderRecords() {
  const { moves, trunks } = S.me;
  const clipList = (refId) => {
    const box = h('div', { class: 'muted small' }, '영상 불러오는 중…');
    api('GET', `/api/clips?refId=${refId}`).then((cs) => box.replaceChildren(cs.length
      ? h('div', {}, cs.map((c) => h('div', {}, `🎥 ${c.kind === 'pre' ? '실행 전' : '실행 후'} ${c.durationSec}초 · ${c.camera === 'rear' ? '후방' : '서라운드'} 카메라 · ${fmtTime(c.recordedAt)} · ${c.disputeId ? '분쟁 보관(30일)' : `${Math.round((c.expiresAt - Date.now()) / 3600000)}시간 뒤 삭제`}`)))
      : '영상 없음'));
    return box;
  };
  setView(
    h('div', { class: 'hero' }, h('div', { class: 'eyebrow' }, '기록'), h('h1', {}, '누가 · 언제 · 무엇을'),
      h('p', {}, '실행 전후 각 10초 영상이 차주와 요청자 양쪽에 남아요. 상시 녹화는 하지 않고, 72시간 뒤 자동 삭제돼요.')),
    h('div', { class: 'card' }, h('h2', {}, '비켜줘'), moves.length ? h('ul', { class: 'list' }, moves.map((m) => h('li', {},
      h('div', { class: 'row between' }, h('a', { href: `#/move/${m.id}`, style: 'font-weight:700' }, m.items.map((i) => i.plate).join(' → ') || m.timeline[0]?.text), pill(m.status)),
      h('div', { class: 'muted small' }, fmtTime(m.createdAt), ' · ', m.isRequester ? '내가 요청' : `${m.requester?.dong}동 ${m.requester?.nickname} 요청`),
      m.items.length ? clipList(m.id) : null))) : h('p', { class: 'muted' }, '기록이 없어요')),
    h('div', { class: 'card' }, h('h2', {}, '트렁크 드롭'), trunks.length ? h('ul', { class: 'list' }, trunks.map((t) => h('li', {},
      h('div', { class: 'row between' }, h('span', { style: 'font-weight:700' }, `${t.giver.nickname} → ${t.owner.nickname} (${t.vehicle.plate})`), h('span', { class: `pill ${TRUNK_KIND[t.status] || ''}` }, TRUNK_TEXT[t.status])),
      t.openedAt ? h('div', { class: 'muted small' }, `열림 ${fmtTime(t.openedAt)}${t.closedAt ? ` · 닫힘 ${fmtTime(t.closedAt)}` : ''}`) : null,
      clipList(t.id),
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', { onclick: guard(async () => { await api('POST', '/api/disputes', { refType: 'trunk', refId: t.id, reason: '사용자 신고' }); toast('분쟁으로 접수했어요'); }) }, '분쟁 신고'),
        h('button', { onclick: guard(async () => { await api('POST', '/api/reports', { targetUserId: t.isOwner ? t.giver.id : t.owner.id, reason: 'trunk' }); toast('신고했어요'); }) }, '상대 신고'))))) : h('p', { class: 'muted' }, '기록이 없어요')),
  );
}

// ---------------- 관리사무소 ----------------
async function renderOffice() {
  const stats = await api('GET', '/api/office/stats').catch((e) => ({ error: e.message }));
  if (stats.error) return setView(h('p', {}, stats.error));
  const disputes = await api('GET', '/api/disputes');
  setView(
    h('div', { class: 'hero' }, h('div', { class: 'eyebrow' }, '관리사무소'), h('h1', {}, '단지 운영 현황'),
      h('p', {}, '개인을 알아볼 수 없는 단지 단위 통계와, 분쟁이 접수된 건의 기록만 볼 수 있어요.')),
    h('div', { class: 'grid3' },
      h('div', { class: 'card' }, h('div', { class: 'muted' }, '위임 참여 차량'), h('div', { class: 'big' }, stats.participatingVehicles)),
      h('div', { class: 'card' }, h('div', { class: 'muted' }, '출차 신호'), h('div', { class: 'big' }, stats.vacancySignals)),
      h('div', { class: 'card' }, h('div', { class: 'muted' }, '열린 분쟁'), h('div', { class: 'big' }, stats.openDisputes))),
    h('div', { class: 'card' }, h('h2', {}, '일자별 비켜줘'), h('ul', { class: 'list' }, Object.entries(stats.moveRequestsByDay).map(([d, s]) => h('li', {}, `${d} · 요청 ${s.requests} · 해결 ${s.resolved} · 연락 전환 ${s.contactFallback}`)))),
    h('div', { class: 'card' }, h('h2', {}, '분쟁'), disputes.length ? h('ul', { class: 'list' }, disputes.map((d) => h('li', {}, `${fmtTime(d.createdAt)} · ${d.refType} · ${d.reason}${d.auto ? ' (자동 접수)' : ''}`))) : h('p', { class: 'muted' }, '없음')),
  );
}

// ---------------- 데모 콘솔 ----------------
const LOG_TEXT = {
  'vacancy.created': (l) => `출차 신호 · ${l.spotId} 자리가 '방금 빈 자리'로 공유됐어요${l.witnesses ? ` · 옆 차 ${l.witnesses}대 확인` : ''}`,
  'vacancy.offered': () => '들어오는 차에 빈자리를 음성으로 안내했어요',
  'vacancy.accepted': () => "운전자가 '갈게요'로 답했어요 · 내비 경로 안내",
  'vacancy.parked': () => '주차 완료 · 차량 화면이 비켜줘를 켤지 물어요',
  'vacancy.arrived': () => '입차 게이트 통과 (지오펜스 진입)',
  'trunk.issued': () => '트렁크 1회 개방 토큰 발급 (10분)',
  'trunk.completed': () => '트렁크가 닫혔어요 · 차주에게 알림과 전후 영상',
  'compact.guided': () => '밀착 구역 빈 칸 안내 (입차 순서대로)',
  'compact.front': () => '칸 앞에 정차 · 내려서 버튼을 누르면 들어가요',
  'compact.parked': () => '밀착 주차 완료 · 문 열 간격 없이',
  'neutral.checked': (l) => (l.neutral ? '중립 확인 · "평지에서 천천히 밀어주세요"' : '번호판 확인 · P로 잠긴 차, 비켜줘 요청 가능'),
  'policy.updated': () => '차주가 위임 조건을 바꿨어요',
  'vehicle.app.connected': () => '차량 앱(Pleos Connect)이 연결됐어요',
};

function latestCaption(snap) {
  const cands = [];
  for (const m of snap.moves) {
    const t = m.timeline[m.timeline.length - 1];
    if (t) cands.push({ at: t.at, text: t.text, kind: t.kind });
  }
  for (const l of snap.logs) if (LOG_TEXT[l.kind]) cands.push({ at: l.at, text: LOG_TEXT[l.kind](l), kind: 'info' });
  cands.sort((a, b) => b.at - a.at);
  return cands[0] || { text: '대기 중', kind: 'info', at: snap.now };
}

// 관리자 스트림을 받아 지도를 다시 그린다 (데모 콘솔 · 스테이지 · 스튜디오 공용)
function watchSnapshot(onSnap, mapBox, stage) {
  let pending = false;
  let last = null;
  const refresh = () => {
    if (pending) return;
    pending = true;
    setTimeout(async () => {
      pending = false;
      try { last = await api('GET', '/api/admin/snapshot'); onSnap(last); } catch { /* 서버 재시작 중 */ }
    }, 120);
  };
  refresh();
  if (S.adminEs) S.adminEs.close();
  S.adminEs = new EventSource('/api/admin/stream');
  for (const t of ['vehicle.state', 'move', 'vacancy', 'trunk', 'compact', 'log', 'reset', 'proximity']) S.adminEs.addEventListener(t, refresh);
  // 거부 창 초 카운트다운
  clearInterval(S.tick);
  S.tick = setInterval(() => { if (last && last.moves.some((m) => m.status === 'VETO')) { last.now += 1000; renderParkingMap(mapBox, last, { stage }); } }, 1000);
  window.addEventListener('hashchange', () => {
    if (!/^#\/(demo|stage|studio)/.test(location.hash) && S.adminEs) { S.adminEs.close(); S.adminEs = null; }
    document.body.classList.remove('stage-mode', 'studio-mode');
  }, { once: true });
  return refresh;
}

async function renderDemo(stage = false) {
  const mapBox = h('div', { class: stage ? 'stage-map' : 'map-box' });
  const caption = h('div', { class: 'stage-caption' });
  const moves = h('div', { class: 'card' });
  const logBox = h('div', { class: 'log' });
  const ctl = h('div');
  if (stage) {
    document.body.classList.add('stage-mode');
    setView(h('div', { class: 'stage' }, mapBox, caption));
  } else {
    document.body.classList.remove('stage-mode');
    setView(
      h('div', { class: 'row between' }, h('h1', {}, '데모 콘솔 · 지하주차장 시뮬레이터'),
        h('div', { class: 'row' },
          ...['usr_jieun', 'usr_minsu', 'usr_hyunwoo', 'usr_sujin', 'usr_harin'].map((u) => h('a', { class: 'btn', href: `/?as=${u}#/home`, target: '_blank' }, `${{ usr_jieun: '지은', usr_minsu: '민수', usr_hyunwoo: '현우', usr_sujin: '수진', usr_harin: '하린' }[u]} 폰`)),
          h('a', { class: 'btn', href: '/#/studio', target: '_blank' }, '영상 스튜디오'),
          h('button', { class: 'danger', onclick: guard(async () => { await api('POST', '/api/sim/reset'); toast('초기 상태로 되돌렸어요'); }) }, '초기화'))),
      h('p', { class: 'muted' }, 'Pleos Connect 차량 앱이 연결되지 않은 차는 서버의 가상 차량이 같은 규칙으로 대신 움직여요. 오른쪽 버튼으로 충전 케이블·탑승자·장애물 같은 상황을 만들 수 있어요.'),
      h('div', { class: 'demo' },
        h('div', {}, mapBox, caption, h('h3', {}, '최근 요청'), moves, h('h3', {}, '이벤트 로그'), logBox),
        ctl),
    );
  }
  watchSnapshot((snap) => {
    renderParkingMap(mapBox, snap, { stage });
    const cap = latestCaption(snap);
    caption.className = `stage-caption ${cap.kind || ''}`;
    caption.replaceChildren(h('time', {}, fmtTime(cap.at)), h('span', {}, cap.text));
    if (stage) return;
    moves.replaceChildren(h('ul', { class: 'list' }, snap.moves.slice(0, 6).map((m) => h('li', { class: 'row between' },
      h('span', {}, `${m.requester?.nickname || ''} → ${m.items.map((i) => `${i.plate}(${i.distance}m)`).join(', ') || m.timeline[0]?.text}`),
      pill(m.status)))));
    logBox.replaceChildren(...snap.logs.map((l) => {
      const rest = Object.fromEntries(Object.entries(l).filter(([k]) => !['id', 'kind', 'at'].includes(k)));
      return h('div', {}, `${fmtTime(l.at)}  ${l.kind}  ${JSON.stringify(rest)}`);
    }));
    ctl.replaceChildren(...demoSidebar(snap));
  }, mapBox, stage);
}

// ---------------- 데모 콘솔 · 차량 조작 패널 ----------------
const CAR_DOT = { '12가3456': '#d7dbe0', '34나5678': '#3b5bdb', '56다7890': '#1c1d21', '90마3344': '#f2c94c', '78라1122': '#b3332e', '23버4567': '#3aa6a0', '45서6789': '#ebe7df', '31거2233': '#35584d', '52너3344': '#7a2e3a', '17더4455': '#d27a35', '64러5566': '#5468d4' };
S.openCars = S.openCars || new Set(['veh_ioniq5']);

function demoSidebar(snap) {
  const c = snap.complexes[0];
  const byPlate = (p) => snap.vehicles.find((v) => v.plate === p);
  const sim = (v, patch) => api('POST', `/api/sim/vehicles/${v.id}/state`, patch);
  const scene = (label, desc, fn) => h('button', { class: 'scene', onclick: guard(fn) }, h('b', {}, label), h('span', {}, desc));
  const scenes = h('div', { class: 'card side-card' },
    h('div', { class: 'side-title' }, '빠른 장면'),
    h('div', { class: 'scenes' },
      scene('🚗 쏘렌토 입차', '게이트 통과 · 빈자리 안내 받을 차', () => sim(byPlate('34나5678'), { inComplex: true, gear: 'D' })),
      scene('🅿 그랜저 출차', '출차 신호 → 방금 빈 자리', async () => {
        const g = byPlate('56다7890');
        await sim(g, { gear: 'D' });
        setTimeout(() => sim(g, { inComplex: false }).catch(() => {}), 1500);
      }),
      scene('🚘 EV6 입차', '하린 씨 · 밀착 구역으로 안내받을 차', () => sim(byPlate('64러5566'), { inComplex: true, gear: 'D' })),
      scene('↺ 처음 상태로', '모든 차·요청·크레딧 초기화', async () => { await api('POST', '/api/sim/reset'); toast('초기 상태로 되돌렸어요'); }),
    ),
  );
  const order = (v) => (v.activeMoveId ? 0 : v.state.inComplex ? 1 : 2);
  const cars = [...snap.vehicles].sort((a, b) => order(a) - order(b));
  return [scenes, ...cars.map((v) => vehicleCtl(v, c, snap))];
}

function vehicleCtl(v, c, snap) {
  const st = v.state;
  const set = (patch) => guard(() => api('POST', `/api/sim/vehicles/${v.id}/state`, patch));
  const owner = snap.users.find((u) => u.id === v.ownerId);
  const zone = st.inComplex ? (c.zones.find((z) => z.id === st.zoneId)?.name || '단지 안') : '단지 밖';
  const anyOcc = Object.values(st.occupied || {}).some(Boolean);
  const anyDoor = ['ROW_1_LEFT', 'ROW_1_RIGHT', 'ROW_2_LEFT', 'ROW_2_RIGHT'].some((k) => st.doors?.[k]);
  const move = snap.moves.find((m) => m.items.some((i) => i.vehicleId === v.id) && !DONE.includes(m.status));
  const open = S.openCars.has(v.id) || !!move || !!st.doors?.REAR;

  const seg = (opts, cur, onPick) => h('div', { class: 'seg' }, opts.map(([val, label]) =>
    h('button', { class: cur === val ? 'on' : '', onclick: onPick(val) }, label)));
  const toggle = (icon, label, on, patch, kind = 'warn') =>
    h('button', { class: `tog ${on ? `on ${kind}` : ''}`, onclick: set(patch) }, h('span', { class: 'ico' }, icon), label);

  const summary = h('div', { class: 'vc-head', onclick: () => { if (S.openCars.has(v.id)) S.openCars.delete(v.id); else S.openCars.add(v.id); details.classList.toggle('open'); } },
    h('span', { class: 'dot', style: `background:${CAR_DOT[v.plate] || '#94a3b8'}` }),
    h('div', { class: 'vc-name' },
      h('div', {}, h('b', {}, v.model), ' ', h('span', { class: 'plate' }, v.plate)),
      h('div', { class: 'muted small' }, `${owner ? `차주 ${owner.nickname}` : ''}${v.hasRspa ? ' · 원격 전·후진' : ' · 중립 표시로 참여'}`)),
    h('span', { class: `pill ${v.appConnected ? 'ok' : ''}` }, v.appConnected ? '차량 앱' : '가상 차량'),
    h('span', { class: 'chev' }, '▾'),
  );
  const chips = h('div', { class: 'vc-chips' },
    h('span', { class: `chip ${['D', 'R'].includes(st.gear) ? 'warn' : ''}` }, `기어 ${st.gear}`),
    h('span', { class: 'chip' }, zone),
    st.soc != null ? h('span', { class: 'chip' }, `🔋 ${st.soc}%`) : null,
    st.neutral ? h('span', { class: 'chip ok' }, 'N 밀어도 돼요') : null,
    v.policy?.enabled && v.policy?.functions?.move ? h('span', { class: 'chip info' }, '비켜줘 ON') : null,
    Math.abs(st.offsetM || 0) > 0.01 ? h('span', { class: 'chip ok' }, `이동 ${st.offsetM > 0 ? '+' : ''}${st.offsetM}m`) : null,
    move ? pill(move.status) : null,
  );

  const body = h('div', { class: 'vc-body' });
  if (v.appConnected) {
    body.append(h('p', { class: 'hint' }, '차량 앱이 실제 차량 신호(Vehicle SDK)를 보내고 있어요. 기어·문·좌석은 Pleos Virtual Console에서, 원격 이동 상황은 차량 앱의 데모 탭에서 바꿔 주세요.'));
  } else {
    body.append(
      h('div', { class: 'vc-row' }, h('label', {}, '기어'), seg([['P', 'P'], ['N', 'N'], ['D', 'D'], ['R', 'R']], st.gear, (g) => set({ gear: g }))),
      h('div', { class: 'vc-row' }, h('label', {}, '위치'), seg([[true, '단지 안'], [false, '단지 밖']], !!st.inComplex, (b) => set({ inComplex: b }))),
      h('div', { class: 'vc-row top' }, h('label', {}, '차량 센서'),
        h('div', { class: 'togs' },
          toggle('⚡', '충전 중', st.charging, { charging: !st.charging }, 'info'),
          toggle('🧍', '뒷좌석 탑승', anyOcc, { occupied: { ROW_1_LEFT: false, ROW_1_RIGHT: false, ROW_2_LEFT: false, ROW_2_RIGHT: !anyOcc } }),
          toggle('🚪', '문 열림', anyDoor, { doors: { ROW_1_LEFT: anyDoor ? 0 : 1, ROW_1_RIGHT: 0, ROW_2_LEFT: 0, ROW_2_RIGHT: 0 } }),
          toggle('🔌', '12V 저전압', st.lowVoltage12v, { lowVoltage12v: !st.lowVoltage12v }, 'err'),
        )),
    );
    if (v.hasRspa) {
      body.append(h('div', { class: 'vc-row top' }, h('label', {}, '원격 이동 상황'),
        h('div', { class: 'togs' },
          toggle('🚧', '진로 장애물', st.obstacle, { obstacle: !st.obstacle }),
          toggle('💥', '이동 중 접촉', st.contact, { contact: !st.contact }, 'err'),
          toggle('⛔', '복귀 자리 막힘', st.returnSpotOccupied, { returnSpotOccupied: !st.returnSpotOccupied }),
        )));
    }
  }
  if (st.doors?.REAR) {
    body.append(h('div', { class: 'vc-alert' }, h('span', {}, '트렁크가 열려 있어요'),
      h('button', { class: 'primary', onclick: guard(() => api('POST', `/api/sim/vehicles/${v.id}/trunk-close`)) }, '트렁크 닫기')));
  }
  const details = h('div', { class: `vehicle-ctl ${open ? 'open' : ''} ${move ? 'active' : ''}` }, summary, chips, body);
  return details;
}

// ---------------- 영상 스튜디오 (#/studio) ----------------
// 1920×1080 한 화면에 지도 · 자막 · 폰 두 대 · 차량 화면 자리를 배치한다.
// 차량 화면 자리(.car-slot)는 비워 두고, 녹화 후 에뮬레이터 영상을 그 위치에 합성한다.
const CHAPTERS = ['비켜줘', '안전 인터록', '트렁크 드롭', '빈자리 레이더', '밀착 구역'];

function renderStudio() {
  document.body.classList.add('studio-mode');
  document.title = 'Carmunity Studio';
  const phoneUrl = (as, label, hash) => `/?as=${as}&rec=1&label=${encodeURIComponent(label)}${hash}`;
  const look = () => h('div', { class: 'look' }, '👀 지금 여기');
  const phone = (key, p) => {
    const ava = h('div', { class: 'ava', style: `background:${p.color}` }, p.name.slice(0, 1));
    const nm = h('div', { class: 'nm' }, p.name);
    const rl = h('div', { class: 'rl' }, p.role);
    const frame = h('iframe', { src: phoneUrl(p.as, p.tag, p.hash) });
    const col = h('section', { class: 'st-col st-phone', id: key }, h('div', { class: 'st-label' }, ava, h('div', {}, nm, rl)), h('div', { class: 'device' }, look(), frame));
    col._set = (q) => { ava.style.background = q.color; ava.textContent = q.name.slice(0, 1); nm.textContent = q.name; rl.textContent = q.role; frame.src = phoneUrl(q.as, q.tag, q.hash); };
    col._frame = frame;
    return col;
  };
  const p1 = phone('p1', { as: 'usr_jieun', name: '지은', role: '막힌 이웃 · 103동 아반떼', tag: '지은 · 103동', color: '#ff9b8f', hash: '#/request' });
  const p2 = phone('p2', { as: 'usr_minsu', name: '민수', role: '아이오닉 5 차주 · 101동', tag: '민수 · 101동', color: '#9ec5ff', hash: '#/home' });
  const chapters = h('div', { class: 'st-chapters' }, CHAPTERS.map((t, i) => h('div', { class: 'c' }, h('b', {}, i + 1), t)));
  const mapBox = h('div', { class: 'st-map-inner' });
  const mapPanel = h('section', { class: 'panel st-map', id: 'map' }, mapBox, look());
  const slot = h('div', { class: 'car-slot' });
  const car = h('section', { class: 'panel st-car', id: 'car' }, look(),
    h('div', { class: 'hd' }, h('b', {}, '차량 화면'), 'Pleos Connect 에뮬레이터 · 아이오닉 5', h('span', { class: 'sdk' }, '실제 Vehicle SDK 신호')), slot);
  const capK = h('div', { class: 'k' });
  const capT = h('div', { class: 't' });
  const capS = h('div', { class: 's' });
  const capBox = h('div', {}, capK, capT, capS);
  const live = h('div', { class: 'st-live', style: 'position:static;margin-top:auto' });
  const cap = h('section', { class: 'panel st-cap', id: 'cap' }, capBox, live);
  const card = h('div', { class: 'st-card hidden' });
  setView(h('div', { class: 'studio' },
    h('header', { class: 'st-top' }, h('div', { class: 'st-logo' }, h('i'), '카뮤니티', h('span', {}, '지하주차장 이웃 공유 차량 앱')), chapters, h('div', { class: 'st-badge' }, 'LIVE DEMO · Pleos Connect')),
    p1, mapPanel, h('div', { class: 'st-bottom' }, car, cap), p2, card));

  let lastLive = '';
  watchSnapshot((snap) => {
    renderParkingMap(mapBox, snap, { stage: true });
    const c = latestCaption(snap);
    const key = `${c.at}${c.text}`;
    if (key !== lastLive) {
      lastLive = key;
      live.className = `st-live ${c.kind || ''}`;
      live.replaceChildren(h('span', { class: 'lv' }), h('time', {}, fmtTime(c.at)), h('span', {}, c.text));
    }
  }, mapBox, true);

  const panels = { p1, p2, map: mapPanel, car, cap };
  window.studio = {
    caption(k, t, s = '') {
      capK.replaceChildren(...k.split('|').map((x, i) => (i === 0 ? h('span', { class: 'n' }, x.trim()) : h('span', {}, x.trim()))));
      capT.innerHTML = t;
      capS.innerHTML = s;
      capBox.classList.remove('anim');
      void capBox.offsetWidth;
      capBox.classList.add('anim');
    },
    chapter(i) { [...chapters.children].forEach((el, j) => { el.className = `c ${j < i ? 'done' : j === i ? 'on' : ''}`; }); },
    focus(...keys) { for (const [k, el] of Object.entries(panels)) el.classList.toggle('focus-on', keys.includes(k)); },
    phone(n, q) { (n === 1 ? p1 : p2)._set(q); },
    frame(n) { return (n === 1 ? p1 : p2)._frame.contentWindow; },
    card(o) {
      if (!o) { card.classList.add('hidden'); return; }
      card.replaceChildren(h('div', { class: 'anim', style: 'display:flex;flex-direction:column;align-items:center' },
        o.k ? h('div', { class: 'ck' }, o.k) : null,
        h('div', { class: 'ct', html: o.t }),
        o.s ? h('div', { class: 'cs', html: o.s }) : null,
        o.items ? h('div', { class: 'ci' }, o.items.map(([a, b]) => h('div', {}, a, h('small', {}, b)))) : null),
      ...(o.f ? [h('div', { class: 'cf' }, o.f)] : []));
      card.classList.remove('hidden');
    },
    carAspect(ar) { slot.style.width = `${Math.round(slot.getBoundingClientRect().height * ar)}px`; },
    slot() { const r = slot.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; },
  };
  window.studio.chapter(-1);
  window.studio.caption('카뮤니티', '아파트 지하주차장,<br>이웃끼리 차 기능을 조건부로 빌려 써요', '');
}

// ---------------- 시작 ----------------
// 스튜디오 화면은 폰 iframe이 각자 알림을 받으므로 바깥 창은 사용자 알림에 연결하지 않는다
if (!location.hash.startsWith('#/studio')) connect();
route();
