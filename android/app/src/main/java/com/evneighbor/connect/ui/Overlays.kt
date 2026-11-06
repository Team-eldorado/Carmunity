package com.evneighbor.connect.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.layout.fillMaxHeight
import com.evneighbor.connect.core.BleUi
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import com.evneighbor.connect.core.CheckItem
import com.evneighbor.connect.core.CheckUi
import com.evneighbor.connect.core.CompactUi
import com.evneighbor.connect.core.VacancyUi
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.evneighbor.connect.core.Coordinator
import com.evneighbor.connect.core.MoveUi
import com.evneighbor.connect.core.UiState
import com.evneighbor.connect.rspa.Direction
import com.evneighbor.connect.rspa.MoveMode
import kotlinx.coroutines.delay
import android.util.Log
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView

/** 어떤 화면 위에도 뜨는 카드들: 주차 직후 질문, 비켜줘 수신, 원격 이동, 트렁크, 빈자리 안내 */
@Composable
fun Overlays(ui: UiState, c: Coordinator) {
    val any = ui.veto != null || ui.trunk != null || ui.move != null || ui.vacancy != null || ui.prompt != null || ui.check != null || ui.compact != null
    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(any, enter = fadeIn(tween(250)), exit = fadeOut(tween(250))) {
            Box(Modifier.fillMaxSize().background(Color(0xB3050810)))
        }
        AnimatedVisibility(any, Modifier.align(Alignment.Center), enter = fadeIn(tween(250)) + scaleIn(tween(300), initialScale = 0.94f), exit = fadeOut(tween(200))) {
            Column(Modifier.width(600.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // 허락·거부는 차주 폰에서 한다. 차 화면은 요청을 받았다는 상태만 보여 준다.
                ui.veto?.let { v ->
                    Card("📨", "비켜줘 요청 수신", Warn) {
                        Text("${v.requester}님이\n비켜줘를 요청했어요", fontSize = 26.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            CountdownRing(v.expiresAt, 30, Warn)
                            Text("차주 폰에서 확인 중이에요.\n거부가 없으면 허락한 조건대로 진행돼요.", color = Muted, fontSize = 15.sp, lineHeight = 22.sp)
                        }
                    }
                }
                ui.check?.let { CheckCard(it) }
                ui.trunk?.let { t ->
                    Card("📦", "트렁크 드롭", BrandLight) {
                        Text(t.text.ifBlank { trunkText(t.status) }, fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 30.sp)
                        Text("테일게이트만 열려요 · 실내 도어는 잠긴 채 · 전후 10초 후방 영상", color = Muted, fontSize = 14.sp)
                        if (t.status == "issued") BleBox(ui.ble, "trunk")
                        if (t.status in setOf("opening", "open")) RecLine()
                    }
                }
                if (ui.check == null) ui.move?.let { m -> MoveCard(m, ui.interlockText, ui.ble) }
                ui.compact?.let { CompactCard(it, ui, c) }
                ui.vacancy?.let { v ->
                    Card("📡", if (v.parked) "빈자리 주차 완료" else if (v.accepted) "빈자리로 안내 중" else "빈자리 레이더 · 이웃 차량 신호", Ok) {
                        Text(v.message.replace(" · ", "\n"), fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 30.sp)
                        if (v.radar.isNotEmpty()) RadarRow(v)
                        else v.spot?.let { Text("${it.label}${if (it.type == "ev_charger") " · 충전기 칸" else ""}", color = Muted, fontSize = 16.sp) }
                        if (!v.accepted) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                CountdownRing(v.expiresAt, 60, Ok)
                                BigButton("갈게요", Ok, Modifier.weight(1f)) { c.answerVacancy(true) }
                                GhostButton("괜찮아요", Modifier.weight(1f)) { c.answerVacancy(false) }
                            }
                        } else {
                            if (v.parked) Text("✓ ${v.spot?.label ?: "빈자리"}에 주차했어요 · 기어 P", color = Ok, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            else Text("${v.spot?.label ?: "빈자리"}을 잡아 뒀어요 · 미니맵의 초록 칸으로 가세요", color = Ok, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                ui.prompt?.let { p ->
                    Card("🅿", "주차 완료 · 음성 질문", BrandLight) {
                        Text(p.text, fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 36.sp)
                        MicLine(ui.listening)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            BigButton("응", Ok, Modifier.weight(1f)) { c.answerPrompt(p.kind, true) }
                            GhostButton("아니", Modifier.weight(1f)) { c.answerPrompt(p.kind, false) }
                        }
                    }
                }
            }
        }
        if (ui.pickSpot) SpotPicker(ui, c)
    }
}

private fun trunkText(status: String) = when (status) {
    "issued" -> "이웃에게 트렁크 1회 개방 토큰을 보냈어요"
    "opening" -> "트렁크를 여는 중이에요"
    "open" -> "이웃이 트렁크를 열었어요"
    "completed" -> "전달을 마쳤어요 · 차주에게 알렸어요"
    "unclosed" -> "트렁크가 아직 열려 있어요"
    "expired" -> "토큰이 만료됐어요"
    "cancelled" -> "토큰을 취소했어요"
    else -> status
}

@Composable
private fun Card(icon: String, title: String, accent: Color, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(Surface2)
            .border(1.dp, accent.copy(alpha = 0.35f), RoundedCornerShape(26.dp)).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(34.dp).clip(CircleShape).background(accent.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) { Text(icon, fontSize = 16.sp) }
            Text(title, color = accent, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }
        content()
    }
}

@Composable
private fun MicLine(listening: Boolean) {
    val pulse = rememberInfiniteTransition(label = "mic")
    val a by pulse.animateFloat(0.35f, 1f, infiniteRepeatable(tween(700, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "a")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(12.dp).scale(if (listening) 0.8f + a * 0.4f else 1f).alpha(if (listening) a else 0.5f).clip(CircleShape).background(if (listening) Err else Muted))
        Text(if (listening) "듣고 있어요 · '응' 또는 '아니'라고 말해 주세요" else "음성으로 답하거나 화면을 눌러 주세요", color = Muted, fontSize = 15.sp)
    }
}

@Composable
private fun BigButton(text: String, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    // 시연 녹화 스크립트가 버튼을 화면 좌표로 누를 수 있게 위치를 로그로 남긴다 (반복 애니메이션 중에는 UI 덤프가 안 됨)
    val view = LocalView.current
    Button(
        onClick = onClick, shape = RoundedCornerShape(18.dp),
        modifier = modifier.height(60.dp).onGloballyPositioned { c ->
            val loc = IntArray(2).also { view.getLocationOnScreen(it) }
            val b = c.boundsInRoot()
            Log.d("TapTarget", "$text|${(loc[0] + b.center.x).toInt()}|${(loc[1] + b.center.y).toInt()}")
        },
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color(0xFF06110C)),
    ) { Text(text, fontSize = 22.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun GhostButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = modifier.height(60.dp), shape = RoundedCornerShape(18.dp)) {
        Text(text, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Ink)
    }
}

@Composable
private fun CountdownRing(expiresAt: Long, total: Int, color: Color) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(expiresAt) {
        while (now < expiresAt) {
            delay(200)
            now = System.currentTimeMillis()
        }
    }
    val left = ((expiresAt - now) / 1000).coerceAtLeast(0)
    val frac by animateFloatAsState((left.toFloat() / total).coerceIn(0f, 1f), tween(200), label = "ring")
    Box(Modifier.size(60.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(progress = { frac }, modifier = Modifier.fillMaxSize(), color = color, trackColor = Color(0x22FFFFFF), strokeWidth = 5.dp)
        Text("$left", fontSize = 20.sp, fontWeight = FontWeight.Black)
    }
}

/** 원격 이동 시각화: 원래 자리(점선)와 지금 위치, 이동 거리 */
@Composable
private fun MoveCard(m: MoveUi, interlock: String?, ble: BleUi?) {
    val color = when {
        m.phase.contains("중단") || m.phase.contains("접촉") -> Err
        m.phase.contains("정지") || m.phase.contains("장애물") || m.phase.contains("막힘") -> Warn
        else -> Ok
    }
    Card("↔", "비켜줘 · 원격 이동", color) {
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text(m.phase, fontSize = 28.sp, fontWeight = FontWeight.Black, color = Ink)
                Text(m.text, fontSize = 15.sp, color = Muted, lineHeight = 21.sp)
            }
            Spacer(Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text("%.1f m".format(m.distance), fontSize = 40.sp, fontWeight = FontWeight.Black, color = color)
                Text("최대 %.1fm · %s".format(m.max, if (m.mode == MoveMode.RETURN) "복귀" else if (m.direction == Direction.FORWARD) "앞으로" else "뒤로"), color = Muted, fontSize = 13.sp)
            }
        }
        val frac = if (m.max > 0) (m.distance / m.max).toFloat().coerceIn(0f, 1f) else 0f
        val anim by animateFloatAsState(frac, label = "move")
        BoxWithConstraints(Modifier.fillMaxWidth().height(74.dp).clip(RoundedCornerShape(16.dp)).background(Color(0xFF0A1019))) {
            val carW = 96.dp
            val track = maxWidth - carW - 24.dp
            val forward = m.direction == Direction.FORWARD
            val start = if (forward) 0.dp else track
            // 원래 자리
            Box(Modifier.offset(x = 12.dp + start, y = 15.dp).size(carW, 44.dp).clip(RoundedCornerShape(12.dp)).border(1.5.dp, Muted.copy(alpha = 0.6f), RoundedCornerShape(12.dp)))
            val p = if (m.mode == MoveMode.RETURN) 1f - anim else anim
            val x = if (forward) track * p else track * (1f - p)
            Box(Modifier.offset(x = 12.dp + x, y = 15.dp).size(carW, 44.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFD7DBE0)), contentAlignment = Alignment.Center) {
                Text(if (forward) "아이오닉 5 ▶" else "◀ 아이오닉 5", color = Color(0xFF111827), fontWeight = FontWeight.Black, fontSize = 12.sp)
            }
        }
        interlock?.let { Chip(if (it.contains("통과")) "✓ $it" else it, if (it.contains("통과")) Ok else Warn) }
        if (!m.phase.contains("완료") && m.phase != "종료") BleBox(ble, if (m.mode == MoveMode.RETURN) "return" else "move")
    }
}

/** 차량 자가 점검: Vehicle SDK 값을 한 줄씩 확인 */
@Composable
private fun CheckCard(ch: CheckUi) {
    val color = if (!ch.done) BrandLight else if (ch.ok) Ok else Err
    Card("🛡", "차량 자가 점검 · Vehicle SDK", color) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ch.items.forEachIndexed { i, item ->
                val state = when {
                    i < ch.shown -> if (item.ok) 1 else 2
                    i == ch.shown && !ch.done -> 0
                    else -> -1
                }
                CheckRow(item, state)
            }
        }
        if (ch.done) {
            Text(ch.result, fontSize = 22.sp, fontWeight = FontWeight.Black, color = color)
        }
    }
}

@Composable
private fun CheckRow(item: CheckItem, state: Int) { // -1 대기 · 0 확인 중 · 1 통과 · 2 걸림
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .background(if (state == 2) Err.copy(alpha = 0.16f) else Color(0xFF0A1019))
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) {
            when (state) {
                0 -> CircularProgressIndicator(Modifier.size(18.dp), color = BrandLight, strokeWidth = 2.5.dp)
                1 -> Text("✓", color = Ok, fontWeight = FontWeight.Black, fontSize = 19.sp)
                2 -> Text("✕", color = Err, fontWeight = FontWeight.Black, fontSize = 19.sp)
                else -> Box(Modifier.size(8.dp).clip(CircleShape).background(Muted.copy(alpha = 0.4f)))
            }
        }
        Spacer(Modifier.width(10.dp))
        Text(item.label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = if (state < 0) Muted else Ink, modifier = Modifier.weight(1f))
        Text(item.source, fontSize = 11.sp, color = Muted, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Color(0x14FFFFFF)).padding(horizontal = 6.dp, vertical = 2.dp))
        Text(
            if (state >= 1) item.value else if (state == 0) "확인 중" else "",
            fontSize = 16.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.End,
            color = when (state) { 2 -> Err; 0 -> Muted; else -> Ink },
            modifier = Modifier.width(150.dp),
        )
    }
}

/** 차가 BLE로 잰 요청자(차주) 폰 위치: 위에서 본 차 + 허용 구역(초록) · 진로(빨강) + 폰 위치 */
@Composable
private fun BleBox(b: BleUi?, kind: String) {
    val (ok, text) = bleText(b, kind)
    val col = if (ok) Ok else Warn
    val pulse = rememberInfiniteTransition(label = "ble")
    val a by pulse.animateFloat(0f, 1f, infiniteRepeatable(tween(1400), RepeatMode.Restart), label = "a")
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(col.copy(alpha = 0.10f))
            .border(1.5.dp, col.copy(alpha = 0.55f), RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Canvas(Modifier.size(170.dp, 78.dp)) {
            val m = if (kind == "return") minOf(size.width / 15f, size.height / 13f) else minOf(size.width / 11.5f, size.height / 6.4f)
            val cx = size.width / 2f
            val cy = size.height / 2f
            val L = 4.6f * m
            val W = 1.9f * m
            val green = Ok.copy(alpha = 0.18f)
            val red = Err.copy(alpha = 0.16f)
            when (kind) {
                "move" -> {
                    drawRect(green, Offset(cx - L / 2, cy - W / 2 - 2 * m), Size(L, 2 * m))
                    drawRect(green, Offset(cx - L / 2, cy + W / 2), Size(L, 2 * m))
                    drawRect(red, Offset(cx + L / 2 + 2f, cy - W / 2), Size(3 * m, W))
                    drawRect(red, Offset(cx - L / 2 - 2f - 3 * m, cy - W / 2), Size(3 * m, W))
                }
                "trunk" -> drawRect(green, Offset(cx - L / 2 - 2f - 2 * m, cy - W / 2 - 4f), Size(2 * m, W + 8f))
                "return" -> {
                    // 차에서 6m 안(초록) · 복귀 경로(빨강, 차 뒤 4m)
                    drawRoundRect(green.copy(alpha = 0.10f), Offset(cx - L / 2 - 6 * m, cy - 6 * m), Size(L + 12 * m, 12 * m), CornerRadius(6 * m))
                    drawRect(red, Offset(cx - L / 2 - 2f - 4 * m, cy - W / 2), Size(4 * m, W))
                }
                else -> drawRoundRect(green.copy(alpha = 0.10f), Offset(cx - L / 2 - 2.2f * m, cy - W / 2 - 1.9f * m), Size(L + 4.4f * m, W + 3.8f * m), CornerRadius(2.6f * m))
            }
            drawRoundRect(Color(0xFFD7DBE0), Offset(cx - L / 2, cy - W / 2), Size(L, W), CornerRadius(8f))
            drawRoundRect(Color(0xFF8A95A8), Offset(cx + L / 2 - 0.9f * m, cy - W / 2 + 4f), Size(0.45f * m, W - 8f), CornerRadius(3f))
            if (b != null && b.zone != "far") {
                val d = b.distanceM.toFloat().coerceIn(0f, if (kind == "return") 6.5f else 3f) * m
                val c = when (b.zone) {
                    "side" -> Offset(cx - 0.4f * m, cy + W / 2 + d)
                    "front" -> Offset(cx + L / 2 + d, cy)
                    "rear" -> Offset(cx - L / 2 - d, cy)
                    else -> Offset(cx - 0.6f * m, cy)
                }
                val r = 5.5.dp.toPx()
                drawCircle(col.copy(alpha = 1f - a), radius = r + a * 14.dp.toPx(), center = c, style = Stroke(2.dp.toPx()))
                drawCircle(col, radius = r, center = c)
                drawCircle(Color.White, radius = r, center = c, style = Stroke(2.dp.toPx()))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(if (kind == "return") "BLE 근접 확인 · 요청자는 자기 차 안에서" else "BLE 근접 확인 · 차가 직접 측정", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(if (ok) "✓ $text" else text, color = col, fontSize = 19.sp, fontWeight = FontWeight.Black, lineHeight = 24.sp)
        }
    }
}

private fun bleText(b: BleUi?, kind: String): Pair<Boolean, String> {
    val d = b?.distanceM ?: 0.0
    return when {
        b == null -> false to (if (kind == "compact") "차주 폰을 찾는 중" else "요청자 폰을 찾는 중")
        b.zone == "far" -> false to "폰이 범위 밖"
        kind == "compact" && b.zone == "inside" -> false to "폰이 아직 차 안"
        kind == "compact" -> (d <= 4.0) to "차주 폰 · 차 밖 %.1fm".format(d)
        kind == "trunk" -> (b.zone in setOf("rear", "side") && d <= 2.0) to "트렁크 뒤 %.1fm".format(d)
        kind == "return" && b.zone == "rear" && d <= 4.0 -> false to "요청자가 복귀 경로에 있음"
        kind == "return" -> (d <= 6.0) to (if (d <= 6.0) "요청자 · %.1fm · 복귀 경로 밖".format(d) else "요청자가 6m 밖")
        b.zone == "front" || b.zone == "rear" -> false to "요청자가 진로에 있음"
        else -> (b.zone == "side" && d <= 2.0) to "요청자 · 차 옆 %.1fm".format(d)
    }
}

/** 트렁크가 열려 있는 동안 후방 영상 녹화 표시 */
@Composable
private fun RecLine() {
    val pulse = rememberInfiniteTransition(label = "rec")
    val a by pulse.animateFloat(0.3f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "a")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(10.dp).alpha(a).clip(CircleShape).background(Err))
        Text("후방 카메라 녹화 중 · 미등 점멸로 촬영 고지", color = Ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** 빈자리 레이더 미니맵: 나간 차가 알린 빈 칸과, 그 칸을 확인한 옆 차들 */
@Composable
private fun RadarRow(v: VacancyUi) {
    val pulse = rememberInfiniteTransition(label = "radar")
    val a by pulse.animateFloat(0f, 1f, infiniteRepeatable(tween(1400), RepeatMode.Restart), label = "a")
    val witnesses = v.radar.count { it.state == "witness" }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFF0A1019)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("${v.zoneName.ifBlank { "주차 구역" }} · 차량들이 보낸 신호", fontSize = 13.sp, color = Muted, fontWeight = FontWeight.SemiBold)
        Row(Modifier.fillMaxWidth().height(92.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            v.radar.forEach { sp ->
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    when (sp.state) {
                        "vacant" -> {
                            Box(Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp)).background(Ok.copy(alpha = 0.10f + 0.12f * (1 - a))).border(2.dp, Ok, RoundedCornerShape(10.dp)))
                            Box(Modifier.size((26 + 46 * a).dp).alpha(1 - a).border(2.dp, Ok, CircleShape))
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("P", color = Ok, fontSize = 26.sp, fontWeight = FontWeight.Black)
                                Text(sp.no, color = Ok, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        "witness" -> {
                            Box(Modifier.fillMaxWidth(0.86f).fillMaxHeight(0.82f).clip(RoundedCornerShape(10.dp)).background(BrandLight.copy(alpha = 0.16f)).border(2.dp, BrandLight.copy(alpha = 0.5f + 0.5f * (1 - a)), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text("📡", fontSize = 15.sp)
                                    Text("확인", color = BrandLight, fontSize = 12.sp, fontWeight = FontWeight.Black)
                                    Text(sp.model ?: "", color = Muted, fontSize = 10.sp, maxLines = 1)
                                }
                            }
                        }
                        "taken" -> Box(Modifier.fillMaxWidth(0.86f).fillMaxHeight(0.82f).clip(RoundedCornerShape(10.dp)).background(Color(0xFF2A313D)), contentAlignment = Alignment.Center) {
                            Text(sp.model ?: "", color = Muted, fontSize = 10.sp, maxLines = 1)
                        }
                        else -> Box(Modifier.fillMaxSize().border(1.dp, Muted.copy(alpha = 0.3f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                            Text(sp.no, color = Muted, fontSize = 11.sp)
                        }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            v.departed?.let { Chip("↗ $it 출차 신호", Ok) }
            if (witnesses > 0) Chip("📡 옆 차 ${witnesses}대 확인", BrandLight)
            v.spot?.let { Chip(it.label, Ink) }
        }
    }
}

/** 밀착 구역: 차량 화면에서 안내 → 칸 앞 P → 내려서 버튼 → 칸으로 */
@Composable
private fun CompactCard(cp: CompactUi, ui: UiState, c: Coordinator) {
    val color = if (cp.phase == "parked") Ok else BrandLight
    val head = when (cp.phase) {
        "offer" -> cp.message
        "guide" -> "${cp.targetLabel} 앞에 세워 주세요"
        "ready" -> "차에서 내려 문을 닫아 주세요"
        "moving" -> "칸으로 들어가는 중"
        "paused" -> "손을 떼서 멈췄어요"
        "parked" -> "밀착 주차 완료 · P 체결"
        else -> cp.phase
    }
    val sub = when (cp.phase) {
        "offer" -> "원격 비켜줘를 켠 차만 · 칸 폭 2.2m · 문 열 공간 없이 한 칸 더"
        "guide" -> "칸 앞에 서서 P를 넣으면 도착으로 알아요"
        "ready" -> "폰 버튼을 누르는 동안만 보행 속도로 칸에 들어가요"
        "moving", "paused" -> "%.1f / %.1f m · 누르는 동안만".format(cp.distance, cp.total)
        "parked" -> "나갈 때도 버튼을 누르는 동안 칸에서 나와요"
        else -> ""
    }
    Card("⇥", "밀착 구역 · 차량 안내", color) {
        Text(head, fontSize = 23.sp, fontWeight = FontWeight.Bold, lineHeight = 31.sp)
        Text(sub, color = Muted, fontSize = 15.sp)
        CompactRow(cp)
        if (cp.phase in setOf("ready", "moving", "paused")) {
            val s = ui.snapshot
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip(if (s.anyOccupied) "실내 탑승자 있음" else "✓ 실내 탑승자 없음", if (s.anyOccupied) Warn else Ok)
                Chip(if (s.anyDoorOpen) "문 열림" else "✓ 문 닫힘", if (s.anyDoorOpen) Warn else Ok)
                Chip("✓ 기어 ${s.gear.name.replace("UNKNOWN", "P")}", Ok)
            }
            BleBox(ui.ble, "compact")
        }
        if (cp.phase == "offer") {
            MicLine(ui.listening)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BigButton("안내 받기", BrandLight, Modifier.weight(1f)) { c.answerCompact(true) }
                GhostButton("괜찮아요", Modifier.weight(1f)) { c.answerCompact(false) }
            }
        }
    }
}

@Composable
private fun CompactRow(cp: CompactUi) {
    val n = cp.slots.size.coerceAtLeast(1)
    val idx = cp.slots.indexOfFirst { it.no == cp.targetNo }.coerceAtLeast(0)
    val p = when (cp.phase) {
        "moving", "paused" -> (cp.distance / cp.total).toFloat().coerceIn(0f, 1f)
        "parked" -> 1f
        else -> 0f
    }
    val anim by animateFloatAsState(p, tween(250), label = "cp")
    val showCar = cp.phase in setOf("ready", "moving", "paused", "parked")
    BoxWithConstraints(Modifier.fillMaxWidth().height(204.dp).clip(RoundedCornerShape(16.dp)).background(Color(0xFF0A1019)).padding(10.dp)) {
        val gap = 6.dp
        val w = (maxWidth - gap * (n - 1)) / n
        val slotH = 92.dp
        cp.slots.forEachIndexed { i, sl ->
            val x = (w + gap) * i
            val target = sl.no == cp.targetNo
            Box(
                Modifier.offset(x = x).size(w, slotH).clip(RoundedCornerShape(10.dp))
                    .border(if (target) 2.dp else 1.dp, if (target) Ok else Muted.copy(alpha = 0.3f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (sl.taken && !target) {
                    Box(Modifier.fillMaxWidth(0.8f).fillMaxHeight(0.84f).clip(RoundedCornerShape(9.dp)).background(Color(0xFF2A313D)))
                } else if (!showCar || !target) {
                    Text(if (target) "${sl.no}\n여기" else sl.no, color = if (target) Ok else Muted, fontSize = 13.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                }
            }
        }
        Text("◀ 2.2m 간격 · 문 열 공간 없음 ▶", color = Muted, fontSize = 11.sp, modifier = Modifier.offset(y = slotH + 72.dp))
        if (showCar) {
            val carW = w * 0.8f
            val carH = slotH * 0.84f
            val y = slotH * 0.08f + (slotH + 4.dp) * (1f - anim)
            Box(
                Modifier.offset(x = (w + gap) * idx + (w - carW) / 2, y = y).size(carW, carH).clip(RoundedCornerShape(9.dp)).background(Color(0xFFD7DBE0)),
                contentAlignment = Alignment.Center,
            ) { Text("아이오닉 5\n▲", color = Color(0xFF111827), fontSize = 11.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center, lineHeight = 13.sp) }
        }
    }
}

@Composable
private fun SpotPicker(ui: UiState, c: Coordinator) {
    AlertDialog(
        onDismissRequest = { c.showSpotPicker(false) },
        containerColor = Surface2,
        title = { Text("내 자리 고르기") },
        text = {
            Column {
                Text("지하에서는 위치 오차가 있어 처음 몇 번은 직접 골라 주세요", color = Muted)
                LazyVerticalGrid(GridCells.Fixed(4), Modifier.height(280.dp).padding(top = 12.dp)) {
                    items(ui.spots) { s ->
                        OutlinedButton(onClick = { c.pickSpot(s.id) }, modifier = Modifier.padding(4.dp)) {
                            Text(s.label.replace("번", ""), fontSize = 13.sp)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { c.showSpotPicker(false) }) { Text("닫기") } },
    )
}
