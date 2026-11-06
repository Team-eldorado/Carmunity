package com.evneighbor.connect.vehicle

import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

enum class Gear { P, R, N, D, UNKNOWN;
    val isParked get() = this == P || this == N
}

/** 문 영역 키 (서버와 같은 이름) */
object DoorKeys {
    const val ROW_1_LEFT = "ROW_1_LEFT"
    const val ROW_1_RIGHT = "ROW_1_RIGHT"
    const val ROW_2_LEFT = "ROW_2_LEFT"
    const val ROW_2_RIGHT = "ROW_2_RIGHT"
    const val REAR = "REAR" // 테일게이트
    val ALL = listOf(ROW_1_LEFT, ROW_1_RIGHT, ROW_2_LEFT, ROW_2_RIGHT, REAR)
}

/** 차량 센서 스냅샷. 인터록 판정과 서버 상태 동기화에 쓴다. */
data class VehicleSnapshot(
    val gear: Gear = Gear.UNKNOWN,
    val doors: Map<String, Int> = emptyMap(), // 0 닫힘, >0 열림
    val occupied: Map<String, Boolean> = emptyMap(), // 좌석별 착석
    val charging: Boolean? = null,
    val soc: Int? = null,
    val odometerKm: Float? = null,
    val brakePressed: Boolean? = null,
    val vin: String? = null,
    val source: String = "pleos",
    val at: Long = System.currentTimeMillis(),
) {
    val anyDoorOpen get() = doors.values.any { it > 0 }
    val tailgateOpen get() = (doors[DoorKeys.REAR] ?: 0) > 0
    val anyOccupied get() = occupied.values.any { it }

    fun toJson(): JSONObject = JSONObject().apply {
        put("gear", if (gear == Gear.UNKNOWN) JSONObject.NULL else gear.name)
        put("doors", JSONObject(doors as Map<*, *>))
        put("occupied", JSONObject(occupied as Map<*, *>))
        put("charging", charging ?: JSONObject.NULL)
        put("soc", soc ?: JSONObject.NULL)
        put("odometerKm", odometerKm?.toDouble() ?: JSONObject.NULL)
        put("source", source)
        put("at", at)
    }
}

/**
 * 차량 신호 계층. Pleos Vehicle SDK 구현([PleosVehicleGateway])과
 * SDK가 없는 환경용 시뮬레이션 구현([SimVehicleGateway])이 같은 인터페이스를 따른다.
 */
interface VehicleGateway {
    val name: String
    val snapshot: StateFlow<VehicleSnapshot>
    val available: StateFlow<Boolean>
    fun start()
    fun stop()

    /** 인터록 직전에 다시 읽은 최신 값 */
    suspend fun refresh(): VehicleSnapshot

    /** 트렁크 드롭: 테일게이트만 연다 (실내 도어는 잠긴 채) */
    suspend fun openTailgate(): Result<Unit>
    suspend fun closeTailgate(): Result<Unit>

    /** 촬영·이동 중임을 주변에 알리는 등 (비상등 API가 없어 미등으로 대신) */
    suspend fun setNoticeLight(on: Boolean)
}
