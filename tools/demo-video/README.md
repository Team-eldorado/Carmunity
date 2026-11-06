# 데모 영상 자동 녹화

기획안 '시연 계획' 순서대로 화면을 자동 조작하면서 녹화하고, 차량 화면을 합성해 1920×1080 영상 한 편을 만듭니다.

- **스튜디오 화면** (`http://localhost:8080/#/studio`): 지도, 자막, 폰 두 대(iframe), 차량 화면 자리를 한 화면에 배치해요. 장 전환 카드와 '지금 여기' 강조도 여기서 그려요.
- **차량 화면**: Pleos 에뮬레이터를 따로 녹화한 뒤, 합성할 때 스튜디오의 차량 화면 자리에 넣어요. 장 전환 카드가 보이는 동안에는 숨겨요.

## 준비
- 매칭 서버 실행 (`server`에서 `npm start`)
- Pleos Connect 에뮬레이터 실행 + 카뮤니티 차량 앱 연결(설치하면 자동 연결)
- `adb forward tcp:8088 tcp:8088` (Virtual Console)
- `adb emu geo fix 127.03636666 37.48544722` (에뮬레이터 위치를 시연 단지로)
- `adb shell settings put system show_touches 1` (차량 화면 터치 표시)
- Chrome, ffmpeg 설치

## 실행
```bash
node setup.mjs --preview                 # 스튜디오 창 띄우기 (전체 화면 아님)
node shot.mjs check.png                  # 1920×1080 캡처로 화면 확인
node run.mjs --dry                       # 리허설 (녹화 없이 끝까지 진행)

node setup.mjs                           # 기본 모니터 전체 화면으로 전환
powershell -File topmost.ps1 -On 1       # 창을 맨 위로 고정
node run.mjs                             # 녹화: desktop.mkv + car.webm + timing.json
powershell -File topmost.ps1 -On 0       # 고정 해제
node compose.mjs demo.mp4                # 차량 화면 합성 → demo.mp4
```
- `run.mjs`는 시작할 때 서버·Virtual Console·차량 앱 상태를 처음으로 되돌려요. 이전 시연에서 열린 트렁크와 Pleos 시스템 경고창도 이때 정리해요.
- 차량 화면은 에뮬레이터 2560×1440 중 왼쪽 차량 패널과 앱 영역(`CAR_CROP`, 위 상태줄·아래 공조 바 제외)을 잘라 써요.
- 녹화 중(약 4분)에는 기본 모니터를 건드리지 마세요. 화면을 그대로 찍어요.
- 에뮬레이터 창은 기본 모니터가 아닌 다른 모니터로 옮겨 두세요. 차량 화면은 `adb emu screenrecord`로 따로 찍기 때문에 창 위치와 상관없지만, 기본 모니터에 있으면 스튜디오 화면을 가려요.
- 장면 순서: 비켜줘 → 안전 인터록 → 트렁크 드롭(넣어 주기·꺼내 가기) → 빈자리 레이더(출차 신호 + 옆 칸 확인) → 밀착 구역(확장 기능).
- 지도의 차는 입차·출차할 때 통로를 따라 운전하는 경로(전진 → 후진 주차)로 움직여요. 경로는 `server/public/map.js`의 `planRoute()`에서 만들어요.
- 소리: `audio.mjs`가 BGM(88 BPM 잔잔한 로파이 앰비언트)과 효과음(탭·알림·자가 점검 틱·성공·거절·크레딧·레이더·트렁크·장 전환)을 직접 합성해 `compose.mjs`에서 깔아요. 효과음 시점은 `run.mjs`가 녹화 중에 `timing.json`의 `sfx`로 기록해요. 외부 음원을 쓰지 않아 저작권 문제가 없어요.
