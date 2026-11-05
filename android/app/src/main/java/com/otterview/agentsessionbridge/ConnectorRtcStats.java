package com.otterview.agentsessionbridge;
import java.util.*;import org.webrtc.RTCStats;
/** Only the transport's actual selected pair can establish a path label. */
final class ConnectorRtcStats {
 static String path(Map<String,RTCStats> stats){String selected=null;for(RTCStats item:stats.values())if("transport".equals(item.getType())&&item.getMembers().get("selectedCandidatePairId")instanceof String){selected=(String)item.getMembers().get("selectedCandidatePairId");break;}if(selected==null)return "unknown";RTCStats pair=stats.get(selected);if(pair==null||!"candidate-pair".equals(pair.getType())||!"succeeded".equals(pair.getMembers().get("state")))return "unknown";RTCStats local=stats.get(pair.getMembers().get("localCandidateId")),remote=stats.get(pair.getMembers().get("remoteCandidateId"));if(local==null||remote==null)return "unknown";Object l=local.getMembers().get("candidateType"),r=remote.getMembers().get("candidateType");if("relay".equals(l)||"relay".equals(r))return "relay";List<String> direct=Arrays.asList("host","srflx","prflx");return direct.contains(l)&&direct.contains(r)?"direct":"unknown";}
}
