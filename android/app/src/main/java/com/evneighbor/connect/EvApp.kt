package com.evneighbor.connect

import android.app.Application
import com.evneighbor.connect.core.Coordinator
import com.evneighbor.connect.data.Settings
import com.evneighbor.connect.location.GeofenceMonitor
import com.evneighbor.connect.navi.NaviGuide
import com.evneighbor.connect.net.ApiClient
import com.evneighbor.connect.net.EventStream
import com.evneighbor.connect.rspa.SimulatedRspaAdapter
import com.evneighbor.connect.vehicle.PleosVehicleGateway
import com.evneighbor.connect.vehicle.SimVehicleGateway
import com.evneighbor.connect.vehicle.VehicleGateway
import com.evneighbor.connect.voice.VoiceAssistant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class EvApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    lateinit var settings: Settings
        private set
    lateinit var coordinator: Coordinator
        private set
    var simGateway: SimVehicleGateway? = null
        private set

    override fun onCreate() {
        super.onCreate()
        settings = Settings(this)
        val gateway: VehicleGateway = chooseGateway()
        val api = ApiClient({ settings.serverUrl }, { settings.pairKey })
        coordinator = Coordinator(
            scope = scope,
            settings = settings,
            gateway = gateway,
            api = api,
            stream = EventStream(scope),
            voice = VoiceAssistant(this),
            geofence = GeofenceMonitor(this),
            navi = NaviGuide(this),
            rspa = SimulatedRspaAdapter(scope),
        )
        coordinator.start()
    }

    /** Pleos Vehicle Service가 있으면 실제 SDK, 없으면 모의 차량 */
    private fun chooseGateway(): VehicleGateway {
        if (!settings.forceSimVehicle && hasVehicleService()) return PleosVehicleGateway(this, scope)
        return SimVehicleGateway().also { simGateway = it }
    }

    /** Vehicle SDK가 바인딩하는 서비스 (SDK 매니페스트의 queries 항목과 같은 액션) */
    private fun hasVehicleService(): Boolean = runCatching {
        packageManager.queryIntentServices(android.content.Intent("ai.pleos.playground.vehicle.VEHICLE_START"), 0).isNotEmpty()
    }.getOrDefault(false)
}
