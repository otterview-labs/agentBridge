package com.otterview.agentsessionbridge;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/** Binary frames for the official, metered Doubao real-time speech recognition endpoint. */
final class DoubaoAsrProtocol {
  static final String URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
  static final String RESOURCE = "volc.seedasr.sauc.duration";
  private static final int MAX_RESPONSE = 1_000_000;

  static byte[] request(int sequence, byte[] json) throws IOException {
    return frame(0x11, 0x11, sequence, json);
  }

  static byte[] audio(int sequence, byte[] pcm, boolean last) throws IOException {
    // The official client marks audio as JSON+gzip too; its payload is still raw PCM.
    return frame(last ? 0x23 : 0x21, 0x11, last ? -sequence : sequence, pcm);
  }

  private static byte[] frame(int type, int encoding, int sequence, byte[] payload) throws IOException {
    ByteArrayOutputStream result = new ByteArrayOutputStream();
    try (GZIPOutputStream zip = new GZIPOutputStream(result)) { zip.write(payload); }
    byte[] compressed = result.toByteArray();
    return ByteBuffer.allocate(12 + compressed.length).put((byte) 0x11).put((byte) type)
        .put((byte) encoding).put((byte) 0).putInt(sequence).putInt(compressed.length).put(compressed).array();
  }

  static final class Result {
    final boolean last;
    final int error;
    final byte[] json;
    Result(boolean last, int error, byte[] json) { this.last = last; this.error = error; this.json = json; }
  }

  static Result decode(byte[] bytes) throws IOException {
    if (bytes.length < 8 || bytes.length > MAX_RESPONSE || (bytes[0] & 0xf0) != 0x10) throw invalid();
    int headerLength = (bytes[0] & 15) * 4;
    int type = (bytes[1] & 0xff) >>> 4, flags = bytes[1] & 15;
    if (headerLength < 4 || headerLength > bytes.length || (type != 9 && type != 15)) throw invalid();
    ByteBuffer body = ByteBuffer.wrap(bytes);
    body.position(headerLength);
    if ((flags & 1) != 0) readInt(body);
    if ((flags & 4) != 0) readInt(body);
    int error = type == 15 ? readInt(body) : 0;
    int length = readInt(body);
    if (length != body.remaining()) throw invalid();
    boolean last = (flags & 2) != 0;
    if (type == 15) {
      if (error == 0) throw invalid();
      return new Result(last, error, new byte[0]); // Do not surface server-supplied error bodies.
    }
    if (length == 0) return new Result(last, error, new byte[0]);
    if ((bytes[2] & 0xf0) != 0x10) throw invalid();
    byte[] payload = new byte[length];
    body.get(payload);
    if ((bytes[2] & 15) == 0) return new Result(last, error, payload);
    if ((bytes[2] & 15) != 1) throw invalid();
    try (GZIPInputStream zip = new GZIPInputStream(new ByteArrayInputStream(payload));
         ByteArrayOutputStream plain = new ByteArrayOutputStream()) {
      byte[] chunk = new byte[4096];
      for (int count; (count = zip.read(chunk)) != -1; ) {
        if (plain.size() + count > MAX_RESPONSE) throw invalid();
        plain.write(chunk, 0, count);
      }
      return new Result(last, error, plain.toByteArray());
    }
  }

  private static int readInt(ByteBuffer body) throws IOException {
    if (body.remaining() < 4) throw invalid();
    return body.getInt();
  }

  private static IOException invalid() { return new IOException("Invalid Doubao ASR frame"); }
}
