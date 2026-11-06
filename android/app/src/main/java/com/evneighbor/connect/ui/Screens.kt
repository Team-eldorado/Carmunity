package com.evneighbor.connect.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.SwitchDefaults
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.evneighbor.connect.core.Coordinator
import com.evneighbor.connect.core.UiState
import com.evneighbor.connect.data.Settings
import com.evneighbor.connect.safety.Interlock
import com.evneighbor.connect.vehicle.DoorKeys
import com.evneighbor.connect.vehicle.Gear
import com.evneighbor.connect.vehicle.SimVehicleGateway
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ---------------- 홈 ----------------
@Composable
fun HomeScreen(ui: UiState, c: Coordinator) {
    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1.08f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DelegationHero(ui, c)
            CreditCard(ui)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val s = ui.snapshot
            val il = Interlock.evaluate(s)
            Section("차량 상태 · Vehicle SDK") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Tile("기어", s.gear.name.replace("UNKNOWN", "-"), Modifier.weight(1f), if (ui.isDriving) Warn else Ink)
                    Tile("충전", when (s.charging) { true -> "충전 중"; false -> "아님"; null -> "-" }, Modifier.weight(1f))
                    Tile("배터리", s.soc?.let { "$it%" } ?: "-", Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Tile("문·트렁크", if (s.anyDoorOpen) "열림" else "닫힘", Modifier.weight(1f), if (s.anyDoorOpen) Warn else Ink)
                    Tile("실내 탑승", if (s.anyOccupied) "감지" else "없음", Modifier.weight(1f), if (s.anyOccupied) Warn else Ink)
                    Tile("내 자리", ui.homeSpotLabel?.replace("번", "") ?: "-", Modifier.weight(1f))
                }
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background((if (il.ok) Ok else Warn).copy(alpha = 0.12f)).padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(if (il.ok) "✓" else "!", color = if (il.ok) Ok else Warn, fontWeight = FontWeight.Black, fontSize = 16.sp)
                    Text(if (il.ok) "지금 요청이 와도 자가 점검을 통과해요" else il.message, color = if (il.ok) Ok else Warn, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Section("최근 알림") {
                if (ui.notices.isEmpty()) Text("아직 알림이 없어요", color = Muted, fontSize = 14.sp)
                ui.notices.take(3).forEach { n ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(time(n.at), color = Muted, fontSize = 13.sp)
                        Text(n.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun DelegationHero(ui: UiState, c: Coordinator) {
    val on = ui.policy.enabled && ui.policy.move && !ui.policy.pausedToday
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Surface1)
            .border(1.dp, if (on) Ok.copy(alpha = 0.45f) else Line, RoundedCornerShape(22.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("비켜줘 위임", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Text(
                    when {
                        !ui.policy.enabled || !ui.policy.move -> "꺼져 있어요"
                        ui.policy.pausedToday -> "오늘은 쉬는 중"
                        else -> "켜져 있어요"
                    },
                    fontSize = 30.sp, fontWeight = FontWeight.Black, color = if (on) Ok else Ink,
                )
            }
            Switch(
                checked = ui.policy.enabled && ui.policy.move,
                enabled = !ui.isDriving && ui.paired,
                onCheckedChange = { v -> c.updatePolicy(JSONObject().put("enabled", v).put("functions", JSONObject().put("move", v && ui.hasRspa))) },
                colors = SwitchDefaults.colors(checkedTrackColor = Ok, checkedThumbColor = Color.White),
            )
        }
        Text("1회 최대 3m · 하루 ${ui.policy.dailyMoveLimit}회 · 30초 거부 창 · 누르는 동안만", color = Muted, fontSize = 14.sp)
        if (ui.isDriving) Text("주행 중에는 설정할 수 없어요", color = Warn, fontSize = 14.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(enabled = !ui.isDriving && ui.paired, onClick = { c.updatePolicy(JSONObject().put("pausedToday", !ui.policy.pausedToday)) }) {
                Text(if (ui.policy.pausedToday) "오늘 다시 켜기" else "오늘은 안 됨", fontSize = 13.sp)
            }
            OutlinedButton(enabled = !ui.isDriving && ui.paired, onClick = { c.registerNeutral(!ui.neutral) }) {
                Text(if (ui.neutral) "중립 표시 해제" else "N 주차 등록", fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun CreditCard(ui: UiState) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(BrandGradient).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("틈 크레딧", color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${ui.credits.balance}", fontSize = 40.sp, fontWeight = FontWeight.Black, color = Color.White)
            Spacer(Modifier.width(6.dp))
            Text("크레딧", color = Color.White.copy(alpha = 0.8f), fontSize = 14.sp, modifier = Modifier.padding(bottom = 8.dp))
        }
        Text(
            if (ui.credits.monthMoves > 0) "이번 달 ${ui.credits.monthMoves}번 비켜줬어요" else "이번 달 아직 비켜준 기록이 없어요",
            fontSize = 15.sp, color = Color.White, fontWeight = FontWeight.SemiBold,
        )
        ui.credits.thanks?.let { Text("💬 $it", color = Color.White.copy(alpha = 0.9f), fontSize = 13.sp) }
    }
}

@Composable
private fun Tile(label: String, value: String, modifier: Modifier = Modifier, color: Color = Ink) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(Surface2).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(label, color = Muted, fontSize = 12.sp)
        Text(value, color = color, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

fun doorName(k: String) = when (k) {
    DoorKeys.ROW_1_LEFT -> "운전석"
    DoorKeys.ROW_1_RIGHT -> "조수석"
    DoorKeys.ROW_2_LEFT -> "뒷좌석 왼쪽"
    DoorKeys.ROW_2_RIGHT -> "뒷좌석 오른쪽"
    DoorKeys.REAR -> "트렁크"
    else -> k
}

@Composable
fun KV(k: String, v: String) {
    Row {
        Text(k, color = Muted, modifier = Modifier.width(110.dp), fontSize = 16.sp)
        Text(v, fontSize = 16.sp)
    }
}

private fun time(ms: Long) = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(ms))

// ---------------- 위임 설정 (정차 중에만) ----------------
@Composable
fun PolicyScreen(ui: UiState, c: Coordinator) {
    if (!ui.paired) {
        Text("설정 탭에서 차량을 먼저 연결해 주세요", fontSize = 20.sp)
        return
    }
    if (ui.isDriving) {
        Section("위임 설정") {
            Text("주행 중에는 설정할 수 없어요", fontSize = 24.sp, color = Warn)
            Text("정차(P) 후 다시 열어 주세요. 운전 중에는 음성과 한 번 탭으로만 답할 수 있어요.", color = Muted)
        }
        return
    }
    val p = ui.policy
    fun send(build: JSONObject.() -> Unit) = c.updatePolicy(JSONObject().apply(build))
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Section("위임 조건 · 한 번 정해 두면 조건에 맞는 요청에만 1회용 토큰이 발급돼요") {
            ToggleRow("위임 켜기", p.enabled) { send { put("enabled", it) } }
            ToggleRow("무엇을 · 이동(비켜줘)${if (!ui.hasRspa) " — 원격 전·후진 미탑재" else ""}", p.move, enabled = ui.hasRspa) { send { put("functions", JSONObject().put("move", it)) } }
            ToggleRow("무엇을 · 트렁크 1회 개방", p.trunk) { send { put("functions", JSONObject().put("trunk", it)) } }
            ToggleRow("무엇을 · 센서·출차 신호 공유", p.sensor) { send { put("functions", JSONObject().put("sensor", it)) } }
        }
        Section("누가 · 얼마나 · 언제") {
            Text("누가", color = Muted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = p.scopeDongs.isEmpty(), onClick = { send { put("scope", JSONObject().put("type", "complex")) } }, label = { Text("우리 단지 전체") })
                listOf("101", "102", "103", "104").forEach { d ->
                    FilterChip(selected = d in p.scopeDongs, onClick = { send { put("scope", JSONObject().put("type", "dongs").put("dongs", JSONArray().put(d))) } }, label = { Text("${d}동만") })
                }
            }
            Text("하루 횟수 (이동 1회 최대 3m)", color = Muted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (0..2).forEach { n -> FilterChip(selected = p.dailyMoveLimit == n, onClick = { send { put("dailyMoveLimit", n) } }, label = { Text("${n}회") }) }
            }
            ToggleRow("23시~06시에도 허용 (야간 크레딧 가중)", p.allowNight) { send { put("allowNight", it) } }
            ToggleRow("오늘은 안 됨", p.pausedToday) { send { put("pausedToday", it) } }
            Text("어디서 · 단지 지하주차장 지오펜스 안에서만 유효  ·  유효기간 · 요청 시점 발급, 10분 뒤 소멸, 1회 사용", color = Muted)
        }
    }
}

@Composable
fun ToggleRow(label: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(label, fontSize = 17.sp, modifier = Modifier.weight(1f))
        Switch(checked = checked, enabled = enabled, onCheckedChange = onChange)
    }
}

// ---------------- 데모 (모의 차량 · 원격 이동 상황) ----------------
@Composable
fun DemoScreen(ui: UiState, c: Coordinator, sim: SimVehicleGateway?) {
    val obstacle by c.simObstacle.collectAsState()
    val contact by c.simContact.collectAsState()
    val blocked by c.simReturnBlocked.collectAsState()
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (sim != null) {
                Section("모의 차량 (Vehicle Service 없음)") {
                    Text("기어", color = Muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(Gear.P, Gear.N, Gear.D, Gear.R).forEach { g ->
                            FilterChip(selected = ui.snapshot.gear == g, onClick = { sim.setGear(g) }, label = { Text(g.name) })
                        }
                    }
                    Text("문 · 트렁크", color = Muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DoorKeys.ALL.forEach { k -> FilterChip(selected = (ui.snapshot.doors[k] ?: 0) > 0, onClick = { sim.toggleDoor(k) }, label = { Text(doorName(k)) }) }
                    }
                    Text("탑승 · 충전", color = Muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = ui.snapshot.occupied["ROW_2_RIGHT"] == true, onClick = { sim.toggleSeat("ROW_2_RIGHT") }, label = { Text("뒷좌석 탑승") })
                        FilterChip(selected = ui.snapshot.charging == true, onClick = { sim.toggleCharging() }, label = { Text("충전 케이블") })
                        FilterChip(selected = false, onClick = { sim.addOdometer(0.05f) }, label = { Text("주행거리 +50m") })
                    }
                    Text("배터리 ${ui.snapshot.soc ?: 0}%", color = Muted)
                    Slider(value = (ui.snapshot.soc ?: 0).toFloat(), onValueChange = { sim.setSoc(it.toInt()) }, valueRange = 0f..100f)
                }
            } else {
                Section("실제 차량 신호") {
                    Text("Pleos Vehicle Service에 연결돼 있어요. 기어·문·좌석·충전 값은 Pleos Connect Virtual Console(http://127.0.0.1:8088)에서 바꿔 보세요.", color = Muted)
                }
            }
            Section("지오펜스 (FusedLocation)") {
                Text("실제 위치 변화 대신 단지 진입·이탈을 흉내 낼 수 있어요", color = Muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { c.simulateGeofence(true) }) { Text("입차 게이트 통과") }
                    OutlinedButton(onClick = { c.simulateGeofence(false) }) { Text("단지 밖으로") }
                }
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Section("원격 이동 상황 (모의 RSPA)") {
                Text("원격 전·후진은 SDK에 없어 인터페이스를 정의하고 모의 구현으로 시연해요", color = Muted)
                ToggleRow("진로 장애물", obstacle) { c.simObstacle.value = it }
                ToggleRow("이동 중 접촉", contact) { c.simContact.value = it }
                ToggleRow("복귀 자리 막힘", blocked) { c.simReturnBlocked.value = it }
            }
            Section("음성 시험") {
                var heard by remember { mutableStateOf("") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { c.voice.sayAsync("오늘 밤 비켜줘를 켜 둘까요?") }) { Text("말하기 (TTS)") }
                    OutlinedButton(onClick = { heard = "듣는 중…" }) { Text("최근 인식: ${ui.lastHeard.ifBlank { "-" }}") }
                }
                if (heard.isNotBlank()) Text("화면 버튼으로도 언제든 답할 수 있어요", color = Muted)
                Text("내비: ${ui.naviStatus.ifBlank { "대기" }}", color = Muted)
            }
        }
    }
}

// ---------------- 설정 / 페어링 ----------------
@Composable
fun SettingsScreen(ui: UiState, c: Coordinator, settings: Settings, onPaired: () -> Unit) {
    var server by remember { mutableStateOf(settings.serverUrl) }
    var plate by remember { mutableStateOf(settings.plate) }
    var key by remember { mutableStateOf(settings.pairKey) }
    var sim by remember { mutableStateOf(settings.forceSimVehicle) }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Section("차량 연결") {
            Text("차주 폰의 카뮤니티 웹(내 정보)에서 차량 번호와 페어링 키를 확인할 수 있어요", color = Muted)
            OutlinedTextField(server, { server = it }, label = { Text("매칭 서버 주소 (에뮬레이터: http://10.0.2.2:8080)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(plate, { plate = it }, label = { Text("차량 번호") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(key, { key = it }, label = { Text("페어링 키") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(enabled = !ui.pairing && !ui.isDriving, onClick = { c.pair(server, plate, key) }, colors = ButtonDefaults.buttonColors()) {
                    Text(if (ui.pairing) "연결 중…" else "연결")
                }
                if (ui.paired) OutlinedButton(onClick = { c.unpair() }) { Text("연결 해제") }
                if (ui.paired) Button(onClick = onPaired) { Text("홈으로") }
            }
            ui.pairError?.let { Text(it, color = Err) }
            if (ui.paired) Text("연결됨 · ${ui.model} ${ui.plate} · 차주 ${ui.ownerNickname}", color = Ok)
        }
        Section("차량 신호") {
            Text("현재: ${ui.gatewayName}", color = Muted)
            ToggleRow("모의 차량으로 실행 (앱 재시작 후 적용)", sim) { sim = it; settings.forceSimVehicle = it }
        }
        Spacer(Modifier.height(40.dp))
    }
}
