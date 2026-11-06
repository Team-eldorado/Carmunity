package com.evneighbor.connect.navi

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.RouteOption
import ai.pleos.playground.navi.data.DestinationArrivedInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 빈자리 안내 경로 (Pleos NaviHelper SDK)
 * 운전자가 '갈게요'라고 답하면 빈자리 좌표를 목적지로 넘겨 내비게이션 화면에서 그 구역까지 안내한다.
 */
class NaviGuide(private val context: Context) {
    private val tag = "NaviGuide"
    private var navi: NaviHelper? = null
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected
    private val _status = MutableStateFlow("")
    val status: StateFlow<String> = _status
    var onArrived: () -> Unit = {}

    private val listener = object : NaviHelperEventListener {
        override fun onRoutingCompleted() {
            _status.value = "경로 안내 중"
            Log.i(tag, "routing completed") // 시연 녹화 스크립트가 경로 화면이 뜬 시점을 알 수 있게
        }
        override fun onDestinationArrived(destinationArrivedInfo: DestinationArrivedInfo) {
            _status.value = "빈자리 도착"
            onArrived()
        }
        override fun onError(errorCode: NaviErrorCode) {
            _status.value = "내비 오류: $errorCode"
            Log.w(tag, "navi error $errorCode")
        }
    }

    fun start() {
        runCatching {
            val n = NaviHelper(context.applicationContext)
            n.initialize(
                {
                    _connected.value = true
                    n.addListener(listener)
                },
                { t -> Log.w(tag, "NaviHelper 연결 실패: ${t.message}") },
            )
            navi = n
        }.onFailure { Log.w(tag, "NaviHelper 사용 불가: ${it.message}") }
    }

    fun stop() {
        runCatching { navi?.removeListener(listener); navi?.release() }
        navi = null
        _connected.value = false
    }

    /** 빈자리로 경로 요청. 성공 여부는 이벤트로 전달된다. */
    fun guideTo(lat: Double, lng: Double, name: String, spotId: String): Boolean {
        val n = navi ?: return false
        return runCatching {
            n.requestRoute(
                RouteInfo(
                    latitude = lat,
                    longitude = lng,
                    displayLatitude = null,
                    displayLongitude = null,
                    poiName = name,
                    poiId = "evneighbor-$spotId",
                    address = name,
                    poiSubId = "0",
                    routeOption = RouteOption.SHORT_DISTANCE,
                ),
            )
            _status.value = "$name 으로 안내 요청"
            true
        }.getOrElse {
            Log.w(tag, "requestRoute 실패: ${it.message}")
            false
        }
    }

    fun cancel() {
        runCatching { navi?.cancelRoute() }
    }
}
