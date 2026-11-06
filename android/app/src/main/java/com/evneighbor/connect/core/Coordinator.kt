package com.evneighbor.connect.core

import android.util.Log
import com.evneighbor.connect.data.Settings
import com.evneighbor.connect.location.GeofenceMonitor
import com.evneighbor.connect.navi.NaviGuide
import com.evneighbor.connect.net.ApiClient
import com.evneighbor.connect.net.EventStream
import com.evneighbor.connect.net.ServerEvent
import com.evneighbor.connect.rspa.Direction
import com.evneighbor.connect.rspa.MoveMode
import com.evneighbor.connect.rspa.RspaProgress
import com.evneighbor.connect.rspa.RspaStatus
import com.evneighbor.connect.rspa.SimulatedRspaAdapter
import com.evneighbor.connect.safety.Interlock
import com.evneighbor.connect.vehicle.DoorKeys
import com.evneighbor.connect.vehicle.Gear
import com.evneighbor.connect.vehicle.ParkingDetector
import com.evneighbor.connect.vehicle.VehicleGateway
import com.evneighbor.connect.vehicle.VehicleSnapshot
import com.evneighbor.connect.voice.VoiceAssistant
import com.evneighbor.connect.voice.YesNo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * 차량 앱의 두뇌.
 * - 서버 명령(SSE)을 받아 차량이 직접 응답한다: 자가 점검, 모의 원격 이동, 테일게이트 1회 개방
 * - 차량 신호(Vehicle SDK)를 서버에 동기화한다: 기어 변화가 주차·출차(빈자리 신호)가 된다
 * - 운전자와는 음성(TTS/STT)과 한 번 탭으로만 대화한다
 */
class Coordinator(
    private val scope: CoroutineScope,
    private val settings: Settings,
    val gateway: VehicleGateway,
    private val api: ApiClient,
    private val stream: EventStream,
    val voice: VoiceAssistant,
    val geofence: GeofenceMonitor,
    val navi: NaviGuide,
    val rspa: SimulatedRspaAdapter,
) {
    private val tag = "Coordinator"
    private val _ui = MutableStateFlow(UiState(gatewayName = gateway.name))
    val ui: StateFlow<UiState> = _ui
    private val detector = ParkingDetector()
    private var activeTrunkToken: String? = null
    private var lastRear = 0
    private var promptJob: Job? = null
    private var vacancyJob: Job? = null
    private var compactJob: Job? = null
    private var bleJob: Job? = null
    private var compactFrontSent: String? = null
    private val compactSpoken = mutableSetOf<String>()

    // 데모: 원격 이동 중 장애물·접촉·복귀 자리 막힘
    val simObstacle = MutableStateFlow(false)
    val simContact = MutableStateFlow(false)
    val simReturnBlocked = MutableStateFlow(false)

    private val vehicleId get() = _ui.value.vehicleId

    fun start() {
        gateway.start()
        voice.start()
        navi.start()
        rspa.obstacle = { simObstacle.value }
        rspa.contact = { simContact.value }
        rspa.returnSpotOccupied = { simReturnBlocked.value }
        rspa.onNotice = { on -> scope.launch { gateway.setNoticeLight(on) } }
        geofence.onTransition = { entered -> scope.launch { onGeofence(entered) } }

        scope.launch { gateway.available.collect { a -> _ui.update { it.copy(vehicleAvailable = a) } } }
        scope.launch { stream.connected.collect { c -> _ui.update { it.copy(serverConnected = c) } } }
        scope.launch { voice.listening.collect { l -> _ui.update { it.copy(listening = l) } } }
        scope.launch { voice.lastHeard.collect { h -> _ui.update { it.copy(lastHeard = h) } } }
        scope.launch { geofence.inside.collect { i -> _ui.update { it.copy(geofenceInside = i) } } }
        scope.launch { navi.status.collect { s -> _ui.update { it.copy(naviStatus = s) } } }
        scope.launch { gateway.snapshot.collect { s -> onSnapshot(s) } }
        scope.launch { rspa.progress.collect { p -> onRspaProgress(p) } }
        syncStateToServer()

        // 저장된 값(처음에는 시연 기본값)으로 바로 연결한다. 실패하면 설정 탭에서 다시 연결할 수 있다.
        pair(settings.serverUrl, settings.plate, settings.pairKey)
    }

    fun stop() {
        stream.stop()
        gateway.stop()
        voice.stop()
        navi.stop()
        geofence.stop()
    }

    // ---------------- 페어링 ----------------
    fun pair(server: String, plate: String, key: String) {
        settings.serverUrl = server
        settings.plate = plate
        settings.pairKey = key
        _ui.update { it.copy(pairing = true, pairError = null) }
        scope.launch {
            try {
                val p = api.pair(plate, key)
                val id = p.getString("vehicleId")
                settings.vehicleId = id
                _ui.update { it.copy(paired = true, pairing = false, vehicleId = id, plate = p.optString("plate"), model = p.optString("model")) }
                loadVehicle()
                stream.start({ api.streamUrl(id) }) { ev -> withContext(Dispatchers.Main) { handle(ev) } }
                pushState(gateway.snapshot.value)
            } catch (e: Exception) {
                Log.w(tag, "pair failed", e)
                _ui.update { it.copy(pairing = false, pairError = e.message ?: "연결 실패") }
            }
        }
    }

    fun unpair() {
        stream.stop()
        settings.vehicleId = null
        _ui.update { UiState(gatewayName = gateway.name, snapshot = it.snapshot, vehicleAvailable = it.vehicleAvailable) }
    }

    suspend fun loadVehicle() {
        val id = vehicleId ?: return
        val j = api.vehicle(id)
        val v = j.getJSONObject("vehicle")
        val c = j.getJSONObject("complex")
        val credits = j.getJSONObject("credits")
        val geo = c.getJSONObject("geofence")
        _ui.update {
            it.copy(
                plate = v.getString("plate"),
                model = v.optString("model"),
                hasRspa = v.optBoolean("hasRspa"),
                ownerNickname = j.getJSONObject("owner").optString("nickname"),
                complexName = c.optString("name"),
                zones = c.getJSONArray("zones").objects().map { z -> Zone(z.getString("id"), z.getString("name"), z.optInt("floor"), z.optString("type"), z.optBoolean("slope")) },
                spots = c.getJSONArray("spots").objects().map { s -> s.toSpot() },
                homeSpotId = v.optJSONObject("home")?.optString("spotId"),
                inComplexServer = v.getJSONObject("state").optBoolean("inComplex"),
                neutral = v.getJSONObject("state").optBoolean("neutral"),
                policy = v.getJSONObject("policy").toPolicy(),
                credits = credits.toCredits(),
            )
        }
        geofence.start(geo.getDouble("lat"), geo.getDouble("lng"), geo.getDouble("radiusM").toFloat())
    }

    // ---------------- 차량 신호 → 서버 ----------------
    private fun onSnapshot(s: VehicleSnapshot) {
        _ui.update { it.copy(snapshot = s) }
        when (detector.onSnapshot(s, rspa.activeRequestId != null)) {
            ParkingDetector.Event.DEPARTED -> if (s.gear == Gear.UNKNOWN) scope.launch { pushPatch(JSONObject().put("gear", "D")) }
            else -> Unit
        }
        // 트렁크 드롭: 열린 테일게이트가 닫히면 전달 완료
        val rear = s.doors[DoorKeys.REAR] ?: 0
        val token = activeTrunkToken
        if (token != null && lastRear > 0 && rear == 0) {
            activeTrunkToken = null
            scope.launch {
                runCatching { api.trunkState(vehicleId ?: return@launch, token, "closed") }
                // 손으로 닫았어도 앱이 보낸 '열림' 목표값이 남아 있으면 다시 열릴 수 있어 닫힘으로 맞춘다
                gateway.closeTailgate()
                gateway.setNoticeLight(false)
                voice.sayAsync("트렁크가 닫혔어요. 차주에게 알렸어요")
            }
        }
        lastRear = rear
        // 빈자리 안내를 따라 주차(P)하면 안내를 마친다
        // 빈자리 안내는 주차(P)를 마칠 때까지 화면에 남기고, 주차하면 '주차 완료'를 잠시 보여 준 뒤 닫는다
        val vac = _ui.value.vacancy
        if (s.gear.isParked && vac?.accepted == true && !vac.parked) {
            _ui.update { it.copy(vacancy = vac.copy(parked = true)) }
            addNotice("${vac.spot?.label ?: "빈자리"}에 주차했어요")
            voice.sayAsync("${vac.spot?.label ?: "빈자리"}에 주차했어요")
            scope.launch {
                delay(4_000)
                _ui.update { st -> if (st.vacancy?.offerId == vac.offerId) st.copy(vacancy = null) else st }
            }
        }
        // 밀착 구역: 안내받은 칸 앞에서 P를 넣으면 '칸 앞 도착'
        val cp = _ui.value.compact
        val sid = cp?.sessionId
        if (cp?.phase == "guide" && sid != null && s.gear.isParked && compactFrontSent != sid) {
            compactFrontSent = sid
            scope.launch {
                runCatching { api.compactFront(vehicleId ?: return@launch, sid) }
                    .onSuccess { applyCompact(it) }
                    .onFailure { addNotice(it.message ?: "밀착 구역 도착 처리 실패") }
            }
        }
    }

    @OptIn(FlowPreview::class)
    private fun syncStateToServer() {
        scope.launch {
            gateway.snapshot
                .map { listOf(it.gear, it.doors, it.occupied, it.charging, it.soc) }
                .distinctUntilChanged()
                .debounce(300)
                .collect { pushState(gateway.snapshot.value) }
        }
    }

    private suspend fun pushState(s: VehicleSnapshot) {
        val body = JSONObject()
        if (s.gear != Gear.UNKNOWN) body.put("gear", s.gear.name)
        body.put("doors", JSONObject(s.doors as Map<*, *>))
        body.put("occupied", JSONObject(s.occupied as Map<*, *>))
        s.charging?.let { body.put("charging", it) }
        s.soc?.let { body.put("soc", it) }
        pushPatch(body)
    }

    private suspend fun pushPatch(body: JSONObject) {
        val id = vehicleId ?: return
        runCatching { api.postState(id, body) }
            .onSuccess { st -> _ui.update { it.copy(inComplexServer = st.optBoolean("inComplex"), neutral = st.optBoolean("neutral")) } }
            .onFailure { Log.w(tag, "state sync: ${it.message}") }
    }

    private suspend fun onGeofence(entered: Boolean) {
        pushPatch(JSONObject().put("inComplex", entered))
        if (entered) addNotice("단지 지하주차장에 들어왔어요")
    }

    // ---------------- 서버 명령 ----------------
    private suspend fun handle(ev: ServerEvent) {
        val d = ev.data
        when (ev.type) {
            "policy.update" -> _ui.update { it.copy(policy = d.getJSONObject("policy").toPolicy()) }
            "credit.update" -> {
                _ui.update { it.copy(credits = it.credits.copy(balance = d.optInt("balance"))) }
                val reason = d.optJSONObject("entry")?.optString("reason")
                if (reason == "MOVE_PROVIDE") scope.launch { runCatching { loadVehicle() } }
            }
            "neutral.notice", "notice" -> {
                val msg = d.optString("message")
                addNotice(msg)
                voice.sayAsync(msg)
            }
            "move.veto" -> {
                _ui.update { it.copy(veto = VetoUi(d.getString("requestId"), d.optString("requester"), d.optLong("expiresAt"))) }
                addNotice("${d.optString("requester")}님이 비켜줘를 요청했어요")
            }
            "move.veto.closed" -> _ui.update { it.copy(veto = null) }
            "interlock.check" -> runInterlock(d.getString("requestId"), d.optBoolean("slope"), d.optBoolean("lowVoltage12v"), if (d.isNull("zone")) null else d.optString("zone"))
            "move.prepare" -> {
                val mode = MoveMode.from(d.optString("mode"))
                val dir = Direction.from(d.optString("direction"))
                val max = d.optDouble("maxMeters", 0.0)
                rspa.requestMove(d.getString("requestId"), null, dir, max, mode)
                _ui.update { it.copy(move = MoveUi(d.getString("requestId"), mode, dir, 0.0, max, "대기", if (mode == MoveMode.RETURN) "요청자가 복귀 버튼을 누르면 원위치로 돌아가요" else "요청자가 차 옆에서 버튼을 누르는 동안만 움직여요")) }
            }
            "move.hold" -> {
                val mode = MoveMode.from(d.optString("mode"))
                val rid = d.getString("requestId")
                // 이미 끝난 이동(같은 요청·같은 단계)에 늦게 도착한 버튼 신호는 무시
                if ("$rid:$mode" in finishedMoves) return
                if (rspa.activeRequestId != rid) {
                    rspa.requestMove(d.getString("requestId"), null, Direction.from(d.optString("direction")), d.optDouble("maxMeters", 0.0), mode)
                }
                rspa.hold()
            }
            "move.release" -> rspa.release()
            "move.finish" -> rspa.finish()
            "move.abort" -> {
                rspa.abort(d.optString("reason"))
                _ui.update { it.copy(move = it.move?.copy(phase = "중단", text = "원격 이동이 중단됐어요")) }
            }
            "move.update" -> {
                val req = d.optJSONObject("request") ?: return
                val last = req.optJSONArray("timeline")?.let { tl -> if (tl.length() > 0) tl.getJSONObject(tl.length() - 1).optString("text") else null }
                if (last != null) _ui.update { it.copy(move = it.move?.copy(text = last)) }
            }
            "move.closed" -> {
                rspa.abort("closed")
                val status = d.optString("status")
                _ui.update { it.copy(move = it.move?.copy(phase = "종료", text = closedText(status))) }
                scope.launch { delay(8_000); _ui.update { it.copy(move = null) }; runCatching { loadVehicle() } }
            }
            "trunk.open" -> openTrunk(d.getString("tokenId"))
            "sim.ble" -> onBle(d.optString("zone", "clear"), d.optDouble("distanceM", 0.0))
            "trunk.close" -> scope.launch {
                gateway.closeTailgate()
                addNotice("트렁크가 열려 있어 자동으로 닫았어요")
            }
            "trunk.update" -> {
                val t = d.optJSONObject("token") ?: return
                _ui.update { it.copy(trunk = TrunkUi(t.getString("id"), t.optString("status"), d.optString("text"))) }
                if (t.optString("status") in setOf("completed", "expired", "cancelled")) {
                    scope.launch { delay(8_000); _ui.update { s -> if (s.trunk?.tokenId == t.getString("id")) s.copy(trunk = null) else s } }
                }
            }
            "parked.prompt" -> handlePrompts(d.optJSONArray("prompts") ?: JSONArray())
            "vacancy.offer" -> handleVacancy(d)
            "vacancy.filled" -> {
                vacancyJob?.cancel()
                voice.cancelListening()
                _ui.update { it.copy(vacancy = null) }
                navi.cancel()
                val msg = d.optString("message", "자리가 찼어요")
                addNotice(msg)
                voice.sayAsync(msg)
            }
            "compact.offer" -> handleCompactOffer(d)
            "compact.update" -> applyCompact(d)
            "vacancy.expired" -> {
                vacancyJob?.cancel()
                _ui.update { s -> if (s.vacancy?.offerId == d.optString("offerId")) s.copy(vacancy = null) else s }
            }
        }
    }

    private fun closedText(status: String) = when (status) {
        "RETURNED" -> "원위치로 돌아왔어요"
        "REJECTED" -> "차주가 직접 처리하기로 했어요"
        "INTERLOCK_FAILED" -> "안전 점검에서 막혔어요"
        "CONTACT_STOPPED" -> "접촉이 감지돼 멈췄어요. 운영사에 접수됐어요"
        "ABORTED" -> "장애물 때문에 중단했어요"
        "EXPIRED" -> "토큰이 만료됐어요. 지금 위치에 P로 서 있어요"
        "RETURN_BLOCKED" -> "원래 자리가 막혀 지금 위치에 섰어요"
        else -> "요청이 끝났어요"
    }

    /** 차량 자가 점검: 최신 센서 값을 다시 읽어 판정하고 서버에 보낸다 (서버도 재판정) */
    private suspend fun runInterlock(requestId: String, slope: Boolean = false, lowVoltage12v: Boolean = false, zone: String? = null) {
        val snap = gateway.refresh()
        val base = Interlock.evaluate(snap)
        // 경사는 단지 지도(경사 구역)와 기울기, 12V는 차량 전원 상태로 함께 판정
        val extra = buildList {
            if (slope) add(Interlock.Fail.SLOPE)
            if (lowVoltage12v) add(Interlock.Fail.LOW_12V)
        }
        val local = Interlock.Result(base.fails + extra)
        val items = checkItems(snap, slope, lowVoltage12v, zone)
        _ui.update { it.copy(check = CheckUi(requestId, items), interlockText = null) }
        // 차량 화면에서 센서 값을 한 줄씩 확인한 뒤 결과를 보낸다 (서버는 10초까지 기다린다)
        for (i in 1..items.size) {
            delay(380)
            _ui.update { st -> st.check?.takeIf { it.requestId == requestId }?.let { st.copy(check = it.copy(shown = i)) } ?: st }
        }
        delay(250)
        val result = if (local.ok) "자가 점검 통과 · 이동을 준비해요" else "이동을 거절했어요 · 차주에게 알렸어요"
        _ui.update { st ->
            st.check?.takeIf { it.requestId == requestId }?.let { st.copy(check = it.copy(done = true, ok = local.ok, result = result)) } ?: st
        }
        _ui.update { it.copy(interlockText = if (local.ok) "자가 점검 통과" else "자가 점검: ${local.message}") }
        if (!local.ok) voice.sayAsync("${local.fails.first().message.removeSuffix(" 움직일 수 없어요")} 움직이지 않을게요. 차주에게 알렸어요")
        runCatching { api.interlock(vehicleId ?: return, requestId, snap.toJson()) }
            .onFailure { addNotice("자가 점검 결과 전송 실패: ${it.message}") }
        scope.launch {
            delay(if (local.ok) 2_400 else 14_000)
            _ui.update { st -> if (st.check?.requestId == requestId) st.copy(check = null) else st }
        }
    }

    private fun checkItems(s: VehicleSnapshot, slope: Boolean, lowVoltage12v: Boolean, zone: String?): List<CheckItem> {
        val seatNames = mapOf("ROW_1_LEFT" to "운전석", "ROW_1_RIGHT" to "조수석", "ROW_2_LEFT" to "뒷좌석 왼쪽", "ROW_2_RIGHT" to "뒷좌석 오른쪽")
        val occ = s.occupied.filterValues { it }.keys.map { seatNames[it] ?: it }
        val open = s.doors.filterValues { it > 0 }.keys
        val soc = s.soc ?: 100
        return listOf(
            CheckItem("기어 · 주차 브레이크", "Gear", if (s.gear == Gear.UNKNOWN) "-" else s.gear.name, s.gear == Gear.UNKNOWN || s.gear.isParked),
            CheckItem("충전 케이블", "EV Battery", if (s.charging == true) "연결됨" else "분리됨", s.charging != true),
            CheckItem("문 · 트렁크", "Body", if (open.isEmpty()) "모두 닫힘" else "열림", open.isEmpty()),
            CheckItem("실내 탑승자", "Seat", if (occ.isEmpty()) "없음" else "${occ.joinToString()} 감지", occ.isEmpty()),
            CheckItem("경사 · 기울기", "단지 지도", if (slope) "경사 구역" else "평지", !slope),
            CheckItem("12V 배터리", "전원", if (lowVoltage12v) "저전압" else "정상", !lowVoltage12v),
            CheckItem("고전압 배터리", "EV Battery", "$soc%", soc >= Interlock.MIN_SOC),
        )
    }

    private val finishedMoves = mutableSetOf<String>()

    private suspend fun onRspaProgress(p: RspaProgress) {
        if (p.status == RspaStatus.COMPLETED) finishedMoves += "${p.requestId}:${p.mode}"
        val phase = when (p.status) {
            RspaStatus.MOVING -> if (p.mode == MoveMode.RETURN) "복귀 중" else "이동 중"
            RspaStatus.PAUSED -> "일시 정지"
            RspaStatus.OBSTACLE -> "장애물 · 재시도 대기"
            RspaStatus.ABORTED -> "중단"
            RspaStatus.CONTACT -> "접촉 정지"
            RspaStatus.BLOCKED -> "복귀 자리 막힘"
            RspaStatus.COMPLETED -> "완료 · P 체결"
        }
        _ui.update { it.copy(move = (it.move ?: MoveUi(p.requestId, p.mode, p.direction, 0.0, p.maxM, phase, "")).copy(distance = p.distanceM, max = p.maxM, phase = phase, mode = p.mode)) }
        val id = vehicleId ?: return
        runCatching { api.moveProgress(id, p.requestId, p.status.wire, p.distanceM, p.reason) }
            .onFailure { Log.w(tag, "move-progress: ${it.message}") }
    }

    private suspend fun openTrunk(tokenId: String) {
        val id = vehicleId ?: return
        // 녹화 중 미등 점멸로 촬영 고지
        gateway.setNoticeLight(true)
        val r = gateway.openTailgate()
        if (r.isSuccess) {
            activeTrunkToken = tokenId
            lastRear = 1
            runCatching { api.trunkState(id, tokenId, "opened") }
            addNotice("이웃이 트렁크를 열었어요 (테일게이트만, 실내 도어는 잠김)")
        } else {
            gateway.setNoticeLight(false)
            runCatching { api.trunkState(id, tokenId, "failed", r.exceptionOrNull()?.message) }
        }
    }

    // ---------------- 주차 직후 질문 ----------------
    private fun handlePrompts(prompts: JSONArray) {
        promptJob?.cancel()
        promptJob = scope.launch {
            for (p in prompts.objects()) {
                val kind = p.optString("kind")
                val text = p.optString("text")
                when (kind) {
                    "pick_spot" -> {
                        _ui.update { it.copy(pickSpot = true) }
                        voice.say(text)
                    }
                    "enable_move", "register_neutral" -> {
                        _ui.update { it.copy(prompt = PromptUi(kind, text)) }
                        val ans = voice.ask(text)
                        if (_ui.value.prompt?.kind != kind) continue // 화면 버튼으로 이미 답함
                        when (ans) {
                            YesNo.Answer.YES -> answerPrompt(kind, true)
                            YesNo.Answer.NO -> answerPrompt(kind, false)
                            YesNo.Answer.UNKNOWN -> Unit // 화면에 남겨 두고 탭으로 답하게
                        }
                    }
                }
            }
        }
    }

    fun answerPrompt(kind: String, yes: Boolean) {
        voice.cancelListening()
        _ui.update { it.copy(prompt = null) }
        if (!yes) {
            if (kind == "enable_move" && _ui.value.policy.enabled) {
                scope.launch {
                    runCatching { api.voiceConsent(vehicleId ?: return@launch, "decline_move") }
                        .onSuccess { addNotice("오늘은 비켜줘를 쉬어요"); voice.sayAsync("알겠어요. 오늘은 비켜줘를 쉴게요"); loadVehicle() }
                }
            }
            return
        }
        scope.launch {
            val id = vehicleId ?: return@launch
            if (kind == "register_neutral" && gateway.snapshot.value.gear != Gear.N && gateway.snapshot.value.gear != Gear.UNKNOWN) {
                voice.sayAsync("기어를 N으로 두고 다시 말씀해 주세요")
                _ui.update { it.copy(prompt = PromptUi(kind, "기어가 ${gateway.snapshot.value.gear}예요. N으로 두면 밀어도 되는 차로 등록돼요")) }
                return@launch
            }
            runCatching { api.voiceConsent(id, kind) }
                .onSuccess {
                    val msg = if (kind == "enable_move") "비켜줘를 켜 뒀어요. 우리 단지 이웃이 요청하면 30초 거부 창이 먼저 떠요" else "밀어도 되는 차로 등록했어요"
                    addNotice(msg)
                    voice.sayAsync(msg)
                    loadVehicle()
                }
                .onFailure { addNotice(it.message ?: "설정 실패") }
        }
    }

    // ---------------- 빈자리 안내 ----------------
    private fun handleVacancy(d: JSONObject) {
        val spot = d.optJSONObject("spot")?.toSpot()
        val r = d.optJSONObject("radar")
        val radar = r?.optJSONArray("spots")?.objects()?.map { o ->
            RadarSpot(o.optString("no"), o.optString("state"), if (o.isNull("model")) null else o.optString("model"))
        } ?: emptyList()
        val departed = r?.optJSONObject("departed")?.optString("model")
        val offer = VacancyUi(d.getString("offerId"), d.optString("message"), spot, d.optLong("expiresAt"), zoneName = r?.optJSONObject("zone")?.optString("name") ?: "", departed = departed, radar = radar)
        _ui.update { it.copy(vacancy = offer) }
        vacancyJob?.cancel()
        vacancyJob = scope.launch {
            // 운전 중에는 음성 1회와 화면 표시
            val ans = voice.ask("${offer.message}. 가실래요?")
            if (_ui.value.vacancy?.offerId != offer.offerId || _ui.value.vacancy?.accepted == true) return@launch
            when (ans) {
                YesNo.Answer.YES -> answerVacancy(true)
                YesNo.Answer.NO -> answerVacancy(false)
                YesNo.Answer.UNKNOWN -> Unit
            }
        }
    }

    fun answerVacancy(accept: Boolean) {
        val v = _ui.value.vacancy ?: return
        voice.cancelListening()
        scope.launch {
            val id = vehicleId ?: return@launch
            runCatching { api.vacancyResponse(id, v.offerId, accept) }
                .onSuccess {
                    if (accept) {
                        _ui.update { it.copy(vacancy = v.copy(accepted = true)) }
                        val s = v.spot
                        // 지하주차장은 GPS 경로가 맞지 않아 내비 대신 차량 화면 미니맵으로 칸 위치를 보여 준다
                        voice.sayAsync("${s?.label ?: "빈자리"}을 잡아 뒀어요. 화면의 초록 칸으로 가세요")
                    } else {
                        _ui.update { it.copy(vacancy = null) }
                    }
                }
                .onFailure {
                    _ui.update { it.copy(vacancy = null) }
                    addNotice(it.message ?: "안내가 끝났어요")
                }
        }
    }

    // ---------------- 요청자 근접 (BLE) ----------------
    // 요청자 폰은 1회용 토큰과 함께 받은 키로 차와 BLE 연결을 맺고, 차가 신호 세기로 거리와 방향을 잰다.
    // 서버는 이 값만 믿는다(폰이 스스로 '차 옆에 있어요'라고 보내는 값은 쓰지 않음).
    // 에뮬레이터에는 BLE가 없어서 시연에서는 데모 콘솔이 측정값을 넣는다(sim.ble). 실차에서는 디지털 키 BLE/UWB 측위 값.
    private fun onBle(zone: String, distanceM: Double) {
        bleJob?.cancel()
        if (zone == "clear" || zone.isBlank()) {
            _ui.update { it.copy(ble = null) }
            return
        }
        _ui.update { it.copy(ble = BleUi(distanceM, zone)) }
        bleJob = scope.launch {
            while (true) {
                val id = vehicleId
                if (id != null) runCatching { api.proximity(id, distanceM, zone) }.onFailure { Log.w(tag, "proximity: ${it.message}") }
                delay(1_000)
            }
        }
    }

    // ---------------- 밀착 구역 ----------------
    private fun handleCompactOffer(d: JSONObject) {
        val zone = d.optJSONObject("zone") ?: return
        val slots = zone.optJSONArray("slots")?.objects()?.map { CompactSlot(it.getString("id").substringAfterLast('-'), it.optBoolean("taken")) } ?: emptyList()
        val next = d.optJSONObject("next")
        val offer = CompactUi(
            phase = "offer", slots = slots,
            targetNo = next?.optString("id")?.substringAfterLast('-') ?: "",
            targetLabel = next?.optString("label") ?: "",
            message = d.optString("message"),
        )
        _ui.update { it.copy(compact = offer) }
        compactJob?.cancel()
        compactJob = scope.launch {
            val ans = voice.ask("${offer.message}. ${offer.targetLabel} 칸으로 안내할까요?")
            if (_ui.value.compact?.phase != "offer") return@launch
            when (ans) {
                YesNo.Answer.YES -> answerCompact(true)
                YesNo.Answer.NO -> answerCompact(false)
                YesNo.Answer.UNKNOWN -> Unit
            }
        }
    }

    fun answerCompact(accept: Boolean) {
        voice.cancelListening()
        if (!accept) {
            _ui.update { it.copy(compact = null) }
            return
        }
        scope.launch {
            val id = vehicleId ?: return@launch
            runCatching { api.compactStart(id) }
                .onSuccess { applyCompact(it) }
                .onFailure { e -> _ui.update { it.copy(compact = null) }; addNotice(e.message ?: "밀착 구역 안내 실패") }
        }
    }

    private fun applyCompact(v: JSONObject) {
        val status = v.optString("status")
        val sid = v.optString("id")
        _ui.update { st ->
            val cur = st.compact ?: CompactUi(status)
            st.copy(compact = cur.copy(
                phase = status, sessionId = sid,
                targetNo = v.optString("spotId").substringAfterLast('-'),
                targetLabel = v.optString("label", cur.targetLabel),
                distance = v.optDouble("distance", 0.0), total = v.optDouble("total", 4.2),
            ))
        }
        if (compactSpoken.add("$sid:$status")) {
            when (status) {
                "guide" -> voice.sayAsync("${v.optString("label")} 앞에 세워 주세요. P를 넣으면 도착으로 알게요")
                "ready" -> voice.sayAsync("차에서 내려 문을 닫아 주세요. 폰 버튼을 누르는 동안 칸으로 들어가요")
                "parked" -> {
                    voice.sayAsync("밀착 주차를 마쳤어요")
                    addNotice("${v.optString("label")}에 밀착 주차했어요")
                    scope.launch {
                        delay(10_000)
                        _ui.update { st -> if (st.compact?.sessionId == sid && st.compact.phase == "parked") st.copy(compact = null) else st }
                    }
                }
            }
        }
    }

    // ---------------- 차주 조작 (정차 중) ----------------
    fun vetoDecision(reject: Boolean) {
        val v = _ui.value.veto ?: return
        scope.launch {
            runCatching { api.veto(vehicleId ?: return@launch, v.requestId, if (reject) "reject" else "approve") }
                .onFailure { addNotice(it.message ?: "실패") }
            _ui.update { it.copy(veto = null) }
        }
    }

    fun updatePolicy(patch: JSONObject) {
        scope.launch {
            runCatching { api.policy(vehicleId ?: return@launch, patch) }
                .onSuccess { p -> _ui.update { it.copy(policy = p.toPolicy()) } }
                .onFailure { addNotice(it.message ?: "설정 실패") }
        }
    }

    fun pickSpot(spotId: String) {
        _ui.update { it.copy(pickSpot = false) }
        scope.launch {
            runCatching { api.home(vehicleId ?: return@launch, spotId) }
                .onSuccess { _ui.update { it.copy(homeSpotId = spotId) } }
                .onFailure { addNotice(it.message ?: "실패") }
        }
    }

    fun showSpotPicker(show: Boolean) = _ui.update { it.copy(pickSpot = show) }

    fun registerNeutral(on: Boolean) {
        scope.launch {
            runCatching { api.neutral(vehicleId ?: return@launch, on) }
                .onSuccess { _ui.update { it.copy(neutral = on) }; addNotice(if (on) "밀어도 되는 차로 등록했어요" else "중립 표시를 내렸어요") }
                .onFailure { addNotice(it.message ?: "실패") }
        }
    }

    fun simulateGeofence(entered: Boolean) = geofence.simulate(entered)

    private fun addNotice(text: String) {
        if (text.isBlank()) return
        _ui.update { it.copy(notices = (listOf(Notice(System.currentTimeMillis(), text)) + it.notices).take(20)) }
    }
}

// ---------------- JSON 변환 ----------------
internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

internal fun JSONObject.toSpot() = Spot(
    id = getString("id"),
    label = optString("label", getString("id")),
    zoneId = optString("zoneId"),
    type = optString("type", "normal"),
    lat = if (has("lat") && !isNull("lat")) getDouble("lat") else null,
    lng = if (has("lng") && !isNull("lng")) getDouble("lng") else null,
)

internal fun JSONObject.toPolicy(): Policy {
    val f = optJSONObject("functions") ?: JSONObject()
    val scope = optJSONObject("scope") ?: JSONObject()
    val dongs = scope.optJSONArray("dongs")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
    return Policy(
        enabled = optBoolean("enabled"),
        move = f.optBoolean("move"),
        trunk = f.optBoolean("trunk"),
        sensor = f.optBoolean("sensor", true),
        scopeDongs = if (scope.optString("type") == "dongs") dongs else emptyList(),
        dailyMoveLimit = optInt("dailyMoveLimit", 2),
        allowNight = optBoolean("allowNight"),
        pausedToday = !isNull("pausedDay") && optString("pausedDay").isNotBlank(),
    )
}

internal fun JSONObject.toCredits(): Credits {
    val thanks = optJSONArray("thanks")
    return Credits(
        balance = optInt("balance"),
        monthMoves = optInt("monthMovesProvided"),
        monthVacancy = optInt("monthVacancySignals"),
        monthTrunk = optInt("monthTrunkProvided"),
        thanks = if (thanks != null && thanks.length() > 0) thanks.getString(thanks.length() - 1) else null,
    )
}
