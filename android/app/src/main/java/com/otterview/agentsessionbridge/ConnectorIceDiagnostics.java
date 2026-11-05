package com.otterview.agentsessionbridge;

import org.json.JSONObject;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Bounded diagnostics only: raw candidates, URLs and SDP are never retained. */
final class ConnectorIceDiagnostics {
 static final int MAX_COUNT=65535,MAX_ERROR_LOGS=16;
 enum CandidateType{HOST,SRFLX,RELAY,OTHER}
 enum ServerTransport{STUN_UDP,STUN_TLS,TURN_UDP,TURN_TCP,TURN_TLS,OTHER}
 enum Gathering{NEW,GATHERING,COMPLETE,UNKNOWN}
 private static final Pattern TYPE=Pattern.compile("(?:^|\\s)typ\\s+(host|srflx|relay)(?=\\s|$)");
 static int increment(AtomicInteger value){return value.updateAndGet(old->Math.min(MAX_COUNT,old+1));}
 static CandidateType candidateType(String candidate){if(candidate==null||candidate.length()>4096||!(candidate.startsWith("candidate:")||candidate.startsWith("a=candidate:")))return CandidateType.OTHER;Matcher match=TYPE.matcher(candidate);if(!match.find())return CandidateType.OTHER;switch(match.group(1)){case "host":return CandidateType.HOST;case "srflx":return CandidateType.SRFLX;case "relay":return CandidateType.RELAY;default:return CandidateType.OTHER;}}
 static ServerTransport serverTransport(String url){
  if(url==null||url.length()>2048)return ServerTransport.OTHER;
  int colon=url.indexOf(':');if(colon<1||colon>5)return ServerTransport.OTHER;
  String scheme=url.substring(0,colon).toLowerCase(Locale.ROOT);boolean tcp=false,udp=false,seen=false;
  int query=url.indexOf('?');if(query>=0){for(String item:url.substring(query+1).split("&")){int eq=item.indexOf('=');if(eq<0||!item.substring(0,eq).equalsIgnoreCase("transport"))continue;if(seen)return ServerTransport.OTHER;seen=true;String mode=item.substring(eq+1);tcp=mode.equalsIgnoreCase("tcp");udp=mode.equalsIgnoreCase("udp");if(!tcp&&!udp)return ServerTransport.OTHER;}}
  switch(scheme){case "stun":return tcp?ServerTransport.OTHER:ServerTransport.STUN_UDP;case "stuns":return udp?ServerTransport.OTHER:ServerTransport.STUN_TLS;case "turn":return tcp?ServerTransport.TURN_TCP:ServerTransport.TURN_UDP;case "turns":return udp?ServerTransport.OTHER:ServerTransport.TURN_TLS;default:return ServerTransport.OTHER;}
 }
 static final class Counts{
  final AtomicInteger host=new AtomicInteger(),srflx=new AtomicInteger(),relay=new AtomicInteger(),other=new AtomicInteger();
  void candidate(String value){switch(candidateType(value)){case HOST:increment(host);break;case SRFLX:increment(srflx);break;case RELAY:increment(relay);break;default:increment(other);}}
  JSONObject publicValues()throws Exception{return new JSONObject().put("host",host.get()).put("srflx",srflx.get()).put("relay",relay.get()).put("other",other.get());}
  String safeLine(){return "host="+host.get()+" srflx="+srflx.get()+" relay="+relay.get()+" other="+other.get();}
  static Counts fromSdp(String sdp){Counts counts=new Counts();if(sdp==null)return counts;if(sdp.length()>65536){increment(counts.other);return counts;}for(String line:sdp.split("\\r?\\n"))if(line.startsWith("a=candidate:"))counts.candidate(line);return counts;}
 }
 static final class ErrorRecord{
  final int code;final ServerTransport transport;final boolean log;
  ErrorRecord(int code,ServerTransport transport,boolean log){this.code=code;this.transport=transport;this.log=log;}
  String safeLine(){return "code="+code+" transport="+transport.name();}
 }
 final Counts gathered=new Counts();private final AtomicInteger errors=new AtomicInteger();
 private volatile int lastErrorCode;private volatile ServerTransport lastErrorTransport=ServerTransport.OTHER;
 private volatile Counts answer=new Counts();private volatile boolean answerLocalSetSuccess;private volatile Gathering answerGathering=Gathering.NEW;
 ErrorRecord error(int code,String url){int count=increment(errors);int safeCode=code>=0&&code<=9999?code:0;ServerTransport transport=serverTransport(url);lastErrorCode=safeCode;lastErrorTransport=transport;return new ErrorRecord(safeCode,transport,count<=MAX_ERROR_LOGS);}
 void answer(String sdp,boolean localSetSuccess,String gathering){answer=Counts.fromSdp(sdp);answerLocalSetSuccess=localSetSuccess;try{answerGathering=Gathering.valueOf(gathering);}catch(Exception ignored){answerGathering=Gathering.UNKNOWN;}}
 String answerLine(){return answer.safeLine()+" localSetSuccess="+answerLocalSetSuccess+" gathering="+answerGathering.name();}
 JSONObject publicValues()throws Exception{return new JSONObject().put("candidates",gathered.publicValues()).put("candidateErrorCount",errors.get()).put("lastCandidateErrorCode",lastErrorCode).put("lastCandidateErrorTransport",lastErrorTransport.name()).put("answerCandidates",answer.publicValues()).put("answerLocalSetSuccess",answerLocalSetSuccess).put("answerGathering",answerGathering.name());}
}
