package com.otterview.agentsessionbridge;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Log;
import java.net.URL;
import java.net.HttpURLConnection;
final class PhoneNetwork {
  static HttpURLConnection open(Context context, URL url) throws Exception {
    ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
    if (manager != null) {
      // Resolve through each candidate network explicitly. Some OEM resolver
      // setups leave the process default unable to resolve external model
      // hosts even though the active network itself is fine; Network#getAllByName
      // pins resolution and routing to one network and sidesteps that state.
      java.util.List<Network> candidates = new java.util.ArrayList<>();
      Network active = manager.getActiveNetwork();
      if (active != null) candidates.add(active);
      for (Network network : manager.getAllNetworks()) {
        if (candidates.contains(network)) continue;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        if (capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
            && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue;
        candidates.add(network);
      }
      for (Network network : candidates) {
        try {
          // DNS alone can succeed on a VPN whose data path is dead; probe a
          // real TCP connection so HTTP never lands on an unusable network.
          java.net.InetAddress[] addresses = network.getAllByName(url.getHost());
          if (addresses.length == 0) continue;
          java.net.Socket probe = network.getSocketFactory().createSocket();
          try {
            probe.connect(new java.net.InetSocketAddress(addresses[0], url.getPort() > 0 ? url.getPort() : url.getDefaultPort()), 4_000);
          } finally {
            try {
              probe.close();
            } catch (Exception closeError) {
              // The probe socket is discarded either way.
            }
          }
          return (HttpURLConnection) network.openConnection(url);
        } catch (java.io.IOException error) {
          Log.w("AgentBridgeNative", "model network candidate failed for " + url.getHost()
              + " net=" + network + " -> " + error);
          // Try the next network.
        }
      }
    }
    return (HttpURLConnection) url.openConnection();
  }

}
