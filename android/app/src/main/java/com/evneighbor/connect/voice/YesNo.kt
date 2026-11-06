package com.evneighbor.connect.voice

/** 짧은 음성 응답을 예/아니오로 해석한다. "응" 한 마디로 위임이 켜지는 흐름에 쓴다. */
object YesNo {
    enum class Answer { YES, NO, UNKNOWN }

    private val no = listOf("아니", "아뇨", "싫어", "안 돼", "안돼", "됐어", "필요 없", "괜찮아요 안", "취소", "하지 마", "하지마")
    private val yes = listOf("응", "어", "네", "예", "그래", "좋아", "좋아요", "켜", "켜줘", "켜 줘", "알았어", "오케이", "ok", "갈게", "가자", "부탁", "해줘", "해 줘", "그렇게", "맞아")

    fun parse(raw: String?): Answer {
        val t = raw?.trim()?.lowercase()?.replace(Regex("[.!?,~]"), "") ?: return Answer.UNKNOWN
        if (t.isEmpty()) return Answer.UNKNOWN
        // 부정을 먼저 본다: "안 켜", "아니 괜찮아"
        if (no.any { t.contains(it) } || t.startsWith("안 ")) return Answer.NO
        if (yes.any { t == it || t.startsWith(it) || t.contains(" $it") }) return Answer.YES
        return Answer.UNKNOWN
    }
}
