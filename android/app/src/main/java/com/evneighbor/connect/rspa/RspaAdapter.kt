package com.evneighbor.connect.rspa

import kotlinx.coroutines.flow.SharedFlow

enum class Direction { FORWARD, BACKWARD;
    companion object {
        fun from(s: String?) = if (s == "backward") BACKWARD else FORWARD
    }
}

enum class MoveMode { MOVE, RETURN, TIDY;
    companion object {
        fun from(s: String?) = when (s) { "return" -> RETURN; "tidy" -> TIDY; else -> MOVE }
    }
}

/** 차량이 서버로 보고하는 진행 상태 (서버 move-progress API와 같은 값) */
enum class RspaStatus(val wire: String) {
    MOVING("moving"), PAUSED("paused"), OBSTACLE("obstacle"), ABORTED("aborted"),
    CONTACT("contact"), BLOCKED("blocked"), COMPLETED("completed"),
}

data class RspaProgress(
    val requestId: String,
    val mode: MoveMode,
    val status: RspaStatus,
    val distanceM: Double,
    val maxM: Double,
    val direction: Direction,
    val reason: String? = null,
)

/**
 * 원격 전·후진(원격 스마트 주차 보조) 어댑터.
 *
 * Pleos Connect SDK에는 원격 이동 API가 없어서, 기획서의 2단계(OEM 제휴 후)에 붙을 인터페이스를 정의하고
 * 공모전 기간에는 [SimulatedRspaAdapter]로 같은 규칙을 시연한다.
 * - 요청자가 버튼을 누르는 동안만(hold 신호가 끊기면 즉시 정지) 보행 속도로 움직인다
 * - 직진·후진만, 조향 없음, 1회 최대 3m
 * - 장애물 감지 시 정지, 5초 뒤 자동 재시도 3회, 계속 막히면 중단
 * - 접촉 감지 시 즉시 정지
 * - 완료 시 P·EPB 체결
 */
interface RspaAdapter {
    val progress: SharedFlow<RspaProgress>

    /** 위임 토큰으로 이동을 준비한다. 실제 움직임은 [hold] 신호가 들어올 때만. */
    fun requestMove(requestId: String, token: String?, direction: Direction, maxDistanceM: Double, mode: MoveMode)
    fun hold()
    fun release()
    fun finish()
    fun abort(reason: String)
    val activeRequestId: String?
}
