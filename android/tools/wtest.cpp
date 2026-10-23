// Linux-Test der Android-Transkription: liest ein 16-kHz-Mono-WAV und gibt dieselben Wörter aus wie die App.
// Aufruf: wtest <modell> <wav> [dtw|heuristic] [sprache]
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <vector>
#include "../app/src/main/cpp/transcribe.h"

static std::vector<float> read_wav(const char * path) {
    std::vector<float> out;
    FILE * f = fopen(path, "rb"); if (!f) return out;
    unsigned char h[44]; if (fread(h, 1, 44, f) != 44) { fclose(f); return out; }
    const int ch = h[22] | (h[23] << 8), bits = h[34] | (h[35] << 8);
    std::vector<short> buf(1 << 16);
    size_t n;
    while ((n = fread(buf.data(), 2, buf.size(), f)) > 0)
        for (size_t i = 0; i + ch - 1 < n; i += ch) out.push_back(buf[i] / 32768.0f);
    fclose(f);
    if (bits != 16) fprintf(stderr, "Warnung: %d Bit\n", bits);
    return out;
}

int main(int argc, char ** argv) {
    if (argc < 3) { fprintf(stderr, "wtest <modell> <wav> [dtw|heuristic] [sprache]\n"); return 2; }
    TsOptions opt;
    opt.model = argv[1];
    opt.dtw = argc < 4 || strcmp(argv[3], "heuristic") != 0;
    opt.language = argc > 4 ? argv[4] : "de";
    opt.threads = 4;
    opt.beam = argc > 5 ? atoi(argv[5]) : 0;
    opt.audio_ctx = argc > 6 ? atoi(argv[6]) : 0;
    opt.single_segment = !(argc > 7 && strcmp(argv[7], "multi") == 0);
    const char * pm = argc > 8 ? argv[8] : "app";
    if (!strcmp(pm, "app")) opt.prompt = "Ähm, also, äh, ich mein, hm, ja. Also ich – ich wollte, das ist, das ist ja so. Ähm, äh.";
    else if (!strcmp(pm, "strong")) opt.prompt = "Ähm, also, äh. Ich wollte – ich wollte heute, ähm, ich wollte heute sagen. Das ist, das ist ja so. Nochmal: Das ist ja so, das ist ja so. Äh, hm.";
    else if (strcmp(pm, "none")) opt.prompt = pm;
    auto audio = read_wav(argv[2]);
    if (audio.empty()) { fprintf(stderr, "WAV nicht lesbar\n"); return 1; }
    std::string json = ts_transcribe(opt, audio.data(), (int) audio.size(), [](int p) { fprintf(stderr, "\r%d %%", p); }, []() { return false; });
    fprintf(stderr, "\n");
    printf("%s\n", json.c_str());
    return 0;
}
