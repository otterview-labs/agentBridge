package com.otterview.agentsessionbridge;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Deliberately narrow grammar for user-authored, single on-device commands. No LLM planning. */
final class PhoneCommand {
  final String app, action, text;
  private PhoneCommand(String app, String action, String text) { this.app=app; this.action=action; this.text=text; }
  static PhoneCommand parse(String content) {
    if(content == null || content.length() > 4000) return null;
    String value=content.trim();
    // Normalize explicit imperative search variants; never infer commands from ordinary chat.
    Matcher inApp=Pattern.compile("^(?:请帮我|帮我|请|麻烦)?(?:在|去|用)\\s*(.+?)(?:里面|里|中|上)?\\s*(?:搜索|搜一下|搜|查找)(?:一下)?\\s*[:：]?\\s*(.+)$",Pattern.DOTALL).matcher(value);
    if(inApp.matches() && !inApp.group(1).contains("打开")) value="打开"+inApp.group(1)+"搜索 "+inApp.group(2);
    Matcher find=Pattern.compile("^(?:请帮我|帮我|请|麻烦)?(?:搜索|搜一下|搜)(?:一下)?\\s*(.+?)(?:里面|里|中|上)(?:的)?\\s*[:：]?\\s*(.+)$",Pattern.DOTALL).matcher(value);
    if(find.matches()) value="打开"+find.group(1)+"搜索 "+find.group(2);
    Matcher enSearch=Pattern.compile("^(?:please\\s+)?search\\s+(.+?)\\s+for\\s+(.+)$",Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(value);
    if(enSearch.matches()) value="open "+enSearch.group(1)+" search for "+enSearch.group(2);
    Matcher zh=Pattern.compile("^(?:请帮我|帮我|请|麻烦)?(?:在手机上|用手机)?打开\\s*(.+?)(?:\\s*(?:，|,)?\\s*(?:然后|并且|并)?\\s*(搜索|搜一下|搜|查找|输入)(?:一下)?\\s*[:：]?\\s*(.+))?$",Pattern.DOTALL).matcher(value);
    String app,action,text;
    if(zh.matches()) {
      app=zh.group(1).trim();action=zh.group(2)==null?"open":zh.group(2).equals("输入")?"input":"search";text=zh.group(3)==null?"":zh.group(3).trim();
    } else {
      Matcher english=Pattern.compile("^(?:please\\s+)?open\\s+(.+?)(?:\\s+(?:and\\s+)?(search(?:\\s+for)?|type|enter)\\s+(.+))?$",Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(value);
      if(!english.matches()) return null;
      app=english.group(1).trim();action=english.group(2)==null?"open":english.group(2).toLowerCase(Locale.ROOT).startsWith("search")?"search":"input";text=english.group(3)==null?"":english.group(3).trim();
    }
    // Reject explanatory, negative, hypothetical and multi-action app clauses.
    if(app.length()>100 || app.matches("(?s).*(怎么|如何|不要|不能|别|如果|例如|比如|是否|可以吗|能否|然后|并|[？?\n，,；;]).*")) return null;
    app=unquote(app.replaceFirst("[。！!]$", "").trim());text=unquote(text);
    if(app.isEmpty() || (!action.equals("open") && (text.isEmpty() || text.length()>2000))) return null;
    return new PhoneCommand(app,action,text);
  }
  private static String unquote(String value) {
    if(value.length()<2)return value;
    char a=value.charAt(0),b=value.charAt(value.length()-1);
    if((a=='"'&&b=='"')||(a=='\''&&b=='\'')||(a=='“'&&b=='”')||(a=='「'&&b=='」'))return value.substring(1,value.length()-1).trim();
    return value;
  }
  private static String normalize(String value) {return value.toLowerCase(Locale.ROOT).replaceFirst("(?:\\s+app|应用)$", "").replaceAll("\\s+", "");}
  static List<JSONObject> matches(String name,JSONArray apps)throws Exception {
    String query=normalize(name);List<JSONObject> exact=new ArrayList<>(),prefix=new ArrayList<>();
    String known=aliasPackage(query);
    for(int i=0;i<apps.length();i++) {
      JSONObject app=apps.getJSONObject(i);String pkg=app.optString("packageName"),label=normalize(app.optString("name"));
      if(query.equals(pkg.toLowerCase(Locale.ROOT)) || (!known.isEmpty()&&known.equals(pkg)) || label.equals(query)) exact.add(app);
      else if(known.isEmpty()&&query.length()>=2&&label.startsWith(query)) prefix.add(app);
    }
    return exact.isEmpty()?prefix:exact;
  }
  private static String aliasPackage(String query) {
    switch(query) {
      case "微信": case "wechat":return "com.tencent.mm";
      case "小红书": case "rednote":return "com.xingin.xhs";
      case "抖音": case "douyin":return "com.ss.android.ugc.aweme";
      case "哔哩哔哩": case "b站": case "bilibili":return "tv.danmaku.bili";
      case "chrome": case "谷歌浏览器":return "com.android.chrome";
      default:return "";
    }
  }
  JSONObject request(String packageName,String requestId)throws Exception {
    return new JSONObject().put("packageName",packageName).put("action",action).put("text",text).put("requestId",requestId);
  }
  static JSONArray appendTurn(JSONArray history,String value,String answer,String date,String id,int scope)throws Exception {
    JSONArray all=new JSONArray();int from=Math.max(0,history.length()-98);
    for(int i=from;i<history.length();i++)all.put(history.get(i));
    all.put(new JSONObject().put("id",id+"-user").put("role","user").put("content",value).put("createdAt",date).put("memoryTaskId",scope).put("phoneAction",true));
    all.put(new JSONObject().put("id",id+"-assistant").put("role","assistant").put("content",answer).put("createdAt",date).put("memoryTaskId",scope).put("phoneAction",true));
    return all;
  }
}
