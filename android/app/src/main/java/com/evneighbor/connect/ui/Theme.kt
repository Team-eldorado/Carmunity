package com.evneighbor.connect.ui

import android.app.Activity
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp

// 차량 화면용 다크 테마 (영상 스튜디오와 같은 색)
val Bg = Color(0xFF070B12)
val Surface1 = Color(0xFF0E1521)
val Surface2 = Color(0xFF162030)
val Line = Color(0x1AFFFFFF)
val Ink = Color(0xFFEEF2F8)
val Muted = Color(0xFF8A95A8)
val Brand = Color(0xFF4C8DFF)
val BrandLight = Color(0xFF3DD6F5)
val Ok = Color(0xFF2EE6A6)
val Warn = Color(0xFFF5C542)
val Err = Color(0xFFFF5D6C)
val BrandGradient = Brush.linearGradient(listOf(Color(0xFF2A5BE0), Color(0xFF4C8DFF), Color(0xFF2BB8D9)))

/**
 * 차량 디스플레이 배율.
 * Pleos 에뮬레이터는 2560×1440을 160dpi로 그려서 일반 앱 글씨가 시스템 UI의 절반 크기가 된다.
 * 화면 높이 720을 기준으로 밀도를 올려 차량 UI와 같은 크기로 맞춘다.
 */
@Composable
private fun HmiScale(content: @Composable () -> Unit) {
    val base = LocalDensity.current
    val ctx = LocalContext.current
    val dm = android.util.DisplayMetrics()
    @Suppress("DEPRECATION")
    (ctx as? Activity)?.windowManager?.defaultDisplay?.getRealMetrics(dm)
    val shortSide = minOf(dm.widthPixels, dm.heightPixels)
    val target = maxOf(base.density, shortSide / 720f)
    CompositionLocalProvider(LocalDensity provides Density(target, base.fontScale), content = content)
}

@Composable
fun EvTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Brand,
            secondary = BrandLight,
            tertiary = Ok,
            background = Bg,
            surface = Surface1,
            surfaceVariant = Surface2,
            onPrimary = Color.White,
            onBackground = Ink,
            onSurface = Ink,
            onSurfaceVariant = Muted,
            outline = Color(0x33FFFFFF),
            error = Err,
        ),
        shapes = Shapes(small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(22.dp)),
    ) { HmiScale(content) }
}
