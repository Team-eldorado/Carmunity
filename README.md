# 카뮤니티 (Carmunity)

> **차량들이 이웃을 돕는 하나의 커뮤니티** — 지하주차장에서 이웃끼리 차 기능을 조건부로 빌려 쓰는 Pleos Connect 차량용 앱

| 항목 | 위치 |
|---|---|
| 앱 이름 · 한 줄 소개 | 이 문서 맨 위 |
| 테스트 환경 및 필요한 설정 | [테스트 환경](#테스트-환경-및-필요한-설정) |
| 실행 방법 | [실행 방법](#실행-방법) |
| APK 파일 위치 | [apk/엘도라도_카뮤니티_release.apk](apk/엘도라도_카뮤니티_release.apk) |

아파트 지하주차장에서 이웃끼리 차 기능을 조건부로 빌려 쓰는 차량용 앱입니다.
차주가 "우리 단지 입주민이, 지하주차장 안에서, 앞뒤 3m까지"처럼 조건을 정해 두면,
이중주차에 막힌 이웃이 번호판을 찍고 차 옆에서 버튼을 누르는 동안 차가 비켜줍니다.

- **비켜줘**: 중립 표시(1단계) · 원격 비켜줘(2단계, 모의) · 복귀
- **빈자리 레이더**: 나가는 차의 출차 신호와 양옆 칸 참여 차의 확인으로, 들어오는 차에게 방금 빈 자리를 음성 안내
- **트렁크 드롭**: 같은 단지 이웃이 내 트렁크에 물건을 넣어 주거나(당근 거래·택배) 꺼내 가요(빌려준 물건) · 테일게이트 1회 개방 토큰
- **밀착 구역** (확장 기능 미리보기): 원격 비켜줘를 켠 차만 문 열 간격 없이 세우는 임시 구역 · 내려서 버튼을 누르는 동안 차가 칸으로 들어감(모의)

요구사항별 구현 현황은 [docs/요구사항_분석.md](docs/요구사항_분석.md)에 정리했습니다.

## 제출 자료

| 자료 | 위치 |
|---|---|
| 시연 영상 | [demo/카뮤니티_데모영상.mp4](demo/카뮤니티_데모영상.mp4) |
| 앱 화면 시안 | [추가자료/카뮤니티_화면시안.pdf](추가자료/카뮤니티_화면시안.pdf) |
| 상세 기획서 | [추가자료/카뮤니티_상세기획서.pdf](추가자료/카뮤니티_상세기획서.pdf) |
| 릴리스 APK | [apk/엘도라도_카뮤니티_release.apk](apk/엘도라도_카뮤니티_release.apk) |

## 구성

```
Carmunity/
├─ android/   Pleos Connect 차량 앱 (Kotlin · Jetpack Compose · Pleos Connect SDK)
├─ server/    매칭 서버 + 요청자/차주용 모바일 웹 + 데모 콘솔 (Node.js, 외부 패키지 없음)
├─ tools/     시연 영상 녹화·편집 스크립트
├─ apk/       릴리스 APK
├─ demo/      시연 영상
├─ 추가자료/  앱 화면 시안 · 상세 기획서
└─ docs/      요구사항 분석
```

| 구성 | 하는 일 |
|---|---|
| 차량 앱 | 위임 설정(정차 중에만), 요청자 근접 측정·보고(BLE, 시연에서는 데모 콘솔이 측정값 입력), 주차 직후 음성 질문 "오늘 밤 비켜줘를 켜 둘까요?", 30초 거부 창, 차량 자가 점검(기어·충전 케이블·문·탑승자·배터리를 Vehicle SDK로 한 줄씩 확인하는 화면), 모의 원격 이동, 테일게이트 1회 개방, 출차 신호 공유, 빈자리 레이더 미니맵(나간 차·확인한 옆 차 표시)과 음성 안내, 밀착 구역 안내(빈 칸 → 칸 앞 P → 내려서 진입 진행률), 주행 중에도 안내 카드 표시(distractionOptimized), 크레딧 홈 카드 |
| 모바일 웹 | 번호판 확인 → 중립 안내 또는 비켜줘 요청 → 차 옆에서 누르는 동안 이동(내 위치는 폰이 아니라 차량이 BLE로 확인해 화면에 표시) → 복귀 / 트렁크 토큰 발급(넣어 주세요·꺼내 가세요)·열기 / 밀착 구역 안내·원격 주차 / 기록·영상 / 차주의 위임 설정·거부 창 |
| 매칭 서버 | 단지·입주민·차량 인증, 위임 토큰 발급·검증·소멸, 비켜줘 상태 머신, 빈자리 매칭, 트렁크 토큰, 실행 기록·영상 보관(72시간), 크레딧 원장 |
| 데모 콘솔 | 지하주차장 지도, 차량 상황 조작(충전 케이블·탑승자·장애물·접촉 등), 이벤트 로그. 차량 앱이 연결되지 않은 차는 서버의 가상 차량이 같은 규칙으로 대신 움직임 |

## Pleos Connect SDK 사용

| SDK / API | 쓰는 곳 |
|---|---|
| Vehicle – Gear | 주차·주행 전환 감지 → '방금 빈 자리' 신호, 중립(N) 검증, 주행 중 설정 잠금 |
| Vehicle – Door | 테일게이트(REAR) 1회 개방, 닫힘 감지, 문 열림 인터록 |
| Vehicle – Seat | 실내 탑승자 감지 인터록 |
| Vehicle – EvBattery | 충전 중 · 배터리 잔량 인터록 |
| Vehicle – Odometer | 주행거리 기록, 기어 신호가 없을 때 출차 보조 신호 |
| Vehicle – Light | 촬영·이동 중 미등 점멸로 주변 고지 |
| Vehicle – CarInfo | VIN |
| FusedLocation | 단지 지오펜스(진입 = 입차 게이트, 이탈 = 토큰 무효), 위치 |
| NaviHelper | 연동 코드만 포함 (지상·대형 주차장 확장용). 지하주차장은 GPS 경로가 맞지 않아 차량 화면 미니맵으로 칸 위치를 안내 |
| SpeechToText / TextToSpeech | "오늘 밤 비켜줘 켜둘까요?" – '응', 빈자리 안내 – '갈게요', 요청·결과 음성 안내 |

요청자가 차 옆에 있는지는 요청자가 화면에서 체크하지 않고, 차량이 BLE로 잰 거리·방향(`POST /api/vehicle/:id/proximity`)으로만 판단합니다. 비켜줘 이동은 차 옆 2m 안·앞뒤 진로 밖, 복귀는 요청자가 빠져나온 자기 차 안에서 누르므로 차에서 6m 안·복귀 경로(남은 거리 + 1m) 밖, 트렁크 드롭은 트렁크 뒤 2m 안, 밀착 구역은 차 밖 4m 안 + 착석 센서 비어 있음이 조건이고, 차량 보고가 3초 넘게 끊기면 버튼 신호를 받지 않습니다. 에뮬레이터에는 BLE가 없어서 시연에서는 데모 콘솔(`POST /api/sim/vehicles/:id/ble`)이 측정값을 차량 앱에 넣고, 차량 앱이 1초마다 서버에 보고합니다.

원격 전·후진(원격 스마트 주차 보조)은 SDK에 없어 `RspaAdapter` 인터페이스를 정의하고 `SimulatedRspaAdapter`로 시연합니다.

## 테스트 환경 및 필요한 설정

| 구분 | 환경 |
|---|---|
| OS | Windows 11 (macOS · Linux도 같은 명령으로 동작) |
| 차량 앱 | Android Studio, Pleos Connect Emulator v2.1.0 (Android 14, API 34, AAOS), JDK 17~21, Gradle 8.10.2 wrapper 포함 |
| 에뮬레이터 화면 규격 | 2560 × 1440, 160 dpi (가로형 차량 디스플레이) · AVD 이미지 android-34 / pleos_car_emulator / x86_64 |
| 서버 · 모바일 웹 | Node.js 20 이상 (외부 패키지 없음), 포트 8080 |
| 모바일 웹 브라우저 | Chrome (PC 또는 같은 Wi-Fi의 휴대폰) |
| 앱 설정 | 설정 탭에서 서버 `http://10.0.2.2:8080`(에뮬레이터 → PC), 차량 번호 `12가3456`, 페어링 키 `demo` |
| 차량 신호 | Pleos Connect Virtual Console (`adb forward tcp:8088 tcp:8088` → http://127.0.0.1:8088) |
| 선택 설정 | 음성 인식: 에뮬레이터 Extended Controls → Microphone 호스트 입력 켜기 · Playground 자격 증명이 있으면 `android/local.properties`에 `PLEOS_CLIENT_ID`, `PLEOS_CLIENT_SECRET` |

- Vehicle Service가 없는 일반 Android 에뮬레이터에서는 자동으로 모의 차량으로 실행됩니다.
- 에뮬레이터에는 BLE가 없어서 요청자 거리는 데모 콘솔(http://localhost:8080/#/demo)에서 넣습니다.
- 원격 전·후진은 SDK에 없어 모의 어댑터(`SimulatedRspaAdapter`)로 동작합니다.

## 실행 방법

### 1) 매칭 서버 + 모바일 웹

Node.js 20 이상만 있으면 됩니다.

```bash
cd server
npm start          # http://localhost:8080
npm test           # 규칙 테스트 42개
```

- 데모 콘솔: http://localhost:8080/#/demo
- 휴대폰(같은 Wi-Fi): 서버 실행 시 출력되는 `http://<PC IP>:8080` 주소
- 시연 계정: 지은(요청자) · 민수(아이오닉 5 차주) · 현우(쏘렌토 차주) · 수진(그랜저 차주) · 관리사무소
- 데이터 파일로 저장하려면 `EVN_DATA_FILE=data/db.json npm start`

### 2) 차량 앱 (Pleos Connect 에뮬레이터)

1. Android Studio에 Pleos Connect Emulator(v2.1.0, API 34)를 설치하고 AVD를 Cold boot로 만듭니다.
   [설치 가이드](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)
2. `android` 폴더를 Android Studio로 열고 실행합니다. (JDK 17~21, Gradle 8.10.2 wrapper 포함)
   - 명령줄 빌드: `gradlew assembleDebug` / 시연용 release: `gradlew assembleRelease`
   - 단위 테스트(13개): `gradlew testDebugUnitTest` — 프로젝트 경로에 한글이 있으면 Windows 테스트 실행기가 클래스를 못 찾으니 영문 경로에서 실행하세요
3. 앱의 **설정** 탭에서 서버 `http://10.0.2.2:8080`, 차량 번호 `12가3456`, 페어링 키 `demo`로 연결합니다.
4. 차량 신호(기어·문·좌석·충전)는 Pleos Connect Virtual Console에서 바꿉니다.
   ```bash
   adb forward tcp:8088 tcp:8088   # 브라우저에서 http://127.0.0.1:8088
   ```
   Vehicle Service가 없는 일반 에뮬레이터에서는 자동으로 **모의 차량**으로 실행되고, **데모** 탭에서 상태를 바꿀 수 있습니다.
5. 음성(STT)을 쓰려면 에뮬레이터 Extended Controls → Microphone에서 호스트 오디오 입력을 켭니다.
   Playground 자격 증명이 있으면 `android/local.properties`에 `PLEOS_CLIENT_ID`, `PLEOS_CLIENT_SECRET`을 넣어 HYBRID 모드를 씁니다(없으면 ON_DEVICE).

## 시연 시나리오 (기획안 '시연 계획'과 같은 순서)

1. 차주가 주차를 마치면(Virtual Console에서 기어 D → P) 차량 화면이 "오늘 밤 비켜줘 켜둘까요?"라고 묻고 '응'으로 위임이 켜집니다.
2. 막힌 이웃(지은 폰)이 번호판 `12가3456`으로 요청 → 차주 폰·차량 화면에 30초 거부 창 → 차가 자가 점검 → 지은 씨가 버튼을 누르는 동안 모의 이동 → 로그와 크레딧이 양쪽에 찍힙니다.
3. 충전 중으로 바꾸고 같은 요청을 보내면 인터록이 막습니다.
4. 수진 씨가 현우 씨 쏘렌토 트렁크 토큰으로 테일게이트를 열고 닫으면 기록이 남고 "물건이 도착했어요"가 갑니다.
5. 그랜저가 출차(P → D)하면 들어오는 아이오닉 5 차량 화면에 "B2 7열 근처에 방금 한 자리 비었어요 · 옆 차 2대가 확인했어요"가 미니맵과 음성으로 안내되고, '갈게요'를 누르면 그 칸을 잡아 두고 미니맵의 초록 칸으로 안내합니다.
6. 안내할 빈자리가 없으면 차량 화면이 밀착 구역 빈 칸을 안내합니다. 칸 앞에서 P를 넣으면 도착으로 인식하고, 내려서 폰 버튼을 누르는 동안 칸으로 들어가는 진행률이 차량 화면에 보입니다.

## APK 파일 위치

**[apk/엘도라도_카뮤니티_release.apk](apk/엘도라도_카뮤니티_release.apk)** — 에뮬레이터에 바로 설치: `adb install -r apk/엘도라도_카뮤니티_release.apk`

직접 빌드하려면

`gradlew assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk`
공모전 규칙에 맞춰 `apk/엘도라도_카뮤니티_release.apk`로 복사해 저장소에 올립니다.
(시연용 서명 키 `android/keystore/carmunity-demo.jks`는 공개 데모 전용입니다. 실제 배포에는 별도 키를 쓰세요.)
