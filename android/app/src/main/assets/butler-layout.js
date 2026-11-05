/* Presentation only: preserve native failures, credentials, routing and chat actions. */
(function (global) {
  'use strict';
  const t = text => global.OfficeI18n ? global.OfficeI18n.text(text) : text;
  function failure(value) {
    const raw = String(value || '');
    if (/5[- ]hour.*(?:usage limit|quota)|(?:usage limit|quota).*5[- ]hour/i.test(raw)) return {
      title: t('当前时段额度已用尽'), text: t('服务提示 5 小时用量已达上限，额度恢复后可再试。')
    };
    if (/insufficient_quota|quota.*(?:exceed|exhaust)|usage limit|额度.*(?:耗尽|不足)|余额不足/i.test(raw)) return {
      title: t('模型额度不足'), text: t('服务提示额度或余额不足，请查看服务商账户。')
    };
    if (/HTTP\s*429|rate.?limit|too many requests|限流/i.test(raw)) return {
      title: t('请求过于频繁'), text: t('服务返回 HTTP 429，请稍后再试。')
    };
    if (/HTTP\s*(401|403)|unauthorized|forbidden/i.test(raw)) {
      const code = raw.match(/HTTP\s*(401|403)/i);
      return { title: t('模型鉴权未通过'), text: `${t('请检查密钥和当前模型的调用权限。')}${code ? ` (HTTP ${code[1]})` : ''}` };
    }
    if (/HTTP\s*404/.test(raw)) return { title: t('模型地址或名称不匹配'), text: t('服务返回 HTTP 404，请检查模型地址与名称。') };
    return { title: t('模型连接暂不可用'), text: t('请稍后重试，或展开错误详情排查。') };
  }
  function notice(value, error) {
    const $ = id => document.getElementById(id);
    const summary = error ? failure(value) : { title: '', text: value };
    $('butlerConnectionTitle').textContent = summary.title;
    $('butlerConnectionTitle').classList.toggle('hidden', !error);
    $('butlerConnectionText').textContent = summary.text;
    const trigger = $('butlerConnectionDetails').querySelector('summary');
    trigger.tabIndex = error ? 0 : -1;
    trigger.setAttribute('aria-disabled', String(!error));
    $('butlerConnectionRaw').classList.toggle('hidden', !error);
    // Use textContent, including for untrusted server diagnostics.
    $('butlerConnectionRaw').textContent = error ? String(value) : '';
    if (!error) $('butlerConnectionDetails').open = false;
  }
  function scope(select) {
    const label = select.selectedOptions[0]?.textContent || t('整个小镇');
    const preview = document.getElementById('butlerScopePreview');
    preview.textContent = label;
    preview.title = label;
  }
  function mount() {
    const options = document.getElementById('butlerComposerOptions');
    document.querySelector('#butlerConnectionDetails > summary').addEventListener('click', event => {
      if (!document.getElementById('connectionHint').classList.contains('error')) event.preventDefault();
    });
    document.getElementById('piInput').addEventListener('focus', () => { options.open = false; });
  }
  function feedback(value) { return /HTTP\s*\d{3}|usage limit|insufficient_quota/i.test(String(value)) ? failure(value).title : value; }
  const api = { failure, feedback, notice, scope, mount };
  global.ButlerLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
