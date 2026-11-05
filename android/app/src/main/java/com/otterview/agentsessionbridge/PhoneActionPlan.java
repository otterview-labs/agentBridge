package com.otterview.agentsessionbridge;

/** One user-defined operation, with no model planning or arbitrary click capability. */
final class PhoneActionPlan {
  static final long TIMEOUT_MS = 20000;
  final String packageName, action, text;
  final long deadline;
  boolean entered;
  PhoneActionPlan(String packageName, String action, String text, long now) {
    if (packageName == null || !packageName.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+"))
      throw new IllegalArgumentException("请选择有效的 App / Choose an app");
    if (!"open".equals(action) && !"input".equals(action) && !"search".equals(action))
      throw new IllegalArgumentException("不支持此操作 / Unsupported action");
    if (!"open".equals(action) && (text == null || text.trim().isEmpty() || text.length() > 2000))
      throw new IllegalArgumentException("请输入 1–2000 字内容 / Enter 1–2000 characters");
    this.packageName = packageName; this.action = action;
    this.text = "open".equals(action) ? "" : text; deadline = now + TIMEOUT_MS;
  }
  static boolean isSearch(String label) { return "搜索".equals(label) || "search".equalsIgnoreCase(label); }
  boolean expired(long now) { return now >= deadline; }
  boolean accepts(String visiblePackage) { return packageName.equals(visiblePackage); }
  // Prefer a field explicitly focused by the user. Never guess between several fields.
  static int choose(boolean[] focused) {
    int selected = -1, count = 0;
    for (int i = 0; i < focused.length; i++) if (focused[i]) { selected = i; count++; }
    return count == 1 ? selected : count == 0 && focused.length == 1 ? 0 : -1;
  }
}
