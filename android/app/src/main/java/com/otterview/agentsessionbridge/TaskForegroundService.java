package com.otterview.agentsessionbridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;

public class TaskForegroundService extends Service {
  private static final String CHANNEL_ID = "asb_task_service";
  private static final int NOTIFICATION_ID = 41026;
  public static TaskForegroundService instance;
  private static final long POLL_INTERVAL_MS = 120_000L;
  private Handler pollHandler;
  private Runnable pollRunnable;
  private PhoneBridge bridge;
  private java.util.Map<String, String> lastTaskStatuses = new java.util.HashMap<>();

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
  public void onCreate() {
    super.onCreate();
    instance = this;
    pollHandler = new Handler(Looper.getMainLooper());
    pollRunnable = this::pollTasks;
  }

  @Override
  public void onDestroy() {
    instance = null;
    if (pollHandler != null) pollHandler.removeCallbacks(pollRunnable);
    stopForeground(true);
    super.onDestroy();
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
    startForeground(NOTIFICATION_ID, notification);
    if (pollHandler != null) {
      pollHandler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
    }
    return START_STICKY;
  }

  public void setBridge(PhoneBridge bridge) {
    this.bridge = bridge;
  }

  private void pollTasks() {
    if (bridge == null || instance == null) return;
    new Thread(() -> {
      try {
        String raw = bridge.studioState();
        JSONObject parsed = new JSONObject(raw);
        if (!parsed.optBoolean("ok")) return;
        JSONArray tasks = parsed.getJSONObject("data").getJSONArray("tasks");
        for (int i = 0; i < tasks.length(); i++) {
          JSONObject task = tasks.getJSONObject(i);
          String id = task.optString("id", "");
          String status = task.optString("status", "");
          boolean needsInput = task.optBoolean("requiredInput", false);
          String title = task.optString("title", "任务");
          String machineName = "";
          int machineId = task.optInt("machineId", 0);
          JSONArray machines = parsed.getJSONObject("data").getJSONArray("machines");
          for (int m = 0; m < machines.length(); m++) {
            if (machines.getJSONObject(m).optInt("id") == machineId) {
              machineName = machines.getJSONObject(m).optString("name", "");
              break;
            }
          }
          String key = id + ":" + status + ":" + needsInput;
          String prev = lastTaskStatuses.get(id);
          if (prev != null && !prev.equals(key)) {
            if (needsInput) {
              MainActivity activity = bridge != null ? bridge.getActivityForService() : null;
              if (activity != null) {
                activity.showTaskNotification(
                    "✋ " + title + " 需要输入",
                    machineName + " · " + (task.optString("requiredInput", "").isEmpty()
                        ? "AI 在等你的回复" : task.optString("requiredInput")));
              }
            } else if ("idle".equals(status) && prev != null && prev.contains("running")) {
              MainActivity activity = bridge != null ? bridge.getActivityForService() : null;
              if (activity != null) {
                activity.showTaskNotification(
                    "✅ " + title + " 已完成",
                    machineName + " · 会话空闲，请查看输出确认");
              }
            }
          }
          lastTaskStatuses.put(id, key);
        }
      } catch (Exception error) {
        android.util.Log.w("AgentBridgeService", "task poll failed", error);
      }
    }, "asb-task-poller").start();
    pollHandler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
  }
}
