// 기획안의 운영 규칙을 한곳에 모은 값. 시범 단지에서 조정할 숫자는 모두 여기서 바꾼다.
export const RULES = Object.freeze({
  move: {
    maxMeters: 3, // 1회 최대 이동 거리
    speedMps: 0.5, // 보행 속도 (모의 이동 속도)
    vetoWindowSec: 30, // 차주 거부 창
    resumeWindowSec: 60, // 손을 뗀 뒤 재개 가능 시간
    holdTimeoutMs: 900, // 버튼 신호가 이 시간 이상 끊기면 정지
    obstacleRetrySec: 5,
    obstacleMaxRetries: 3,
    returnWindowMin: 10, // 출차 후 복귀 실행 기한
    minClearanceM: 1, // 앞뒤 여유가 이보다 작으면 요청 단계에서 안내
    tidyMoveMeters: 1, // 복귀 불가 시 통로 정리 이동 한도
    perRequesterDaily: 3, // 요청자당 하루 횟수
    perPairDaily: 1, // 같은 요청자 → 같은 차 하루 횟수
    defaultVehicleDaily: 2, // 위임 토큰 기본값: 차 한 대가 하루 비켜주는 횟수
    frequentRejectThreshold: 3, // 최근 5건 중 이 횟수 이상 거부하면 위임 끄기 제안
    minSocPercent: 10, // 고전압 배터리 최저치
  },
  quietHours: { start: 23, end: 6 }, // 23시~06시 기본 비활성
  token: { ttlMin: 10 },
  trunk: {
    ttlMin: 10,
    dailyLimit: 3,
    unclosedOwnerAlertMin: 3, // 닫힘 미감지 → 차주 알림, 자동 재잠금 시도
    unclosedOfficeAlertMin: 10, // 그래도 열려 있으면 관리사무소 알림
  },
  vacancy: {
    offerTimeoutSec: 60,
    maxOffersPerArrival: 2,
    recentWindowMin: 30, // 이 시간보다 오래된 빈자리는 안내하지 않음
    chargerNeedSoc: 80, // 이 SOC 미만인 전기차만 충전기 칸 안내
    witnessRadiusM: 6, // 빈 칸 양옆에 주차된 참여 차가 '빈자리 확인' 신호를 보탠다
  },
  proximity: {
    freshMs: 3000, // 차량 앱이 1초마다 보고. 끊기면 무효
    moveMaxM: 2, // 비켜줘: 차 측면 2m 안
    returnMaxM: 6, // 복귀: 요청자는 빠져나온 차 안에서 → 차에서 6m 안 (원격 주차 국제 기준 6m)
    returnPathMarginM: 1, // 복귀 경로(남은 거리) + 여유 1m 안에 서 있으면 시작 안 함
    trunkMaxM: 2, // 트렁크 드롭: 트렁크 뒤나 옆 2m 안
    compactMaxM: 4, // 밀착 구역: 차 밖 4m 안 (RSPA 스마트키 범위)
  },
  compact: {
    approachM: 4.2, // 칸 앞에 세운 뒤 원격 전진으로 들어가는 거리
    speedMps: 0.8, // 원격 주차 속도 (모의)
    pitchM: 2.2, // 밀착 칸 간격 (일반 구획 2.5m)
    holdTimeoutMs: 900,
  },
  credits: {
    moveProvide: 100,
    moveRequest: -100,
    nightMultiplier: 1.5,
    vacancySignal: 10,
    sensorScan: 5,
    trunkProvide: 20,
    lateReturnPenalty: -50,
  },
  clips: {
    secondsEachSide: 10,
    retentionHours: 72,
    disputeRetentionDays: 30,
  },
  safety: {
    reportsToSuspend: 3,
    suspendDays: 7,
  },
});

export const PORT = Number(process.env.PORT || 8080);
export const DATA_FILE = process.env.EVN_DATA_FILE || null; // 지정 시 JSON 파일에 저장
