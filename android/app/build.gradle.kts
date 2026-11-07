import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val tsVersion = providers.environmentVariable("TS_VERSION").getOrElse("1.0.0").removePrefix("v").removePrefix("android-v")
val tsCode = providers.environmentVariable("TS_VERSION_CODE").getOrElse("1").toInt()

android {
    namespace = "de.honeybalecta.textschnitt"
    compileSdk = 36
    ndkVersion = providers.environmentVariable("TS_NDK_VERSION").getOrElse("27.2.12479018")

    defaultConfig {
        applicationId = "de.honeybalecta.textschnitt"
        minSdk = 29
        targetSdk = 36
        versionCode = tsCode
        versionName = tsVersion
        ndk { abiFilters += listOf("arm64-v8a") }
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_STL=c++_static") } }
    }

    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }

    signingConfigs {
        create("release") {
            val ks = providers.environmentVariable("TS_KEYSTORE").orNull
            if (ks != null) {
                storeFile = file(ks)
                storePassword = providers.environmentVariable("TS_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("TS_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("TS_KEY_PASSWORD").get()
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (providers.environmentVariable("TS_KEYSTORE").isPresent)
                signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // Die Oberfläche kommt aus dem gemeinsamen Studio-Kern (../../core/web)
    sourceSets { getByName("main") { assets.srcDirs("src/main/assets", "../../core") } }
    androidResources { noCompress += listOf("bin") }
    packaging { jniLibs { useLegacyPackaging = false } }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    val media3 = "1.11.1"
    implementation("androidx.media3:media3-transformer:$media3")
    implementation("androidx.media3:media3-effect:$media3")
    implementation("androidx.media3:media3-common:$media3")
    // Automatisch freistellen: Personenerkennung (Modell im Programm enthalten)
    implementation("com.google.mlkit:segmentation-selfie:16.0.0-beta6")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
}
