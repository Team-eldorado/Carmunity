package com.evneighbor.connect.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.evneighbor.connect.core.Coordinator
import com.evneighbor.connect.core.UiState
import com.evneighbor.connect.data.Settings
import com.evneighbor.connect.vehicle.SimVehicleGateway

@Composable
fun AppScreen(c: Coordinator, sim: SimVehicleGateway?, settings: Settings) {
    val ui by c.ui.collectAsState()
    var tab by rememberSaveable { mutableIntStateOf(if (ui.paired || settings.vehicleId != null) 0 else 3) }
    // 자동 연결이 끝나면 홈으로
    LaunchedEffect(ui.paired) { if (ui.paired && tab == 3) tab = 0 }
    Surface(Modifier.fillMaxSize(), color = Bg) {
        Row(Modifier.fillMaxSize()) {
            Rail(tab) { tab = it }
            Column(Modifier.fillMaxSize()) {
                TopBar(ui)
                Box(Modifier.fillMaxSize().padding(start = 4.dp, end = 14.dp, bottom = 12.dp)) {
                    when (tab) {
                        0 -> HomeScreen(ui, c)
                        1 -> PolicyScreen(ui, c)
                        2 -> DemoScreen(ui, c, sim)
                        else -> SettingsScreen(ui, c, settings, onPaired = { tab = 0 })
                    }
                }
            }
        }
        Overlays(ui, c)
    }
}

@Composable
private fun Rail(tab: Int, onTab: (Int) -> Unit) {
    Column(
        Modifier.fillMaxHeight().width(74.dp).padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(BrandGradient), contentAlignment = Alignment.Center) {
            Text("카", color = Color.White, fontWeight = FontWeight.Black, fontSize = 15.sp)
        }
        Spacer(Modifier.height(10.dp))
        val items = listOf("홈" to Icons.Filled.Home, "위임" to Icons.Filled.Lock, "데모" to Icons.Filled.Build, "설정" to Icons.Filled.Settings)
        items.forEachIndexed { i, (label, icon) ->
            val on = tab == i
            Column(
                Modifier.width(60.dp).clip(RoundedCornerShape(14.dp)).background(if (on) Brand.copy(alpha = 0.16f) else Color.Transparent)
                    .clickable { onTab(i) }.padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(icon, contentDescription = label, tint = if (on) Brand else Muted, modifier = Modifier.size(22.dp))
                Text(label, fontSize = 11.sp, color = if (on) Ink else Muted, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun TopBar(ui: UiState) {
    Row(
        Modifier.fillMaxWidth().height(54.dp).padding(start = 6.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(if (ui.paired) ui.model.ifBlank { "내 차" } else "차량 연결 전", fontWeight = FontWeight.Bold, fontSize = 19.sp, color = Ink)
        if (ui.paired) PlateTag(ui.plate)
        Spacer(Modifier.width(4.dp))
        Chip("기어 ${ui.snapshot.gear.name.replace("UNKNOWN", "-")}", if (ui.isDriving) Warn else Ok)
        Chip(
            when (ui.geofenceInside ?: ui.inComplexServer) { true -> "단지 안"; false -> "단지 밖" },
            if (ui.geofenceInside ?: ui.inComplexServer) BrandLight else Muted,
        )
        if (ui.listening) Chip("🎤 듣는 중", BrandLight)
        Spacer(Modifier.weight(1f))
        Dot(ui.vehicleAvailable, if (ui.vehicleAvailable) "Vehicle SDK" else ui.gatewayName)
        Dot(ui.serverConnected, if (ui.serverConnected) "서버" else "서버 끊김")
    }
}

@Composable
fun PlateTag(plate: String) {
    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(Color.White).padding(horizontal = 8.dp, vertical = 2.dp)) {
        Text(plate, color = Color(0xFF111827), fontWeight = FontWeight.Black, fontSize = 13.sp)
    }
}

@Composable
fun Dot(on: Boolean, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (on) Ok else Err))
        Spacer(Modifier.width(6.dp))
        Text(label, fontSize = 12.sp, color = Muted)
    }
}

@Composable
fun Chip(text: String, color: Color) {
    Box(Modifier.clip(RoundedCornerShape(99.dp)).background(color.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp)) {
        Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun Section(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Surface1).border(1.dp, Line, RoundedCornerShape(20.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = Muted)
        content()
    }
}

@Composable
fun FullHeight(content: @Composable () -> Unit) = Box(Modifier.fillMaxHeight()) { content() }
