// JNI-Brücke zu whisper.cpp: Fortschritt und Abbruch nach Kotlin, die Transkription selbst steht in transcribe.cpp.
#include <jni.h>
#include <atomic>
#include <string>
#include "transcribe.h"
#include "whisper.h"

static std::atomic<bool> g_abort{false};

static jbyteArray to_bytes(JNIEnv *env, const std::string &s) {
    jbyteArray a = env->NewByteArray((jsize) s.size());
    env->SetByteArrayRegion(a, 0, (jsize) s.size(), (const jbyte *) s.data());
    return a;
}
static std::string jstr(JNIEnv *env, jstring s) {
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string out(c);
    env->ReleaseStringUTFChars(s, c);
    return out;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_de_honeybalecta_textschnitt_Whisper_transcribe(JNIEnv *env, jclass, jstring jmodel, jfloatArray jaudio,
                                                    jstring jlang, jstring jprompt, jint threads, jobject cb) {
    g_abort = false;
    TsOptions opt;
    opt.model = jstr(env, jmodel);
    opt.language = jstr(env, jlang);
    opt.prompt = jstr(env, jprompt);
    opt.threads = threads;
    const jmethodID mid = env->GetMethodID(env->GetObjectClass(cb), "onProgress", "(I)V");
    auto progress = [&](int p) {
        env->CallVoidMethod(cb, mid, (jint) p);
        if (env->ExceptionCheck()) env->ExceptionClear();
    };
    auto abort = []() { return g_abort.load(); };

    jsize n = env->GetArrayLength(jaudio);
    jfloat *audio = env->GetFloatArrayElements(jaudio, nullptr);
    std::string out = ts_transcribe(opt, audio, n, progress, abort);
    env->ReleaseFloatArrayElements(jaudio, audio, JNI_ABORT);
    return to_bytes(env, out);
}

extern "C" JNIEXPORT void JNICALL
Java_de_honeybalecta_textschnitt_Whisper_abort(JNIEnv *, jclass) { g_abort = true; }

extern "C" JNIEXPORT jstring JNICALL
Java_de_honeybalecta_textschnitt_Whisper_systemInfo(JNIEnv *env, jclass) {
    return env->NewStringUTF(whisper_print_system_info());
}
