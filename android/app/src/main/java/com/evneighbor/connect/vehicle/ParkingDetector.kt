package com.evneighbor.connect.vehicle

/**
 * 기어 변화로 주차 완료 / 출차를 판정한다.
 * - 주행(D/R) → P/N : 주차 완료 → 차량 화면이 "오늘 밤 비켜줘를 켜 둘까요?"를 묻는다
 * - P/N → 주행(D/R) : 출차 → 그 자리를 '방금 빈 자리'로 공유
 * 비켜줘 원격 이동 중의 기어 변화는 출차가 아니므로 무시한다.
 * 기어 신호가 없으면(UNKNOWN) 주행거리 증가를 출차 보조 신호로 쓴다.
 */
class ParkingDetector(private val odometerDepartKm: Float = 0.02f) {
    enum class Event { PARKED, DEPARTED }

    private var lastGear: Gear = Gear.UNKNOWN
    private var parkedOdometer: Float? = null
    private var parked = false

    /** @return 이번 신호로 생긴 이벤트 (없으면 null) */
    fun onSnapshot(s: VehicleSnapshot, remoteMoveActive: Boolean): Event? {
        val prev = lastGear
        lastGear = s.gear
        if (remoteMoveActive) return null
        if (s.gear != Gear.UNKNOWN) {
            if (prev != Gear.UNKNOWN && !prev.isParked && s.gear.isParked) {
                parked = true
                parkedOdometer = s.odometerKm
                return Event.PARKED
            }
            if (prev.isParked && !s.gear.isParked) {
                parked = false
                return Event.DEPARTED
            }
            if (prev == Gear.UNKNOWN && s.gear.isParked) {
                parked = true
                parkedOdometer = s.odometerKm
            }
            return null
        }
        // 기어 신호가 없을 때: 주차 기준 주행거리에서 일정 이상 늘면 출차로 본다
        val base = parkedOdometer
        val odo = s.odometerKm
        if (parked && base != null && odo != null && odo - base >= odometerDepartKm) {
            parked = false
            return Event.DEPARTED
        }
        return null
    }
}
