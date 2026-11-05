package com.otterview.agentsessionbridge;

import android.webkit.JavascriptInterface;
import org.json.JSONObject;

/** Stable WebView API. Validation and execution belong to the controller and services. */
final class PhoneBridge {
  private final PhoneController controller;

  PhoneBridge(MainActivity activity) { this(new PhoneController(activity)); }
  PhoneBridge(PhoneController controller) { this.controller = controller; }

  @JavascriptInterface
  public String state() {
    return controller.state();
  }

  @JavascriptInterface
  public String beginNoteCommand(String payload) { return controller.beginNoteCommand(payload); }

  @JavascriptInterface
  public String studioOverview() {
    return controller.studioOverview();
  }

  @JavascriptInterface
  public String managedState() {
    return controller.managedState();
  }

  @JavascriptInterface
  public String addManagedJob(String payload) {
    return controller.addManagedJob(payload);
  }

  @JavascriptInterface
  public String managedControl(String id, String action) {
    return controller.managedControl(id, action);
  }

  @JavascriptInterface
  public String setManagedEnabled(boolean enabled) {
    return controller.setManagedEnabled(enabled);
  }

  @JavascriptInterface
  public String saveOpenHandsConfig(String payload) {
    return controller.saveOpenHandsConfig(payload);
  }

  @JavascriptInterface
  public String studioModelProfileAction(String payload) { return controller.studioModelProfileAction(payload); }

  @JavascriptInterface
  public String saveStudioModel(String payload) {
    return controller.saveStudioModel(payload);
  }

  @JavascriptInterface
  public String sendStudioMessage(String content) {
    return controller.sendStudioMessage(content);
  }

  @JavascriptInterface
  public String beginPhoneCommand(String payload) { return controller.beginPhoneCommand(payload); }

  @JavascriptInterface
  public String beginStudioMessage(String content) {
    return controller.beginStudioMessage(content);
  }

  @JavascriptInterface
  public String beginScopedStudioMessage(String payload) {
    return controller.beginScopedStudioMessage(payload);
  }

  @JavascriptInterface
  public String beginStudioModelCheck() {
    return controller.beginStudioModelCheck();
  }

  @JavascriptInterface
  public String saveVoiceService(String payload) {
    return controller.saveVoiceService(payload);
  }

  @JavascriptInterface
  public String generateStudioReport(String date) {
    return controller.generateStudioReport(date);
  }

  @JavascriptInterface
  public String startVoiceInput(boolean autoSend) {
    return controller.startVoiceInput(autoSend);
  }

  @JavascriptInterface
  public String stopVoiceInput() {
    return controller.stopVoiceInput();
  }

  @JavascriptInterface
  public String cancelVoiceInput() {
    return controller.cancelVoiceInput();
  }

  @JavascriptInterface
  public String startConversationAudio(boolean speakerOn) {
    return controller.startConversationAudio(speakerOn);
  }

  @JavascriptInterface
  public String setConversationSpeaker(boolean speakerOn) {
    return controller.setConversationSpeaker(speakerOn);
  }

  @JavascriptInterface
  public String stopConversationAudio() {
    return controller.stopConversationAudio();
  }

  @JavascriptInterface
  public String setTtsSettings(double rate, double pitch) {
    return controller.setTtsSettings(rate, pitch);
  }

  @JavascriptInterface
  public String setTtsEnginePreference(boolean preferCloud) {
    return controller.setTtsEnginePreference(preferCloud);
  }

  @JavascriptInterface
  public String getOfflineVoiceModelStatus() { return controller.getOfflineVoiceModelStatus(); }

  @JavascriptInterface
  public String downloadOfflineVoiceModel() { return controller.downloadOfflineVoiceModel(); }

  @JavascriptInterface
  public String getTtsStatus() {
    return controller.getTtsStatus();
  }

  @JavascriptInterface
  public String speakText(String text) {
    return controller.speakText(text);
  }

  @JavascriptInterface
  public String stopSpeaking() {
    return controller.stopSpeaking();
  }

  @JavascriptInterface
  public String studioState() {
    return controller.studioState();
  }

  @JavascriptInterface
  public String addStudioMemory(String content) {
    return controller.addStudioMemory(content);
  }

  @JavascriptInterface
  public String deleteStudioMemory(String id) {
    return controller.deleteStudioMemory(id);
  }

  @JavascriptInterface
  public String beginDiscoverTasks(int machineId) {
    return controller.beginDiscoverTasks(machineId);
  }

  @JavascriptInterface
  public String beginStudioReport(String date) {
    return controller.beginStudioReport(date);
  }

  @JavascriptInterface
  public String networkStatus(int machineId) {
    return controller.networkStatus(machineId);
  }

  @JavascriptInterface
  public String saveFrpServer(String payload) {
    return controller.saveFrpServer(payload);
  }

  @JavascriptInterface
  public String deployFrpServer() {
    return controller.deployFrpServer();
  }

  @JavascriptInterface
  public String setMachinePublicMode(int machineId, String mode) {
    return controller.setMachinePublicMode(machineId, mode);
  }

  @JavascriptInterface
  public String deployFrpRelay(int machineId) {
    return controller.deployFrpRelay(machineId);
  }

  @JavascriptInterface
  public String disableFrpRelay(int machineId) {
    return controller.disableFrpRelay(machineId);
  }

  @JavascriptInterface
  public String beginSendPrompt(int id, String prompt, String actorId) {
    return controller.beginSendPrompt(id, prompt, actorId);
  }

  @JavascriptInterface
  public String beginBridgeCall(String method, String argsJson) {
    return controller.beginBridgeCall(method, argsJson);
  }

  @JavascriptInterface
  public String generateReplySuggestions(int taskId) {
    return controller.generateReplySuggestions(taskId);
  }

  @JavascriptInterface
  public String resetHostKey(int machineId) {
    return controller.resetHostKey(machineId);
  }

  @JavascriptInterface
  public String operationState(int id) {
    return controller.operationState(id);
  }

  @JavascriptInterface
  public String clearOperation(int id) {
    return controller.clearOperation(id);
  }

  @JavascriptInterface
  public String saveMachine(String payload) {
    return controller.saveMachine(payload);
  }

  @JavascriptInterface
  public String deleteMachine(int id) {
    return controller.deleteMachine(id);
  }

  @JavascriptInterface
  public String scanNetwork(String prefixOrAddress) {
    return controller.scanNetwork(prefixOrAddress);
  }

  @JavascriptInterface
  public String probeMachine(int id) {
    return controller.probeMachine(id);
  }

  @JavascriptInterface
  public String discoverTasks(int machineId) {
    return controller.discoverTasks(machineId);
  }

  @JavascriptInterface
  public String renameTask(int id, String title) {
    return controller.renameTask(id, title);
  }

  @JavascriptInterface
  public String deleteTask(int id) {
    return controller.deleteTask(id);
  }

  @JavascriptInterface
  public String restoreDeletedTask(int id) {
    return controller.restoreDeletedTask(id);
  }

  @JavascriptInterface
  public String beginTailTask(int taskId) {
    return controller.beginTailTask(taskId);
  }

  @JavascriptInterface
  public String tailTask(int id) {
    return controller.tailTask(id);
  }

  @JavascriptInterface
  public String sendPrompt(int id, String prompt, String actorId) {
    return controller.sendPrompt(id, prompt, actorId);
  }

  // Native callers use these adapters; none is exposed to page JavaScript.
  JSONObject voiceConfig() throws Exception { return controller.voiceConfig(); }
  boolean usesCloudVoice() { return controller.usesCloudVoice(); }
  void cancelVoiceTranscription() { controller.cancelVoiceTranscription(); }
  JSONObject transcribeVoiceAudio(String audio, String contentType, JSONObject config,
      java.util.function.BooleanSupplier cancelled) throws Exception {
    return controller.transcribeVoiceAudio(audio, contentType, config, cancelled);
  }
  void close() { controller.close(); }
}
