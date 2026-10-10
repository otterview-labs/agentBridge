package com.otterview.agentsessionbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Portable orchestration. Android lifecycle, model and executor are adapters. */
final class ManagedCoordinator {
  interface Backend {
    JSONObject observe(JSONObject binding) throws Exception;
    void send(JSONObject binding, String text, String actionId) throws Exception;
  }
  interface Planner { JSONObject decide(JSONObject job, JSONObject observation) throws Exception; }
  interface Memory { String read(JSONObject job) throws Exception; void record(JSONObject job, String text) throws Exception; }
  private final File file;
  private final Map<String, Backend> backends = new LinkedHashMap<>();
  private final Planner planner;
  private final Memory memory;
  private JSONObject state;
  private boolean ticking;

  ManagedCoordinator(File file, Planner planner, Memory memory) throws Exception {
    this.file = file; this.planner = planner; this.memory = memory;
    state = file.exists() ? new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8))
        : new JSONObject().put("schema", 1).put("enabled", false).put("jobs", new JSONArray());
    if (state.optInt("schema") != 1) throw new IllegalStateException("Unsupported managed queue schema");
    for (int i = 0; i < jobs().length(); i++) {
      JSONObject job = jobs().getJSONObject(i);
      if ("dispatching".equals(job.optString("state"))) {
        job.put("state", "uncertain"); event(job, "发送时应用退出，请核对原会话，未自动重发。");
      } else if ("observing".equals(job.optString("state"))) job.put("state", "waiting").put("nextAt", 0);
    }
    save();
  }
  synchronized void register(String key, Backend backend) { backends.put(key, backend); }
  synchronized JSONObject snapshot() throws Exception { return new JSONObject(state.toString()); }
  private JSONArray jobs() { return state.optJSONArray("jobs"); }
  synchronized void enable(boolean enabled) throws Exception {
    state.put("enabled", enabled);
    if (!enabled) for (int i=0;i<jobs().length();i++) {
      JSONObject job=jobs().getJSONObject(i);
      if (job.optString("state").equals("observing")) job.put("state","waiting");
      job.put("generation",job.optInt("generation")+1);
    }
    save();
  }
  synchronized JSONObject add(String backend, JSONObject binding, String goal, String rules, boolean allowReplies,
      int maxReplies, int minutes) throws Exception {
    if (!backends.containsKey(backend)) throw new IllegalArgumentException("Unknown execution backend");
    if (goal.trim().isEmpty() || goal.length() > 4000 || rules.trim().isEmpty() || rules.length() > 4000)
      throw new IllegalArgumentException("请填写目标和允许管家处理的范围（各最多 4000 字）。");
    for (int i = 0; i < jobs().length(); i++) {
      JSONObject old = jobs().getJSONObject(i);
      if (backend.equals(old.optString("backend")) && binding.toString().equals(old.optJSONObject("binding").toString())
          && !terminal(old.optString("state"))) throw new IllegalArgumentException("这个会话已有跟进任务，请先取消原任务。");
    }
    if (jobs().length() >= 100) throw new IllegalStateException("最多保留 100 个跟进任务，请先清理已结束任务。");
    long now = System.currentTimeMillis();
    JSONObject job = new JSONObject().put("id", UUID.randomUUID().toString()).put("backend", backend)
        .put("binding", new JSONObject(binding.toString())).put("goal", goal.trim()).put("rules", rules.trim())
        .put("allowReplies", allowReplies).put("maxReplies", Math.max(1, Math.min(20, maxReplies)))
        .put("replyCount", 0).put("checks", 0).put("state", "waiting").put("generation", 0)
        .put("nextAt", 0).put("deadline", now + Math.max(10, Math.min(1440, minutes)) * 60000L)
        .put("events", new JSONArray()).put("createdAt", now);
    event(job, "已加入手机跟进队列。"); jobs().put(job); save(); return new JSONObject(job.toString());
  }
  private static boolean terminal(String value) { return value.equals("complete") || value.equals("cancelled"); }
  synchronized void control(String id, String action) throws Exception {
    JSONObject job = find(id);
    if (job == null) throw new IllegalArgumentException("跟进任务不存在");
    String before = job.optString("state");
    if (action.equals("remove")) {
      if (!terminal(before)) throw new IllegalArgumentException("只能清理已结束任务");
      for (int i=0;i<jobs().length();i++) if (jobs().getJSONObject(i).optString("id").equals(id)) { jobs().remove(i); break; }
      save(); return;
    }
    if (terminal(before)) throw new IllegalArgumentException("任务已结束");
    if (action.equals("pause")) job.put("state", "paused");
    else if (action.equals("cancel")) job.put("state", "cancelled");
    else if (action.equals("accept")) {
      if (!before.equals("review")) throw new IllegalArgumentException("只有待验收的任务能标记完成");
      job.put("state", "complete");
    } else if (action.equals("resume")) {
      if (!before.equals("paused") && !before.equals("needs_user") && !before.equals("uncertain") && !before.equals("review"))
        throw new IllegalArgumentException("当前任务不需要恢复");
      if (System.currentTimeMillis() >= job.optLong("deadline")) throw new IllegalArgumentException("跟进期限已到，请重新创建任务");
      // Resume never replays a draft or an in-flight action. It reads fresh state.
      job.put("state", "waiting").put("nextAt", 0);
    } else throw new IllegalArgumentException("Unknown job action");
    job.put("generation", job.optInt("generation") + 1); event(job, "用户操作：" + action); save();
  }
  private JSONObject find(String id) {
    for (int i = 0; i < jobs().length(); i++) if (id.equals(jobs().optJSONObject(i).optString("id"))) return jobs().optJSONObject(i);
    return null;
  }
  private void event(JSONObject job, String text) throws Exception {
    JSONArray events = job.optJSONArray("events");
    if (events == null) { events = new JSONArray(); job.put("events", events); }
    events.put(new JSONObject().put("at", System.currentTimeMillis()).put("text", text.substring(0, Math.min(text.length(), 4000))));
    while (events.length() > 60) events.remove(0);
    job.put("updatedAt", System.currentTimeMillis()).put("message", text.substring(0, Math.min(text.length(), 4000)));
  }
  private void save() throws Exception {
    Files.createDirectories(file.getParentFile().toPath());
    File temp = new File(file.getPath() + ".tmp");
    try (FileOutputStream out = new FileOutputStream(temp)) {
      out.write(state.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync();
    }
    Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
  }
  synchronized boolean hasDue() {
    if (ticking || !state.optBoolean("enabled")) return false;
    long now=System.currentTimeMillis();
    for(int i=0;i<jobs().length();i++) {
      JSONObject job=jobs().optJSONObject(i);
      if(job!=null && job.optString("state").equals("waiting") && now>=job.optLong("nextAt")) return true;
    }
    return false;
  }

  /** One scheduler owns ticks, while UI controls can invalidate a pending decision. */
  void tick() throws Exception {
    JSONObject copy = null; int generation = 0; Backend backend = null;
    synchronized (this) {
      if (ticking || !state.optBoolean("enabled")) return;
      long now = System.currentTimeMillis();
      for (int i=0;i<jobs().length();i++) {
        JSONObject job=jobs().getJSONObject(i);
        if (!"waiting".equals(job.optString("state")) || now < job.optLong("nextAt")) continue;
        if (now >= job.optLong("deadline") || job.optInt("checks") >= 120) {
          job.put("state", "needs_user"); event(job, "已到跟进期限或检查次数上限，请查看结果。"); save(); continue;
        }
        backend = backends.get(job.optString("backend"));
        if (backend == null) { job.put("state", "needs_user"); event(job, "执行后端不可用，请选择可用后端。"); save(); continue; }
        job.put("state", "observing").put("checks", job.optInt("checks") + 1);
        generation=job.optInt("generation"); copy=new JSONObject(job.toString()); save(); ticking=true; break;
      }
    }
    if (copy == null) return;
    String id=copy.getString("id"); boolean dispatch=false;
    try {
      JSONObject observation=backend.observe(copy.getJSONObject("binding"));
      String revision=hash(observation.toString());
      String backendState=observation.optString("state");
      JSONObject decision;
      if (backendState.equals("running") || revision.equals(copy.optString("lastSentRevision")))
        decision=new JSONObject().put("action", "wait").put("reason", "员工仍在处理，稍后再查看。");
      else if (backendState.equals("confirmation") || backendState.equals("error"))
        decision=new JSONObject().put("action", "needs_user").put("reason", "执行后端需要确认或出现错误，请查看原会话。");
      else {
        copy.put("memory", memory.read(copy));
        decision=planner.decide(copy, observation);
      }
      String action=decision.optString("action"), reason=decision.optString("reason");
      String reply=decision.optString("reply").trim();
      if (!action.matches("wait|reply|needs_user|review")) throw new IllegalStateException("管家返回了无法识别的动作");
      // Re-observe before any mutation; a response to an old question must not be delivered.
      if (action.equals("reply")) {
        if (reply.isEmpty() || reply.length()>4000) throw new IllegalArgumentException("管家回复内容无效");
        if (!copy.optBoolean("allowReplies") || copy.optInt("replyCount")>=copy.optInt("maxReplies")) {
          action="needs_user"; reason="需要你确认回复，或已到自动回复次数上限。";
        } else if (!hash(backend.observe(copy.getJSONObject("binding")).toString()).equals(revision)) {
          action="wait"; reason="员工记录已变化，重新读取后再决定。";
        }
      }
      String actionId=UUID.randomUUID().toString();
      synchronized(this) {
        JSONObject current=find(id);
        if (!state.optBoolean("enabled") || current==null || current.optInt("generation")!=generation || !current.optString("state").equals("observing")) return;
        current.put("errors",0).put("lastObservation", observation).put("draft", reply).put("nextAt", System.currentTimeMillis()+60000L);
        current.put("state", action.equals("reply") ? "dispatching" : action.equals("wait") ? "waiting" : action);
        event(current, reason.isEmpty() ? action : reason);
        if (action.equals("reply")) {
          current.put("actionId", actionId).put("lastSentRevision", revision).put("replyCount", current.optInt("replyCount")+1);
          event(current, "正在发送："+reply); dispatch=true;
        }
        save();
      }
      if (dispatch) {
        backend.send(new JSONObject(copy.getJSONObject("binding").toString()).put("expectedRevision", revision), reply, actionId);
        synchronized(this) {
          JSONObject current=find(id);
          if (current!=null) {
            if (current.optString("state").equals("dispatching")) current.put("state", "waiting");
            event(current, "回复已送交后端，等待结果；尚未验收。"); save();
          }
        }
        try { memory.record(copy, "派发 "+actionId+"："+reply+"\n已送交后端，尚未验收。"); } catch(Exception ignored) { /* Queue remains authoritative. */ }
      }
    } catch(Exception error) {
      synchronized(this) {
        JSONObject current=find(id);
        if (current!=null && (dispatch || current.optInt("generation")==generation)) {
          if (!dispatch || current.optString("state").equals("dispatching")) current.put("state", dispatch ? "uncertain" : "waiting");
          current.put("deliveryUncertain",dispatch).put("nextAt", System.currentTimeMillis()+120000L);
          current.put("errors", current.optInt("errors")+1);
          if (!dispatch && current.optInt("errors")>=3) current.put("state", "needs_user");
          event(current, dispatch ? "发送结果不确定，请核对原会话，未自动重发。" : "读取或判断失败，稍后重试；连续三次失败会暂停。"); save();
        }
      }
    } finally { synchronized(this) { ticking=false; } }
  }
  static String hash(String text) throws Exception {
    byte[] bytes=MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
    StringBuilder out=new StringBuilder(); for(byte b:bytes) out.append(String.format(java.util.Locale.ROOT,"%02x",b)); return out.toString();
  }
}
