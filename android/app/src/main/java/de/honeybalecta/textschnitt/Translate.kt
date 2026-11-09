package de.honeybalecta.textschnitt

import android.content.Context
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import org.json.JSONArray
import org.json.JSONObject

/**
 * Untertitel übersetzen mit ML Kit – läuft auf dem Gerät. Das Sprachmodell wird beim ersten Mal geladen
 * (ca. 30 MB je Sprache) und bleibt danach offline verfügbar.
 */
object Translate {
    fun start(ctx: Context, texts: JSONArray, src: String, tgt: String, job: Job) {
        val s = TranslateLanguage.fromLanguageTag(src.take(2).lowercase()) ?: throw IllegalStateException("Ausgangssprache ${src.uppercase()} wird nicht unterstützt")
        val t = TranslateLanguage.fromLanguageTag(tgt.take(2).lowercase()) ?: throw IllegalStateException("Zielsprache ${tgt.uppercase()} wird nicht unterstützt")
        val n = texts.length()
        if (s == t) { job.done(JSONObject().put("texts", texts)); return }
        val tr: Translator = Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(s).setTargetLanguage(t).build())
        job.message = "Lade Sprachmodell (einmalig, ca. 30 MB) …"
        tr.downloadModelIfNeeded(DownloadConditions.Builder().build())
            .addOnSuccessListener {
                val out = arrayOfNulls<String>(n)
                fun next(i: Int) {
                    if (job.status != "running") { tr.close(); return }
                    if (i >= n) { tr.close(); job.done(JSONObject().put("texts", JSONArray(out.map { it ?: "" }))); return }
                    val txt = texts.optString(i, "").trim()
                    if (txt.isEmpty()) { out[i] = ""; next(i + 1); return }
                    tr.translate(txt)
                        .addOnSuccessListener { r -> out[i] = r; job.progress = (i + 1.0) / n * 0.99; job.message = "Übersetze … ${i + 1} von $n"; next(i + 1) }
                        .addOnFailureListener { e -> tr.close(); job.fail(e) }
                }
                next(0)
            }
            .addOnFailureListener { e -> tr.close(); job.fail(IllegalStateException("Sprachmodell konnte nicht geladen werden (Internet nötig): ${e.message}")) }
    }
}
