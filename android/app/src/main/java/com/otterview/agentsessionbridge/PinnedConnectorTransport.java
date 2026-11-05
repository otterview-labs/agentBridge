package com.otterview.agentsessionbridge;
import org.json.*;
import okhttp3.*;
import javax.net.ssl.*;
import java.security.*;
import java.security.cert.*;
import java.io.*;
import java.util.concurrent.TimeUnit;
/** Exact leaf pin and endpoint IP SAN validation; redirects/replays are refused. */
final class PinnedConnectorTransport implements ConnectorTransport {
 private volatile OkHttpClient transport;
  public JSONObject request(String origin,String host,String pin,String token,String method,String route,JSONObject body)throws Exception{
    X509TrustManager trust=new X509TrustManager(){public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}public void checkClientTrusted(X509Certificate[] c,String a)throws CertificateException{throw new CertificateException("Client trust unsupported");}public void checkServerTrusted(X509Certificate[] c,String a)throws CertificateException{try{if(c==null||c.length==0)throw new CertificateException("No certificate");ConnectorPolicy.verify(c[0],host,pin);}catch(Exception e){throw new CertificateException("Pinned endpoint certificate rejected");}}};
    SSLContext tls=SSLContext.getInstance("TLS");tls.init(null,new TrustManager[]{trust},new SecureRandom());
    OkHttpClient http=new OkHttpClient.Builder().sslSocketFactory(tls.getSocketFactory(),trust).hostnameVerifier((name,session)->{try{if(!host.equals(name.replace("[", "").replace("]", "")))return false;ConnectorPolicy.verify((X509Certificate)session.getPeerCertificates()[0],host,pin);return true;}catch(Exception ignored){return false;}}).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(10,TimeUnit.SECONDS).readTimeout(15,TimeUnit.SECONDS).callTimeout(20,TimeUnit.SECONDS).build();transport=http;
    Request.Builder request=new Request.Builder().url(origin+route).header("Accept","application/json");if(token!=null)request.header("Authorization","Bearer "+token);
    if("POST".equals(method))request.post(RequestBody.create(body.toString(),MediaType.get("application/json; charset=utf-8")));
    try(Response response=http.newCall(request.build()).execute()){
      if(response.code()>=300&&response.code()<400)throw new ConnectorException("redirect_refused","连接器重定向已拒绝，请重新核对配对地址");
      if(!response.isSuccessful())throw new ConnectorException(response.code()==401||response.code()==403?"authorization_failed":response.code()==409?"conflict":"server_error",response.code()==401||response.code()==403?"连接器授权已失效，请重新配对":response.code()==409?"会话正在运行或请求冲突；请核对电脑端状态":"连接器拒绝请求，请检查电脑端记录");
      ResponseBody data=response.body();if(data==null)throw new IOException("Empty connector response");InputStream input=data.byteStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){if(bytes.size()+n>2_000_000)throw new IOException("Connector response too large");bytes.write(buffer,0,n);}return new JSONObject(bytes.toString("UTF-8"));
    }finally{http.connectionPool().evictAll();http.dispatcher().executorService().shutdown();transport=null;}
  }
 public void close(){OkHttpClient http=transport;if(http!=null)http.dispatcher().cancelAll();}
}
