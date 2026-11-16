package de.honeybalecta.textschnitt;

/**
 * Rechenteile für Einblendungen und unkenntlich gemachte Bereiche im Android-Export. Ohne Android-Klassen – so lassen sie sich
 * auch am Rechner prüfen (tests/java) und rechnen wie der Windows- und der Browser-Export.
 */
public final class OvGeom {
    private OvGeom() {}

    /**
     * Lage zur Zeit rel (Sekunden ab Beginn des Elements): Keyframes [t, x, y, w] stückweise linear; vor dem ersten und nach dem
     * letzten gilt der Randwert. Ohne Keyframes die festen Werte. Ergebnis {x, y, w} (Mitte und Breite als Anteile des Bilds).
     */
    public static float[] at(float[][] kf, float rel, float x, float y, float w) {
        if (kf == null || kf.length == 0) return new float[]{x, y, w};
        int n = kf.length;
        if (rel <= kf[0][0]) return new float[]{kf[0][1], kf[0][2], kf[0][3]};
        if (rel >= kf[n - 1][0]) return new float[]{kf[n - 1][1], kf[n - 1][2], kf[n - 1][3]};
        for (int i = 0; i < n - 1; i++) {
            if (rel < kf[i + 1][0]) {
                float f = (rel - kf[i][0]) / Math.max(1e-6f, kf[i + 1][0] - kf[i][0]);
                return new float[]{kf[i][1] + (kf[i + 1][1] - kf[i][1]) * f, kf[i][2] + (kf[i + 1][2] - kf[i][2]) * f,
                        kf[i][3] + (kf[i + 1][3] - kf[i][3]) * f};
            }
        }
        return new float[]{kf[n - 1][1], kf[n - 1][2], kf[n - 1][3]};
    }

    /**
     * Anker für ein Overlay, dessen Mitte bei c liegt (Koordinaten des Bilds von −1 bis 1; c darf außerhalb liegen) und das von
     * der Mitte aus half weit reicht. Media3 nimmt für beide Anker nur Werte von −1 bis 1 an: Liegt die Mitte im Bild, sitzt
     * der Anker in der Mitte des Overlays; sonst an der Stelle des Overlays, die auf dem Bildrand liegt.
     * Ergebnis {Anker im Overlay, Anker im Bild} oder null, wenn das Overlay ganz außerhalb des Bilds liegt.
     */
    public static float[] anchor(float c, float half) {
        if (c >= -1f && c <= 1f) return new float[]{0f, c};
        if (!(half > 1e-6f)) return null;
        float b = c > 1f ? 1f : -1f, o = (b - c) / half;
        if (o < -1f || o > 1f) return null;
        return new float[]{o, b};
    }

    /**
     * Fenster und Bereich eines unkenntlich gemachten Bereichs in Pixeln eines Bilds der Größe W × H (y von oben):
     * {Fenster x, y, Breite, Höhe, Bereich Mitte x, Mitte y, halbe Breite, halbe Höhe, Felder waagerecht, Felder senkrecht}.
     * Das Fenster hat die größte Größe des Bereichs (wmax), folgt seiner Mitte und bleibt im Bild; das Raster der Felder ist an
     * ihm verankert. x, y, w: Mitte und Breite als Anteile des Bilds, aspect = Breite : Höhe, cell = Feldgröße in Pixeln.
     */
    public static float[] blurBox(float x, float y, float w, float aspect, float wmax, float cell, int W, int H) {
        float a = Math.max(0.02f, aspect), rw = w * W, rh = rw / a;
        int ww = Math.min(W, Math.max(2, (int) Math.ceil(Math.max(wmax, w) * W / 2.0) * 2));
        int wh = Math.min(H, Math.max(2, (int) Math.ceil(Math.max(wmax, w) * W / a / 2.0) * 2));
        int wx = Math.max(0, Math.min(W - ww, (int) ((x * W - ww / 2f) / 2f) * 2));
        int wy = Math.max(0, Math.min(H - wh, (int) ((y * H - wh / 2f) / 2f) * 2));
        float c = Math.max(2f, cell);
        return new float[]{wx, wy, ww, wh, x * W, y * H, rw / 2, rh / 2, Math.max(1, Math.round(ww / c)), Math.max(1, Math.round(wh / c))};
    }

    /**
     * Gruppen von höchstens max Einträgen in der gegebenen Reihenfolge: {Anfang, Ende (ausschließlich)} je Gruppe.
     * (Eine Overlay-Stufe von Media3 nimmt nur eine begrenzte Zahl von Bildern auf.)
     */
    public static int[][] chunks(int n, int max) {
        int m = Math.max(1, max), k = (n + m - 1) / m;
        int[][] out = new int[k][];
        for (int i = 0; i < k; i++) out[i] = new int[]{i * m, Math.min(n, (i + 1) * m)};
        return out;
    }
}
