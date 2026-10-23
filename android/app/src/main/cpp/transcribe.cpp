// Transkription mit whisper.cpp: ein Segment je Wort, Wortzeiten über die Aufmerksamkeits-Ausrichtung (DTW).
// Das entspricht dem Verfahren von faster-whisper am Desktop – darauf ist der Schnitt im Kern abgestimmt.
#include "transcribe.h"
#include <algorithm>
#include <cmath>
#include <cctype>
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
static bool on_abort(void * ud) {
    auto * cb = static_cast<Cb *>(ud);
    return cb->abort && *cb->abort && (*cb->abort)();
}

// Lautstärke je 10 ms in dB
static std::vector<float> envelope(const float * a, int n) {
    const int m = n / 160;
    std::vector<float> db(m);
    for (int k = 0; k < m; ++k) {
        double sum = 0; for (int i = k * 160, e = i + 160; i < e; ++i) sum += (double) a[i] * a[i];
        db[k] = (float) std::min(0.0, std::max(-90.0, 20 * std::log10(std::sqrt(sum / 160) + 1e-9)));
    }
    return db;
}

// Ton an Sprechpausen in Stücke von höchstens MAXC Sekunden teilen. Kurze Stücke halten Whisper davon ab,
// Neuansätze zu „bereinigen“, und die Wortzeiten können sich nicht über lange Strecken verschieben.
struct Chunk { int s, e; bool pause; };   // in 10-ms-Rahmen; pause: Schnitt liegt in einer Sprechpause
static std::vector<Chunk> split_chunks(const std::vector<float> & db, float thr) {
    const int MAXC = 1400, MINC = 500;   // Rahmen à 10 ms
    std::vector<Chunk> out;
    const int m = (int) db.size();
    int s = 0;
    while (m - s > MAXC) {
        // erste Pause ab MINC von mindestens 0,5 s → Schnitt in ihrer Mitte (Anläufe landen so meist in eigenen Stücken);
        // sonst die längste Lücke ab 0,25 s; sonst die leiseste Stelle im letzten Drittel
        int cut = -1, run = 0, best_len = 0, best_mid = -1;
        for (int k = s + MINC; k < s + MAXC; ++k) {
            if (db[k] < thr) { ++run; if (run > best_len) { best_len = run; best_mid = k - run / 2; } if (run >= 50) { cut = k - run / 2; break; } }
            else run = 0;
        }
        if (cut < 0 && best_len >= 25) cut = best_mid;
        if (cut < 0) {
            cut = s + MAXC - 1; float bv = 1e9f;
            for (int k = s + MAXC * 2 / 3; k < s + MAXC; ++k) { float v = 0; for (int j = -10; j <= 10; ++j) v += db[std::max(0, std::min(m - 1, k + j))]; if (v < bv) { bv = v; cut = k; } }
        }
        out.push_back({s, cut, run >= 50 || best_len >= 25}); s = cut;
    }
    out.push_back({s, m, true});
    return out;
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

    whisper_full_params p = whisper_full_default_params(opt.beam > 1 ? WHISPER_SAMPLING_BEAM_SEARCH : WHISPER_SAMPLING_GREEDY);
    if (opt.beam > 1) p.beam_search.beam_size = opt.beam;
    p.n_threads = opt.threads;
    p.print_progress = false; p.print_realtime = false; p.print_timestamps = false; p.print_special = false;
    p.translate = false;
    p.no_context = true;         // jedes Stück für sich (wie condition_on_previous_text=False)
    p.single_segment = opt.single_segment;   // ein Stück = ein Durchlauf, kein Weiterrücken innerhalb des Stücks
    p.token_timestamps = true;   // Zeitstempel pro Wort:
    p.max_len = 1;               //   jedes Segment ist ein Wort
    p.split_on_word = true;
    p.suppress_blank = true;
    p.suppress_nst = true;       // keine Geräusch-Symbole wie ♪ oder (Musik)
    p.language = opt.language.empty() ? "auto" : opt.language.c_str();
    p.initial_prompt = opt.prompt.empty() ? nullptr : opt.prompt.c_str();
    Cb cb{nullptr, &abort, -1};
    p.abort_callback = on_abort;
    p.abort_callback_user_data = &cb;

    // Stücke an Sprechpausen
    const std::vector<float> db = envelope(audio, n);
    std::vector<float> sorted = db; std::sort(sorted.begin(), sorted.end());
    const float floor_db = sorted.empty() ? -90.f : sorted[sorted.size() / 5];
    const float thr = std::max(-55.f, floor_db + 6.f);
    const auto chunks = split_chunks(db, thr);
    const int PAD = 16000 / 2;   // 0,5 s Stille vor und nach jedem Stück
    std::vector<float> buf;

    struct W { std::string text; double t0, t1; double dtw_end; float prob; int chunk; };
    std::vector<W> words;
    std::string lang;
    bool used_dtw = false;
    double last = 0;
    const whisper_token eot = whisper_token_eot(ctx);
    for (size_t ci = 0; ci < chunks.size(); ++ci) {
        const auto & c = chunks[ci];
        if (on_abort(&cb)) break;
        float mx = -90; for (int k = c.s; k < c.e; ++k) mx = std::max(mx, db[k]);
        if (mx < thr) continue;   // nur Stille
        const int s0 = c.s * 160, e0 = std::min(n, c.e * 160);
        buf.assign(PAD, 0.f); buf.insert(buf.end(), audio + s0, audio + e0); buf.insert(buf.end(), PAD, 0.f);
        p.audio_ctx = opt.audio_ctx > 0 ? std::min(1500, std::max(opt.audio_ctx, (int) std::ceil((buf.size() / 16000.0 + 1.0) / 30.0 * 1500))) : 0;
        const int rc = whisper_full(ctx, p, buf.data(), (int) buf.size());
        if (rc != 0) {
            if (on_abort(&cb)) break;
            whisper_free(ctx);
            return "{\"error\":\"Transkription fehlgeschlagen (Code " + std::to_string(rc) + ")\"}";
        }
        if (lang.empty()) { const char * ls = whisper_lang_str(whisper_full_lang_id(ctx)); if (ls) lang = ls; }
        const double off = s0 / 16000.0 - PAD / 16000.0, chunk_len = (e0 - s0) / 16000.0;
        const size_t w0 = words.size();
        const int ns = whisper_full_n_segments(ctx);
        for (int i = 0; i < ns; ++i) {
            const char * text = whisper_full_get_segment_text(ctx, i);
            if (!text || !*text) continue;
            W w{text, whisper_full_get_segment_t0(ctx, i) / 100.0, whisper_full_get_segment_t1(ctx, i) / 100.0, -1.0, 1.0f, (int) ci};
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
        // Entartete Ausrichtung (mehrere Wörter mit derselben Zeit): dort die Schätzung nehmen
        for (size_t k = w0; k + 1 < words.size(); ++k) {
            if (words[k].dtw_end < 0) continue;
            size_t j = k + 1;
            while (j < words.size() && words[j].dtw_end >= 0 && std::abs(words[j].dtw_end - words[k].dtw_end) < 1e-6) ++j;
            if (j - k >= 3) { for (size_t q = k; q < j; ++q) words[q].dtw_end = -1; }
            k = j - 1;
        }
        // Wie bei OpenAI/faster-whisper: ein Wort beginnt, wo das vorige endet, und endet mit seinem letzten Token.
        double prev_end = -1;
        for (size_t k = w0; k < words.size(); ++k) {
            W & w = words[k];
            if (!dtw) break;
            const bool has_end = w.dtw_end >= 0;
            double start = (prev_end >= 0 && has_end && prev_end < w.dtw_end && w.dtw_end - prev_end < 8.0) ? prev_end : -1;
            if (start < 0) start = has_end ? std::max(w.t0, w.dtw_end - std::min(1.0, 0.07 * (double) w.text.size() + 0.2)) : w.t0;
            double end = has_end ? w.dtw_end : std::min(std::max(w.t1, start + 0.05), start + 1.5);
            if (has_end || prev_end >= 0) used_dtw = true;
            w.t0 = start; w.t1 = std::max(end, start + 0.02);
            prev_end = has_end ? w.dtw_end : -1;
        }
        // In Stückzeit → Videozeit; Reihenfolge sichern (auch über Stückgrenzen); Wörter jenseits des Stücks (erfundene Fortsetzungen) weg
        size_t keep = w0;
        for (size_t k = w0; k < words.size(); ++k) {
            W w = words[k];
            w.t0 += off; w.t1 += off;
            if (w.t0 < last) w.t0 = last;
            if (w.t1 < w.t0 + 0.02) w.t1 = w.t0 + 0.02;
            last = w.t0;
            if (w.t0 > s0 / 16000.0 + chunk_len + 0.3) continue;
            if (c.pause && ci + 1 < chunks.size() && w.t0 > s0 / 16000.0 + chunk_len - 0.15) continue;   // Schnitt lag in einer Pause: dort beginnt kein echtes Wort mehr
            // Wort liegt komplett in Stille → erfunden
            int f0 = std::max(0, (int) (w.t0 * 100)), f1 = std::min((int) db.size(), (int) (w.t1 * 100) + 1);
            float m2 = -90; for (int f = f0; f < f1; ++f) m2 = std::max(m2, db[f]);
            if (f1 > f0 && m2 < thr && w.t1 - w.t0 > 0.12) continue;
            words[keep++] = w;
        }
        words.resize(keep);
        // Erfundener Text: ≥4 Wörter ohne Zeitfortschritt (Ausrichtung und Schätzung entartet) → weg
        for (size_t k = w0; k < words.size();) {
            size_t j = k + 1;
            while (j < words.size() && std::abs(words[j].t0 - words[k].t0) < 0.011) ++j;
            if (j - k >= 4) { words.erase(words.begin() + k, words.begin() + j); } else k = j;
        }
        // Typische Halluzinationen am Stückende
        for (size_t k = w0; k < words.size();) {
            std::string low = words[k].text; for (auto & ch : low) ch = (char) std::tolower((unsigned char) ch);
            const bool bad = (low.find("zusehen") != std::string::npos || low.find("zuschauen") != std::string::npos) && k > w0 && words[k - 1].text.find("Danke") != std::string::npos;
            const bool bad2 = low.find("untertitel") != std::string::npos || low.find("amara") != std::string::npos;
            if (bad) { words.erase(words.begin() + k - 1, words.begin() + k + 1); k = std::max(w0, k - 1); }
            else if (bad2) words.erase(words.begin() + k);
            else ++k;
        }
        // Stückgrenze mitten im Wort: dasselbe Wort am Ende des einen und am Anfang des nächsten Stücks → das erste weg
        if (w0 > 0 && words.size() > w0) {
            auto norm = [](std::string t) { std::string o; for (unsigned char ch : t) if (std::isalnum(ch) || ch >= 0x80) o += (char) std::tolower(ch); return o; };
            const W & a = words[w0 - 1]; const W & b = words[w0];
            const double edge = s0 / 16000.0;
            if (norm(a.text) == norm(b.text) && a.t1 > edge - 0.5 && b.t0 < edge + 0.5) words.erase(words.begin() + (w0 - 1));
        }
        if (progress) progress((int) (100.0 * c.e / std::max(1, (int) db.size())));
    }

    std::string out = "{\"words\":[";
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
    json_str(out, lang.c_str());
    out += ",\"timing\":";
    out += used_dtw ? "\"dtw\"" : "\"heuristic\"";
    out += ",\"chunks\":" + std::to_string(chunks.size()) + "}";
    whisper_free(ctx);
    return out;
}
