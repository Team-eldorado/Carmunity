package com.evneighbor.connect.voice

import ai.pleos.playground.stt.SpeechToText
import ai.pleos.playground.stt.listener.ResultListener
import ai.pleos.playground.tts.TextToSpeech
import ai.pleos.playground.tts.listener.EventListener
import android.content.Context
import android.util.Log
import com.evneighbor.connect.BuildConfig
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import ai.pleos.playground.stt.constant.ErrorType as SttError
import ai.pleos.playground.stt.constant.Mode as SttMode
import ai.pleos.playground.stt.listener.OnInitializeListener as SttInit
import ai.pleos.playground.stt.listener.OnServerConnectionListener as SttServer
import ai.pleos.playground.tts.constant.ErrorType as TtsError
import ai.pleos.playground.tts.constant.Mode as TtsMode
import ai.pleos.playground.tts.listener.OnInitializeListener as TtsInit
import ai.pleos.playground.tts.listener.OnServerConnectionListener as TtsServer

/**
 * 차량 음성 입출력 (Pleos TextToSpeech · SpeechToText SDK)
 * - 주차 직후 "오늘 밤 비켜줘를 켜 둘까요?" → '응' 한 마디로 위임 켜기
 * - 운전 중 빈자리 안내는 음성 1회 + 화면 표시, '갈게요'로 응답
 *
 * Playground 자격 증명이 있으면 HYBRID, 없으면 차량 안 ON_DEVICE 엔진을 쓴다.
 */
class VoiceAssistant(private val context: Context) {
    private val tag = "Voice"
    private var tts: TextToSpeech? = null
    private var stt: SpeechToText? = null
    private val _listening = MutableStateFlow(false)
    val listening: StateFlow<Boolean> = _listening
    private val _lastHeard = MutableStateFlow("")
    val lastHeard: StateFlow<String> = _lastHeard
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready
    private var speakDone: CompletableDeferred<Unit>? = null
    private var heard: CompletableDeferred<String?>? = null

    private val hasCredentials = BuildConfig.PLEOS_CLIENT_ID.isNotBlank() && BuildConfig.PLEOS_CLIENT_SECRET.isNotBlank()

    private val ttsEvents = object : EventListener {
        override fun onReady() = Unit
        override fun onStart() = Unit
        override fun onUpdatedRms(rms: Double) = Unit
        override fun onDone() { speakDone?.complete(Unit) }
        override fun onStop() { speakDone?.complete(Unit) }
        override fun onError(errorType: TtsError) {
            Log.w(tag, "TTS error $errorType")
            speakDone?.complete(Unit)
        }
    }

    private val sttResults = object : ResultListener {
        override fun onReady() = Unit
        override fun onStartedRecognition() { _listening.value = true }
        override fun onUpdated(stt: String, completed: Boolean) {
            _lastHeard.value = stt
            if (completed) heard?.complete(stt)
        }
        override fun onUpdatedEpdData(on: Long, off: Long) = Unit
        override fun onUpdatedRms(rms: Double) = Unit
        override fun onEndedRecognition() {
            _listening.value = false
            heard?.complete(_lastHeard.value.ifBlank { null })
        }
        override fun onError(errorType: SttError) {
            Log.w(tag, "STT error $errorType")
            _listening.value = false
            heard?.complete(null)
        }
    }

    fun start() {
        runCatching {
            val t = TextToSpeech(context.applicationContext, if (hasCredentials) TtsMode.HYBRID else TtsMode.ON_DEVICE)
            t.initialize(object : TtsInit {
                override fun onSuccess() {
                    t.addEventListener(ttsEvents)
                    t.setLocale(Locale.KOREA)
                    if (hasCredentials) {
                        t.registerApp(BuildConfig.PLEOS_CLIENT_ID, BuildConfig.PLEOS_CLIENT_SECRET, object : TtsServer {
                            override fun onConnected() = Unit
                            override fun onFailed(errorType: TtsError) { Log.w(tag, "TTS server $errorType") }
                        })
                    }
                    _ready.value = true
                }
                override fun onFailure(errorType: TtsError) { Log.w(tag, "TTS init $errorType") }
            })
            tts = t
        }.onFailure { Log.w(tag, "TTS 사용 불가: ${it.message}") }

        runCatching {
            val s = SpeechToText(context.applicationContext, if (hasCredentials) SttMode.HYBRID else SttMode.ON_DEVICE)
            s.initialize(object : SttInit {
                override fun onSuccess() {
                    s.addListener(sttResults)
                    s.setLocale(Locale.KOREA)
                    if (hasCredentials) {
                        s.registerApp(BuildConfig.PLEOS_CLIENT_ID, BuildConfig.PLEOS_CLIENT_SECRET, object : SttServer {
                            override fun onConnected() = Unit
                            override fun onFailed(errorType: SttError) { Log.w(tag, "STT server $errorType") }
                        })
                    }
                }
                override fun onFailure(errorType: SttError) { Log.w(tag, "STT init $errorType") }
            })
            stt = s
        }.onFailure { Log.w(tag, "STT 사용 불가: ${it.message}") }
    }

    fun stop() {
        runCatching { tts?.removeEventListener(ttsEvents); tts?.release() }
        runCatching { stt?.removeListener(sttResults); stt?.release() }
        tts = null
        stt = null
    }

    /** 말하고 끝날 때까지 기다린다 (최대 8초) */
    suspend fun say(text: String) {
        val t = tts ?: return
        val d = CompletableDeferred<Unit>()
        speakDone = d
        runCatching { t.speak(text, true) }.onFailure { d.complete(Unit) }
        withTimeoutOrNull(8_000) { d.await() }
    }

    fun sayAsync(text: String) {
        runCatching { tts?.speak(text, true) }
    }

    /** 질문하고 예/아니오를 듣는다. 화면 버튼으로도 답할 수 있으므로 못 알아들으면 UNKNOWN. */
    suspend fun ask(question: String, listenMs: Long = 6_000): YesNo.Answer {
        say(question)
        val s = stt ?: return YesNo.Answer.UNKNOWN
        delay(150)
        val d = CompletableDeferred<String?>()
        heard = d
        _lastHeard.value = ""
        runCatching { s.request() }.onFailure { return YesNo.Answer.UNKNOWN }
        val text = withTimeoutOrNull(listenMs) { d.await() }
        runCatching { s.stop() }
        _listening.value = false
        return YesNo.parse(text)
    }

    /** 화면 버튼으로 답했을 때 듣기를 끝낸다 */
    fun cancelListening() {
        heard?.complete(null)
        runCatching { stt?.stop() }
        _listening.value = false
    }
}
