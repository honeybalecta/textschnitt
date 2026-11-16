package androidx.annotation;

/** Nachbau für die Prüfläufe (in der App kommt die Annotation aus androidx.annotation). */
public @interface OptIn {
  Class<? extends java.lang.annotation.Annotation>[] markerClass();
}
