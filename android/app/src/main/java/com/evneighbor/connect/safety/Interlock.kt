package com.evneighbor.connect.safety

import com.evneighbor.connect.vehicle.Gear
import com.evneighbor.connect.vehicle.VehicleSnapshot

/**
 * 안전 인터록 (차량 쪽 판정). 하나라도 걸리면 차는 움직이지 않는다.
 * 서버도 같은 스냅샷을 받아 같은 규칙으로 다시 판정한다.
 */
object Interlock {
    const val MIN_SOC = 10

    enum class Fail(val message: String) {
        CHARGING("충전 중이라 움직일 수 없어요"),
        DOOR_OPEN("문이나 트렁크가 열려 있어 움직일 수 없어요"),
        OCCUPANT("차 안에 사람이나 반려동물이 있어 움직일 수 없어요"),
        LOW_HV("배터리가 부족해 요청을 받을 수 없어요"),
        SLOPE("경사 구역이라 움직일 수 없어요"),
        LOW_12V("12V 배터리 전압이 낮아 움직일 수 없어요"),
        NOT_PARKED("차가 주차 상태(P/N)가 아니에요"),
    }

    data class Result(val fails: List<Fail>) {
        val ok get() = fails.isEmpty()
        val message get() = fails.joinToString(", ") { it.message }
    }

    fun evaluate(s: VehicleSnapshot): Result {
        val fails = mutableListOf<Fail>()
        if (s.charging == true) fails += Fail.CHARGING
        if (s.anyDoorOpen) fails += Fail.DOOR_OPEN
        if (s.anyOccupied) fails += Fail.OCCUPANT
        if ((s.soc ?: 100) < MIN_SOC) fails += Fail.LOW_HV
        if (s.gear != Gear.UNKNOWN && !s.gear.isParked) fails += Fail.NOT_PARKED
        return Result(fails)
    }
}
