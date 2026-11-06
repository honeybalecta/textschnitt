import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val hdVersion = providers.environmentVariable("HD_VERSION").getOrElse("1.0.0").removePrefix("v").removePrefix("deck-v").removePrefix("deck-android-v")
val hdCode = providers.environmentVariable("HD_VERSION_CODE").getOrElse("1").toInt()

android {
    namespace = "de.honeybalecta.honeydeck"
    compileSdk = 36

    defaultConfig {
        applicationId = "de.honeybalecta.honeydeck"
        minSdk = 29
        targetSdk = 36
        versionCode = hdCode
        versionName = hdVersion
    }

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
    // Die Oberfläche (deck/web + Schriften) legt deck/build.py vor dem Bauen nach src/main/assets/deck
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")
}
