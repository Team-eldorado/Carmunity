package com.evneighbor.connect.vehicle

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * Vehicle Service가 없는 환경(일반 에뮬레이터, 개발 PC)에서 쓰는 모의 차량.
 * 개발 패널에서 기어·문·탑승자·충전 상태를 바꿔 시나리오를 재현한다.
 */
class SimVehicleGateway : VehicleGateway {
    override val name = "모의 차량"
    private val state = MutableStateFlow(
        VehicleSnapshot(
            gear = Gear.P,
            doors = DoorKeys.ALL.associateWith { 0 },
            occupied = mapOf("ROW_1_LEFT" to false, "ROW_1_RIGHT" to false, "ROW_2_LEFT" to false, "ROW_2_RIGHT" to false),
            charging = false,
            soc = 64,
            odometerKm = 12_345.6f,
            source = "sim",
        ),
    )
    private val ok = MutableStateFlow(true)
    override val snapshot: StateFlow<VehicleSnapshot> = state
    override val available: StateFlow<Boolean> = ok
    var noticeLight = false
        private set

    override fun start() {}
    override fun stop() {}
    override suspend fun refresh() = state.value.copy(at = System.currentTimeMillis())

    override suspend fun openTailgate(): Result<Unit> {
        state.update { it.copy(doors = it.doors + (DoorKeys.REAR to 1)) }
        return Result.success(Unit)
    }

    override suspend fun closeTailgate(): Result<Unit> {
        state.update { it.copy(doors = it.doors + (DoorKeys.REAR to 0)) }
        return Result.success(Unit)
    }

    override suspend fun setNoticeLight(on: Boolean) {
        noticeLight = on
    }

    // ---- 개발 패널 조작 ----
    fun setGear(g: Gear) = state.update { it.copy(gear = g, at = System.currentTimeMillis()) }
    fun toggleDoor(key: String) = state.update { val cur = it.doors[key] ?: 0; it.copy(doors = it.doors + (key to if (cur > 0) 0 else 1)) }
    fun toggleSeat(key: String) = state.update { it.copy(occupied = it.occupied + (key to !(it.occupied[key] ?: false))) }
    fun toggleCharging() = state.update { it.copy(charging = !(it.charging ?: false)) }
    fun setSoc(v: Int) = state.update { it.copy(soc = v) }
    fun addOdometer(km: Float) = state.update { it.copy(odometerKm = (it.odometerKm ?: 0f) + km) }
}
