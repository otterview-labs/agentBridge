/* Explicit deterministic phone actions. No remote connection or LLM invocation. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const en = document.documentElement.lang.startsWith('en');
  const t = (zh, english) => en ? english : zh;
  const bridge = window.PhoneActions;
  let apps = [], busy = false, enabled = false, timer;
  const sheet = $('phoneActionsDialog'), status = $('phoneActionsStatus');
  async function call(name, payload) {
    if (!bridge) throw new Error(t('请使用新版安卓 App 打开此功能。', 'Open this feature in the latest Android app.'));
    const reply = JSON.parse(await bridge[name](...(payload === undefined ? [] : [payload])));
    if (!reply.ok) throw new Error(reply.error || t('操作失败，请重试', 'Action failed; retry'));
    return reply.data;
  }
  function controls() {
    const valid = !!$('phoneActionsApp').value;
    $('phoneActionsOpen').disabled = busy || !valid;
    $('phoneActionsInput').disabled = $('phoneActionsSearch').disabled = busy || !valid || !enabled || !$('phoneActionsText').value.trim();
    $('phoneActionsApp').disabled = $('phoneActionsText').disabled = $('phoneActionsFilter').disabled = busy;
    $('phoneActionsStop').hidden = !busy;
    $('phoneActionsRefresh').disabled = $('phoneActionsNotes').disabled = busy;
  }
  function show(data) {
    busy = data.busy; enabled = data.enabled;
    const labels = {idle:t('准备就绪', 'Ready'), waiting:t('等待输入框', 'Waiting for field'), running:t('执行中', 'Running'), cancelled:t('已停止', 'Stopped'), failed:t('未完成', 'Not completed'), partial:t('部分完成', 'Partially completed'), completed:t('输入已核对', 'Text verified'), requested:t('已发起请求', 'Request sent')};
    const parts = (data.detail || '').split(' / ');
    status.textContent = (labels[data.state] || data.state) + ' · ' + (en ? parts[1] || parts[0] : parts[0]);
    $('phoneActionsPermission').textContent = enabled ? t('手机操作权限已开启', 'On-device access is enabled') : t('输入和搜索需要开启手机操作权限', 'Input and Search need on-device access');
    $('phoneActionsSettings').textContent = enabled ? t('管理权限', 'Manage access') : t('开启权限', 'Enable access');
    controls();
  }
  async function refresh() { try { show(await call('status')); } catch(e) { status.textContent = e.message; } }
  function renderApps() {
    const select = $('phoneActionsApp'), previous = select.value, query = $('phoneActionsFilter').value.trim().toLowerCase();
    select.replaceChildren(new Option(t('请选择 App', 'Choose an app'), ''));
    for (const app of apps.filter(app => (app.name + ' ' + app.packageName).toLowerCase().includes(query))) select.add(new Option(app.name, app.packageName));
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    $('phoneActionsCount').textContent = apps.length ? t('发现 ' + apps.length + ' 个可打开的 App', apps.length + ' launchable apps found') : t('没有找到可打开的 App，请刷新或检查系统限制。', 'No launchable apps found. Refresh or check system restrictions.');
    controls();
  }
  async function load() {
    try { apps = (await call('apps')).apps; renderApps(); await refresh(); }
    catch(e) { status.textContent = e.message; }
  }
  $('openPhoneActions').querySelector('.actionLabel').textContent = t('手机操作', 'Phone actions');
  $('openPhoneActions').title = t('手机操作 · 无需电脑', 'Phone actions · No computer');
  $('openPhoneActions').onclick = () => { sheet.showModal(); load(); clearInterval(timer); timer = setInterval(refresh, 800); };
  $('phoneActionsNotes').textContent = t('小红书笔记 · 草稿与定时提醒', 'Rednote drafts & reminders');
  $('phoneActionsNotes').onclick = async () => { try { await call('notes'); } catch(e) { status.textContent = e.message; } };
  $('phoneActionsClose').onclick = () => { sheet.close(); };
  sheet.addEventListener('close', () => { clearInterval(timer); $('openPhoneActions').focus(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && sheet.open) refresh(); });
  $('phoneActionsFilter').oninput = renderApps;
  $('phoneActionsText').oninput = controls;
  $('phoneActionsApp').onchange = controls;
  $('phoneActionsRefresh').onclick = load;
  $('phoneActionsSettings').onclick = async () => { try { await call('settings'); } catch(e) { status.textContent = e.message; } };
  $('phoneActionsStop').onclick = async () => { try { show(await call('cancel')); await refresh(); } catch(e) { status.textContent = e.message; } };
  for (const [id, action] of [['phoneActionsOpen','open'], ['phoneActionsInput','input'], ['phoneActionsSearch','search']]) $(id).onclick = async () => {
    if (busy) return;
    busy = true; controls();
    try { show(await call('run', JSON.stringify({ action, packageName: $('phoneActionsApp').value, text: $('phoneActionsText').value }))); }
    catch(e) { busy = false; controls(); status.textContent = e.message; }
  };
  if (en) {
    const labels = {phoneActionsBefore:'Search locates a labeled entry or field automatically. Existing field text is replaced.',phoneActionsHelpTitle:'How this works and limits',phoneActionsTitle:'On-device actions', phoneActionsClose:'Close', phoneActionsIntro:'Choose an app and an action. Runs on this phone, without a computer or a model account.',phoneActionsSettings:'Enable access',phoneActionsRefresh:'Refresh apps', phoneActionsTextLabel:'Text to enter or search',phoneActionsOpen:'Open app',phoneActionsInput:'Open and enter',phoneActionsSearch:'Enter and search',phoneActionsStop:'Stop action',phoneActionsHint:'Search opens an explicit Search entry and prefers a labeled search field. Stops after 20 seconds or when controls are ambiguous. For ordinary input you can focus the target field manually. Existing text is replaced. Return here to check or stop.'};
    for (const [id,value] of Object.entries(labels)) $(id).textContent = value;
    $('phoneActionsFilter').placeholder = 'Find an app'; $('phoneActionsFilter').setAttribute('aria-label','Find an app');
    $('phoneActionsApp').setAttribute('aria-label','Target app'); $('phoneActionsText').placeholder = 'For example: tomorrow’s weather';
  }
  controls();
})();
