package com.evneighbor.connect.ui

import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.evneighbor.connect.EvApp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val app get() = application as EvApp

    // FUSED_LOCATION 은 protection level dangerous → 실행 중 요청
    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) lifecycleScope.launch { runCatching { app.coordinator.loadVehicle() } }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (ContextCompat.checkSelfPermission(this, FUSED) != PackageManager.PERMISSION_GRANTED) {
            runCatching { locationPermission.launch(FUSED) }
        }
        setContent {
            EvTheme {
                AppScreen(app.coordinator, app.simGateway, app.settings)
            }
        }
    }

    companion object {
        const val FUSED = "pleos.car.permission.FUSED_LOCATION"
    }
}
