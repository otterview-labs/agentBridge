package com.otterview.agentsessionbridge;
import java.net.*;import java.security.*;import java.security.cert.*;import java.nio.charset.StandardCharsets;import java.util.*;import javax.net.ssl.*;import okhttp3.*;
/** WSS leaf pin is separate from the computer offer-signing certificate pin. */
final class ConnectorSignalTls {
 static void verify(X509Certificate cert,String host,String pin)throws Exception{
  cert.checkValidity();if(!MessageDigest.isEqual(ConnectorPolicy.digest(cert).getBytes(StandardCharsets.US_ASCII),pin.getBytes(StandardCharsets.US_ASCII)))throw new CertificateException("Signal pin mismatch");
  boolean ip=host.matches("[0-9.]+")||host.indexOf(':')>=0,matched=false;Collection<List<?>> sans=cert.getSubjectAlternativeNames();
  if(sans!=null)for(List<?> san:sans){if(san.size()<2||!(san.get(1)instanceof String))continue;String name=((String)san.get(1)).toLowerCase(Locale.ROOT);
   if(ip&&Integer.valueOf(7).equals(san.get(0))){if(Arrays.equals(InetAddress.getByName(host).getAddress(),InetAddress.getByName(name).getAddress()))matched=true;}
   if(!ip&&Integer.valueOf(2).equals(san.get(0))){if(host.equals(name))matched=true;else if(name.startsWith("*.")&&name.indexOf('*',1)<0){String suffix=name.substring(1);if(suffix.indexOf('.',1)>0&&host.endsWith(suffix)&&host.substring(0,host.length()-suffix.length()).indexOf('.')<0&&host.length()>suffix.length())matched=true;}}
  }if(!matched)throw new CertificateException("Signal SAN mismatch");
 }
 static OkHttpClient client(String host,String pin)throws Exception{
  X509TrustManager trust=new X509TrustManager(){public X509Certificate[]getAcceptedIssuers(){return new X509Certificate[0];}public void checkClientTrusted(X509Certificate[]c,String a)throws CertificateException{throw new CertificateException("Client trust unsupported");}public void checkServerTrusted(X509Certificate[]c,String a)throws CertificateException{try{if(c==null||c.length==0)throw new CertificateException("Missing signal certificate");verify(c[0],host,pin);}catch(Exception e){throw new CertificateException("Signal certificate rejected");}}};
  SSLContext tls=SSLContext.getInstance("TLS");tls.init(null,new TrustManager[]{trust},new SecureRandom());
  return new OkHttpClient.Builder().sslSocketFactory(tls.getSocketFactory(),trust).hostnameVerifier((name,session)->{try{if(!host.equals(name.replace("[","").replace("]","")))return false;verify((X509Certificate)session.getPeerCertificates()[0],host,pin);return true;}catch(Exception ignored){return false;}}).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(10,java.util.concurrent.TimeUnit.SECONDS).readTimeout(0,java.util.concurrent.TimeUnit.SECONDS).pingInterval(20,java.util.concurrent.TimeUnit.SECONDS).build();
 }
}
