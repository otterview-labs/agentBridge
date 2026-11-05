package com.otterview.agentsessionbridge;
import org.json.JSONObject;
/** Local direct HTTPS is one transport; pairing/session UI does not own sockets. */
interface ConnectorTransport {
 JSONObject request(String origin,String host,String pin,String token,String method,String route,JSONObject body)throws Exception;
 default JSONObject publicState(){try{return new JSONObject().put("kind","https").put("state","unknown").put("path","local");}catch(Exception error){return new JSONObject();}}
 default boolean renewalDue(){return false;}
 default void networkChanged(){}
 void close();
}
