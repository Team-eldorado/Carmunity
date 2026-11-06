package com.evneighbor.connect

import com.evneighbor.connect.rspa.Direction
import com.evneighbor.connect.rspa.MoveMode
import com.evneighbor.connect.rspa.RspaProgress
import com.evneighbor.connect.rspa.RspaStatus
import com.evneighbor.connect.rspa.SimulatedRspaAdapter
import com.evneighbor.connect.safety.Interlock
import com.evneighbor.connect.vehicle.DoorKeys
import com.evneighbor.connect.vehicle.Gear
import com.evneighbor.connect.vehicle.ParkingDetector
import com.evneighbor.connect.vehicle.VehicleSnapshot
import com.evneighbor.connect.voice.YesNo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InterlockTest {
    private val parked = VehicleSnapshot(gear = Gear.P, doors = DoorKeys.ALL.associateWith { 0 }, occupied = mapOf("ROW_1_LEFT" to false), charging = false, soc = 60)

    @Test fun passesWhenParkedAndClosed() = assertTrue(Interlock.evaluate(parked).ok)

    @Test fun blocksChargingDoorOccupantLowBatteryDriving() {
        assertEquals(listOf(Interlock.Fail.CHARGING), Interlock.evaluate(parked.copy(charging = true)).fails)
        assertEquals(listOf(Interlock.Fail.DOOR_OPEN), Interlock.evaluate(parked.copy(doors = parked.doors + (DoorKeys.REAR to 1))).fails)
        assertEquals(listOf(Interlock.Fail.OCCUPANT), Interlock.evaluate(parked.copy(occupied = mapOf("ROW_2_RIGHT" to true))).fails)
        assertEquals(listOf(Interlock.Fail.LOW_HV), Interlock.evaluate(parked.copy(soc = 5)).fails)
        assertEquals(listOf(Interlock.Fail.NOT_PARKED), Interlock.evaluate(parked.copy(gear = Gear.D)).fails)
        assertTrue(Interlock.evaluate(parked.copy(gear = Gear.N)).ok)
    }
}

class ParkingDetectorTest {
    @Test fun gearTransitionsMakeParkedAndDeparted() {
        val d = ParkingDetector()
        assertEquals(null, d.onSnapshot(VehicleSnapshot(gear = Gear.D), false))
        assertEquals(ParkingDetector.Event.PARKED, d.onSnapshot(VehicleSnapshot(gear = Gear.P), false))
        assertEquals(ParkingDetector.Event.DEPARTED, d.onSnapshot(VehicleSnapshot(gear = Gear.D), false))
    }

    @Test fun remoteMoveIsNotDeparture() {
        val d = ParkingDetector()
        d.onSnapshot(VehicleSnapshot(gear = Gear.P), false)
        assertEquals(null, d.onSnapshot(VehicleSnapshot(gear = Gear.D), remoteMoveActive = true))
    }

    @Test fun odometerFallbackWhenGearUnknown() {
        val d = ParkingDetector(odometerDepartKm = 0.02f)
        d.onSnapshot(VehicleSnapshot(gear = Gear.P, odometerKm = 100f), false)
        d.onSnapshot(VehicleSnapshot(gear = Gear.UNKNOWN, odometerKm = 100.01f), false)
        assertEquals(ParkingDetector.Event.DEPARTED, d.onSnapshot(VehicleSnapshot(gear = Gear.UNKNOWN, odometerKm = 100.05f), false))
    }
}

class YesNoTest {
    @Test fun parsesKoreanShortAnswers() {
        listOf("응", "네", "예", "그래", "좋아요", "켜 줘", "응 켜줘", "갈게요", "어 그래").forEach { assertEquals(it, YesNo.Answer.YES, YesNo.parse(it)) }
        listOf("아니", "아니요", "싫어", "안 돼", "됐어", "아니 괜찮아", "안 켜").forEach { assertEquals(it, YesNo.Answer.NO, YesNo.parse(it)) }
        listOf("", "음악 틀어줘", null).forEach { assertEquals(YesNo.Answer.UNKNOWN, YesNo.parse(it)) }
    }
}

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class SimulatedRspaTest {
    private var now = 0L
    private val events = mutableListOf<RspaProgress>()

    private fun adapter(): SimulatedRspaAdapter {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        val a = SimulatedRspaAdapter(scope, clock = { now }, autoRun = false)
        a.progress.onEach { events += it }.launchIn(scope)
        return a
    }

    /** 300ms마다 버튼 신호를 보내며 100ms 단위로 진행 */
    private fun holdFor(a: SimulatedRspaAdapter, ms: Long, holding: Boolean = true) {
        var t = 0L
        while (t < ms) {
            if (holding && t % 300 == 0L) a.hold()
            now += 100
            t += 100
            a.step()
        }
    }

    @Test fun movesOnlyWhileHeldAndStopsAtMax() {
        val a = adapter()
        a.requestMove("r1", "tok", Direction.FORWARD, 3.0, MoveMode.MOVE)
        holdFor(a, 2_000)
        val mid = a.distance
        assertTrue("2초 동안 약 1m ($mid)", mid in 0.8..1.2)
        a.release() // 손을 떼면 즉시 정지
        holdFor(a, 2_000, holding = false)
        assertEquals(RspaStatus.PAUSED, events.last().status)
        assertEquals(mid, a.distance, 0.11)
        holdFor(a, 6_000)
        assertEquals(RspaStatus.COMPLETED, events.last().status)
        assertEquals(3.0, events.last().distanceM, 1e-9)
    }

    @Test fun holdSignalLossStopsWithinTimeout() {
        val a = adapter()
        a.requestMove("r0", "tok", Direction.FORWARD, 3.0, MoveMode.MOVE)
        holdFor(a, 1_200)
        val before = a.distance
        holdFor(a, 2_000, holding = false) // 신호가 끊김 (통신 단절 등)
        assertEquals(RspaStatus.PAUSED, events.last().status)
        assertTrue("타임아웃(0.9초) 안에 멈춤", a.distance - before <= 0.5)
    }

    @Test fun obstacleRetriesThenAborts() {
        val a = adapter()
        var obstacle = false
        a.obstacle = { obstacle }
        a.requestMove("r2", "tok", Direction.BACKWARD, 3.0, MoveMode.MOVE)
        holdFor(a, 500)
        obstacle = true
        holdFor(a, 25_000)
        assertEquals(3, events.count { it.status == RspaStatus.OBSTACLE })
        assertEquals(RspaStatus.ABORTED, events.last().status)
    }

    @Test fun contactStopsImmediately() {
        val a = adapter()
        var contact = false
        a.contact = { contact }
        a.requestMove("r3", "tok", Direction.FORWARD, 3.0, MoveMode.MOVE)
        holdFor(a, 600)
        contact = true
        holdFor(a, 300)
        assertEquals(RspaStatus.CONTACT, events.last().status)
        assertFalse(a.activeRequestId == "r3")
    }

    @Test fun returnBlockedWhenSpotTaken() {
        val a = adapter()
        a.returnSpotOccupied = { true }
        a.requestMove("r4", "tok", Direction.BACKWARD, 2.0, MoveMode.RETURN)
        a.hold()
        assertEquals(RspaStatus.BLOCKED, events.last().status)
    }

    @Test fun maxDistanceIsCappedAtThreeMeters() {
        val a = adapter()
        a.requestMove("r5", "tok", Direction.FORWARD, 10.0, MoveMode.MOVE)
        holdFor(a, 10_000)
        assertEquals(3.0, events.last().distanceM, 1e-9)
    }
}

class SnapshotJsonTest {
    @Test fun serializesForServer() {
        val j = VehicleSnapshot(gear = Gear.N, doors = mapOf("REAR" to 1), occupied = mapOf("ROW_1_LEFT" to true), charging = true, soc = 42).toJson()
        assertEquals("N", j.getString("gear"))
        assertEquals(1, j.getJSONObject("doors").getInt("REAR"))
        assertTrue(j.getJSONObject("occupied").getBoolean("ROW_1_LEFT"))
        assertTrue(j.getBoolean("charging"))
        assertEquals(42, j.getInt("soc"))
    }
}

@Suppress("unused")
private val keepDispatchers = Dispatchers.Unconfined
