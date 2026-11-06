package com.evneighbor.connect.rspa

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch

/**
 * 원격 이동 모의 구현. 실제 차량 대신 위치 값을 바꿔 이동을 표현한다.
 * 규칙은 현대·기아 원격 스마트 주차 보조의 안전 규칙을 그대로 따른다.
 *
 * 시계를 주입할 수 있어 단위 테스트에서 [step]으로 시간을 직접 흘린다.
 */
class SimulatedRspaAdapter(
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val speedMps: Double = 0.5,
    private val holdTimeoutMs: Long = 900,
    private val obstacleRetryMs: Long = 5_000,
    private val obstacleMaxRetries: Int = 3,
    private val tickMs: Long = 100,
    private val autoRun: Boolean = true,
    /** 데모: 진로 장애물 / 접촉 / 복귀 자리 막힘 */
    var obstacle: () -> Boolean = { false },
    var contact: () -> Boolean = { false },
    var returnSpotOccupied: () -> Boolean = { false },
    /** 이동 중 미등 점멸 등 주변 고지 */
    var onNotice: (Boolean) -> Unit = {},
) : RspaAdapter {
    private val flow = MutableSharedFlow<RspaProgress>(extraBufferCapacity = 64)
    override val progress: SharedFlow<RspaProgress> = flow

    private class Session(
        val requestId: String,
        val direction: Direction,
        val max: Double,
        val mode: MoveMode,
    ) {
        var distance = 0.0
        var lastHold = 0L
        var running = false
        var retries = 0
        var waitUntil = 0L
        var done = false
        var lastTick = 0L
        var ticks = 0
    }

    private var s: Session? = null
    private var job: Job? = null
    override val activeRequestId: String? get() = s?.takeIf { !it.done }?.requestId

    /** 현재 원위치 대비 이동량 (화면 표시용) */
    val distance: Double get() = s?.distance ?: 0.0

    override fun requestMove(requestId: String, token: String?, direction: Direction, maxDistanceM: Double, mode: MoveMode) {
        val cur = s
        if (cur != null && cur.requestId == requestId && cur.mode == mode && !cur.done) return
        stopLoop()
        s = Session(requestId, direction, maxDistanceM.coerceIn(0.0, 3.0), mode)
    }

    override fun hold() {
        val cur = s ?: return
        if (cur.done) return
        cur.lastHold = clock()
        if (cur.mode == MoveMode.RETURN && returnSpotOccupied()) {
            cur.done = true
            emit(cur, RspaStatus.BLOCKED)
            return
        }
        if (!cur.running && clock() >= cur.waitUntil) {
            cur.running = true
            cur.lastTick = clock()
            onNotice(true)
            if (autoRun) startLoop()
        }
    }

    override fun release() {
        s?.lastHold = 0L
    }

    override fun finish() {
        val cur = s ?: return
        if (!cur.done) complete(cur)
    }

    override fun abort(reason: String) {
        stopLoop()
        s?.done = true
        onNotice(false)
    }

    private fun startLoop() {
        if (job?.isActive == true) return
        job = scope.launch {
            while (true) {
                delay(tickMs)
                if (!step()) break
            }
        }
    }

    private fun stopLoop() {
        job?.cancel()
        job = null
    }

    /** 한 틱 진행. 계속 돌아야 하면 true */
    fun step(): Boolean {
        val cur = s ?: return false
        if (cur.done) return false
        val now = clock()
        if (!cur.running) {
            // 장애물 재시도 대기
            if (cur.waitUntil in 1..now && cur.lastHold > 0 && now - cur.lastHold <= holdTimeoutMs) {
                cur.waitUntil = 0
                cur.running = true
                cur.lastTick = now
                return true
            }
            return cur.waitUntil > now
        }
        if (contact()) {
            cur.running = false
            cur.done = true
            onNotice(false)
            emit(cur, RspaStatus.CONTACT)
            return false
        }
        if (obstacle()) {
            cur.running = false
            cur.retries += 1
            if (cur.retries > obstacleMaxRetries) {
                cur.done = true
                onNotice(false)
                emit(cur, RspaStatus.ABORTED, "OBSTACLE")
                return false
            }
            cur.waitUntil = now + obstacleRetryMs
            emit(cur, RspaStatus.OBSTACLE)
            return true
        }
        if (cur.lastHold == 0L || now - cur.lastHold > holdTimeoutMs) {
            // 버튼에서 손을 떼면 즉시 정지
            cur.running = false
            onNotice(false)
            emit(cur, RspaStatus.PAUSED)
            return false
        }
        val dt = (now - cur.lastTick).coerceAtLeast(0) / 1000.0
        cur.lastTick = now
        cur.distance = (cur.distance + speedMps * dt).coerceAtMost(cur.max)
        cur.ticks += 1
        if (cur.distance >= cur.max - 1e-6) {
            cur.distance = cur.max
            complete(cur)
            return false
        }
        if (cur.ticks % 5 == 1) emit(cur, RspaStatus.MOVING)
        return true
    }

    private fun complete(cur: Session) {
        cur.running = false
        cur.done = true
        stopLoop()
        onNotice(false)
        emit(cur, RspaStatus.COMPLETED) // P·EPB 자동 체결
    }

    private fun emit(cur: Session, status: RspaStatus, reason: String? = null) {
        flow.tryEmit(RspaProgress(cur.requestId, cur.mode, status, Math.round(cur.distance * 100) / 100.0, cur.max, cur.direction, reason))
    }
}
