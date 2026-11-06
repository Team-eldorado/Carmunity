package com.evneighbor.connect.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ServerEvent(val type: String, val data: JSONObject)

/** 서버 → 차량 실시간 명령 (Server-Sent Events). 끊기면 2초 뒤 다시 연결한다. */
class EventStream(private val scope: CoroutineScope) {
    private var job: Job? = null
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    fun start(url: () -> String, onEvent: suspend (ServerEvent) -> Unit) {
        stop()
        job = scope.launch(Dispatchers.IO) {
            while (isActive) {
                try {
                    val conn = (URL(url()).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 5_000
                        readTimeout = 0
                        setRequestProperty("accept", "text/event-stream")
                    }
                    if (conn.responseCode != 200) throw ApiException(conn.responseCode, "STREAM", "stream ${conn.responseCode}")
                    _connected.value = true
                    conn.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                        var type = "message"
                        val data = StringBuilder()
                        while (isActive) {
                            val line = reader.readLine() ?: break
                            when {
                                line.isEmpty() -> {
                                    if (data.isNotEmpty()) {
                                        val json = runCatching { JSONObject(data.toString()) }.getOrElse { JSONObject() }
                                        onEvent(ServerEvent(type, json))
                                    }
                                    type = "message"
                                    data.setLength(0)
                                }
                                line.startsWith("event:") -> type = line.substring(6).trim()
                                line.startsWith("data:") -> data.append(line.substring(5).trim())
                                else -> Unit // 주석(: ka), retry 등
                            }
                        }
                    }
                } catch (_: Exception) {
                    // 재연결
                } finally {
                    _connected.value = false
                }
                delay(2_000)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        _connected.value = false
    }
}
