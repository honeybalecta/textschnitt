// JNI-Brücke zu whisper.cpp: Wortgenaue Zeitstempel, Fortschritt, Abbruch.
#include <jni.h>
#include <android/log.h>
#include <atomic>
#include <string>
#include <cstdio>
#include "whisper.h"

#define TAG "tsnative"
static std::atomic<bool> g_abort{false};

struct Progress { JNIEnv *env; jobject cb; jmethodID mid; int last; };

static void on_progress(struct whisper_context *, struct whisper_state *, int p, void *ud) {
    auto *pr = static_cast<Progress *>(ud);
    if (p == pr->last) return;
    pr->last = p;
    pr->env->CallVoidMethod(pr->cb, pr->mid, (jint) p);
    if (pr->env->ExceptionCheck()) pr->env->ExceptionClear();
}
static bool on_abort(void *) { return g_abort.load(); }

static void json_str(std::string &out, const char *s) {
    out += '"';
    for (const unsigned char *p = (const unsigned char *) s; *p; ++p) {
        unsigned char c = *p;
        if (c == '"' || c == '\\') { out += '\\'; out += (char) c; }
        else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); out += b; }
        else out += (char) c;
    }
    out += '"';
}

static jbyteArray to_bytes(JNIEnv *env, const std::string &s) {
    jbyteArray a = env->NewByteArray((jsize) s.size());
    env->SetByteArrayRegion(a, 0, (jsize) s.size(), (const jbyte *) s.data());
    return a;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_de_honeybalecta_textschnitt_Whisper_transcribe(JNIEnv *env, jclass, jstring jmodel, jfloatArray jaudio,
                                                    jstring jlang, jstring jprompt, jint threads, jobject cb) {
    g_abort = false;
    const char *cmodel = env->GetStringUTFChars(jmodel, nullptr);
    std::string model(cmodel);
    env->ReleaseStringUTFChars(jmodel, cmodel);
    const char *clang = env->GetStringUTFChars(jlang, nullptr);
    std::string lang(clang);
    env->ReleaseStringUTFChars(jlang, clang);
    const char *cprompt = env->GetStringUTFChars(jprompt, nullptr);
    std::string prompt(cprompt);
    env->ReleaseStringUTFChars(jprompt, cprompt);

    whisper_context_params cp = whisper_context_default_params();
    cp.use_gpu = false;
    whisper_context *ctx = whisper_init_from_file_with_params(model.c_str(), cp);
    if (!ctx) return to_bytes(env, "{\"error\":\"Das Whisper-Modell konnte nicht geladen werden.\"}");

    whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.n_threads = threads;
    p.print_progress = false; p.print_realtime = false; p.print_timestamps = false; p.print_special = false;
    p.translate = false;
    p.no_context = true;
    p.token_timestamps = true;   // Zeitstempel pro Wort:
    p.max_len = 1;               //   jedes Segment ist ein Wort
    p.split_on_word = true;
    p.language = lang.empty() ? "auto" : lang.c_str();
    p.initial_prompt = prompt.empty() ? nullptr : prompt.c_str();
    p.suppress_blank = true;

    Progress pr{env, cb, env->GetMethodID(env->GetObjectClass(cb), "onProgress", "(I)V"), -1};
    p.progress_callback = on_progress;
    p.progress_callback_user_data = &pr;
    p.abort_callback = on_abort;
    p.abort_callback_user_data = nullptr;

    jsize n = env->GetArrayLength(jaudio);
    jfloat *audio = env->GetFloatArrayElements(jaudio, nullptr);
    int rc = whisper_full(ctx, p, audio, n);
    env->ReleaseFloatArrayElements(jaudio, audio, JNI_ABORT);

    std::string out;
    if (rc != 0 && !g_abort.load()) {
        out = "{\"error\":\"Transkription fehlgeschlagen (Code " + std::to_string(rc) + ")\"}";
    } else {
        out = "{\"words\":[";
        const int ns = whisper_full_n_segments(ctx);
        const whisper_token eot = whisper_token_eot(ctx);
        bool first = true;
        for (int i = 0; i < ns; ++i) {
            const char *text = whisper_full_get_segment_text(ctx, i);
            if (!text || !*text) continue;
            double t0 = whisper_full_get_segment_t0(ctx, i) / 100.0;
            double t1 = whisper_full_get_segment_t1(ctx, i) / 100.0;
            float psum = 0; int pn = 0;
            const int nt = whisper_full_n_tokens(ctx, i);
            for (int j = 0; j < nt; ++j) {
                if (whisper_full_get_token_id(ctx, i, j) >= eot) continue;
                psum += whisper_full_get_token_p(ctx, i, j); ++pn;
            }
            char num[96];
            snprintf(num, sizeof num, ",\"start\":%.3f,\"end\":%.3f,\"prob\":%.3f}", t0, t1, pn ? psum / pn : 1.0f);
            if (!first) out += ',';
            first = false;
            out += "{\"text\":";
            json_str(out, text);
            out += num;
        }
        out += "],\"lang\":";
        json_str(out, whisper_lang_str(whisper_full_lang_id(ctx)) ? whisper_lang_str(whisper_full_lang_id(ctx)) : "");
        out += "}";
    }
    whisper_free(ctx);
    return to_bytes(env, out);
}

extern "C" JNIEXPORT void JNICALL
Java_de_honeybalecta_textschnitt_Whisper_abort(JNIEnv *, jclass) { g_abort = true; }

extern "C" JNIEXPORT jstring JNICALL
Java_de_honeybalecta_textschnitt_Whisper_systemInfo(JNIEnv *env, jclass) {
    return env->NewStringUTF(whisper_print_system_info());
}
