package com.otterview.agentsessionbridge;

import android.content.Context;
import org.json.JSONObject;

final class NotePreferences {
  static JSONObject read(Context context) throws Exception {
    String raw=context.getSharedPreferences("note_preferences",0).getString("defaults",null);
    return raw==null?NoteCommand.defaults():NoteCommand.config(new JSONObject(raw));
  }
  static void save(Context context,JSONObject value) throws Exception {
    JSONObject checked=NoteCommand.config(value);
    if(!context.getSharedPreferences("note_preferences",0).edit().putString("defaults",checked.toString()).commit())throw new IllegalStateException("设置保存失败 / Cannot save settings");
  }
}
