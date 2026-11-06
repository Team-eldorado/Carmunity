import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Pleos Playground My Project 자격 증명 (HYBRID/SERVER 음성 모드에서만 필요)
// local.properties 에 PLEOS_CLIENT_ID / PLEOS_CLIENT_SECRET 를 넣으면 주입된다.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun prop(name: String, default: String = "") = (localProps.getProperty(name) ?: System.getenv(name) ?: default)

android {
    namespace = "com.evneighbor.connect"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.evneighbor.connect"
        minSdk = 28 // Pleos Connect 요구사항 (서명 키 로테이션·리니지)
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "DEFAULT_SERVER", "\"${prop("EVN_SERVER", "http://10.0.2.2:8080")}\"")
        buildConfigField("String", "PLEOS_CLIENT_ID", "\"${prop("PLEOS_CLIENT_ID")}\"")
        buildConfigField("String", "PLEOS_CLIENT_SECRET", "\"${prop("PLEOS_CLIENT_SECRET")}\"")
    }

    signingConfigs {
        // 시연용 release APK 서명. 실제 배포 시에는 별도 키스토어로 교체한다.
        create("demo") {
            storeFile = rootProject.file("keystore/carmunity-demo.jks")
            storePassword = prop("EVN_STORE_PASSWORD", "carmunity")
            keyAlias = "carmunity"
            keyPassword = prop("EVN_KEY_PASSWORD", "carmunity")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (rootProject.file("keystore/carmunity-demo.jks").exists()) {
                signingConfig = signingConfigs.getByName("demo")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/*.kotlin_module")
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // Pleos Connect SDK
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("ai.pleos.playground:TextToSpeech:3.3.1")
    implementation("ai.pleos.playground:SpeechToText:3.3.1")
    implementation("ai.pleos.playground:FusedLocation:1.1.3")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.json:json:20240303")
}
