// Transkription mit whisper.cpp – plattformunabhängig, damit derselbe Code in der App (jni.cpp)
// und im Linux-Test (tools/wtest.cpp) läuft.
#pragma once
#include <functional>
#include <string>

struct TsOptions {
    std::string model;        // Pfad zur ggml-Modelldatei
    std::string language;     // "de", "en" oder leer (automatisch)
    std::string prompt;       // Startkontext (Füllwörter), darf leer sein
    int threads = 4;
    bool dtw = true;          // Wortzeiten über die Aufmerksamkeits-Ausrichtung (wie faster-whisper); sonst Schätzung
};

// Liefert JSON: {"words":[{"text","start","end","prob"}], "lang":"de", "timing":"dtw"|"heuristic"} oder {"error":"…"}
std::string ts_transcribe(const TsOptions & opt, const float * audio, int n,
                          const std::function<void(int)> & progress, const std::function<bool()> & abort);
