package com.evneighbor.connect.data

import android.content.Context
import com.evneighbor.connect.BuildConfig

/** 차량 앱 설정: 매칭 서버 주소와 차량 페어링 정보 */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("evneighbor", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server", BuildConfig.DEFAULT_SERVER) ?: BuildConfig.DEFAULT_SERVER
        set(v) = prefs.edit().putString("server", v.trim().trimEnd('/')).apply()

    var plate: String
        get() = prefs.getString("plate", "12가3456") ?: ""
        set(v) = prefs.edit().putString("plate", v.trim()).apply()

    var pairKey: String
        get() = prefs.getString("key", "demo") ?: ""
        set(v) = prefs.edit().putString("key", v.trim()).apply()

    var vehicleId: String?
        get() = prefs.getString("vehicleId", null)
        set(v) = prefs.edit().putString("vehicleId", v).apply()

    /** Vehicle Service가 없을 때 모의 차량으로 실행 */
    var forceSimVehicle: Boolean
        get() = prefs.getBoolean("simVehicle", false)
        set(v) = prefs.edit().putBoolean("simVehicle", v).apply()
}
