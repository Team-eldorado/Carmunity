package com.evneighbor.connect.core

import com.evneighbor.connect.rspa.Direction
import com.evneighbor.connect.rspa.MoveMode
import com.evneighbor.connect.vehicle.VehicleSnapshot

data class Spot(val id: String, val label: String, val zoneId: String, val type: String, val lat: Double?, val lng: Double?)
data class Zone(val id: String, val name: String, val floor: Int, val type: String, val slope: Boolean)

data class Policy(
    val enabled: Boolean = false,
    val move: Boolean = false,
    val trunk: Boolean = false,
    val sensor: Boolean = true,
    val scopeDongs: List<String> = emptyList(),
    val dailyMoveLimit: Int = 2,
    val allowNight: Boolean = false,
    val pausedToday: Boolean = false,
)

data class Credits(val balance: Int = 0, val monthMoves: Int = 0, val monthVacancy: Int = 0, val monthTrunk: Int = 0, val thanks: String? = null)

data class VetoUi(val requestId: String, val requester: String, val expiresAt: Long)
data class MoveUi(
    val requestId: String,
    val mode: MoveMode,
    val direction: Direction,
    val distance: Double,
    val max: Double,
    val phase: String, // 준비 · 이동 중 · 일시 정지 · 완료 ...
    val text: String,
)
/** 빈자리 레이더 미니맵: 그 열의 칸 하나 (vacant 빈 칸 · witness 확인한 옆 차 · taken 주차된 차 · free 빈 칸) */
data class RadarSpot(val no: String, val state: String, val model: String?)
data class VacancyUi(
    val offerId: String,
    val message: String,
    val spot: Spot?,
    val expiresAt: Long,
    val accepted: Boolean = false,
    val zoneName: String = "",
    val departed: String? = null,
    val radar: List<RadarSpot> = emptyList(),
    val parked: Boolean = false, // 안내받은 칸에 주차(P)까지 마침
)

/** 차량 자가 점검 한 줄: 무엇을, 어느 SDK 값으로, 결과 */
data class CheckItem(val label: String, val source: String, val value: String, val ok: Boolean)
data class CheckUi(val requestId: String, val items: List<CheckItem>, val shown: Int = 0, val done: Boolean = false, val ok: Boolean = true, val result: String = "")

/** 밀착 구역: offer → guide → ready → moving ⇄ paused → parked */
data class CompactSlot(val no: String, val taken: Boolean)
data class CompactUi(
    val phase: String,
    val sessionId: String? = null,
    val slots: List<CompactSlot> = emptyList(),
    val targetNo: String = "",
    val targetLabel: String = "",
    val distance: Double = 0.0,
    val total: Double = 4.2,
    val message: String = "",
)
/** 요청자(또는 차주) 폰까지의 거리·방향. zone: side · front · rear · inside · far */
data class BleUi(val distanceM: Double, val zone: String)
data class PromptUi(val kind: String, val text: String)
data class TrunkUi(val tokenId: String, val status: String, val text: String)
data class Notice(val at: Long, val text: String)

data class UiState(
    val paired: Boolean = false,
    val pairing: Boolean = false,
    val pairError: String? = null,
    val serverConnected: Boolean = false,
    val vehicleId: String? = null,
    val plate: String = "",
    val model: String = "",
    val ownerNickname: String = "",
    val hasRspa: Boolean = false,
    val complexName: String = "",
    val zones: List<Zone> = emptyList(),
    val spots: List<Spot> = emptyList(),
    val homeSpotId: String? = null,
    val inComplexServer: Boolean = false,
    val neutral: Boolean = false,
    val gatewayName: String = "",
    val vehicleAvailable: Boolean = false,
    val snapshot: VehicleSnapshot = VehicleSnapshot(),
    val geofenceInside: Boolean? = null,
    val policy: Policy = Policy(),
    val credits: Credits = Credits(),
    val veto: VetoUi? = null,
    val move: MoveUi? = null,
    val vacancy: VacancyUi? = null,
    val check: CheckUi? = null,
    val ble: BleUi? = null,
    val compact: CompactUi? = null,
    val prompt: PromptUi? = null,
    val pickSpot: Boolean = false,
    val trunk: TrunkUi? = null,
    val notices: List<Notice> = emptyList(),
    val listening: Boolean = false,
    val lastHeard: String = "",
    val naviStatus: String = "",
    val interlockText: String? = null,
) {
    /** 주행 중(D/R)에는 설정 화면을 막고 음성·한 번 탭만 허용 */
    val isDriving get() = snapshot.gear.name in setOf("D", "R")
    val homeSpotLabel get() = spots.firstOrNull { it.id == homeSpotId }?.label
}
