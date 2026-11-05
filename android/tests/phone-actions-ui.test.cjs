const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const assets=path.resolve(__dirname,'../app/src/main/assets');let browser;
before(async()=>browser=await chromium.launch({headless:true}));after(async()=>browser?.close());
async function pageFor(t,{enabled=false,language='zh',width=363,fail=false,missing=false}={}){
 const context=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,reducedMotion:'reduce'});t.after(()=>context.close());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.route('http://phone.test/**',route=>{let name=new URL(route.request().url()).pathname.slice(1)||'phone.html';let body=fs.readFileSync(path.join(assets,name));
 if(name==='phone.html')body=body.toString().replace(/<script src="(?!\.\/phone-actions\.js)[^"]+"><\/script>/g,'').replace('<html lang="zh-CN">',`<html lang="${language}">`);
 return route.fulfill({body,contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html'});
 });
 await page.addInitScript(({enabled,fail,missing})=>{
 window.calls=[];window.actionStatus={enabled,busy:false,state:'idle',detail:'尚未执行 / No action yet'};
 const ok=data=>JSON.stringify({ok:true,data});
 if(!missing)window.PhoneActions={notes:()=>{window.calls.push({notes:true});return ok(window.actionStatus);},status:()=>ok(window.actionStatus),apps:()=>ok({apps:[{packageName:'example.notes',name:'便签 Notes'},{packageName:'example.browser',name:'浏览器 Browser'}]}),settings:()=>{window.calls.push({settings:true});return ok(window.actionStatus);},run:payload=>{window.calls.push(JSON.parse(payload));if(fail)return JSON.stringify({ok:false,error:'App 已卸载，请刷新'});window.actionStatus={enabled,busy:true,state:'waiting',detail:'等待输入 / Waiting for field'};return ok(window.actionStatus);},cancel:()=>{window.calls.push({cancel:true});window.actionStatus={enabled,busy:false,state:'cancelled',detail:'已停止 / Stopped'};return ok(window.actionStatus);}};
 },{enabled,fail,missing});
 await page.goto('http://phone.test/phone.html');await page.locator('#butler').evaluate(n=>n.classList.remove('hidden'));await page.locator('#butlerActions > summary').click();await page.locator('#openPhoneActions').click();return page;
}
test('on-device apps filter, permission gate and explicit payload need no computer or model',async t=>{
 const page=await pageFor(t);
 await page.waitForFunction(()=>document.querySelector('#phoneActionsApp').options.length===3);
 await page.locator('#phoneActionsFilter').fill('browser');assert.equal(await page.locator('#phoneActionsApp option').count(),2);
 await page.locator('#phoneActionsApp').selectOption('example.browser');await page.locator('#phoneActionsText').fill('天气');
 assert.equal(await page.locator('#phoneActionsInput').isDisabled(),true);assert.equal(await page.locator('#phoneActionsOpen').isDisabled(),false);
 await page.locator('#phoneActionsSettings').click();assert.deepEqual(await page.evaluate(()=>calls),[{settings:true}]);
 await page.locator('#phoneActionsOpen').click();assert.deepEqual((await page.evaluate(()=>calls))[1],{action:'open',packageName:'example.browser',text:'天气'});
 assert.equal(await page.locator('#phoneActionsStop').isVisible(),true);await page.locator('#phoneActionsStop').click();
 await page.waitForFunction(()=>!document.querySelector('#phoneActionsOpen').disabled);assert.equal(await page.locator('#phoneActionsStop').isVisible(),false);
});
test('explicit search blocks double submission, retains text, handles cancellation',async t=>{
 const page=await pageFor(t,{enabled:true});await page.locator('#phoneActionsApp').selectOption('example.notes');await page.locator('#phoneActionsText').fill('Codex 待办');
 await page.locator('#phoneActionsSearch').click();assert.equal(await page.locator('#phoneActionsSearch').isDisabled(),true);assert.equal((await page.evaluate(()=>calls)).length,1);
 await page.locator('#phoneActionsStop').click();await page.waitForFunction(()=>!document.querySelector('#phoneActionsSearch').disabled);assert.equal(await page.locator('#phoneActionsText').inputValue(),'Codex 待办');
});
test('native launch failure stays actionable, missing bridge explains Android requirement',async t=>{
 const page=await pageFor(t,{enabled:true,fail:true});await page.locator('#phoneActionsApp').selectOption('example.notes');await page.locator('#phoneActionsOpen').click();assert.match(await page.locator('#phoneActionsStatus').innerText(),/已卸载/);assert.equal(await page.locator('#phoneActionsOpen').isEnabled(),true);
 const absent=await pageFor(t,{missing:true});await absent.waitForFunction(()=>document.querySelector('#phoneActionsStatus').textContent.includes('安卓'));assert.equal(await absent.locator('#phoneActionsOpen').isDisabled(),true);
});
test('phone actions render at compact Chinese and wide English sizes without horizontal overflow',async t=>{
 for(const [language,width] of [['zh',363],['en',430]]){
  const page=await pageFor(t,{enabled:true,language,width});await page.locator('#phoneActionsApp').selectOption('example.browser');await page.locator('#phoneActionsText').fill(language==='zh'?'明天的天气':'Weather tomorrow');
  assert.equal(await page.locator('#phoneActionsDialog').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
  const file=path.resolve(__dirname,`../../docs/screenshots/phone-actions/${language}-${width}.png`);fs.mkdirSync(path.dirname(file),{recursive:true});await page.screenshot({path:file});
 }
});

test('Rednote draft entry opens locally without permission and waits while another action runs',async t=>{
 const page=await pageFor(t);await page.locator('#phoneActionsNotes').click();assert.deepEqual(await page.evaluate(()=>calls),[{notes:true}]);
 await page.locator('#phoneActionsApp').selectOption('example.notes');await page.locator('#phoneActionsOpen').click();assert.equal(await page.locator('#phoneActionsNotes').isDisabled(),true);
 await page.locator('#phoneActionsStop').click();await page.waitForFunction(()=>!document.querySelector('#phoneActionsNotes').disabled);
});
