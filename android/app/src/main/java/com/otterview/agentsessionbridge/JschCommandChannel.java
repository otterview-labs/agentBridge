package com.otterview.agentsessionbridge;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.Session;
import java.io.InputStream;
import java.io.OutputStream;

/** The SSH-library adapter for RemoteCommandRunner. */
final class JschCommandChannel implements RemoteCommandRunner.Channel {
  private final Session session;
  private final ChannelExec channel;

  JschCommandChannel(Session session) throws Exception {
    this.session = session;
    this.channel = (ChannelExec) session.openChannel("exec");
  }

  @Override public void configure(String command, InputStream stdin, OutputStream stderr) {
    channel.setCommand(command);
    channel.setInputStream(stdin);
    channel.setErrStream(stderr);
  }
  @Override public InputStream stdout() throws Exception { return channel.getInputStream(); }
  @Override public void connect(int timeoutMillis) throws Exception { channel.connect(timeoutMillis); }
  @Override public boolean closed() { return channel.isClosed(); }
  @Override public boolean connected() { return session.isConnected(); }
  @Override public int exitStatus() { return channel.getExitStatus(); }
  @Override public void close() { channel.disconnect(); }
}
