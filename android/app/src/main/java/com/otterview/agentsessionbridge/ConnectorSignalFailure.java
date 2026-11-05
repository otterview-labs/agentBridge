package com.otterview.agentsessionbridge;

/** Local diagnostics only. Never format throwable messages or remote response bodies. */
final class ConnectorSignalFailure {
 enum Kind { DNS, CONNECT, TIMEOUT, TLS_IDENTITY, TLS_HANDSHAKE, HTTP_UPGRADE, IO, OTHER }
 static int httpCode(int value){return value>=100&&value<=599?value:0;}
 static Kind classify(Throwable error,int responseCode){
  if(httpCode(responseCode)!=0)return Kind.HTTP_UPGRADE;
  Kind fallback=Kind.OTHER;
  Throwable cause=error;
  for(int depth=0;cause!=null&&depth<8;depth++){
   if(cause instanceof java.net.UnknownHostException)return Kind.DNS;
   if(cause instanceof java.net.ConnectException)return Kind.CONNECT;
   if(cause instanceof java.net.SocketTimeoutException)return Kind.TIMEOUT;
   if(cause instanceof javax.net.ssl.SSLPeerUnverifiedException||cause instanceof java.security.cert.CertificateException)return Kind.TLS_IDENTITY;
   if(cause instanceof javax.net.ssl.SSLHandshakeException)fallback=Kind.TLS_HANDSHAKE;
   else if(cause instanceof java.io.IOException&&fallback==Kind.OTHER)fallback=Kind.IO;
   cause=cause.getCause();
  }
  return fallback;
 }
 private ConnectorSignalFailure(){}
}
