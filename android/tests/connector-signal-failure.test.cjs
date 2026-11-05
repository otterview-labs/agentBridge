const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');const{harness,source}=require('./java-json-fixture.cjs');
test('signal diagnostic classification is bounded and never formats throwable secrets',t=>{
 const raw=fs.readFileSync(path.join(source,'ConnectorSignalFailure.java'),'utf8');const code=raw.slice(raw.indexOf(' enum Kind'),raw.indexOf(' private ConnectorSignalFailure'));
 harness(t,'SignalFailureHarness',code+`
 static final String SECRET="fixture-token-url-address-room-cert";
 static class Opaque extends RuntimeException{Throwable next;int reads;public String getMessage(){throw new AssertionError("Read secret message");}public String toString(){throw new AssertionError("Formatted secret");}public synchronized Throwable getCause(){reads++;return next;}}
 public static void main(String[]args){check(httpCode(99)==0&&httpCode(100)==100&&httpCode(599)==599&&httpCode(600)==0&&httpCode(Integer.MAX_VALUE)==0);
 check(classify(new java.net.UnknownHostException(SECRET),0)==Kind.DNS);check(classify(new java.net.ConnectException(SECRET),0)==Kind.CONNECT);check(classify(new java.net.SocketTimeoutException(SECRET),0)==Kind.TIMEOUT);check(classify(new javax.net.ssl.SSLPeerUnverifiedException(SECRET),0)==Kind.TLS_IDENTITY);check(classify(new javax.net.ssl.SSLHandshakeException(SECRET),0)==Kind.TLS_HANDSHAKE);check(classify(new java.io.IOException(SECRET),0)==Kind.IO);check(classify(null,0)==Kind.OTHER);check(classify(new Opaque(),403)==Kind.HTTP_UPGRADE);
 javax.net.ssl.SSLHandshakeException tls=new javax.net.ssl.SSLHandshakeException(SECRET);tls.initCause(new java.security.cert.CertificateException(SECRET));check(classify(tls,0)==Kind.TLS_IDENTITY);
 Opaque self=new Opaque();self.next=self;check(classify(self,0)==Kind.OTHER&&self.reads==8);
 Opaque[] chain=new Opaque[9];for(int i=0;i<9;i++)chain[i]=new Opaque();for(int i=0;i<8;i++)chain[i].next=chain[i+1];chain[8].next=new java.net.UnknownHostException(SECRET);check(classify(chain[0],0)==Kind.OTHER);check(chain[8].reads==0);System.out.println("ok");}
 `);
 assert.doesNotMatch(raw,/getMessage\(|toString\(|getLocalizedMessage\(|printStackTrace\(/);
 const rtc=fs.readFileSync(path.join(source,'ConnectorRtcTransport.java'),'utf8');const callback=rtc.slice(rtc.indexOf('@Override public void onFailure'),rtc.indexOf('@Override public void onClosed'));assert.match(callback,/if\(alive\(s\)\)/);assert.match(callback,/if\(code==409\)fail\(s,Failure.SIGNAL_ROOM_UNAVAILABLE\);else fail\(s,Failure.SIGNAL_DISCONNECTED\)/);assert.match(rtc,/error.getCause\(\) instanceof ConnectorException/);assert.match(rtc,/"connector_unavailable"/);assert.doesNotMatch(callback,/\.body\(|\.message\(|\.url\(|getMessage\(/);
});
