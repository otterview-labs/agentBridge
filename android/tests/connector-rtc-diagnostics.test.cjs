const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('RTC diagnostics expose only compile-time phase/failure enums and never exception or handshake material',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../app/src/main/java/com/otterview/agentsessionbridge/ConnectorRtcTransport.java'),'utf8');
 const calls=[...source.matchAll(/android\.util\.Log\.[a-z]\([^;]+;/g)].map(value=>value[0]);
 assert.equal(calls.length,10);
 assert.equal(calls.filter(call=>call.includes("signal_failure=")).length,1);
 for(const call of calls){assert.match(call,/"ConnectorRTC"/);assert.doesNotMatch(call,/statement|sdp|secret|key|token|certificate|signature|nonce|errorText|error\.|reason\.toString|getMessage|printStackTrace/i);}
 assert.match(source,/void fail\(Session s,Failure reason\)/);
 for(const call of source.matchAll(/fail\((?:s|started),([^)]*)\)/g))assert.match(call[1],/^Failure\.[A-Z_]+$/);
 assert.match(source,/\.put\("phase",phase\.name\(\)\)\.put\("failure",failure\.name\(\)\)/);
 assert.match(source,/closed\.compareAndSet\(false,true\)/);
});

test('SDK enum diagnostics preserve exact states, omit stale callbacks, and expose only fixed values',t=>{
 const {methods,harness}=require('./java-json-fixture.cjs');
 const iceHelper=fs.readFileSync(path.join(__dirname,'../app/src/main/java/com/otterview/agentsessionbridge/ConnectorIceDiagnostics.java'),'utf8').replace(/^package .*;\n/m,'').replace(/^import .*$/gm,'').replace('final class ConnectorIceDiagnostics','static final class ConnectorIceDiagnostics');
 const record=methods('ConnectorRtcTransport.java',' private void recordSdkIceState',' ConnectorRtcTransport(Context');
 const projection=methods('ConnectorRtcTransport.java',' public JSONObject publicState()',' private boolean alive');
 harness(t,'RtcSdkDiagnosticHarness',iceHelper+record+projection+`
 ConnectorIceDiagnostics iceDiagnostics=new ConnectorIceDiagnostics();
 static class NetworkSnapshotFixture{JSONObject publicValues(){return new JSONObject();}}
 NetworkSnapshotFixture networkSnapshot=new NetworkSnapshotFixture();
 enum Phase{IDLE} enum Failure{NONE} enum NetworkMode{PLATFORM_DEFAULT}
 NetworkMode networkMode=NetworkMode.PLATFORM_DEFAULT;
 Phase phase=Phase.IDLE;Failure failure=Failure.NONE;String connectionState="disconnected",pathState="unknown";
 static class Session{boolean live=true;}
 boolean alive(Session s){return s.live;}
 static class PeerConnection{enum IceConnectionState{NEW,CHECKING,CONNECTED,COMPLETED,DISCONNECTED,FAILED,CLOSED}enum PeerConnectionState{NEW,CONNECTING,CONNECTED,DISCONNECTED,FAILED,CLOSED}}
 volatile PeerConnection.IceConnectionState sdkIceState=PeerConnection.IceConnectionState.NEW;
 volatile PeerConnection.PeerConnectionState sdkPeerState=PeerConnection.PeerConnectionState.NEW;
 static class android{static class util{static class Log{static final List<String> records=new ArrayList<>();static void i(String tag,String message){records.add(tag+" "+message);}}}}
 public static void main(String[]args)throws Exception{RtcSdkDiagnosticHarness view=new RtcSdkDiagnosticHarness();Session session=new Session();
 for(PeerConnection.IceConnectionState state:PeerConnection.IceConnectionState.values()){view.recordSdkIceState(session,state);check(view.sdkIceState==state);check(view.publicState().getString("sdkIceState").equals(state.name()));check(android.util.Log.records.get(android.util.Log.records.size()-1).equals("ConnectorRTC sdk_ice="+state.name()));}
 for(PeerConnection.PeerConnectionState state:PeerConnection.PeerConnectionState.values()){view.recordSdkPeerState(session,state);check(view.sdkPeerState==state);check(view.publicState().getString("sdkPeerState").equals(state.name()));check(android.util.Log.records.get(android.util.Log.records.size()-1).equals("ConnectorRTC sdk_peer="+state.name()));}
 int before=android.util.Log.records.size();session.live=false;view.recordSdkIceState(session,PeerConnection.IceConnectionState.DISCONNECTED);view.recordSdkPeerState(session,PeerConnection.PeerConnectionState.FAILED);check(android.util.Log.records.size()==before);check(view.sdkIceState==PeerConnection.IceConnectionState.CLOSED&&view.sdkPeerState==PeerConnection.PeerConnectionState.CLOSED);session.live=true;view.recordSdkIceState(session,null);view.recordSdkPeerState(session,null);check(android.util.Log.records.size()==before);System.out.println("ok");}
 `,'import java.util.concurrent.atomic.*;');
 const source=fs.readFileSync(path.join(__dirname,'../app/src/main/java/com/otterview/agentsessionbridge/ConnectorRtcTransport.java'),'utf8');
 assert.match(source,/current\.set\(s\);iceDiagnostics=s\.ice;failure=Failure\.NONE;sdkIceState=PeerConnection\.IceConnectionState\.NEW;sdkPeerState=PeerConnection\.PeerConnectionState\.NEW;/);
 assert.match(source,/onIceConnectionChange\(PeerConnection\.IceConnectionState state\)\{recordSdkIceState\(s,state\);[^\n]*?if\(state==PeerConnection\.IceConnectionState\.FAILED\|\|state==PeerConnection\.IceConnectionState\.CLOSED\|\|state==PeerConnection\.IceConnectionState\.DISCONNECTED\)fail\(s,Failure\.ICE_DISCONNECTED\)/);
 assert.match(source,/onConnectionChange\(PeerConnection\.PeerConnectionState state\)\{recordSdkPeerState\(s,state\);if\(state==PeerConnection\.PeerConnectionState\.FAILED\|\|state==PeerConnection\.PeerConnectionState\.CLOSED\|\|state==PeerConnection\.PeerConnectionState\.DISCONNECTED\)fail\(s,Failure\.PEER_DISCONNECTED\)/);
});
