package com.evneighbor.connect.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class ApiException(val status: Int, val code: String, message: String) : IOException(message)

/** 매칭 서버 REST 클라이언트 (차량 앱 전용 /api/vehicle 경로) */
class ApiClient(private val base: () -> String, private val key: () -> String) {

    suspend fun pair(plate: String, key: String): JSONObject =
        get("/api/vehicle/pair?plate=${enc(plate)}&key=${enc(key)}", auth = false)

    suspend fun vehicle(id: String) = get("/api/vehicle/$id")
    suspend fun postState(id: String, body: JSONObject) = post("/api/vehicle/$id/state", body)
    suspend fun interlock(id: String, requestId: String, snapshot: JSONObject) =
        post("/api/vehicle/$id/interlock", JSONObject().put("requestId", requestId).put("snapshot", snapshot))
    suspend fun moveProgress(id: String, requestId: String, status: String, distance: Double, reason: String?) =
        post("/api/vehicle/$id/move-progress", JSONObject().put("requestId", requestId).put("status", status).put("distance", distance).put("reason", reason ?: JSONObject.NULL))
    suspend fun trunkState(id: String, tokenId: String, state: String, reason: String? = null) =
        post("/api/vehicle/$id/trunk-state", JSONObject().put("tokenId", tokenId).put("state", state).put("reason", reason ?: JSONObject.NULL))
    suspend fun vacancyResponse(id: String, offerId: String, accept: Boolean) =
        post("/api/vehicle/$id/vacancy-response", JSONObject().put("offerId", offerId).put("accept", accept))
    suspend fun home(id: String, spotId: String) = post("/api/vehicle/$id/home", JSONObject().put("spotId", spotId))
    suspend fun policy(id: String, patch: JSONObject) = post("/api/vehicle/$id/policy", patch)
    suspend fun voiceConsent(id: String, kind: String) = post("/api/vehicle/$id/voice-consent", JSONObject().put("kind", kind))
    suspend fun neutral(id: String, neutral: Boolean) = post("/api/vehicle/$id/neutral", JSONObject().put("neutral", neutral))
    suspend fun veto(id: String, requestId: String, decision: String) =
        post("/api/vehicle/$id/veto", JSONObject().put("requestId", requestId).put("decision", decision))

    suspend fun compactStart(id: String) = post("/api/vehicle/$id/compact", JSONObject())
    suspend fun compactFront(id: String, sessionId: String) = post("/api/vehicle/$id/compact/$sessionId/front", JSONObject())

    suspend fun proximity(id: String, distanceM: Double, zone: String) =
        post("/api/vehicle/$id/proximity", JSONObject().put("distanceM", distanceM).put("zone", zone))

    fun streamUrl(id: String) = "${base()}/api/vehicle/$id/stream?key=${enc(key())}"

    private suspend fun get(path: String, auth: Boolean = true) = request("GET", path, null, auth)
    private suspend fun post(path: String, body: JSONObject) = request("POST", path, body, true)

    private suspend fun request(method: String, path: String, body: JSONObject?, auth: Boolean): JSONObject = withContext(Dispatchers.IO) {
        val conn = (URL(base() + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 5_000
            readTimeout = 10_000
            setRequestProperty("content-type", "application/json; charset=utf-8")
            if (auth) setRequestProperty("x-vehicle-key", key())
            if (body != null) {
                doOutput = true
                outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
        }
        try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            val json = if (text.trimStart().startsWith("{")) JSONObject(text) else JSONObject().put("value", text)
            if (code !in 200..299) throw ApiException(code, json.optString("error"), json.optString("message", "서버 오류 ($code)"))
            json
        } finally {
            conn.disconnect()
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}
