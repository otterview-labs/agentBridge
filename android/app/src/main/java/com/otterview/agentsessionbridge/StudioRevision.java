package com.otterview.agentsessionbridge;

import org.json.JSONArray;
import org.json.JSONObject;

/** Latest-turn replacement is committed only after the model succeeds. */
final class StudioRevision {
  static JSONArray scope(JSONArray messages, int taskId) throws Exception {
    JSONArray result=new JSONArray();
    for(int i=0;i<messages.length();i++) if(messages.getJSONObject(i).optInt("memoryTaskId")==taskId) result.put(messages.getJSONObject(i));
    return result;
  }
  static JSONArray before(JSONArray messages, String replyId) throws Exception {
    int count=messages.length();
    if(replyId.isEmpty() || count<2 || !messages.getJSONObject(count-1).optString("id").equals(replyId)
        || !messages.getJSONObject(count-1).optString("role").equals("assistant")
        || !messages.getJSONObject(count-2).optString("role").equals("user"))
      throw new IllegalStateException("对话已变化，仅能编辑或重新生成当前最后一轮，请刷新后重试");
    if(messages.getJSONObject(count-1).optBoolean("phoneAction") || messages.getJSONObject(count-2).optBoolean("phoneAction"))
      throw new IllegalStateException("手机操作记录不能重新生成或替换；需要再次执行时请发送新指令");
    JSONArray result=new JSONArray();
    for(int i=0;i<count-2;i++) result.put(messages.getJSONObject(i));
    return result;
  }
  static JSONArray replace(JSONArray all, String replyId, int taskId, JSONObject user, JSONObject reply) throws Exception {
    JSONArray selected=scope(all,taskId);
    before(selected,replyId);
    JSONObject oldReply=selected.getJSONObject(selected.length()-1), oldUser=selected.getJSONObject(selected.length()-2);
    JSONArray revisions=new JSONArray();
    JSONArray prior=oldReply.optJSONArray("revisions");
    if(prior!=null) for(int i=Math.max(0,prior.length()-4);i<prior.length();i++) revisions.put(prior.getJSONObject(i));
    JSONObject archived=new JSONObject(oldReply.toString()); archived.remove("revisions");
    revisions.put(new JSONObject().put("user",oldUser).put("assistant",archived));
    reply.put("revisions",revisions);
    JSONArray result=new JSONArray();
    for(int i=0;i<all.length();i++) {
      JSONObject item=all.getJSONObject(i);
      if(item==oldUser) result.put(user);
      else if(item==oldReply) result.put(reply);
      else result.put(item);
    }
    return result;
  }
}
