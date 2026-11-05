const {test}=require('node:test');
const {harness,productionClass}=require('./java-json-fixture.cjs');
const stubs=`
static class Looper {static Looper getMainLooper(){return new Looper();}}
static class Handler {Handler(Looper l){}void postDelayed(Runnable r,long delay){}void removeCallbacks(Runnable r){}}
static class SystemClock {static long now;static long elapsedRealtime(){return now;}}
static class Build {static class VERSION {static int SDK_INT=35;}}
static class Bundle {String text;void putCharSequence(String key,CharSequence value){text=value.toString();}}
static class KeyguardManager {boolean locked;boolean isKeyguardLocked(){return locked;}}
static class AccessibilityEvent {}
static class AccessibilityService {
 AccessibilityNodeInfo root; KeyguardManager keyguard=new KeyguardManager();
 protected void onServiceConnected(){}public void onAccessibilityEvent(AccessibilityEvent e){}public void onInterrupt(){}public void onDestroy(){}
 AccessibilityNodeInfo getRootInActiveWindow(){return root;}
 <T> T getSystemService(Class<T> c){return c.cast(keyguard);}
}
static class PhoneActions {static String state,detail;static void result(String s,String d){state=s;detail=d;}}
static class AccessibilityNodeInfo {
 static final int ACTION_SET_TEXT=1,ACTION_CLICK=2,ACTION_FOCUS=4;static final String ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE="text";
 static class AccessibilityAction {
  static final AccessibilityAction ACTION_FOCUS=new AccessibilityAction(4,null),ACTION_SET_TEXT=new AccessibilityAction(1,null),ACTION_IME_ENTER=new AccessibilityAction(3,null);
  int id;String label;AccessibilityAction(int id,String label){this.id=id;this.label=label;}int getId(){return id;}CharSequence getLabel(){return label;}
  @Override public boolean equals(Object o){return o instanceof AccessibilityAction&&((AccessibilityAction)o).id==id;}
 }
 String pkg="demo.app",text="",desc="",hint="",viewId="";boolean editable,visible=true,enabled=true,password,focused,clickable,accept=true,refresh=true,applyText=true;
 int setCalls,clickCalls,imeCalls;List<AccessibilityNodeInfo> children=new ArrayList<>();List<AccessibilityAction> actions=new ArrayList<>();
 static AccessibilityNodeInfo obtain(AccessibilityNodeInfo n){return n;}void recycle(){}
 CharSequence getPackageName(){return pkg;}boolean isVisibleToUser(){return visible;}boolean isEnabled(){return enabled;}boolean isPassword(){return password;}boolean isEditable(){return editable;}boolean isFocused(){return focused;}boolean isClickable(){return clickable;}
 int getChildCount(){return children.size();}AccessibilityNodeInfo getChild(int i){return children.get(i);}List<AccessibilityAction> getActionList(){return actions;}
 CharSequence getHintText(){return hint;}String getViewIdResourceName(){return viewId;}CharSequence getText(){return text;}CharSequence getContentDescription(){return desc;}boolean refresh(){return refresh;}
 boolean performAction(int action){if(action==2)clickCalls++;if(action==3)imeCalls++;return accept;}
 boolean performAction(int action,Bundle args){setCalls++;if(accept&&applyText)text=args.text;return accept;}
}
${productionClass('PhoneActionService.java').replace('public final class PhoneActionService','static final class PhoneActionService').replaceAll('android.view.accessibility.AccessibilityNodeInfo.', 'AccessibilityNodeInfo.')}
static PhoneActionService service(){SystemClock.now=0;PhoneActionService s=new PhoneActionService();s.root=new AccessibilityNodeInfo();s.onServiceConnected();return s;}
static AccessibilityNodeInfo field(){AccessibilityNodeInfo n=new AccessibilityNodeInfo();n.editable=true;n.actions.add(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_TEXT);return n;}
static void tick(PhoneActionService s)throws Exception{java.lang.reflect.Method m=s.getClass().getDeclaredMethod("step");m.setAccessible(true);m.invoke(s);}
static void begin(PhoneActionService s,String action){s.begin(new PhoneActionPlan("demo.app",action,"hello",0));}
`;

test('phone action plan validates explicit actions, deadlines and unambiguous field selection',t=>{
 harness(t,'PhonePlanHarness',`
 public static void main(String[] args){
 check(PhoneActionPlan.choose(new boolean[]{})==-1);check(PhoneActionPlan.choose(new boolean[]{false})==0);
 check(PhoneActionPlan.choose(new boolean[]{false,false})==-1);check(PhoneActionPlan.choose(new boolean[]{false,true})==1);check(PhoneActionPlan.choose(new boolean[]{true,true})==-1);
 PhoneActionPlan p=new PhoneActionPlan("demo.app","search","hello",100);
 check(!p.expired(20099)&&p.expired(20100));check(p.accepts("demo.app")&&!p.accepts("other.app"));
 for(String a:new String[]{"send","click","shell"}){try{new PhoneActionPlan("demo.app",a,"text",0);throw new AssertionError();}catch(IllegalArgumentException expected){}}
 for(String q:new String[]{""," ","x".repeat(2001)}){try{new PhoneActionPlan("demo.app","input",q,0);throw new AssertionError();}catch(IllegalArgumentException expected){}}
 check(!PhoneActionPlan.isSearch("Send")&&!PhoneActionPlan.isSearch("发送")&&PhoneActionPlan.isSearch("Search"));System.out.println("ok");
 }`,['PhoneActionPlan.java']);
});

test('local service writes once then verifies text and never submits ordinary input',t=>{
 harness(t,'PhoneInputHarness',stubs+`
 public static void main(String[] args)throws Exception{
 PhoneActionService s=service();AccessibilityNodeInfo f=field();s.root.children.add(f);begin(s,"input");tick(s);check(f.setCalls==1);tick(s);tick(s);
 check(PhoneActions.state.equals("completed")&&f.setCalls==1&&f.clickCalls==0&&f.imeCalls==0);s.onDestroy();check(PhoneActionService.current()==null);System.out.println("ok");
 }`,['PhoneActionPlan.java']);
});

test('local service excludes passwords, wrong packages and ambiguous inputs; explicit focus disambiguates',t=>{
 harness(t,'PhoneScopeHarness',stubs+`
 public static void main(String[] args)throws Exception{
 PhoneActionService s=service();AccessibilityNodeInfo a=field(),b=field(),password=field();password.password=true;s.root.children.add(a);s.root.children.add(b);s.root.children.add(password);
 begin(s,"input");tick(s);check(a.setCalls==0&&b.setCalls==0&&password.setCalls==0);
 b.focused=true;s.root.pkg="other.app";tick(s);check(b.setCalls==0);s.root.pkg="demo.app";tick(s);tick(s);check(b.setCalls==1&&a.setCalls==0&&password.setCalls==0);System.out.println("ok");
 }`,['PhoneActionPlan.java']);
});

test('search requires explicit unique Search and submits once, never Send or unlabeled IME',t=>{
 harness(t,'PhoneSearchHarness',stubs+`
 public static void main(String[] args)throws Exception{
 PhoneActionService s=service();AccessibilityNodeInfo f=field();f.actions.add(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER);s.root.children.add(f);
 AccessibilityNodeInfo button=new AccessibilityNodeInfo();button.clickable=true;button.text="Send";s.root.children.add(button);
 begin(s,"search");tick(s);tick(s);check(PhoneActions.state.equals("partial")&&f.imeCalls==0&&button.clickCalls==0);
 button.text="搜索";begin(s,"search");tick(s);tick(s);check(button.clickCalls==1);tick(s);check(button.clickCalls==1);SystemClock.now=500;tick(s);check(PhoneActions.state.equals("requested"));
 button.text="Send";f.actions.clear();f.actions.add(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_TEXT);f.actions.add(new AccessibilityNodeInfo.AccessibilityAction(3,"Search"));begin(s,"search");tick(s);tick(s);check(f.imeCalls==1);SystemClock.now=1000;tick(s);check(f.imeCalls==1);System.out.println("ok");
 }`,['PhoneActionPlan.java']);
});

test('timeout, locking, cancellation, rejected text and mismatch stop without further actions',t=>{
 harness(t,'PhoneStopsHarness',stubs+`
 public static void main(String[] args)throws Exception{
 PhoneActionService s=service();AccessibilityNodeInfo f=field();s.root.children.add(f);
 begin(s,"search");s.cancel();tick(s);check(f.setCalls==0&&PhoneActions.state.equals("cancelled"));
 begin(s,"search");SystemClock.now=20000;tick(s);check(f.setCalls==0&&PhoneActions.state.equals("failed"));
 SystemClock.now=0;begin(s,"search");s.keyguard.locked=true;tick(s);check(f.setCalls==0&&PhoneActions.state.equals("failed"));s.keyguard.locked=false;
 begin(s,"search");f.accept=false;tick(s);check(PhoneActions.state.equals("failed"));f.accept=true;f.applyText=false;f.text="old";
 begin(s,"search");tick(s);tick(s);check(PhoneActions.state.equals("partial")&&f.imeCalls==0);System.out.println("ok");
 }`,['PhoneActionPlan.java']);
});

test('duplicate search controls and truncated interface trees never guess an action',t=>{
 harness(t,'PhoneAmbiguityHarness',stubs+`
 public static void main(String[] args)throws Exception{
 PhoneActionService s=service();AccessibilityNodeInfo f=field();s.root.children.add(f);
 AccessibilityNodeInfo a=new AccessibilityNodeInfo(),b=new AccessibilityNodeInfo();a.clickable=b.clickable=true;a.text=b.text="Search";s.root.children.add(a);s.root.children.add(b);
 begin(s,"search");tick(s);tick(s);check(PhoneActions.state.equals("partial")&&a.clickCalls==0&&b.clickCalls==0);
 s.root.children.clear();s.root.children.add(f);for(int i=0;i<501;i++)s.root.children.add(new AccessibilityNodeInfo());int before=f.setCalls;
 begin(s,"input");tick(s);check(PhoneActions.state.equals("failed")&&f.setCalls==before);System.out.println("ok");
 }`,['PhoneActionPlan.java']);
});

test('search opens a unique labeled entry once before entering text, then submits only after verification',t=>{
 harness(t,'PhoneSearchEntryHarness',stubs+`
 public static void main(String[] args)throws Exception{
 PhoneActionService s=service();AccessibilityNodeInfo entry=new AccessibilityNodeInfo();entry.text="搜索";entry.clickable=true;s.root.children.add(entry);
 begin(s,"search");tick(s);tick(s);check(entry.clickCalls==1);
 AccessibilityNodeInfo f=field();s.root.children.add(f);tick(s);check(f.setCalls==1&&entry.clickCalls==1);tick(s);check(entry.clickCalls==2);SystemClock.now=500;tick(s);tick(s);check(entry.clickCalls==2&&PhoneActions.state.equals("requested"));
 s=service();AccessibilityNodeInfo a=new AccessibilityNodeInfo(),b=new AccessibilityNodeInfo();a.clickable=b.clickable=true;a.text=b.text="搜索";s.root.children.add(a);s.root.children.add(b);begin(s,"search");tick(s);check(a.clickCalls==0&&b.clickCalls==0);System.out.println("ok");
 }`,['PhoneActionPlan.java']);
});

test('search field hint or resource id wins over an unrelated focused editor; multiple search fields stay ambiguous',t=>{
 harness(t,'PhoneSearchFieldHarness',stubs+`
 public static void main(String[] args)throws Exception{
 PhoneActionService s=service();AccessibilityNodeInfo comment=field(),search=field();comment.focused=true;search.hint="搜索笔记";
 s.root.children.add(comment);s.root.children.add(search);begin(s,"search");tick(s);
 check(search.setCalls==1&&comment.setCalls==0);
 s=service();search=field();search.viewId="demo.app:id/search_edit";comment=field();comment.focused=true;s.root.children.add(comment);s.root.children.add(search);begin(s,"search");tick(s);check(search.setCalls==1&&comment.setCalls==0);
 s=service();AccessibilityNodeInfo a=field(),b=field();a.hint=b.hint="Search";s.root.children.add(a);s.root.children.add(b);begin(s,"search");tick(s);check(a.setCalls==0&&b.setCalls==0);System.out.println("ok");
 }`,['PhoneActionPlan.java']);
});
