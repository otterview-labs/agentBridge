package com.otterview.agentsessionbridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Intent;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/** Never launches another app in the background. A notification opens the saved draft. */
public final class NoteReminderService extends JobService {
  @Override public boolean onStartJob(JobParameters params) {
    try {
      JSONArray due=NoteTasks.markDue(this,System.currentTimeMillis());
      NotificationManager manager=getSystemService(NotificationManager.class);
      if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("note-reminders",NoteTasksActivity.t("笔记提醒","Note reminders"),NotificationManager.IMPORTANCE_DEFAULT));
      for(int i=0;i<due.length();i++) {
        JSONObject note=due.getJSONObject(i);String id=note.optString("id");
        Intent intent=new Intent(this,NoteTasksActivity.class).putExtra("noteId",id).setData(android.net.Uri.parse("agentbridge-internal://note/"+id));
        PendingIntent open=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,"note-reminders"):new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle(NoteTasksActivity.t("小红书笔记待发布","Rednote draft is due"))
            .setContentText(note.optString("title")).setContentIntent(open).setAutoCancel(true);
        if(Build.VERSION.SDK_INT<33 || checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED)
          manager.notify(id,41062,builder.build());
      }
      NoteTasks.schedule(this);
    } catch(Exception error) { android.util.Log.e("NoteReminder","Could not process reminders",error); }
    return false;
  }
  @Override public boolean onStopJob(JobParameters params) { return true; }
}
