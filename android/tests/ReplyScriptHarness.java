package com.otterview.agentsessionbridge;

public final class ReplyScriptHarness {
  public static void main(String[] args) {
    if ("start".equals(args[0])) {
      System.out.print(RemoteReply.start(args[1]));
    } else if ("poll".equals(args[0])) {
      System.out.print(RemoteReply.poll(args[1]));
    } else if ("parse".equals(args[0])) {
      Integer exit = RemoteReply.exitCode(args[1]);
      System.out.print((exit == null ? "running" : exit) + "\n" + RemoteReply.output(args[1]));
    } else {
      throw new IllegalArgumentException("Unknown fixture");
    }
  }
}
