package com.otterview.agentsessionbridge;

public final class ReplyScriptHarness {
  public static void main(String[] args) {
    if ("start".equals(args[0])) {
      System.out.print(RemoteReply.start(args[1]));
    } else if ("poll".equals(args[0])) {
      System.out.print(RemoteReply.poll(args[1]));
    } else if ("cleanup".equals(args[0])) {
      System.out.print(RemoteReply.cleanup(args[1]));
    } else if ("parse".equals(args[0]) || "parse-file".equals(args[0])) {
      String content = args[1];
      if ("parse-file".equals(args[0])) {
        try {
          content = java.nio.file.Files.readString(java.nio.file.Path.of(args[1]));
        } catch (java.io.IOException error) {
          throw new IllegalArgumentException(error);
        }
      }
      Integer exit = RemoteReply.exitCode(content);
      System.out.print((exit == null ? "running" : exit) + "\n" + RemoteReply.output(content));
    } else {
      throw new IllegalArgumentException("Unknown fixture");
    }
  }
}
