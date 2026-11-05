package com.otterview.agentsessionbridge;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Log;
import com.jcraft.jsch.SocketFactory;
import java.io.*;
import java.net.*;
import java.util.*;

/**
 * Binds JSch to the phone's Wi-Fi/Ethernet network when an always-on VPN is
 * active. A VPN may accept the default route but block long-lived raw SSH
 * sockets, which surfaces as JSch's "socket is not established" timeout.
 *
 * <p>JSch skips its own connect timeout when a SocketFactory is set, so every
 * path here connects with CONNECT_TIMEOUT itself.
 */
final class AndroidSshSocketFactory implements SocketFactory {
  private static final int CONNECT_TIMEOUT = 12_000;
  /** Process binding is global state: one connect at a time may hold it. */
  private static final Object PROCESS_BINDING = new Object();
  private final Network network;
  private final ConnectivityManager manager;

  AndroidSshSocketFactory(Context context) {
    Network selected = null;
    ConnectivityManager selectedManager = null;
    try {
      ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
      if (manager != null) {
        boolean vpnActive = false;
        for (Network network : manager.getAllNetworks()) {
          NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
          if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
            vpnActive = true;
            break;
          }
        }
        // The physical-network bypass exists only to route raw SSH around an
        // always-on VPN; without one, default routing is used.
        if (vpnActive) {
          // Prefer Wi-Fi/Ethernet, then cellular: any validated physical
          // network is a better SSH route than an always-on VPN tunnel that
          // silently drops long-lived raw sockets.
          List<Network> candidates = new ArrayList<>();
          for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) candidates.add(0, network);
            else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) candidates.add(network);
          }
          for (Network network : candidates) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities == null
                || !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                || !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED)) continue;
            selected = network;
            selectedManager = manager;
            break;
          }
        }
      }
    } catch (Exception error) {
      Log.w("AgentBridgeNative", "direct network selection failed; using default", error);
    }
    this.network = selected;
    this.manager = selectedManager;
  }

  @Override
  public Socket createSocket(String host, int port) throws IOException {
    if (network == null) return connectDefault(host, port);
    synchronized (PROCESS_BINDING) {
      // Some OEM/VPN stacks honor bindSocket for the source address but still
      // apply per-UID routing, so the process is bound too, only for the DNS
      // lookup and connect, and then put back exactly as it was. Restoring
      // getActiveNetwork() instead would pin the whole app to the VPN.
      Network previous = manager.getBoundNetworkForProcess();
      Socket socket = new Socket();
      try {
        manager.bindProcessToNetwork(network);
        InetAddress target = null;
        for (InetAddress address : network.getAllByName(host)) {
          if (address instanceof java.net.Inet4Address) {
            target = address;
            break;
          }
        }
        if (target == null) target = network.getAllByName(host)[0];
        network.bindSocket(socket);
        socket.connect(new InetSocketAddress(target, port), CONNECT_TIMEOUT);
        return socket;
      } catch (IOException bindFailure) {
        // The saved Network handle can go stale after Wi-Fi roaming; fall
        // back to default routing below rather than failing the session.
        try {
          socket.close();
        } catch (IOException ignored) {
          // Nothing was connected.
        }
      } finally {
        manager.bindProcessToNetwork(previous);
      }
    }
    return connectDefault(host, port);
  }

  private static Socket connectDefault(String host, int port) throws IOException {
    Socket socket = new Socket();
    try {
      socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT);
      return socket;
    } catch (IOException error) {
      try {
        socket.close();
      } catch (IOException ignored) {
        // Nothing was connected.
      }
      throw error;
    }
  }

  @Override
  public InputStream getInputStream(Socket socket) throws IOException {
    return socket.getInputStream();
  }

  @Override
  public OutputStream getOutputStream(Socket socket) throws IOException {
    return socket.getOutputStream();
  }
}
