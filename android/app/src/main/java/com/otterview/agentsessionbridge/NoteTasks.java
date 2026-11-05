package com.otterview.agentsessionbridge;

import android.app.job.JobScheduler;
import android.app.job.JobInfo;
import android.content.ComponentName;
import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local drafts. Scheduling only makes a draft due; it never publishes content. */
final class NoteTasks {
  static final int JOB = 41061;
  private static final String PREF = "local_note_tasks";
  static synchronized JSONArray list(Context context) {
    try { return new JSONArray(context.getSharedPreferences(PREF,0).getString("notes","[]")); }
    catch (Exception error) { throw new IllegalStateException("Cannot read note drafts",error); }
  }
  static JSONObject validate(JSONObject value, long now) throws Exception {
    String title=value.optString("title").trim(), body=value.optString("body").trim();
    if(title.isEmpty() && body.isEmpty()) throw new IllegalArgumentException("请填写标题或正文 / Enter a title or body");
    if(title.length()>100 || body.length()>10000) throw new IllegalArgumentException("标题最多 100 字，正文最多 10000 字 / Title: 100 characters; body: 10000");
    long due=value.optLong("dueAt");
    if(due<0 || (due>0 && due<=now)) throw new IllegalArgumentException("请选择未来的提醒时间 / Choose a future reminder time");
    String image=value.optString("image");
    if(!image.isEmpty() && !image.startsWith("content://")) throw new IllegalArgumentException("请选择手机中的图片 / Select an image on this phone");
    return new JSONObject().put("id", value.optString("id").isEmpty()?java.util.UUID.randomUUID().toString():value.optString("id"))
        .put("title",title).put("body",body).put("image",image).put("dueAt",due)
        .put("state",due>0?"scheduled":"draft").put("updatedAt",now);
  }
  private static void write(Context context, JSONArray notes) {
    if(!context.getSharedPreferences(PREF,0).edit().putString("notes",notes.toString()).commit())
      throw new IllegalStateException("草稿保存失败 / Could not save draft");
  }
  static synchronized void save(Context context, JSONObject note) throws Exception {
    JSONArray notes=list(context), next=new JSONArray();
    for(int i=0;i<notes.length();i++) if(!notes.getJSONObject(i).optString("id").equals(note.optString("id"))) next.put(notes.get(i));
    next.put(note);write(context,next);
    context.getSystemService(android.app.NotificationManager.class).cancel(note.optString("id"),41062);
    schedule(context);
  }
  static synchronized void delete(Context context,String id) throws Exception {
    JSONArray notes=list(context), next=new JSONArray();
    for(int i=0;i<notes.length();i++) if(!notes.getJSONObject(i).optString("id").equals(id)) next.put(notes.get(i));
    write(context,next);
    context.getSystemService(android.app.NotificationManager.class).cancel(id,41062);
    schedule(context);
  }
  static synchronized JSONArray markDue(Context context,long now) throws Exception {
    JSONArray notes=list(context), due=new JSONArray();
    for(int i=0;i<notes.length();i++) {
      JSONObject note=notes.getJSONObject(i);
      if(note.optString("state").equals("scheduled") && note.optLong("dueAt")<=now) {
        note.put("state","due");due.put(note);
      }
    }
    write(context,notes);return due;
  }
  static synchronized JSONObject find(Context context,String id) throws Exception {
    JSONArray notes=list(context);
    for(int i=0;i<notes.length();i++)if(notes.getJSONObject(i).optString("id").equals(id))return notes.getJSONObject(i);
    throw new IllegalStateException("草稿不存在或已删除 / Draft no longer exists");
  }
  static synchronized void completeImage(Context context,String id,String uri,String status) throws Exception {
    JSONObject note=find(context,id);
    if(!note.optString("imageStatus").equals("pending"))return;
    if(!uri.isEmpty()&&!uri.startsWith("content://"))throw new IllegalArgumentException("Invalid image URI");
    note.put("image",uri).put("imageStatus",status).put("updatedAt",System.currentTimeMillis());save(context,note);
  }
  static synchronized boolean schedule(Context context) throws Exception {
    JSONArray notes=list(context);long earliest=Long.MAX_VALUE;
    for(int i=0;i<notes.length();i++) {JSONObject n=notes.getJSONObject(i);if(n.optString("state").equals("scheduled"))earliest=Math.min(earliest,n.optLong("dueAt"));}
    JobScheduler jobs=context.getSystemService(JobScheduler.class);
    jobs.cancel(JOB);
    if(earliest==Long.MAX_VALUE)return true;
    long delay=Math.max(1000,earliest-System.currentTimeMillis());
    return jobs.schedule(new JobInfo.Builder(JOB,new ComponentName(context,NoteReminderService.class))
        .setMinimumLatency(delay).setOverrideDeadline(delay+15*60*1000).setPersisted(true).build())==JobScheduler.RESULT_SUCCESS;
  }
}
