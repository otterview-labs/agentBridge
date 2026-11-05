package com.otterview.agentsessionbridge;

/** Shared endpoint normalization; no I/O, credentials or Android lifecycle. */
final class ModelEndpoint {
  private ModelEndpoint() {}

  static String normalize(String value) throws Exception {
    String clean = value == null ? "" : value.trim();
    while (clean.endsWith("/")) clean = clean.substring(0, clean.length() - 1);
    if (clean.endsWith("/chat/completions")) clean = clean.substring(0, clean.length() - "/chat/completions".length());
    if (clean.isEmpty()) throw new IllegalArgumentException(UiText.text("模型 Base URL 不能为空"));
    java.net.URL url = new java.net.URL(clean);
    boolean local = url.getHost().equals("localhost") || url.getHost().equals("127.0.0.1")
        || url.getHost().equals("[::1]");
    if (!url.getProtocol().equals("https") && !(url.getProtocol().equals("http") && local)) {
      throw new IllegalArgumentException(UiText.text("模型 Base URL 须使用 HTTPS；本机模型可用 HTTP"));
    }
    if (url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null) {
      throw new IllegalArgumentException(UiText.text("模型 Base URL 不能带凭据、查询参数或片段"));
    }
    return clean;
  }

}
