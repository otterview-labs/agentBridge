package com.otterview.agentsessionbridge;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

/** System picker opened by a fresh chat command, without opening the draft form. */
public final class NoteImageActivity extends Activity {
  private String id;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);id=getIntent().getStringExtra("noteId");
    if(id==null){finish();return;}
    if(state==null) {
      Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
      try{startActivityForResult(pick,71);}catch(Exception error){complete("","failed");}
    }
  }
  private void complete(String uri,String status) {
    try {NoteTasks.completeImage(this,id,uri,status);}
    catch(Exception error){Toast.makeText(this,NoteTasksActivity.t("图片未保存，请在草稿中重选","Image not saved; select it in the draft"),Toast.LENGTH_LONG).show();}
    finish();
  }
  @Override protected void onActivityResult(int request,int result,Intent data) {
    super.onActivityResult(request,result,data);if(request!=71)return;
    if(result!=RESULT_OK||data==null||data.getData()==null){complete("","cancelled");return;}
    try {
      Uri uri=data.getData();String type=getContentResolver().getType(uri);
      if(type==null||!type.startsWith("image/"))throw new IllegalArgumentException("Not an image");
      getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
      complete(uri.toString(),"selected");
    }catch(Exception error){complete("","failed");}
  }
}
