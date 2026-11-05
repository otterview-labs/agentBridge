package com.otterview.agentsessionbridge;

import java.util.Collections;

public final class FrpScriptHarness {
  public static void main(String[] args) {
    if ("download".equals(args[0])) {
      // args[1] is the SHA-256 the fixture archive is expected to have.
      System.out.print(FrpInstallSupport.downloadWithChecksums(
          Collections.singletonMap("frp_0.61.1_darwin_arm64.tar.gz", args[1])));
    } else if ("pinned".equals(args[0])) {
      System.out.print(FrpInstallSupport.download(args[1]));
    } else if ("refuse".equals(args[0])) {
      System.out.print(FrpInstallSupport.downloadOrRefuse(args[1]));
    } else if ("directories".equals(args[0])) {
      System.out.print(FrpInstallSupport.serviceDirectories());
    } else if ("service-account".equals(args[0])) {
      System.out.print(FrpInstallSupport.serviceAccount());
    } else if ("mac".equals(args[0])) {
      System.out.print(FrpInstallSupport.macLaunchAgent(args.length > 1 ? args[1] : "asb-machine-2-ssh"));
    } else if ("linux-client".equals(args[0])) {
      System.out.print(FrpInstallSupport.linuxUserService(args[1]));
    } else if ("disable-client".equals(args[0])) {
      System.out.print(FrpInstallSupport.disableClient(args[1]));
    } else {
      throw new IllegalArgumentException("Unknown fixture");
    }
  }
}
