// Transkription mit whisper.cpp: ein Segment je Wort, Wortzeiten über die Aufmerksamkeits-Ausrichtung (DTW).
// Das entspricht dem Verfahren von faster-whisper am Desktop – darauf ist der Schnitt im Kern abgestimmt.
#include "transcribe.h"
#include <algorithm>
#include <cstdio>
#include <vector>
#include "whisper.h"

static void json_str(std::string & out, const char * s) {
    out += '"';
    for (const unsigned char * p = (const unsigned char *) s; *p; ++p) {
        unsigned char c = *p;
        if (c == '"' || c == '\\') { out += '\\'; out += (char) c; }
        else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); out += b; }
        else out += (char) c;
    }
    out += '"';
}

// Ausrichtungsköpfe passend zum Modell (Dateiname wie ggml-small-q5_1.bin)
static whisper_alignment_heads_preset preset_for(const std::string & model) {
    auto has = [&](const char * s) { return model.find(s) != std::string::npos; };
    if (has("large-v3-turbo") || has("large-v3_turbo")) return WHISPER_AHEADS_LARGE_V3_TURBO;
    if (has("large-v3")) return WHISPER_AHEADS_LARGE_V3;
    if (has("large-v2")) return WHISPER_AHEADS_LARGE_V2;
    if (has("large-v1") || has("large")) return WHISPER_AHEADS_LARGE_V1;
    if (has("medium.en")) return WHISPER_AHEADS_MEDIUM_EN;
    if (has("medium")) return WHISPER_AHEADS_MEDIUM;
    if (has("small.en")) return WHISPER_AHEADS_SMALL_EN;
    if (has("small")) return WHISPER_AHEADS_SMALL;
    if (has("base.en")) return WHISPER_AHEADS_BASE_EN;
    if (has("base")) return WHISPER_AHEADS_BASE;
    if (has("tiny.en")) return WHISPER_AHEADS_TINY_EN;
    if (has("tiny")) return WHISPER_AHEADS_TINY;
    return WHISPER_AHEADS_NONE;
}

struct Cb { const std::function<void(int)> * progress; const std::function<bool()> * abort; int last; };
static void on_progress(struct whisper_context *, struct whisper_state *, int p, void * ud) {
    auto * cb = static_cast<Cb *>(ud);
    if (p == cb->last) return;
    cb->last = p;
    if (cb->progress && *cb->progress) (*cb->progress)(p);
}
static bool on_abort(void * ud) {
    auto * cb = static_cast<Cb *>(ud);
    return cb->abort && *cb->abort && (*cb->abort)();
}

std::string ts_transcribe(const TsOptions & opt, const float * audio, int n,
                          const std::function<void(int)> & progress, const std::function<bool()> & abort) {
    whisper_context_params cp = whisper_context_default_params();
    cp.use_gpu = false;
    const auto preset = preset_for(opt.model);
    const bool dtw = opt.dtw && preset != WHISPER_AHEADS_NONE;
    if (dtw) {
        cp.dtw_token_timestamps = true;
        cp.dtw_aheads_preset = preset;
        cp.flash_attn = false;   // sonst schaltet whisper.cpp die DTW-Ausrichtung stillschweigend ab
    }
    whisper_context * ctx = whisper_init_from_file_with_params(opt.model.c_str(), cp);
    if (!ctx) return "{\"error\":\"Das Whisper-Modell konnte nicht geladen werden.\"}";

    whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.n_threads = opt.threads;
    p.print_progress = false; p.print_realtime = false; p.print_timestamps = false; p.print_special = false;
    p.translate = false;
    p.no_context = true;         // jedes Fenster für sich (wie condition_on_previous_text=False)
    p.token_timestamps = true;   // Zeitstempel pro Wort:
    p.max_len = 1;               //   jedes Segment ist ein Wort
    p.split_on_word = true;
    p.suppress_blank = true;
    p.suppress_nst = true;       // keine Geräusch-Symbole wie ♪ oder (Musik)
    p.language = opt.language.empty() ? "auto" : opt.language.c_str();
    p.initial_prompt = opt.prompt.empty() ? nullptr : opt.prompt.c_str();

    Cb cb{&progress, &abort, -1};
    p.progress_callback = on_progress;
    p.progress_callback_user_data = &cb;
    p.abort_callback = on_abort;
    p.abort_callback_user_data = &cb;

    const int rc = whisper_full(ctx, p, audio, n);
    std::string out;
    if (rc != 0 && !on_abort(&cb)) {
        out = "{\"error\":\"Transkription fehlgeschlagen (Code " + std::to_string(rc) + ")\"}";
        whisper_free(ctx);
        return out;
    }

    // Wörter einsammeln: Text, geschätzte Zeiten, DTW-Zeit des letzten Tokens (= Ende des Wortes), mittlere Wahrscheinlichkeit.
    // In whisper.cpp trägt ein Token die Zeit, an der die Ausrichtung zum nächsten Token springt – also sein Ende.
    struct W { std::string text; double t0, t1; double dtw_end; float prob; };
    std::vector<W> words;
    const int ns = whisper_full_n_segments(ctx);
    const whisper_token eot = whisper_token_eot(ctx);
    for (int i = 0; i < ns; ++i) {
        const char * text = whisper_full_get_segment_text(ctx, i);
        if (!text || !*text) continue;
        W w{text, whisper_full_get_segment_t0(ctx, i) / 100.0, whisper_full_get_segment_t1(ctx, i) / 100.0, -1.0, 1.0f};
        float psum = 0; int pn = 0;
        const int nt = whisper_full_n_tokens(ctx, i);
        for (int j = 0; j < nt; ++j) {
            if (whisper_full_get_token_id(ctx, i, j) >= eot) continue;
            const auto td = whisper_full_get_token_data(ctx, i, j);
            if (td.t_dtw >= 0) w.dtw_end = td.t_dtw / 100.0;
            psum += td.p; ++pn;
        }
        if (pn) w.prob = psum / pn;
        words.push_back(w);
    }
    // Wie bei OpenAI/faster-whisper: ein Wort beginnt, wo das vorige endet, und endet mit seinem letzten Token.
    // Das erste Wort eines Fensters beginnt bei der Schätzung (begrenzt), das letzte endet bei der Schätzung.
    bool used_dtw = false;
    double prev_end = -1;
    for (size_t k = 0; k < words.size(); ++k) {
        W & w = words[k];
        if (!dtw) break;
        const bool has_end = w.dtw_end >= 0;
        double start = (prev_end >= 0 && (!has_end || prev_end < w.dtw_end) && (!has_end || w.dtw_end - prev_end < 8.0)) ? prev_end : -1;
        if (start < 0) start = has_end ? std::max(w.t0, w.dtw_end - std::min(1.0, 0.07 * (double) w.text.size() + 0.2)) : w.t0;   // erstes Wort im Fenster: Länge schätzen
        double end = has_end ? w.dtw_end : std::min(std::max(w.t1, start + 0.05), start + 1.5);
        if (has_end || prev_end >= 0) used_dtw = true;
        w.t0 = start; w.t1 = std::max(end, start + 0.02);
        prev_end = has_end ? w.dtw_end : -1;
    }
    double last = 0;
    for (auto & w : words) {   // Reihenfolge sichern, keine negativen Längen
        if (w.t0 < last) w.t0 = last;
        if (w.t1 < w.t0 + 0.02) w.t1 = w.t0 + 0.02;
        last = w.t0;
    }

    out = "{\"words\":[";
    bool first = true;
    for (const auto & w : words) {
        char num[96];
        snprintf(num, sizeof num, ",\"start\":%.3f,\"end\":%.3f,\"prob\":%.3f}", w.t0, w.t1, w.prob);
        if (!first) out += ',';
        first = false;
        out += "{\"text\":";
        json_str(out, w.text.c_str());
        out += num;
    }
    out += "],\"lang\":";
    const char * ls = whisper_lang_str(whisper_full_lang_id(ctx));
    json_str(out, ls ? ls : "");
    out += ",\"timing\":";
    out += used_dtw ? "\"dtw\"" : "\"heuristic\"";
    out += "}";
    whisper_free(ctx);
    return out;
}
