package com.otterview.agentsessionbridge;

/** Localizes app-owned labels only; session output and user messages are never rewritten. */
final class UiText {
  private static volatile java.util.Map<String, String> dictionary = java.util.Collections.emptyMap();
  private static volatile boolean english;

  static void configure(String language, java.util.Map<String, String> entries) {
    dictionary = java.util.Collections.unmodifiableMap(new java.util.HashMap<>(entries));
    english = "en".equals(language);
  }

  static boolean english() { return english; }
  static java.util.Locale speechLocale() { return english ? java.util.Locale.US : java.util.Locale.SIMPLIFIED_CHINESE; }
  static String text(String source) {
    if (!english || source == null) return source;
    return dictionary.getOrDefault(source, source);
  }
}
