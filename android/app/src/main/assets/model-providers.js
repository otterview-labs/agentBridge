(function (root) {
  'use strict';
  // Editable presets, not a claim that a particular account has model access.
  // See docs/model-providers.md for the official configuration references.
  const presets = {
    'kimi-code': { brand: 'kimi', name: 'Kimi', variant: 'Kimi Code 会员', baseUrl: 'https://api.kimi.com/coding/v1', modelId: 'k3-256k', models: ['k3-256k', 'k3'], note: '使用 Kimi Code 会员密钥；与开放平台密钥不通用。' },
    'kimi-open': { brand: 'kimi', name: 'Kimi', variant: '开放平台 API', baseUrl: 'https://api.moonshot.cn/v1', modelId: 'kimi-k3', models: ['kimi-k3', 'kimi-k2.6'], note: '使用 Moonshot 开放平台密钥，按 API 用量计费。' },
    deepseek: { brand: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'], note: '使用 DeepSeek 开放平台的 API Key。' },
    bailian: { brand: 'bailian', name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-plus', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'], note: '默认北京地域；其他地域可在连接设置中修改地址。' },
    zhipu: { brand: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelId: '', models: [], note: '填写智谱开放平台中已开通的模型 ID。' },
    volcengine: { brand: 'volcengine', name: '火山方舟', variant: '开放平台 API', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', modelId: '', models: [], note: '填写控制台中的模型 ID 或 ep- 开头的接入点 ID。' },
    'volcengine-plan': { brand: 'volcengine', name: '火山方舟', variant: 'Coding Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', modelId: '', models: [], note: '使用 Coding Plan 专属密钥；套餐限支持的编程工具，请先确认此 App 的调用权限。' },
    openai: { brand: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4.1-mini', models: ['gpt-4.1-mini'], note: '使用 OpenAI API 平台密钥，ChatGPT 订阅与 API 分别计费。' },
    gemini: { brand: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modelId: 'gemini-3.8-flash', models: ['gemini-3.8-flash'], note: '通过 Gemini 的 OpenAI 兼容接口连接，需手机能访问 Google 服务。' },
    custom: { brand: 'custom', name: '自定义', baseUrl: '', modelId: '', models: [], note: '填写 OpenAI 兼容服务的地址、模型名称和密钥。Claude 原生接口需要兼容网关。' }
  };
  const brands = ['kimi', 'deepseek', 'bailian', 'zhipu', 'volcengine', 'openai', 'gemini', 'custom'];
  const normalize = value => String(value || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  function detect(baseUrl) {
    const normalized = normalize(baseUrl);
    return Object.keys(presets).find(key => presets[key].baseUrl && normalize(presets[key].baseUrl) === normalized) || 'custom';
  }
  function parseModelConfig(raw) {
    if (!raw || raw.length > 16000) throw new Error('请粘贴不超过 16000 字符的模型 JSON 配置');
    let input;
    try { input = JSON.parse(raw); } catch (_) { throw new Error('配置不是有效 JSON，请检查引号和逗号'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请粘贴包含地址、模型名和密钥的 JSON 对象');
    const field = names => {
      for (const name of names) if (Object.prototype.hasOwnProperty.call(input, name)) {
        if (typeof input[name] !== 'string') throw new Error('模型配置的字段应为文本');
        return input[name].trim();
      }
      return '';
    };
    const baseUrl = field(['baseUrl', 'baseURL', 'base_url', 'OPENAI_BASE_URL']);
    const modelId = field(['modelId', 'model', 'model_id', 'OPENAI_MODEL']);
    const apiKey = field(['apiKey', 'api_key', 'OPENAI_API_KEY']);
    if (!baseUrl || !modelId) throw new Error('配置中需要 baseUrl 和 model（或 modelId）');
    let url;
    try { url = new URL(baseUrl); } catch (_) { throw new Error('模型地址格式不正确'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('模型地址应为不含账号、密钥或查询参数的 HTTP(S) 地址');
    if (modelId.length > 160) throw new Error('模型名称最多 160 字符');
    return { baseUrl, modelId, apiKey };
  }

  let saved = {};
  let mounted = false;
  let renderedPreset = '';
  let customSelected = false;
  let savedFeedback = null;
  const $ = id => document.getElementById(id);
  const t = value => root.OfficeI18n?.text(value) || value;
  function refresh() {
    const key = $('modelProvider').value || 'custom';
    const preset = presets[key] || presets.custom;
    $('modelSelectedService').textContent = key === 'custom' ? t('选择服务商') : t(preset.name);
    document.querySelectorAll('[data-model-brand]').forEach(button => {
      const active = button.dataset.modelBrand === preset.brand && (key !== 'custom' || customSelected || Boolean($('modelBaseUrl').value.trim()));
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('selected', active);
    });
    const variants = Object.entries(presets).filter(([, value]) => value.brand === preset.brand);
    const select = $('modelVariant');
    if (renderedPreset !== key) {
      select.replaceChildren();
      variants.forEach(([value, item]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = t(item.variant || item.name); select.appendChild(option);
      });
      select.value = key;
      const suggestions = $('modelSuggestions');
      suggestions.replaceChildren();
      preset.models.forEach(value => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.modelSuggestion = value; button.textContent = value;
        button.addEventListener('click', () => { $('modelId').value = value; refresh(); });
        suggestions.appendChild(button);
      });
      suggestions.classList.toggle('hidden', preset.models.length === 0);
      renderedPreset = key;
    }
    $('modelVariantRow').classList.toggle('hidden', variants.length < 2);
    $('modelProviderHint').textContent = t(preset.note);
    $('modelSuggestions').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.modelSuggestion === $('modelId').value.trim())));
    $('modelId').placeholder = t(preset.modelId || '填写已开通的模型 ID');
    const reuse = Boolean(saved.hasApiKey) && normalize(saved.baseUrl) === normalize($('modelBaseUrl').value);
    $('modelApiKey').placeholder = t(reuse ? '已保存，留空继续使用' : '粘贴所选服务的 API Key');
    $('modelKeyHint').textContent = t(reuse ? '密钥已保存在本机，留空继续使用。' : '切换服务后，请填写对应的密钥。');
    let host = t('填写服务地址');
    try { host = new URL($('modelBaseUrl').value).host; } catch (_) { /* Incomplete form. */ }
    $('modelEndpointHost').textContent = host;
    const dirty = normalize(saved.baseUrl) !== normalize($('modelBaseUrl').value)
      || (saved.modelId || '') !== $('modelId').value.trim() || Boolean($('modelApiKey').value.trim());
    $('testModelConnection').disabled = dirty || !saved.hasApiKey;
    const badge = $('modelConnectionBadge'), feedback = $('modelCheckResult');
    if (dirty && !savedFeedback) {
      savedFeedback = { badge: badge.textContent, state: badge.dataset.state,
        message: feedback.textContent, error: feedback.classList.contains('error') };
      badge.textContent = t('待保存');
      badge.dataset.state = 'pending';
      feedback.textContent = t('配置尚未保存，保存后验证连接。');
      feedback.classList.remove('error');
    } else if (!dirty && savedFeedback) {
      badge.textContent = savedFeedback.badge;
      badge.dataset.state = savedFeedback.state;
      feedback.textContent = savedFeedback.message;
      feedback.classList.toggle('error', savedFeedback.error);
      savedFeedback = null;
    }
  }
  function choose(key) {
    if (!presets[key]) return;
    const preset = presets[key];
    customSelected = key === 'custom';
    const oldDestination = normalize($('modelBaseUrl').value);
    $('modelProvider').value = key;
    if (key !== 'custom') {
      $('modelBaseUrl').value = preset.baseUrl;
      $('modelId').value = normalize(saved.baseUrl) === normalize(preset.baseUrl) ? saved.modelId || preset.modelId : preset.modelId;
      $('modelEndpointDetails').open = false;
    } else {
      if (detect(oldDestination) !== 'custom') {
        const customSaved = Boolean(saved.baseUrl) && detect(saved.baseUrl) === 'custom';
        $('modelBaseUrl').value = customSaved ? saved.baseUrl : '';
        $('modelId').value = customSaved ? saved.modelId : '';
      }
      $('modelEndpointDetails').open = true;
    }
    $('modelServiceChoices').open = false;
    if (normalize($('modelBaseUrl').value) !== oldDestination) $('modelApiKey').value = '';
    refresh();
    $('modelBaseUrl').dispatchEvent(new Event('input', { bubbles: true }));
  }
  function sync(settings = {}, model = {}) {
    savedFeedback = null;
    saved = { baseUrl: settings.baseUrl || '', modelId: settings.modelId || '', hasApiKey: Boolean(settings.hasApiKey) };
    $('modelProvider').value = detect($('modelBaseUrl').value);
    customSelected = Boolean(saved.baseUrl) && $('modelProvider').value === 'custom';
    $('modelServiceChoices').open = !saved.baseUrl;
    $('modelEndpointDetails').open = $('modelProvider').value === 'custom';
    const badge = $('modelConnectionBadge');
    badge.textContent = t(model.verifiedAt ? '已验证' : settings.hasApiKey ? '待验证' : '未配置');
    badge.dataset.state = model.verifiedAt ? 'verified' : 'pending';
    $('modelCheckResult').textContent = t(model.verifiedAt ? '已验证连接，可以继续使用或更换模型。' : '验证会发送一条短测试消息。');
    $('modelCheckResult').classList.remove('error');
    refresh();
  }
  function mount() {
    if (mounted) return; mounted = true;
    const selector = $('modelProvider'); selector.replaceChildren();
    Object.entries(presets).forEach(([key, preset]) => {
      const option = document.createElement('option'); option.value = key; option.textContent = t(preset.name) + (preset.variant ? ' · ' + t(preset.variant) : ''); selector.appendChild(option);
    });
    const grid = $('modelProviderChoices'); grid.replaceChildren();
    brands.filter(brand => brand !== 'custom').forEach(brand => {
      const key = Object.keys(presets).find(id => presets[id].brand === brand);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'modelProviderChoice'; button.dataset.modelBrand = brand; button.textContent = t(presets[key].name); button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        if (presets[selector.value]?.brand === brand) { $('modelServiceChoices').open = false; return; }
        choose(key);
      });
      grid.appendChild(button);
    });
    $('modelCustomChoice').addEventListener('click', () => {
      choose('custom');
      $('modelBaseUrl').focus();
    });
    selector.addEventListener('change', () => choose(selector.value));
    $('modelVariant').addEventListener('change', () => choose($('modelVariant').value));
    $('modelBaseUrl').addEventListener('input', refresh);
    $('modelId').addEventListener('input', refresh);
    $('modelApiKey').addEventListener('input', refresh);
  }
  const api = { presets, brands, normalize, detect, parseModelConfig, mount, sync, refresh };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ModelProviders = api;
})(typeof window === 'undefined' ? globalThis : window);
