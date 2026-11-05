package com.otterview.agentsessionbridge;

import android.accessibilityservice.AccessibilityService;
import android.app.KeyguardManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;

/** Bounded, explicitly requested input/search. Does not upload or retain screen text. */
public final class PhoneActionService extends AccessibilityService {
  private static volatile PhoneActionService connected;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private PhoneActionPlan plan;
  private AccessibilityNodeInfo enteredNode;
  private boolean searchAttempted;
  private boolean searchOpened;
  private long searchAt;
  private final Runnable tick = this::step;
  static PhoneActionService current() { return connected; }
  @Override protected void onServiceConnected() { connected = this; }
  void begin(PhoneActionPlan next) {
    cancel(); plan = next; searchOpened = false;
    PhoneActions.result("waiting", "正在定位搜索入口或输入框，最多等待 20 秒 / Locating Search or an input field; up to 20 seconds");
    handler.postDelayed(tick, 500);
  }
  void cancel() {
    handler.removeCallbacks(tick);
    if (plan != null) PhoneActions.result("cancelled", "已停止，已输入的文字不会撤回 / Stopped; entered text is kept");
    plan = null;
    if (enteredNode != null) { enteredNode.recycle(); enteredNode = null; }
  }
  private void finish(String state, String detail) {
    cancel(); PhoneActions.result(state, detail);
  }
  @Override public void onAccessibilityEvent(AccessibilityEvent event) {
    // Do not inspect event sources, and do not poll at all while idle.
    // A fixed 300 ms tick prevents noisy apps from indefinitely delaying execution.
  }
  @Override public void onInterrupt() { cancel(); }
  @Override public void onDestroy() { cancel(); if (connected == this) connected = null; super.onDestroy(); }
  private void step() {
    if (plan == null) return;
    if (getSystemService(KeyguardManager.class).isKeyguardLocked()) { finish("failed", "手机已锁屏，已停止 / Phone locked; stopped"); return; }
    if (plan.expired(SystemClock.elapsedRealtime())) {
      finish("failed", "等待输入框超时；请先打开目标搜索页再重试 / No eligible field; open the search page and retry"); return;
    }
    AccessibilityNodeInfo root = getRootInActiveWindow();
    try {
      if (root == null || !plan.accepts(String.valueOf(root.getPackageName()))) return;
      if (plan.entered) {
        if (searchAttempted) {
          // Only report the IME acceptance, never claim to have verified search results.
          if (SystemClock.elapsedRealtime() >= searchAt) finish("requested", "已提交搜索请求，请在 App 查看结果 / Search requested; check results in the app");
          return;
        }
        if (!enteredNode.refresh() || !enteredNode.isVisibleToUser() || enteredNode.isPassword()) {
          finish("partial", "文字已输入，输入框已变化；请在 App 手动搜索 / Text entered; field changed, search manually"); return;
        }
        if (!plan.text.contentEquals(enteredNode.getText() == null ? "" : enteredNode.getText())) {
          finish("partial", "App 未确认输入内容；已停止 / App did not confirm the text; stopped"); return;
        }
        if ("input".equals(plan.action)) { finish("completed", "已核对输入框文字；未发送 / Text verified in field; nothing sent"); return; }
        boolean supports = Build.VERSION.SDK_INT >= 30 && enteredNode.getActionList().contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER);
        // Search only: do not use a chat 'Send', payment 'Next', or arbitrary Enter action.
        boolean searchField = false;
        // The IME action is supplied by the editor, not inferred from its text or class.
        if (Build.VERSION.SDK_INT >= 30) {
          android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction ime = AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER;
          for (AccessibilityNodeInfo.AccessibilityAction action : enteredNode.getActionList()) {
            if (action.getId() == ime.getId()) {
              String label = action.getLabel() == null ? "" : action.getLabel().toString().trim();
              searchField = PhoneActionPlan.isSearch(label);
            }
          }
        }
        AccessibilityNodeInfo searchButton = (!supports || !searchField) ? findSearch(root, new int[]{0}) : null;
        if ((!supports || !searchField) && searchButton == null) { finish("partial", "文字已输入；此 App 未提供明确的搜索动作，请手动点搜索 / Text entered; tap Search in the app"); return; }
        // Mark before dispatch so even synchronous events cannot submit twice.
        searchAttempted = true; searchAt = SystemClock.elapsedRealtime() + 400;
        boolean accepted;
        try { accepted = searchButton != null ? searchButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            : enteredNode.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId()); }
        finally { if (searchButton != null) searchButton.recycle(); }
        if (!accepted) finish("partial", "文字已输入，但 App 拒绝搜索动作 / Text entered; app rejected Search");
        return;
      }
      ArrayList<AccessibilityNodeInfo> fields = new ArrayList<>();
      int[] visited = {0};
      collect(root, fields, visited);
      try {
        if (visited[0] >= 500) { finish("failed", "页面过于复杂，请手动输入 / Page too complex; enter text manually"); return; }
        if (fields.isEmpty() && "search".equals(plan.action) && !searchOpened) {
          AccessibilityNodeInfo entry = findSearch(root, new int[]{0});
          if (entry != null) {
            searchOpened = true; // At most one deterministic Search-entry click.
            try {
              if (!entry.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                finish("failed", "App 拒绝打开搜索页，请手动进入 / App rejected Search; open the page manually");
              else PhoneActions.result("waiting", "已请求打开搜索页，正在等待输入框 / Search page requested; waiting for field");
            } finally { entry.recycle(); }
          }
          return;
        }
        // Prefer a uniquely identified Search field over an unrelated focused editor.
        if ("search".equals(plan.action)) {
          ArrayList<AccessibilityNodeInfo> searchFields = new ArrayList<>();
          for (AccessibilityNodeInfo field : fields) if (isSearchField(field)) searchFields.add(AccessibilityNodeInfo.obtain(field));
          if (!searchFields.isEmpty()) {
            for (AccessibilityNodeInfo field : fields) field.recycle();
            fields = searchFields;
          }
        }
        boolean[] focused = new boolean[fields.size()];
        for (int i = 0; i < fields.size(); i++) focused[i] = fields.get(i).isFocused();
        int index = PhoneActionPlan.choose(focused);
        if (index < 0) return;
        AccessibilityNodeInfo field = fields.get(index);
        if (!field.isFocused() && field.getActionList().contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_FOCUS))
          field.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        Bundle args = new Bundle(); args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, plan.text);
        plan.entered = true; enteredNode = AccessibilityNodeInfo.obtain(field); searchAttempted = false;
        if (!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
          finish("failed", "App 拒绝输入，请手动输入 / App rejected text input"); return;
        }
        PhoneActions.result("running", "已请求输入，正在核对 / Checking entered text");
      } finally { for (AccessibilityNodeInfo field : fields) field.recycle(); }
    } catch (RuntimeException error) {
      finish("failed", "页面已变化，已停止；请重试 / Page changed; stopped, please retry");
    } finally {
      if (root != null) root.recycle();
      if (plan != null) { handler.removeCallbacks(tick); handler.postDelayed(tick, 300); }
    }
  }
  private boolean isSearchField(AccessibilityNodeInfo node) {
    String label = String.valueOf(node.getContentDescription());
    String hint = Build.VERSION.SDK_INT >= 26 ? String.valueOf(node.getHintText()) : "";
    String id = String.valueOf(node.getViewIdResourceName());
    return label.matches("(?i).*(搜索|search).*") || hint.matches("(?i).*(搜索|search).*")
        || id.matches("(?i).*(search_input|search_edit|search_src_text|searchinput|searchedit).*");
  }
  private AccessibilityNodeInfo findSearch(AccessibilityNodeInfo root, int[] visited) {
    ArrayList<AccessibilityNodeInfo> buttons = new ArrayList<>();
    collectSearch(root, buttons, visited);
    AccessibilityNodeInfo result = buttons.size() == 1 && visited[0] < 500 ? AccessibilityNodeInfo.obtain(buttons.get(0)) : null;
    for (AccessibilityNodeInfo node : buttons) node.recycle();
    return result;
  }
  private void collectSearch(AccessibilityNodeInfo node, ArrayList<AccessibilityNodeInfo> buttons, int[] visited) {
    if (++visited[0] > 500 || !plan.accepts(String.valueOf(node.getPackageName())) || !node.isVisibleToUser() || node.isPassword()) return;
    String label = node.getContentDescription() == null ? "" : node.getContentDescription().toString().trim();
    String text = node.getText() == null ? "" : node.getText().toString().trim();
    if (!node.isEditable() && !node.isPassword() && node.isClickable() && node.isEnabled()
        && (PhoneActionPlan.isSearch(label) || PhoneActionPlan.isSearch(text))) buttons.add(AccessibilityNodeInfo.obtain(node));
    for (int i=0; i<node.getChildCount() && visited[0] <= 500; i++) {
      AccessibilityNodeInfo child = node.getChild(i);
      if (child != null) { try { collectSearch(child, buttons, visited); } finally { child.recycle(); } }
    }
  }
  private void collect(AccessibilityNodeInfo node, ArrayList<AccessibilityNodeInfo> fields, int[] visited) {
    if (++visited[0] > 500) return;
    if (!plan.accepts(String.valueOf(node.getPackageName())) || !node.isVisibleToUser()) return;
    if (node.isEditable() && node.isEnabled() && !node.isPassword()
        && node.getActionList().contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_TEXT))
      fields.add(AccessibilityNodeInfo.obtain(node));
    for (int i = 0; i < node.getChildCount() && visited[0] <= 500; i++) {
      AccessibilityNodeInfo child = node.getChild(i);
      if (child != null) { try { collect(child, fields, visited); } finally { child.recycle(); } }
    }
  }
}
