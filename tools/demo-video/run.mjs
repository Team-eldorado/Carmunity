// 데모 시나리오 자동 실행 + 녹화 (스튜디오 한 화면 + 에뮬레이터)
// node run.mjs [--dry]   --dry: 녹화 없이 리허설
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { REC, API, sleep, api, vc, snap, waitFor, adb, tapText, tapTarget, startHeartbeat, studioPage, dismissSystemDialogs } from './lib.mjs';

const DRY = process.argv.includes('--dry');
const CAR_CROP = { w: 2534, h: 1208, x: 0, y: 90 }; // 에뮬레이터 화면(2560×1440)에서 왼쪽 차량 패널 + 앱 영역
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const s = await studioPage();
const p1 = s.phone(1);
const p2 = s.phone(2);
const marks = [];
const sfxMarks = [];
const sfx = (name, afterMs = 0) => sfxMarks.push({ t: Date.now() + afterMs, name });
const cards = [];
let cardOn = null;
const caption = (k, t, sub = '') => { marks.push({ t: Date.now(), k }); log('▶', k, t.replace(/<br>/g, ' ')); return s.call('caption', k, t, sub); };
const focus = (...k) => s.call('focus', ...k);
const card = async (o, ms) => {
  if (cardOn == null) cardOn = Date.now();
  sfx('whoosh');
  await s.call('card', o);
  log('■', o.t.replace(/<[^>]+>/g, ''));
  await sleep(ms);
};
const hideCard = async () => {
  await s.call('card', null);
  cards.push([cardOn, Date.now() + 650]);
  cardOn = null;
  await sleep(700);
};
const chapter = async (i, k, t, sub) => {
  await s.call('chapter', i);
  await card({ k, t, s: sub }, 3600);
  await hideCard();
};
// 요청자 폰이 차에서 어디쯤 있는지 차량 앱에 넣는다 (에뮬레이터에 BLE가 없어 측정값을 대신 넣음). 차량 앱이 재서 서버에 보고
const ble = (plate, zone, distanceM = 0) => snap().then((x) => api('POST', `/api/sim/vehicles/${x.vehicles.find((v) => v.plate === plate).id}/ble`, { zone, distanceM }));
const sim = (plate, patch) => snap().then((x) => api('POST', `/api/sim/vehicles/${x.vehicles.find((v) => v.plate === plate).id}/state`, patch));
const moveOf = async (plate) => (await snap()).moves.find((m) => m.items.some((i) => i.plate === plate));
const plateInput = '.plate-input';

// ---------------- 준비: 초기 상태 ----------------
log('reset');
startHeartbeat();
await sleep(1500);
await vc('/vehicle/gear?gear=Park');
await vc('/vehicle/ev-battery?field=charge_switch&value=false');
for (const a of ['driver', 'passenger', 'rear_left']) await vc(`/vehicle/seat?area=${a}&kind=occupied&value=false`);
await vc('/vehicle/body?trunk=false');
// 이전 리허설에서 남은 질문 카드가 있으면 닫는다
try { tapText('아니'); } catch { /* */ }
// 차량 앱을 새로 띄워 이전 리허설에서 남은 카드를 비운다
adb('shell', 'am', 'force-stop', 'com.evneighbor.connect');
adb('logcat', '-c');
await api('POST', '/api/sim/reset');
adb('shell', 'am', 'start', '-n', 'com.evneighbor.connect/.ui.MainActivity');
await sleep(4000);
// 이전 테스트에서 열린 트렁크 값이 남아 있으면 자가 점검이 막힌다 → 차량 앱이 닫힘을 볼 때까지 닫는다
const ioniqId = (await snap()).vehicles.find((v) => v.plate === '12가3456').id;
await waitFor(async () => (await snap()).vehicles.find((v) => v.id === ioniqId).appConnected, 20000);
await api('POST', `/api/sim/vehicles/${ioniqId}/trunk-close`);
await waitFor(async () => {
  await vc('/vehicle/body?trunk=false');
  await sleep(1500);
  const st = (await snap()).vehicles.find((v) => v.plate === '12가3456').state;
  return !st.doors?.REAR && !Object.values(st.occupied || {}).some(Boolean);
}, 30000, 500);
await dismissSystemDialogs();
await fetch(`${API}/api/vehicles/veh_avante/policy`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-user-id': 'usr_jieun' }, body: JSON.stringify({ functions: { sensor: false } }) });
await waitFor(async () => (await snap()).vehicles.find((v) => v.plate === '12가3456').appConnected, 20000);
await s.eval('location.reload(); true');
await sleep(1500);
await waitFor(() => s.eval('!!window.studio'), 15000);
await s.call('carAspect', CAR_CROP.w / CAR_CROP.h);
await sleep(3500);
const slot = await s.call('slot');
log('slot', JSON.stringify(slot));
await s.call('card', {
  k: '카뮤니티',
  t: '차량들이 이웃을 돕는 하나의 커뮤니티<br><em>새로운 지하주차장</em>',
  s: '막힌 출차, 주차 빈자리, 물건 전달까지<br>우리의 차량들과 함께 더 편리해져요.',
});
cardOn = Date.now();
await sleep(1200);

// ---------------- 녹화 시작 ----------------
let ff = null;
const t0 = {};
if (!DRY) {
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '30', '-offset_x', '0', '-offset_y', '0', '-video_size', '1920x1080', '-draw_mouse', '0', '-i', 'desktop',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p', `${REC}/desktop.mkv`], { stdio: ['pipe', 'inherit', 'inherit'] });
  t0.desktop = Date.now();
  adb('emu', 'screenrecord', 'start', '--time-limit', '480', `${REC.replace(/\//g, '\\')}\\car.webm`);
  t0.car = Date.now();
}
await sleep(6500);

try {
  await card({
    k: '우리의 아이디어',
    t: '차주가 미리 허락한 범위 안에서<br><em>이웃이 내 차를 원격으로 컨트롤해요</em>',
    items: [['비켜줘', '누르는 동안만 · 최대 3m'], ['트렁크 드롭', '넣어 주기 · 꺼내 가기'], ['빈자리 레이더', '나가는 차 + 옆 칸 차가 알림'], ['밀착 구역', '문 열 공간 없이 한 칸 더']],
    f: 'Pleos Connect SDK  ·  Vehicle · TextToSpeech / SpeechToText · FusedLocation',
  }, 6500);

  // ================= 1. 비켜줘 =================
  await s.call('chapter', 0);
  await card({ k: 'CHAPTER 01', t: '<em>비켜줘</em>', s: '이중주차한 차를, 차주가 허락한 만큼만 이웃이 움직여요' }, 3600);
  await hideCard();

  await caption('01 | 전날 밤 · 이중주차', '민수 씨가 아이오닉 5를<br>통로에 이중주차해요', '기어가 <b>P</b>로 바뀌는 순간을 <b>Vehicle SDK</b>가 알려 주고, 차가 먼저 음성으로 물어요');
  await focus('car', 'map');
  await vc('/vehicle/gear?gear=Drive');
  await sleep(2500);
  await vc('/vehicle/gear?gear=Park');
  await sleep(5500);
  await caption('01 | 전날 밤 · 이중주차', '"오늘 밤도 비켜줘를 켜 둘까요?"<br>"응" 한마디면 끝', '운전 중엔 설정 화면 대신 음성(TTS/STT)과 한 번 탭으로만 답해요');
  await focus('car');
  await sleep(2500);
  await dismissSystemDialogs();
  await waitFor(async () => tapText('응'), 12000, 800);
  sfx('tap');
  await sleep(3000);

  await caption('02 | 다음 날 아침', '지은 씨 아반떼 앞을<br>아이오닉 5가 막고 있어요', '지도의 빨간 테두리 · <b>출차 막힘</b>');
  await focus('map');
  await sleep(4000);
  await caption('02 | 다음 날 아침', '앱 설치 없이,<br>번호판만 입력해요', '단지 QR로 여는 웹 · P로 잠긴 차지만 차주가 허락해 둔 <b>비켜줘</b>를 요청할 수 있어요');
  await focus('p1');
  await p1.type(plateInput, '12가3456');
  await sleep(600);
  sfx('tap');
  await p1.clickText('상태 확인');
  await sleep(3800);
  sfx('tap');
  await p1.clickText('비켜줘 요청');
  sfx('ping', 900);
  await sleep(1500);

  await caption('03 | 차주 확인', '민수 씨 폰에<br>30초 거부 창이 떠요', '거부하지 않으면 미리 허락한 조건대로 진행 · 차량 화면에도 동시에 표시돼요');
  await focus('p2', 'car');
  await sleep(6500);
  sfx('tap');
  await p2.clickText('지금 허락');
  sfx('checks', 650);

  await caption('04 | 자가 점검', '움직이기 전에<br>차가 스스로 점검해요', '충전 케이블 · 문/트렁크 · 실내 탑승자 · 배터리를 <b>Vehicle SDK</b>로 다시 읽고, 서버도 같은 규칙으로 재판정');
  await focus('car', 'p1');
  await waitFor(async () => (await moveOf('12가3456'))?.status === 'READY', 20000);
  sfx('ok');
  await sleep(3000);

  await caption('05 | 누르는 동안만', '차 옆에서 버튼을 누르는 동안만<br>보행 속도로 움직여요', '차가 <b>BLE</b>로 요청자가 차 옆 2m · 진로 밖인지 확인 · 직진·후진만 · 1회 최대 3m · RSPA 모의 구현');
  await focus('p1', 'car');
  await sleep(1200);
  await ble('12가3456', 'side', 1.4); // 지은 씨가 차 옆에 섬
  await sleep(2200);
  sfx('tap');
  await p1.holdDown();
  await sleep(2800);
  await p1.holdUp();
  await caption('05 | 누르는 동안만', '손을 떼면 즉시 멈춰요', '1분 안에 다시 누르면 이어서 움직이고, 지나면 토큰이 사라져요');
  await sleep(3500);
  await caption('05 | 누르는 동안만', '다시 누르면 이어서,<br>3m에서 자동 정지', '도착하면 P · 전자식 주차 브레이크 체결');
  sfx('tap');
  await p1.holdDown();
  await waitFor(async () => (await moveOf('12가3456'))?.status === 'MOVED', 15000);
  sfx('success');
  await p1.holdUp();

  await caption('06 | 길이 열렸어요', '아이오닉 5는 앞뒤로만 3m,<br>지은 씨 아반떼가 출차해요', '실행 전후 10초 영상과 기록이 차주·요청자 양쪽에 남아요');
  await focus('map');
  await sleep(2200);
  // 아반떼가 칸에서 빠져 출구 쪽(←)을 보고 위 차로에 잠깐 선다 (지은 씨는 차 안)
  await sim('78라1122', { gear: 'D', spotId: null, zoneId: null, pos: { x: 4.0, y: 6.6 }, heading: 180 });
  await sleep(4600);
  await ble('12가3456', 'side', 5.6); // 차에 탄 지은 씨 폰: 아이오닉에서 5.6m, 복귀 경로 밖

  await caption('07 | 복귀', '빠져나온 차 안에서<br>원위치로 돌려놔요', '차량이 <b>BLE</b>로 요청자가 6m 안 · 복귀 경로 밖인지 확인 · 10분 안에 복귀하지 않으면 차주에게 알림');
  await focus('p1', 'map');
  sfx('tap');
  await p1.clickText('복귀 시작');
  await sleep(2000);
  sfx('tap');
  await p1.holdDown();
  await waitFor(async () => (await moveOf('12가3456'))?.status === 'RETURNED', 15000);
  sfx('success');
  await p1.holdUp();
  await sleep(1200);
  // 지은 씨는 그대로 직진해서 출구로
  await ble('12가3456', 'clear');
  await sim('78라1122', { inComplex: false });
  sfx('coin');
  await caption('07 | 복귀', '민수 씨에게<br>틈 크레딧 +100', '같은 두 사람 사이는 하루 1회만 인정 · 야간 1.5배 · 관리비 차감 등으로 환원');
  await focus('p2', 'car');
  await sleep(5500);

  // ================= 2. 안전 인터록 =================
  // 다른 날: 장 카드가 덮고 있는 동안 아반떼를 다시 제자리에 세워 둔다
  await s.call('chapter', 1);
  await card({ k: 'CHAPTER 02', t: '<em>안전 인터록</em>', s: '차 안에 사람이 있으면, 차가 먼저 거절해요' }, 1200);
  await sim('78라1122', { inComplex: true, gear: 'P', spotId: 'B2-7-03' });
  await ble('12가3456', 'clear'); // 다른 날: 이전 요청자 위치는 지움
  await sleep(2400);
  await hideCard();
  await s.call('phone', 1, { as: 'usr_sujin', name: '수진', role: '이웃 · 104동', tag: '수진 · 104동', color: '#ffd43b', hash: '#/request' });
  await vc('/vehicle/seat?area=rear_left&kind=occupied&value=true');
  await caption('08 | 인터록', '뒷좌석에 아이가<br>잠들어 있다면?', 'Virtual Console에서 뒷좌석 착석 센서를 켰어요 · <b>Vehicle SDK Seat</b>');
  await focus('car');
  await sleep(3800);
  await caption('08 | 인터록', '수진 씨도 같은 차에<br>비켜줘를 요청해요', '차주는 이번에도 허락해요');
  await focus('p1');
  await p1.type(plateInput, '12가3456');
  sfx('tap');
  await p1.clickText('상태 확인');
  await sleep(2800);
  sfx('tap');
  await p1.clickText('비켜줘 요청');
  sfx('ping', 900);
  await sleep(3000);
  sfx('tap');
  await p2.clickText('지금 허락');
  sfx('checks', 650);
  await caption('08 | 인터록', '차가 탑승자를 감지하고<br>스스로 거절했어요', '요청자는 "차주에게 연락"으로 전환 · 차주에게 알림');
  await focus('car', 'p1');
  await waitFor(async () => (await snap()).moves.some((m) => m.status === 'INTERLOCK_FAILED'), 20000);
  sfx('deny');
  await sleep(6500);
  await vc('/vehicle/seat?area=rear_left&kind=occupied&value=false');

  // ================= 3. 트렁크 드롭 =================
  await chapter(2, 'CHAPTER 03', '<em>트렁크 드롭</em>', '집에 없어도, 이웃이 내 트렁크에 물건을 넣어 주거나 꺼내 가요');
  await caption('09 | 트렁크 드롭', '넣어 주기도, 꺼내 가기도<br>트렁크 1회 개방 토큰으로', '<b>넣어 주세요</b> 당근 거래 물건 · 대신 받은 택배 &nbsp;|&nbsp; <b>꺼내 가세요</b> 빌려준 공구 · 팔기로 한 물건');
  await focus('p2');
  await p2.hash('#/trunk');
  await sleep(1800);
  sfx('tap');
  await p2.clickText('꺼내 가세요');
  await sleep(1600);
  sfx('tap');
  await p2.clickText('넣어 주세요');
  await sleep(1000);
  await caption('09 | 트렁크 드롭', '민수 씨가 수진 씨에게<br>"유모차 넣어 주세요" 토큰을 보내요', '귀중품 확인 후 발급 · 지정한 계정만 · 10분 · 지하주차장 안에서만');
  await p2.type('input[placeholder*="상대 닉네임"]', '수진');
  await p2.type('input[placeholder*="메모"]', '유모차 (당근 거래)');
  await p2.check('귀중품');
  await sleep(900);
  sfx('tap');
  await p2.clickText('1회 개방 토큰 보내기');
  sfx('ping', 800);
  await sleep(2500);
  await p1.hash('#/trunk');
  await caption('09 | 트렁크 드롭', '수진 씨가 차 옆에서<br>트렁크를 열어요', '테일게이트만 열리고 실내 도어는 잠긴 채 · 개방 직전~닫힘 후 10초 후방 영상');
  await focus('p1');
  await sleep(1400);
  await ble('12가3456', 'rear', 1.0); // 수진 씨가 트렁크 뒤에 섬
  await sleep(1800);
  sfx('tap');
  await p1.clickText('트렁크 열기');
  await focus('p1', 'car', 'map');
  await waitFor(async () => (await snap()).trunks.some((t) => t.status === 'open'), 15000);
  sfx('trunk');
  await sleep(4500);
  await vc('/vehicle/body?trunk=false');
  await waitFor(async () => (await snap()).trunks.some((t) => t.status === 'completed'), 15000);
  sfx('success');
  await caption('09 | 트렁크 드롭', '닫히면 차주에게<br>"물건이 도착했어요"', '꺼내 가기였다면 "물건을 가져갔어요" · 개폐 시각 · 상대 닉네임 · 전후 영상이 양쪽에 남아요');
  await focus('p2', 'p1');
  await sleep(5500);

  // ================= 4. 빈자리 레이더 =================
  // 다른 날 저녁: 장 카드가 덮고 있는 동안 아이오닉 5는 단지 밖으로 (퇴근길)
  await s.call('chapter', 3);
  await card({ k: 'CHAPTER 04', t: '<em>빈자리 레이더</em>', s: '나가는 차와 옆 칸 차들이, 들어오는 차에게 빈자리를 알려요' }, 600);
  await ble('12가3456', 'clear');
  await vc('/vehicle/gear?gear=Drive');
  await sleep(1200);
  await sim('12가3456', { inComplex: false });
  await s.call('phone', 1, { as: 'usr_minsu', name: '민수', role: '아이오닉 5 차주 · 101동 · 퇴근길', tag: '민수 · 101동', color: '#74c0fc', hash: '#/home' });
  await s.call('phone', 2, { as: 'usr_seoyeon', name: '서연', role: '코나 차주 · 그랜저 옆 칸', tag: '서연 · 103동', color: '#63e6be', hash: '#/home' });
  await sleep(4200);
  await hideCard();
  await caption('10 | 빈자리 레이더', '그랜저가 출차하면<br>그 자리가 "방금 빈 자리"로', '주차(P) → 주행(D) 전환이 곧 출차 신호 · <b>Vehicle SDK</b> Gear');
  await focus('map');
  await sleep(1500);
  await sim('56다7890', { gear: 'D' });
  await sleep(1500);
  await sim('56다7890', { inComplex: false });
  sfx('radar', 500);
  await sleep(3800);
  await caption('10 | 빈자리 레이더', '옆 칸 차들이<br>빈 칸을 함께 확인해요', '양옆에 주차된 참여 차가 확인 신호를 보태요 · 참여 차에 크레딧 (2단계: 초음파 센서 스캔)');
  await focus('map', 'p2');
  await sleep(5000);
  await caption('10 | 빈자리 레이더', '민수 씨 아이오닉 5가 게이트를<br>지나는 순간 차량 화면에 알림', '지오펜스 진입 <b>FusedLocation</b> · 나간 차와 옆 차들이 보낸 신호를 차량 화면 미니맵으로 · 음성 1회');
  await focus('car', 'map');
  await sim('12가3456', { inComplex: true });
  sfx('ping', 1100);
  await sleep(6500);
  await caption('10 | 빈자리 레이더', '"갈게요" 한마디면<br>그 자리까지 안내', '게이트 통과 순 · 같은 구역 우선 · 60초 무응답이면 다음 차 · 차량 화면 미니맵으로 칸 위치 안내');
  await waitFor(async () => tapTarget('갈게요'), 8000, 600);
  sfx('tap');
  await sleep(4500);
  await sim('12가3456', { gear: 'P', spotId: 'B2-7-06' });
  await focus('map', 'car');
  // 지도에서 칸에 후진 주차를 마칠 때까지 차량 화면은 '빈자리로 안내 중'
  await sleep(9500);
  await vc('/vehicle/gear?gear=Park'); // 차량 기어 P → 차량 화면 '빈자리 주차 완료'
  sfx('success', 500);
  await focus('car', 'map');
  await sleep(3500);

  // ================= 5. 밀착 구역 (확장 기능) =================
  // 다음 날 밤: 아이오닉 5는 다시 밖으로, 비운 자리는 쏘렌토가 채워서 빈자리가 없는 상황
  await s.call('chapter', 4);
  await card({ k: 'CHAPTER 05 · 확장 기능', t: '<em>밀착 구역</em>', s: '비켜줘를 켠 차끼리는 문 열 공간이 필요 없어요' }, 600);
  // 장 카드가 덮고 있는 동안 다음 날 출차 (민수 씨는 차 안)
  await ble('12가3456', 'inside', 0.4);
  await vc('/vehicle/gear?gear=Drive');
  await sleep(1200);
  await sim('12가3456', { inComplex: false });
  await sim('34나5678', { inComplex: true, gear: 'P', spotId: 'B2-7-06' });
  adb('shell', 'am', 'start', '-n', 'com.evneighbor.connect/.ui.MainActivity');
  await s.call('phone', 2, { as: 'usr_minsu', name: '민수', role: '아이오닉 5 차주 · 101동 · 비켜줘 ON', tag: '민수 · 101동', color: '#74c0fc', hash: '#/compact' });
  await sleep(3000);
  adb('shell', 'am', 'start', '-n', 'com.evneighbor.connect/.ui.MainActivity');
  await sleep(1300);
  await hideCard();
  await caption('11 | 밀착 구역', '기둥 사이 자투리를<br>밀착 임시 구역으로', '관리사무소 지정 · 칸 폭 2.2m(일반 2.5m) · 같은 폭에 3대 → 4대 · 원격 비켜줘를 켠 차만');
  await focus('map');
  await sleep(4500);
  await caption('11 | 밀착 구역', '빈자리가 없는 날,<br>차량 화면이 밀착 칸을 안내해요', '자격 확인(원격 전·후진 + 비켜줘 ON) 후 안쪽 칸부터 · 칸 앞에서 <b>P</b>를 넣으면 도착으로 인식');
  await focus('car', 'map');
  await sim('12가3456', { inComplex: true });
  sfx('ping', 1100);
  await sleep(3800);
  await waitFor(async () => tapTarget('안내 받기'), 8000, 600);
  sfx('tap');
  await sleep(3200);
  await vc('/vehicle/gear?gear=Park');
  await sleep(4500);
  await caption('11 | 밀착 구역', '내려서 문을 닫고,<br>누르는 동안만 칸으로 들어가요', '그래서 문 열 공간이 필요 없어요 · 실내에 사람이 있으면 움직이지 않아요 · RSPA 원격 전진(모의)');
  await focus('car', 'p2');
  await sleep(1200);
  await ble('12가3456', 'side', 2.0); // 내려서 문을 닫고 차 옆에 섬
  await sleep(2200);
  sfx('tap');
  await p2.holdDown();
  await waitFor(async () => (await snap()).compacts?.[0]?.status === 'parked', 15000);
  sfx('success');
  await p2.holdUp();
  await sleep(1500);
  await caption('11 | 밀착 구역', '나갈 때도 버튼으로<br>칸에서 꺼낸 뒤 타요', '이중주차 줄과 자투리가 질서 있는 임시 구역이 돼요 · 법정 주차면이 아닌 관리사무소 협약으로 운영');
  await focus('map', 'car');
  await sleep(5500);

  // 앞으로: 지하주차장을 넘어
  await s.call('chapter', 5);
  await card({
    k: '확장성',
    t: '아파트 지하주차장을 넘어<br><em>더 많은 주차장으로</em>',
    items: [['오피스 · 상가', '입주사 · 직원 인증'], ['공영 · 대형마트', '운영사 · 지자체 연동'], ['병원 · 공항', '방문객 임시 위임']],
    f: '같은 차량 앱, 같은 위임 토큰 · 주차장마다 인증 방식만 바꿔요',
  }, 6500);

  // 마무리
  await s.call('chapter', 5);
  await card({
    k: '카뮤니티',
    t: '차주가 미리 허락한 범위 안에서<br><em>이웃이 내 차를 움직입니다</em>',
    items: [['단지 인증', '입주민 · 실명 인증'], ['위임 토큰 + 거부 창', '1회용 · 10분 · 최대 3m'], ['기록과 인터록', '전후 영상 · 차량 자가 점검']],
    f: '현대자동차그룹 차량용 앱 개발 공모전  ·  Pleos Connect',
  }, 8000);
} catch (e) {
  log('ERROR', e.message);
} finally {
  if (cardOn != null) cards.push([cardOn, Date.now() + 5000]);
  if (!DRY) {
    try { adb('emu', 'screenrecord', 'stop'); } catch (e) { log('emu stop', e.message); }
    ff.stdin.write('q');
    await new Promise((r) => ff.on('close', r));
    writeFileSync(`${REC}/timing.json`, JSON.stringify({ t0, slot, crop: CAR_CROP, cards, marks, sfx: sfxMarks, end: Date.now() }, null, 1));
  }
  await focus();
  log('done');
  process.exit(0);
}
