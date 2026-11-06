package com.evneighbor.connect.location

import ai.pleos.playground.location.fused.FusedLocation
import ai.pleos.playground.location.fused.listener.FusedLocationListener
import ai.pleos.playground.location.fused.listener.ProximityAlertListener
import ai.pleos.playground.location.fused.model.LocationData
import ai.pleos.playground.location.fused.model.ProximityAlertEvent
import ai.pleos.playground.location.fused.model.ProximityAlertRequest
import ai.pleos.playground.location.fused.model.ProximityTransition
import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 단지 지오펜스 (Pleos FusedLocation SDK)
 * - addProximityAlert 로 단지 반경 진입 = 입차 게이트 통과, 이탈 = 단지 밖
 * - 위치 업데이트로 마지막 좌표를 유지 (지하에서는 GPS 대신 FusedLocation의 추측항법 값)
 * 위임 토큰은 지오펜스 안에서만 유효하다.
 */
class GeofenceMonitor(private val context: Context) {
    private val tag = "Geofence"
    private var fused: FusedLocation? = null
    private var alertId: String? = null
    private val _inside = MutableStateFlow<Boolean?>(null)
    val inside: StateFlow<Boolean?> = _inside
    private val _location = MutableStateFlow<LocationData?>(null)
    val location: StateFlow<LocationData?> = _location
    private val _supported = MutableStateFlow(false)
    val supported: StateFlow<Boolean> = _supported
    var onTransition: (entered: Boolean) -> Unit = {}

    private val locationListener = object : FusedLocationListener {
        override fun onChanged(location: LocationData?) {
            if (location != null) _location.value = location
        }
        override fun onError(exception: Exception) { Log.w(tag, "location: ${exception.message}") }
    }

    private val alertListener = object : ProximityAlertListener {
        override fun onRegistered(alertId: String) { this@GeofenceMonitor.alertId = alertId }
        override fun onTransition(event: ProximityAlertEvent) {
            val entered = event.transition == ProximityTransition.ENTER
            _inside.value = entered
            onTransition(entered)
        }
        override fun onError(exception: Exception) { Log.w(tag, "proximity: ${exception.message}") }
    }

    /** FUSED_LOCATION 권한(dangerous)을 받은 뒤 호출 */
    fun start(lat: Double, lng: Double, radiusM: Float) {
        runCatching {
            val f = fused ?: FusedLocation(context.applicationContext).also { fused = it }
            if (!f.isSupported()) {
                _supported.value = false
                return
            }
            f.initialize()
            _supported.value = true
            f.registerFusedLocationCallback(locationListener)
            f.getLastKnownLocation(object : FusedLocationListener {
                override fun onChanged(location: LocationData?) {
                    if (location != null) {
                        _location.value = location
                        if (_inside.value == null) _inside.value = distanceM(location.latitude, location.longitude, lat, lng) <= radiusM
                    }
                }
                override fun onError(exception: Exception) = Unit
            })
            alertId?.let { f.removeProximityAlert(it) }
            f.addProximityAlert(
                ProximityAlertRequest(lat, lng, radiusM, setOf(ProximityTransition.ENTER, ProximityTransition.EXIT)),
                alertListener,
            )
        }.onFailure {
            Log.w(tag, "FusedLocation 사용 불가: ${it.message}")
            _supported.value = false
        }
    }

    fun stop() {
        runCatching {
            fused?.let { f ->
                alertId?.let { f.removeProximityAlert(it) }
                f.unregisterFusedLocationCallback(locationListener)
                f.release()
            }
        }
        fused = null
    }

    /** 개발 패널: 지오펜스 진입/이탈 흉내 */
    fun simulate(entered: Boolean) {
        _inside.value = entered
        onTransition(entered)
    }

    companion object {
        fun distanceM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
            val r = 6_371_000.0
            val dLat = Math.toRadians(lat2 - lat1)
            val dLng = Math.toRadians(lng2 - lng1)
            val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
            return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        }
    }
}
