package com.otterview.agentsessionbridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * Keeps the process in the foreground while an SSH or model operation that the
 * user started is still running, so locking the phone does not kill it. Every
 * operation holds one reference; the service stops when the last one ends.
 */
public class TaskForegroundService extends Service {
  private static final String CHANNEL_ID = "asb_task_service";
  private static final int NOTIFICATION_ID = 41026;
  private static final Object LOCK = new Object();
  private static int holders;
  /** The instance that has reached the foreground, if any. */
  private static TaskForegroundService current;

  static void acquire(Context context) {
    Context app = context.getApplicationContext();
    synchronized (LOCK) {
      holders += 1;
      if (holders > 1) return;
    }
    try {
      Intent intent = new Intent(app, TaskForegroundService.class);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(intent);
      else app.startService(intent);
    } catch (RuntimeException error) {
      // Android 12+ refuses to start a foreground service from the background.
      // The operation still runs; it just has no protection from being killed.
      Log.w("AgentBridgeService", "foreground service not started", error);
    }
  }

  static void release(Context context) {
    synchronized (LOCK) {
      if (holders == 0) return;
      holders -= 1;
      if (holders > 0) return;
      // Never stopService() here: stopping a service that was started with
      // startForegroundService() before it reached startForeground() crashes
      // the app. If it has not got there yet, onStartCommand stops it itself.
      if (current != null) current.stopSelf();
    }
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(
          CHANNEL_ID, "Agent Bridge 后台任务", NotificationManager.IMPORTANCE_LOW);
      getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    ensureChannel();
    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CHANNEL_ID)
        : new Notification.Builder(this);
    Notification notification = builder
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle("Agent Bridge 后台任务")
        .setContentText("正在执行远程任务")
        .setOngoing(true)
        .build();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }
    synchronized (LOCK) {
      current = this;
      // Started for an operation that has already finished.
      if (holders == 0) stopSelf();
    }
    // Operations do not survive the process, so neither should the service.
    return START_NOT_STICKY;
  }

  /** Android 15 caps dataSync services at 6 hours a day; stop cleanly instead of crashing. */
  @Override
  public void onTimeout(int startId, int fgsType) {
    Log.w("AgentBridgeService", "dataSync time limit reached; leaving the foreground");
    synchronized (LOCK) {
      holders = 0;
    }
    stopSelf();
  }

  @Override
  public void onDestroy() {
    synchronized (LOCK) {
      if (current == this) current = null;
    }
    stopForeground(true);
    super.onDestroy();
  }
}
