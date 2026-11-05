package com.otterview.agentsessionbridge;

import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.*;
import java.util.*;

/** QR trust is restricted to one HTTPS origin and one exact leaf certificate. */
final class ConnectorPolicy {
  final String endpoint, host, pin, pairingToken;
  final int version;final String signalPin,room;
  final boolean usbDevelopment;
  private ConnectorPolicy(String endpoint,String host,String pin,String token,boolean usb){this.endpoint=endpoint;this.host=host;this.pin=pin;this.pairingToken=token;this.usbDevelopment=usb;this.version=1;this.signalPin="";this.room="";}
  private ConnectorPolicy(String signal,String host,String signalPin,String room,String pin,String token){this.endpoint=signal;this.host=host;this.signalPin=signalPin;this.room=room;this.pin=pin;this.pairingToken=token;this.usbDevelopment=false;this.version=2;}
  static ConnectorPolicy parse(String raw,boolean debug) throws Exception {
    if(raw==null||raw.length()>4096)throw new IllegalArgumentException("Invalid pairing URI");
    URI uri=new URI(raw);
    if(!"agentbridge".equals(uri.getScheme())||!"pair".equals(uri.getHost())||uri.getPort()!=-1||uri.getUserInfo()!=null||uri.getFragment()!=null||!(uri.getRawPath()==null||uri.getRawPath().isEmpty()))throw new IllegalArgumentException("Invalid pairing URI");
    Map<String,String> values=new HashMap<>();String query=uri.getRawQuery();if(query==null)throw new IllegalArgumentException("Invalid pairing URI");
    for(String field:query.split("&",-1)){String[] kv=field.split("=",2);if(kv.length!=2)throw new IllegalArgumentException("Invalid pairing URI");String key=URLDecoder.decode(kv[0],"UTF-8"),value=URLDecoder.decode(kv[1],"UTF-8");if(!Arrays.asList("v","endpoint","signal","signalPin","room","pin","token").contains(key)||values.put(key,value)!=null)throw new IllegalArgumentException("Invalid pairing URI");}
    if(!values.containsKey("pin")||!values.containsKey("token")||!values.get("pin").matches("[0-9a-f]{64}")||!values.get("token").matches("[A-Za-z0-9_-]{20,256}"))throw new IllegalArgumentException("Invalid pairing URI");
    if("2".equals(values.get("v"))){
      if(values.size()!=6||values.containsKey("endpoint")||!values.containsKey("signal")||!values.containsKey("signalPin")||!values.containsKey("room")||!values.get("signalPin").matches("[0-9a-f]{64}")||!values.get("room").matches("[A-Za-z0-9_-]{16,128}"))throw new IllegalArgumentException("Invalid v2 invite");
      URI signal=new URI(values.get("signal"));String signalHost=signal.getHost();
      if(!"wss".equals(signal.getScheme())||signalHost==null||signal.getUserInfo()!=null||signal.getQuery()!=null||signal.getFragment()!=null||!"/v2/signal".equals(signal.getRawPath())||signal.getPort()!=-1&&(signal.getPort()<1||signal.getPort()>65535))throw new IllegalArgumentException("Invalid signal endpoint");
      signalHost=signalHost.replace("[","").replace("]","").toLowerCase(Locale.ROOT);
      if(signalHost.length()>253||!signalHost.matches("[a-z0-9][a-z0-9.:-]*[a-z0-9]|[a-z0-9]"))throw new IllegalArgumentException("Invalid signal host");
      return new ConnectorPolicy(signal.toASCIIString(),signalHost,values.get("signalPin"),values.get("room"),values.get("pin"),values.get("token"));
    }
    if(values.size()!=4||!"1".equals(values.get("v"))||!values.containsKey("endpoint"))throw new IllegalArgumentException("Invalid v1 invite");
    URI origin=new URI(values.get("endpoint"));String host=origin.getHost();
    if(!"https".equals(origin.getScheme())||host==null||origin.getUserInfo()!=null||origin.getQuery()!=null||origin.getFragment()!=null||!(origin.getRawPath()==null||origin.getRawPath().isEmpty())||origin.getPort()!=-1&&(origin.getPort()<1||origin.getPort()>65535))throw new IllegalArgumentException("Invalid HTTPS origin");
    host=host.replace("[", "").replace("]", "").toLowerCase(Locale.ROOT);
    // Literal addresses only: no DNS rebinding or implicit endpoint discovery.
    if(!host.matches("[0-9.]+")&&!host.matches("[0-9a-f:]+"))throw new IllegalArgumentException("Use a private IP address");
    if(host.indexOf(':')<0){String[] pieces=host.split("[.]",-1);if(pieces.length!=4)throw new IllegalArgumentException("Invalid IP address");for(String piece:pieces)if(!piece.matches("0|[1-9][0-9]{0,2}")||Integer.parseInt(piece)>255)throw new IllegalArgumentException("Invalid IP address");}
    InetAddress address=InetAddress.getByName(host);boolean usb=address.isLoopbackAddress();
    if((usb&&!debug)||(!usb&&!privateAddress(address)))throw new IllegalArgumentException("Private LAN address required");
    return new ConnectorPolicy(origin.toASCIIString(),host,values.get("pin"),values.get("token"),usb);
  }
  static boolean privateAddress(InetAddress address){byte[] b=address.getAddress();if(address.isAnyLocalAddress()||address.isMulticastAddress()||address.isLoopbackAddress())return false;if(b.length==4){int a=b[0]&255,c=b[1]&255;return a==10||a==172&&c>=16&&c<=31||a==192&&c==168||a==169&&c==254;}return b.length==16&&((b[0]&254)==252||(b[0]&255)==254&&(b[1]&192)==128);}
  static String digest(X509Certificate certificate) throws Exception {byte[] hash=MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());StringBuilder out=new StringBuilder();for(byte b:hash)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
  static void verify(X509Certificate certificate,String host,String pin) throws Exception {
    certificate.checkValidity();
    if(!MessageDigest.isEqual(digest(certificate).getBytes(StandardCharsets.US_ASCII),pin.getBytes(StandardCharsets.US_ASCII)))throw new CertificateException("Certificate pin mismatch");
    Collection<List<?>> sans=certificate.getSubjectAlternativeNames();boolean matched=false;
    if(sans!=null)for(List<?> san:sans)if(san.size()>=2&&Integer.valueOf(7).equals(san.get(0))&&san.get(1) instanceof String){try{if(Arrays.equals(InetAddress.getByName(host).getAddress(),InetAddress.getByName((String)san.get(1)).getAddress()))matched=true;}catch(Exception ignored){}}
    if(!matched)throw new CertificateException("Endpoint SAN mismatch");
  }
  static String uuid(String value){if(value==null||!value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))throw new IllegalArgumentException("Invalid identifier");return value.toLowerCase(Locale.ROOT);}
}
