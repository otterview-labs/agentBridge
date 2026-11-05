package com.otterview.agentsessionbridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import java.util.ArrayList;
import java.util.HashSet;
import org.json.JSONArray;
import org.json.JSONObject;

/** Separate local-only bridge. Never registered as an LLM tool or remote RPC. */
final class PhoneActions {
  private final Activity activity;
  private final Handler main = new Handler(Looper.getMainLooper());
  private static volatile String state = "idle", detail = "尚未执行 / No action yet";
  private static volatile long updatedAt;
  private static volatile boolean busy;
  private static volatile String requestId = "";
  PhoneActions(Activity activity) { this.activity = activity; }
  static synchronized void result(String next, String message) {
    state = next; detail = message; updatedAt = System.currentTimeMillis();
    busy = next.equals("waiting") || next.equals("running");
  }
  private String ok(JSONObject data) { try { return new JSONObject().put("ok", true).put("data", data).toString(); } catch(Exception e) { throw new IllegalStateException(e); } }
  private String error(Exception e) { try { return new JSONObject().put("ok", false).put("error", e.getMessage()).toString(); } catch(Exception ignored) { return "{\"ok\":false}"; } }
  @JavascriptInterface public String status() {
    synchronized (PhoneActions.class) { return statusLocked(); }
  }
  private String statusLocked() {
    try { return ok(new JSONObject().put("enabled", PhoneActionService.current() != null)
        .put("requestId", requestId).put("state", state).put("detail", detail).put("updatedAt", updatedAt).put("busy", busy)); }
    catch(Exception e) { return error(e); }
  }
  @JavascriptInterface public String apps() {
    try {
      Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
      ArrayList<ResolveInfo> list = new ArrayList<>(activity.getPackageManager().queryIntentActivities(intent, 0));
      list.sort((a,b) -> a.loadLabel(activity.getPackageManager()).toString().compareToIgnoreCase(b.loadLabel(activity.getPackageManager()).toString()));
      JSONArray apps = new JSONArray(); HashSet<String> seen = new HashSet<>();
      for (ResolveInfo info : list) {
        String pkg = info.activityInfo.packageName;
        if (pkg.equals(activity.getPackageName()) || !info.activityInfo.exported || !info.activityInfo.enabled || !seen.add(pkg)) continue;
        apps.put(new JSONObject().put("packageName", pkg).put("name", info.loadLabel(activity.getPackageManager()).toString()));
      }
      return ok(new JSONObject().put("apps", apps));
    } catch(Exception e) { return error(e); }
  }
  @JavascriptInterface public String settings() {
    main.post(() -> new AlertDialog.Builder(activity).setTitle("手机本机操作 / On-device actions")
        .setMessage("开启后，小镇可在你明确发出手机操作指令或点按执行后读取所选 App 的可访问界面，并向输入框写入文字或提交搜索。仅执行你选定的一次操作，20 秒自动停止；不读取密码框、不上传页面内容。你可随时在系统设置中关闭权限。\n\nAfter you explicitly request or run a phone action, Office Town can inspect the chosen app and enter text or request Search. Each operation expires in 20 seconds. Password fields are excluded; screen contents are not uploaded. Disable access anytime in system settings.")
        .setNegativeButton("取消 / Cancel", null)
        .setPositiveButton("前往系统设置 / Settings", (dialog, which) -> {
          try { activity.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
          catch(RuntimeException e) { result("failed", "无法打开系统设置 / Cannot open settings"); }
        }).show());
    return status();
  }
  @JavascriptInterface public String notes() {
    main.post(() -> activity.startActivity(new Intent(activity, NoteTasksActivity.class)));
    return status();
  }
  @JavascriptInterface public String cancel() {
    main.post(() -> {
      PhoneActionService service = PhoneActionService.current();
      if (service != null) service.cancel();
      busy = false; result("cancelled", "已停止，已输入的文字不会撤回 / Stopped; entered text is kept");
    });
    return status();
  }
  @JavascriptInterface public String run(String payload) {
    synchronized (PhoneActions.class) { return runLocked(payload); }
  }
  private String runLocked(String payload) {
    try {
      JSONObject request = new JSONObject(payload);
      PhoneActionPlan plan = new PhoneActionPlan(request.optString("packageName"), request.optString("action"), request.optString("text"), SystemClock.elapsedRealtime());
      if (plan.packageName.equals(activity.getPackageName())) throw new IllegalArgumentException("请选择其他 App / Choose another app");
      if (busy) throw new IllegalStateException("有操作正在进行，请先停止 / Stop the current action first");
      if (!plan.action.equals("open") && PhoneActionService.current() == null)
        throw new IllegalStateException("请先开启手机操作权限 / Enable on-device access first");
      Intent launch = activity.getPackageManager().getLaunchIntentForPackage(plan.packageName);
      if (launch == null) throw new IllegalArgumentException("App 不可打开或已卸载，请刷新列表 / App unavailable; refresh the list");
      // The target must still be an exported launcher app, not an arbitrary package intent.
      requestId = request.optString("requestId", java.util.UUID.randomUUID().toString());
      busy = true; result("running", "正在打开所选 App / Opening app");
      main.post(() -> {
        try {
          if (plan.expired(SystemClock.elapsedRealtime())) throw new IllegalStateException("指令已过期，请重新发送 / Command expired; resend to run it");
          if (activity.isFinishing() || activity.getSystemService(KeyguardManager.class).isKeyguardLocked()) throw new IllegalStateException("手机锁屏或小镇已关闭 / Phone locked or app closed");
          if (!plan.action.equals("open")) {
            PhoneActionService service = PhoneActionService.current();
            if (service == null) throw new IllegalStateException("权限已关闭 / Access disabled");
            service.begin(plan);
          }
          activity.startActivity(launch);
          if (plan.action.equals("open")) result("requested", "已请求打开 App，请在手机查看 / App launch requested");
        } catch(RuntimeException e) {
          PhoneActionService service = PhoneActionService.current(); if(service != null) service.cancel();
          result("failed", e.getMessage());
        }
      });
      return status();
    } catch(Exception e) { return error(e); }
  }
}
