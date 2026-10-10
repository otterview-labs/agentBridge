package com.otterview.agentsessionbridge;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import java.util.concurrent.*;
import org.json.*;

/** User-started, visible supervision service. Restart rebuilds state from disk. */
public final class ManagedButlerService extends Service {
  private static volatile ManagedButlerService current;
  private static final String CHANNEL="asb_managed_butler";
  private static final int ID=41028;
  private ScheduledExecutorService executor;
  private PowerManager.WakeLock wake;
  private volatile boolean closing;
  static boolean running() { return current!=null; }
  static void start(Context context) throws Exception {
    ManagedRuntime.get(context).coordinator.enable(true);
    try {
      Intent intent=new Intent(context,ManagedButlerService.class);
      if(Build.VERSION.SDK_INT>=26) context.startForegroundService(intent); else context.startService(intent);
    } catch(RuntimeException e) { ManagedRuntime.get(context).coordinator.enable(false); throw e; }
  }
  static void pause(Context context) throws Exception {
    ManagedRuntime.get(context).coordinator.enable(false);
    ManagedButlerService service=current;
    if(service!=null) service.stopSelf();
  }
  @Override public IBinder onBind(Intent intent) { return null; }
  @Override public int onStartCommand(Intent intent,int flags,int startId) {
    try {
      if(intent!=null && "pause".equals(intent.getAction())) { pause(this); return START_NOT_STICKY; }
      if(!ManagedRuntime.get(this).coordinator.snapshot().optBoolean("enabled")) { stopSelf(); return START_NOT_STICKY; }
      notification("手机管家正在跟进任务"); current=this;
      if(executor==null) {
        wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"agentbridge:managed-turn");
        wake.setReferenceCounted(false);
        executor=Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::tick,0,10,TimeUnit.SECONDS);
      }
      return START_STICKY;
    } catch(Exception e) {
      try { ManagedRuntime.get(this).coordinator.enable(false); } catch(Exception ignored) {}
      stopSelf(); return START_NOT_STICKY;
    }
  }
  private void tick() {
    if(closing) return;
    try {
      ManagedRuntime runtime=ManagedRuntime.get(this);
      if(runtime.coordinator.hasDue()) {
        synchronized(wake) { if(!closing) wake.acquire(300000L); }
        if(!closing) runtime.coordinator.tick();
      }
      JSONObject state=runtime.coordinator.snapshot(); JSONArray jobs=state.getJSONArray("jobs");
      int active=0,attention=0;
      for(int i=0;i<jobs.length();i++) {
        String value=jobs.getJSONObject(i).optString("state");
        if(value.equals("waiting")||value.equals("observing")||value.equals("dispatching")) active++;
        if(value.equals("needs_user")||value.equals("uncertain")||value.equals("review")) attention++;
      }
      if(!closing) notification("正在跟进 "+active+" 项，待查看 "+attention+" 项");
    } catch(Exception ignored) {
      // Corrupt/persist-failed queue must not trigger new actions. Leave visible notice.
      if(!closing) notification("跟进暂时不可用，请打开 App 查看");
    } finally { releaseWake(); }
  }
  private void releaseWake() {
    if(wake!=null) synchronized(wake) { if(wake.isHeld()) wake.release(); }
  }
  private void notification(String message) {
    NotificationManager manager=getSystemService(NotificationManager.class);
    if(Build.VERSION.SDK_INT>=26) manager.createNotificationChannel(new NotificationChannel(CHANNEL,
        UiText.text("手机管家"),NotificationManager.IMPORTANCE_LOW));
    PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
    PendingIntent pause=PendingIntent.getService(this,1,new Intent(this,ManagedButlerService.class).setAction("pause"),PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
    Notification value=builder.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(UiText.text("手机管家"))
        .setContentText(UiText.text(message)).setContentIntent(open).setOngoing(true)
        .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause,UiText.text("暂停跟进"),pause).build()).build();
    if(Build.VERSION.SDK_INT>=34) startForeground(ID,value,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
    else startForeground(ID,value);
  }
  @Override public void onDestroy() {
    closing=true; if(current==this) current=null;
    if(executor!=null) executor.shutdownNow();
    releaseWake();
    stopForeground(true); super.onDestroy();
  }
}
