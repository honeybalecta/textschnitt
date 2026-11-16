package androidx.media3.common;

/** Nachbau für die Prüfläufe: nur die Konstanten, die HoneyCuts Tonklassen benutzen (Werte wie in Media3). */
public final class C {
  public static final long TIME_END_OF_SOURCE = Long.MIN_VALUE;
  public static final long TIME_UNSET = Long.MIN_VALUE + 1;
  public static final int ENCODING_PCM_16BIT = 2;
  public static final int ENCODING_PCM_FLOAT = 4;
  private C() {}
}
