package com.otterview.agentsessionbridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.widget.*;
import android.view.View;
import java.text.DateFormat;
import java.util.Calendar;
import org.json.JSONArray;
import org.json.JSONObject;

/** A user-reviewed handoff, not an unofficial Rednote posting API. */
public final class NoteTasksActivity extends Activity {
  private LinearLayout layout;
  private EditText title, body;
  private TextView imageLabel, timeLabel;
  private JSONObject editing;
  static String t(String zh,String en) { return BuildConfig.APP_LANGUAGE.equals("en")?en:zh; }
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    if(state!=null && state.containsKey("editor")) {
      try { edit(new JSONObject(state.getString("editor")));return; }catch(Exception ignored){}
    }
    String id=getIntent().getStringExtra("noteId");
    if(id!=null) {try {JSONArray notes=NoteTasks.list(this);for(int i=0;i<notes.length();i++)if(notes.getJSONObject(i).optString("id").equals(id)){edit(notes.getJSONObject(i));return;}}catch(Exception error){error(error);}}
    list();
  }
  @Override protected void onSaveInstanceState(Bundle state) {
    if(editing!=null) {try {capture();state.putString("editor",editing.toString());}catch(Exception ignored){}}
    super.onSaveInstanceState(state);
  }
  private void screen(String heading) {
    ScrollView scroll=new ScrollView(this);layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);
    int pad=(int)(20*getResources().getDisplayMetrics().density);layout.setPadding(pad,pad,pad,pad);scroll.addView(layout);setContentView(scroll);
    text(heading,24);
  }
  private TextView text(String content,int size) {TextView v=new TextView(this);v.setText(content);v.setTextSize(size);v.setPadding(0,12,0,12);layout.addView(v);return v;}
  private void button(String label, View.OnClickListener listener) {Button b=new Button(this);b.setText(label);b.setOnClickListener(listener);layout.addView(b);}
  private void error(Exception error) {new AlertDialog.Builder(this).setMessage(error.getMessage()).setPositiveButton(t("知道了","OK"),null).show();}
  private void list() {
    editing=null;screen(t("笔记草稿与定时提醒","Drafts & reminders"));
    text(t("保存文字和一张图片，到时提醒你打开草稿。此功能不自动发布；小红书是否接受分享需在其发布页核对。系统省电、强行停止或通知关闭会影响提醒时间。","Save text and one image for a reminder. Publishing requires review in Rednote. Battery restrictions, force-stop and disabled notifications may delay or prevent reminders."),16);
    if(Build.VERSION.SDK_INT>=24 && !getSystemService(android.app.NotificationManager.class).areNotificationsEnabled())text(t("通知已关闭：到时请回此页面查看待发布草稿。","Notifications disabled: return here to check due drafts."),16);
    button(t("聊天笔记默认设置","Chat note defaults"),v->preferences());
    button(t("＋ 新建小红书笔记","＋ New Rednote draft"),v->edit(new JSONObject()));
    try {
      NoteTasks.markDue(this,System.currentTimeMillis());
      if(!NoteTasks.schedule(this))text(t("系统未接受提醒任务，请重新保存草稿。","System rejected scheduling. Save the draft again."),16);
      JSONArray notes=NoteTasks.list(this);
      for(int i=notes.length()-1;i>=0;i--) {
        JSONObject n=notes.getJSONObject(i);
        String state=n.optString("state"),label=state.equals("scheduled")?t("已安排提醒","Reminder scheduled"):state.equals("due")?t("待发布","Due for review"):t("草稿","Draft");
        button(label+" · "+(n.optString("title").isEmpty()?n.optString("body"):n.optString("title")),v->edit(n));
      }
    }catch(Exception error){error(error);}
    button(t("返回管家","Back to Butler"),v->finish());
  }
  private void preferences() {
    try {
      JSONObject settings=NotePreferences.read(this);
      ScrollView scroll=new ScrollView(this);LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(24,8,24,8);scroll.addView(form);
      java.util.function.BiFunction<String,String,EditText> input=(label,value)->{TextView caption=new TextView(this);caption.setText(label);caption.setTextSize(16);form.addView(caption);EditText field=new EditText(this);field.setText(value);form.addView(field);return field;};
      EditText style=input.apply(t("默认文案风格（聊天中的要求优先）","Default style (chat instructions take priority)"),settings.optString("style"));
      EditText audience=input.apply(t("默认读者","Default audience"),settings.optString("audience"));
      EditText length=input.apply(t("默认篇幅：50–2000 字","Default length: 50–2000 characters"),String.valueOf(settings.optInt("length")));length.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
      TextView imageCaption=new TextView(this);imageCaption.setText(t("默认配图方式","Default image mode"));imageCaption.setTextSize(16);form.addView(imageCaption);
      Spinner mode=new Spinner(this);mode.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{t("纯文字","Text only"),t("每次弹出图片选择器","Ask for an image"),t("沿用最近一次的图片","Reuse last image")}));
      String[] values={"none","ask","last"};for(int i=0;i<values.length;i++)if(values[i].equals(settings.optString("imageMode")))mode.setSelection(i);form.addView(mode);
      EditText time=input.apply(t("只说提醒日期时使用的默认时刻（HH:mm）","Default time when only a reminder date is given (HH:mm)"),String.format(java.util.Locale.ROOT,"%02d:%02d",settings.optInt("hour"),settings.optInt("minute")));
      EditText zone=input.apply(t("时区，例如 Asia/Shanghai","Time zone, e.g. Asia/Shanghai"),settings.optString("zone"));
      TextView info=new TextView(this);info.setText(t("不提提醒时仅保存草稿；默认时间不会自动给所有笔记加日程。提醒不会自动发布。模型沿用管家当前配置，可在管家模型页面更换。","No reminder is created unless requested. Reminders do not publish. Generation uses your current Butler model configuration."));form.addView(info);
      AlertDialog dialog=new AlertDialog.Builder(this).setTitle(t("聊天笔记默认设置","Chat note defaults")).setView(scroll).setNegativeButton(t("取消","Cancel"),null).setPositiveButton(t("保存","Save"),null).create();
      dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
        try {
          String clock=time.getText().toString().trim();if(!clock.matches("\\d{1,2}:\\d{2}"))throw new IllegalArgumentException(t("时间格式应为 HH:mm","Use HH:mm"));String[] parts=clock.split(":");
          NotePreferences.save(this,new JSONObject().put("style",style.getText().toString()).put("audience",audience.getText().toString()).put("length",Integer.parseInt(length.getText().toString())).put("imageMode",values[mode.getSelectedItemPosition()]).put("hour",Integer.parseInt(parts[0])).put("minute",Integer.parseInt(parts[1])).put("zone",zone.getText().toString().trim()));
          dialog.dismiss();Toast.makeText(this,t("默认设置已保存，后续聊天生效","Defaults saved for future requests"),Toast.LENGTH_LONG).show();
        }catch(Exception error){error(error);}
      }));dialog.show();
    }catch(Exception error){error(error);}
  }
  private void edit(JSONObject note) {
    try {editing=new JSONObject(note.toString());}catch(Exception error){error(error);return;}
    screen(t("小红书笔记草稿","Rednote draft"));
    text(t("内容保存在本机；打开小红书只代表交接内容，最终发布请在小红书确认。","Stored on this phone. Opening Rednote hands off content; confirm the final post in Rednote."),16);
    text(t("标题","Title"),16);title=new EditText(this);title.setText(editing.optString("title"));title.setSingleLine(true);layout.addView(title);
    text(t("正文","Body"),16);body=new EditText(this);body.setText(editing.optString("body"));body.setMinLines(5);body.setGravity(android.view.Gravity.TOP);layout.addView(body);
    imageLabel=text("",16);refreshImage();
    button(t("选择一张图片","Choose one image"),v->{Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);try{startActivityForResult(pick,61);}catch(Exception error){error(error);}});
    button(t("移除图片","Remove image"),v->{try{editing.put("image","");refreshImage();}catch(Exception error){error(error);}});
    timeLabel=text("",16);refreshTime();
    button(t("设置提醒时间","Set reminder time"),v->pickTime());
    button(t("取消定时，仅存草稿","Remove reminder"),v->{try{editing.put("dueAt",0);refreshTime();}catch(Exception error){error(error);}});
    button(t("保存草稿与提醒","Save draft & reminder"),v->save(false));
    button(t("保存并交给小红书","Save & open in Rednote"),v->save(true));
    button(t("删除草稿","Delete draft"),v->new AlertDialog.Builder(this).setMessage(t("删除此草稿和提醒？","Delete this draft and reminder?"))
        .setNegativeButton(t("取消","Cancel"),null).setPositiveButton(t("删除","Delete"),(d,w)->{try{NoteTasks.delete(this,editing.optString("id"));list();}catch(Exception error){error(error);}}).show());
    button(t("返回列表","Back to list"),v->new AlertDialog.Builder(this).setMessage(t("返回会放弃未保存的修改。","Discard unsaved changes?"))
        .setNegativeButton(t("继续编辑","Keep editing"),null).setPositiveButton(t("返回","Discard"),(d,w)->list()).show());
  }
  private void capture() throws Exception {editing.put("title",title.getText().toString()).put("body",body.getText().toString());}
  private void refreshImage(){imageLabel.setText(editing.optString("image").isEmpty()?t("未选择图片","No image selected"):t("已选择 1 张图片","1 image selected"));}
  private void refreshTime(){long due=editing.optLong("dueAt");timeLabel.setText(due>0?t("提醒：","Reminder: ")+DateFormat.getDateTimeInstance().format(new java.util.Date(due)):t("没有定时提醒","No reminder"));}
  private void pickTime() {
    Calendar c=Calendar.getInstance();if(editing.optLong("dueAt")>System.currentTimeMillis())c.setTimeInMillis(editing.optLong("dueAt"));
    new DatePickerDialog(this,(d,y,m,day)->{
      c.set(y,m,day);
      new TimePickerDialog(this,(time,h,min)->{c.set(Calendar.HOUR_OF_DAY,h);c.set(Calendar.MINUTE,min);c.set(Calendar.SECOND,0);c.set(Calendar.MILLISECOND,0);
        try{if(c.getTimeInMillis()<=System.currentTimeMillis())throw new IllegalArgumentException(t("请选择未来时间","Choose a future time"));editing.put("dueAt",c.getTimeInMillis());refreshTime();}catch(Exception error){error(error);}},c.get(Calendar.HOUR_OF_DAY),c.get(Calendar.MINUTE),true).show();
    },c.get(Calendar.YEAR),c.get(Calendar.MONTH),c.get(Calendar.DAY_OF_MONTH)).show();
  }
  @Override protected void onActivityResult(int request,int result,Intent data) {
    super.onActivityResult(request,result,data);
    if(request!=61||result!=RESULT_OK||data==null||data.getData()==null)return;
    try {
      Uri uri=data.getData();String type=getContentResolver().getType(uri);
      if(type==null||!type.startsWith("image/"))throw new IllegalArgumentException(t("请选择图片文件","Choose an image file"));
      getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
      editing.put("image",uri.toString());refreshImage();
    }catch(Exception error){error(error);}
  }
  private void save(boolean share) {
    try {
      capture();
      // An overdue reminder is already due, not an invalid future schedule when reviewing it.
      if(editing.optLong("dueAt")<=System.currentTimeMillis())editing.put("dueAt",0);
      JSONObject note=NoteTasks.validate(editing,System.currentTimeMillis());
      NoteTasks.save(this,note);editing=note;
      if(!NoteTasks.schedule(this))throw new IllegalStateException(t("草稿已保存，但系统未接受提醒。请重试。","Draft saved, but scheduling failed. Retry."));
      if(share){handoff(note);return;}
      if(note.optLong("dueAt")>0 && Build.VERSION.SDK_INT>=33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)
        requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},62);
      Toast.makeText(this,t("已保存；定时为提醒，不会自动发布","Saved; reminders do not auto-publish"),Toast.LENGTH_LONG).show();list();
    }catch(Exception error){error(error);}
  }
  private void handoff(JSONObject note) throws Exception {
    String content=note.optString("title")+(note.optString("title").isEmpty()?"":"\n\n")+note.optString("body");
    Intent share=new Intent(Intent.ACTION_SEND).setPackage("com.xingin.xhs").putExtra(Intent.EXTRA_TEXT,content).putExtra(Intent.EXTRA_TITLE,note.optString("title"));
    String image=note.optString("image");share.setType(image.isEmpty()?"text/plain":"image/*");
    if(!image.isEmpty()){
      Uri uri=Uri.parse(image);try(java.io.InputStream check=getContentResolver().openInputStream(uri)){if(check==null)throw new IllegalStateException(t("图片已失效，请重新选择","Image unavailable; select it again"));}
      share.putExtra(Intent.EXTRA_STREAM,uri);share.setClipData(ClipData.newRawUri("note-image",uri));share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }
    if(getPackageManager().queryIntentActivities(share,0).isEmpty()) {
      new AlertDialog.Builder(this).setMessage(t("小红书未提供此内容的分享入口。可复制文案后手动发布，图片请在小红书选择。","Rednote does not expose a share target for this content. Copy text and select your image in Rednote."))
          .setNegativeButton(t("取消","Cancel"),null).setPositiveButton(t("复制并打开","Copy & open"),(d,w)->{
            getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("note",content));
            Intent open=getPackageManager().getLaunchIntentForPackage("com.xingin.xhs");if(open!=null)startActivity(open);else Toast.makeText(this,t("未安装小红书","Rednote is not installed"),Toast.LENGTH_LONG).show();
          }).show();return;
    }
    startActivity(share);Toast.makeText(this,t("已请求交接，请在小红书核对文字、图片并确认发布","Handoff requested. Review text and image, then publish in Rednote."),Toast.LENGTH_LONG).show();
  }
  @Override public void onBackPressed() {
    if(editing==null){super.onBackPressed();return;}
    new AlertDialog.Builder(this).setMessage(t("放弃未保存的修改并返回？","Discard unsaved changes?"))
        .setNegativeButton(t("继续编辑","Keep editing"),null).setPositiveButton(t("返回","Discard"),(d,w)->list()).show();
  }
}
