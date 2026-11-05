package com.otterview.agentsessionbridge;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.jcraft.jsch.KeyPairGenEdDSA;
import com.jcraft.jsch.SignatureEdDSA;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public final class SshCryptoCompatibilityTest {
  @Test
  public void androidEd25519FallbackSignsAndVerifiesSshMessages() throws Exception {
    // Exercise the same portable implementation selected by JSch on Android,
    // even when this test runs on a Java 17 host with native Ed25519 support.
    KeyPairGenEdDSA keys = new com.jcraft.jsch.bc.KeyPairGenEdDSA();
    keys.init("Ed25519", 256);
    byte[] message = "agentBridge SSH authentication".getBytes(StandardCharsets.UTF_8);
    SignatureEdDSA signer = new com.jcraft.jsch.bc.SignatureEd25519();
    signer.init();
    signer.setPrvKey(keys.getPrv());
    signer.update(message);
    byte[] signature = signer.sign();
    byte[] algorithm = "ssh-ed25519".getBytes(StandardCharsets.US_ASCII);
    byte[] wire = ByteBuffer.allocate(8 + algorithm.length + signature.length)
        .putInt(algorithm.length).put(algorithm).putInt(signature.length).put(signature).array();

    assertTrue(verify(keys.getPub(), message, wire));
    assertFalse(verify(keys.getPub(), "changed".getBytes(StandardCharsets.UTF_8), wire));
  }

  private static boolean verify(byte[] key, byte[] message, byte[] signature) throws Exception {
    SignatureEdDSA verifier = new com.jcraft.jsch.bc.SignatureEd25519();
    verifier.init();
    verifier.setPubKey(key);
    verifier.update(message);
    return verifier.verify(signature);
  }
}
