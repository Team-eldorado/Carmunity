package com.evneighbor.connect.vehicle

import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.DoorArea
import ai.pleos.playground.vehicle.api.model.area.SeatArea
import ai.pleos.playground.vehicle.constant.area.DoorValue
import ai.pleos.playground.vehicle.constant.area.SeatValue
import ai.pleos.playground.vehicle.constant.control.LightSwitch
import ai.pleos.playground.vehicle.constant.control.VehicleGear
import ai.pleos.playground.vehicle.listener.DistanceDrivenListener
import ai.pleos.playground.vehicle.listener.DoorPositionListener
import ai.pleos.playground.vehicle.listener.EvBatteryStateOfChargeListener
import ai.pleos.playground.vehicle.listener.GearSelectionListener
import ai.pleos.playground.vehicle.listener.SeatOccupancyListener
import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Pleos Vehicle SDK로 실제 차량 신호를 읽고, 테일게이트·미등을 제어한다.
 *
 * 쓰는 API
 * - Gear: 기어 P/R/N/D (주차·출차 판정, 중립 표시 검증, 정차 중 설정 제한)
 * - Door: 문·테일게이트 열림 (인터록), REAR 1회 개방 (트렁크 드롭)
 * - Seat: 착석 센서 (실내 탑승자 인터록)
 * - EvBattery: 충전 중 · 배터리 잔량 (인터록)
 * - Odometer: 주행거리 (이동 거리 기록, 출차 보조 신호)
 * - Light: 미등 점멸 (촬영·이동 고지)
 * - CarInfo: VIN
 */
class PleosVehicleGateway(
    private val context: Context,
    private val scope: CoroutineScope,
) : VehicleGateway {
    override val name = "Pleos Vehicle SDK"
    private val tag = "PleosVehicle"
    private var vehicle: Vehicle? = null
    private val state = MutableStateFlow(VehicleSnapshot(source = "pleos"))
    private val ok = MutableStateFlow(false)
    override val snapshot: StateFlow<VehicleSnapshot> = state
    override val available: StateFlow<Boolean> = ok
    private var pollJob: Job? = null
    private var tailgateMax = 1

    /**
     * Pleos Connect 에뮬레이터(2.1.0)에서 확인: Seat 착석 값이 반대로 온다.
     * Virtual Console에서 "Empty"면 true, "Occupied"면 false. (Android SEAT_OCCUPANCY의 VACANT를 true로 매핑하는 것으로 보임)
     * 실차에서 정상 매핑이 확인되면 false로 바꾼다.
     */
    private val seatOccupancyInverted = true
    private fun occupiedFrom(v: Boolean?): Boolean = if (v == null) false else if (seatOccupancyInverted) !v else v
    private var seats: List<SeatValue> = listOf(SeatValue.ROW_1_LEFT, SeatValue.ROW_1_RIGHT, SeatValue.ROW_2_LEFT, SeatValue.ROW_2_RIGHT)

    private val doorValues = mapOf(
        DoorKeys.ROW_1_LEFT to DoorValue.ROW_1_LEFT,
        DoorKeys.ROW_1_RIGHT to DoorValue.ROW_1_RIGHT,
        DoorKeys.ROW_2_LEFT to DoorValue.ROW_2_LEFT,
        DoorKeys.ROW_2_RIGHT to DoorValue.ROW_2_RIGHT,
        DoorKeys.REAR to DoorValue.REAR,
    )

    private val gearListener = object : GearSelectionListener {
        override fun onSelected(gear: VehicleGear?) {
            state.update { it.copy(gear = gear.toGear(), at = now()) }
        }
        override fun onFailed(e: Exception) = warn("gear", e)
    }
    private val doorListeners = doorValues.mapValues { (key, _) ->
        object : DoorPositionListener {
            override fun onPositionUpdated(pos: Int?) {
                state.update { it.copy(doors = it.doors + (key to (pos ?: 0)), at = now()) }
            }
            override fun onFailed(e: Exception) = warn("door $key", e)
        }
    }
    private val seatListeners = mutableMapOf<SeatValue, SeatOccupancyListener>()
    private val socListener = object : EvBatteryStateOfChargeListener {
        override fun onEvBatteryStateOfChargeUpdated(value: Int?) {
            state.update { it.copy(soc = value, at = now()) }
        }
        override fun onFailed(e: Exception) = warn("soc", e)
    }
    private val odoListener = object : DistanceDrivenListener {
        override fun onDistanceDrivenUpdated(distance: Float?) {
            state.update { it.copy(odometerKm = distance, at = now()) }
        }
        override fun onFailed(e: Exception) = warn("odometer", e)
    }

    override fun start() {
        if (vehicle != null) return
        try {
            val v = Vehicle(context)
            v.initialize()
            vehicle = v
            ok.value = true
            v.getGear().registerGearSelection(gearListener)
            doorValues.forEach { (key, dv) -> v.getDoor().registerDoorPosition(DoorArea(dv), doorListeners.getValue(key)) }
            v.getEvBattery().registerEvBatteryStateOfCharge(socListener)
            v.getOdometer().registerDistanceDriven(odoListener)
            // 지원 좌석만 착석 센서 구독
            v.getSeat().checkSeatOccupancyCapabilities({ _, areas ->
                val supported = areas.flatMap { it.values.toList() }.distinct()
                if (supported.isNotEmpty()) seats = supported
                seats.forEach { sv -> registerSeat(v, sv) }
            }, { e ->
                warn("seat capability", e)
                seats.forEach { sv -> registerSeat(v, sv) }
            })
            // 테일게이트 최대 개방 값 (차종마다 다름)
            v.getDoor().checkDoorPositionCapabilities({ _, bounds ->
                bounds.entries.firstOrNull { e -> e.key.values.contains(DoorValue.REAR) }?.value?.maxValue?.let { tailgateMax = it }
            }, { e -> warn("door capability", e) })
            v.getCarInfo().getVINInfo({ vin: String? -> state.update { it.copy(vin = vin) } }, { e -> warn("vin", e) })
            // 충전 상태는 리스너가 없어 주기적으로 읽는다
            pollJob = scope.launch {
                while (isActive) {
                    readCharging()?.let { c -> state.update { it.copy(charging = c, at = now()) } }
                    delay(5_000)
                }
            }
            scope.launch { refresh() }
        } catch (t: Throwable) {
            // 일반 에뮬레이터 등 Vehicle Service가 없는 환경
            Log.w(tag, "Vehicle SDK 사용 불가: ${t.message}")
            ok.value = false
            vehicle = null
        }
    }

    private fun registerSeat(v: Vehicle, sv: SeatValue) {
        if (seatListeners.containsKey(sv)) return
        val l = object : SeatOccupancyListener {
            override fun onSeatOccupancyUpdated(occupancy: Boolean?) {
                state.update { it.copy(occupied = it.occupied + (sv.name to occupiedFrom(occupancy)), at = now()) }
            }
            override fun onFailed(e: Exception) = warn("seat ${sv.name}", e)
        }
        seatListeners[sv] = l
        runCatching { v.getSeat().registerSeatOccupancy(SeatArea(sv), l) }.onFailure { warn("seat register", it) }
    }

    override fun stop() {
        pollJob?.cancel()
        val v = vehicle ?: return
        runCatching {
            v.getGear().unregisterGearSelection(gearListener)
            doorValues.forEach { (key, dv) -> v.getDoor().unregisterDoorPosition(DoorArea(dv), doorListeners.getValue(key)) }
            v.getEvBattery().unregisterEvBatteryStateOfCharge(socListener)
            v.getOdometer().unregisterDistanceDriven(odoListener)
            seatListeners.forEach { (sv, l) -> v.getSeat().unregisterSeatOccupancy(SeatArea(sv), l) }
        }
        runCatching { v.release() }
        vehicle = null
        ok.value = false
    }

    override suspend fun refresh(): VehicleSnapshot {
        val v = vehicle ?: return state.value
        val gear = call<VehicleGear?> { done, fail -> v.getGear().getCurrentGearSelectionState({ g: VehicleGear? -> done(g) }, fail) }
        if (gear != null) state.update { it.copy(gear = gear.toGear()) }
        val doors = state.value.doors.toMutableMap()
        for ((key, dv) in doorValues) {
            call<Int?> { done, fail -> v.getDoor().getCurrentDoorPosition(DoorArea(dv), { p: Int? -> done(p) }, fail) }?.let { doors[key] = it }
        }
        val occ = state.value.occupied.toMutableMap()
        for (sv in seats) {
            call<Boolean?> { done, fail -> v.getSeat().getCurrentSeatOccupancy(SeatArea(sv), { b: Boolean? -> done(b) }, fail) }?.let { occ[sv.name] = occupiedFrom(it) }
        }
        val soc = call<Int?> { done, fail -> v.getEvBattery().getEvBatteryStateOfCharge({ s: Int? -> done(s) }, fail) }
        val odo = call<Float?> { done, fail -> v.getOdometer().getCurrentDistanceDriven({ d: Float? -> done(d) }, fail) }
        val brake = call<Boolean?> { done, fail -> v.getBrake().getCurrentBrakePedalStatus({ b: Boolean? -> done(b) }, fail) }
        val charging = readCharging()
        state.update {
            it.copy(
                doors = doors, occupied = occ,
                soc = soc ?: it.soc, odometerKm = odo ?: it.odometerKm, brakePressed = brake ?: it.brakePressed,
                charging = charging ?: it.charging, at = now(),
            )
        }
        return state.value
    }

    private suspend fun readCharging(): Boolean? {
        val v = vehicle ?: return null
        return call<Boolean?> { done, fail -> v.getEvBattery().getEvChargeSwitchState({ b: Boolean? -> done(b) }, fail) }
    }

    override suspend fun openTailgate(): Result<Unit> = setTailgate(tailgateMax)
    override suspend fun closeTailgate(): Result<Unit> = setTailgate(0)

    private suspend fun setTailgate(value: Int): Result<Unit> {
        val v = vehicle ?: return Result.failure(IllegalStateException("Vehicle SDK 미연결"))
        val r = withTimeoutOrNull(3_000) {
            suspendCancellableCoroutine<Result<Unit>> { cont ->
                v.getDoor().setDoorPosition(
                    DoorArea(DoorValue.REAR), value,
                    { _: DoorArea, _: Int? -> if (cont.isActive) cont.resume(Result.success(Unit)) },
                    { e: Exception -> if (cont.isActive) cont.resume(Result.failure(e)) },
                )
            }
        } ?: Result.failure(IllegalStateException("테일게이트 응답 없음"))
        if (r.isSuccess) state.update { it.copy(doors = it.doors + (DoorKeys.REAR to value)) }
        return r
    }

    override suspend fun setNoticeLight(on: Boolean) {
        val v = vehicle ?: return
        runCatching {
            v.getLight().setTailLampLightSwitch(if (on) LightSwitch.ON else LightSwitch.OFF, { _: LightSwitch? -> }, { e: Exception -> warn("tail lamp", e) })
        }
    }

    /** SDK 비동기 콜백을 코루틴으로. 응답이 없으면 null */
    private suspend fun <T> call(block: (done: (T) -> Unit, fail: (Exception) -> Unit) -> Unit): T? =
        withTimeoutOrNull(1_500) {
            suspendCancellableCoroutine<T?> { cont ->
                runCatching {
                    block({ value -> if (cont.isActive) cont.resume(value) }, { e -> warn("call", e); if (cont.isActive) cont.resume(null) })
                }.onFailure { if (cont.isActive) cont.resume(null) }
            }
        }

    private fun warn(what: String, e: Throwable) {
        Log.w(tag, "$what: ${e.message}")
    }
    private fun now() = System.currentTimeMillis()
}

internal fun VehicleGear?.toGear(): Gear = when (this) {
    VehicleGear.GEAR_PARK -> Gear.P
    VehicleGear.GEAR_NEUTRAL -> Gear.N
    VehicleGear.GEAR_REVERSE -> Gear.R
    null, VehicleGear.GEAR_UNKNOWN -> Gear.UNKNOWN
    else -> Gear.D // GEAR_DRIVE, GEAR_1..9
}
