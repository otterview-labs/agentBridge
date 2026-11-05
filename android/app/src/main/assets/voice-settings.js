/* Settings are a draft until explicitly saved; test actions always use saved native settings. */
window.VoiceSettings = (() => {
  const $ = id => document.getElementById(id);
  const t = value => window.OfficeI18n.text(value);
  const defaults = {
    system: { baseUrl: '', asrModel: '', ttsModel: '', voice: '' },
    sherpa: { baseUrl: '', asrModel: 'xasr-zh-en-int8', ttsModel: '', voice: '' },
    doubao: { baseUrl: 'https://openspeech.bytedance.com', asrModel: 'doubao-seed-asr-2.0', ttsModel: '', voice: '' },
    bailian: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', asrModel: 'qwen3-asr-flash', ttsModel: 'qwen3-tts-flash', voice: 'Cherry' },
    openai: { baseUrl: 'https://api.openai.com/v1', asrModel: 'gpt-4o-mini-transcribe', ttsModel: 'gpt-4o-mini-tts', voice: 'alloy' },
    custom: { baseUrl: '', asrModel: 'whisper-1', ttsModel: 'tts-1', voice: 'alloy' }
  };
  let status = {}, provider = 'system', saved = '', busy = false;
  let downloadPoll;
  const local = name => name === 'system' || name === 'sherpa';
  const payload = () => ({ provider, baseUrl: $('voiceBaseUrl').value.trim(), asrModel: $('voiceAsrModel').value.trim(), ttsModel: $('voiceTtsModel').value.trim(), voice: provider === 'openai' ? $('voiceChoice').value : $('voiceCustomVoice').value.trim(), apiKey: $('voiceApiKey').value.trim() });
  const dirty = () => JSON.stringify(payload()) !== saved;
  function feedback(message, error = false) { $('voiceTestResult').textContent = message; $('voiceTestResult').classList.toggle('error', error); }
  function controls() {
    $('ttsPreview').disabled = dirty() || busy || status.ready === false;
    $('voiceAsrTest').disabled = dirty() || (!status.cloudAvailable && (status.provider === 'doubao' || status.recognitionAvailable === false)) || (busy && $('voiceAsrTest').textContent !== t('结束录音'));
    $('voiceTestStop').disabled = !busy;
    $('saveVoiceService').disabled = busy;
    $('clearVoiceService').disabled = busy || dirty() || !status.hasVoiceKey || provider !== status.provider;
    document.querySelectorAll('#voiceProviderChoices button').forEach(button => {
      button.disabled = busy || (button.dataset.voiceProvider === 'sherpa' && status.offlineAvailable !== true);
      if (button.dataset.voiceProvider === 'sherpa') {
        button.querySelector('small').textContent = t(status.offlineAvailable ? '中英混说 · 下载后离线' : '此设备不支持小镇离线识别');
      }
    });
    document.querySelectorAll('#voiceCloudFields input, #voiceCloudFields select').forEach(input => { input.disabled = busy; });
    if (dirty() && !busy) feedback(t('配置尚未保存，保存后再测试。'));
  }
  function offlineModel(start = false) {
    clearTimeout(downloadPoll);
    const show = provider === 'sherpa' && status.offlineAvailable === true;
    $('offlineVoiceModel').classList.toggle('hidden', !show);
    if (!show) return;
    const button = $('downloadOfflineVoice'), bar = $('offlineVoiceProgress');
    let model;
    try {
      const result = JSON.parse(start ? AgentBridge.downloadOfflineVoiceModel() : AgentBridge.getOfflineVoiceModelStatus());
      if (!result.ok) throw Error();
      model = result.data;
    } catch { model = { state: 'error' }; }
    const active = model.state === 'downloading', ready = model.state === 'ready';
    const failed = model.state === 'error' || model.state === 'storage';
    const megabytes = Math.round(model.totalBytes / 1000000);
    const percent = active ? Math.min(100, Math.floor((model.downloadedBytes || 0) * 100 / model.totalBytes)) : 0;
    button.classList.toggle('hidden', ready);
    button.disabled = active || busy;
    button.textContent = t(active ? '下载中…' : failed ? '重试下载' : '下载离线模型');
    bar.classList.toggle('hidden', !active);
    bar.value = percent;
    const message = ready ? t('已下载 · 可断网使用')
      : model.state === 'storage' ? t('手机存储空间不足，请腾出空间再试。')
      : failed ? t('下载失败，请检查网络后重试。')
      : active ? (percent === 100 ? t('正在校验并安装模型…') : t('正在下载模型 · {percent}%').replace('{percent}', percent))
      : t('首次使用需联网下载，约 {size} MB。').replace('{size}', megabytes);
    if ($('offlineVoiceModelStatus').textContent !== message) $('offlineVoiceModelStatus').textContent = message;
    if (status.provider === 'sherpa' && status.recognitionAvailable !== ready) {
      status.recognitionAvailable = ready;
      renderInputStatus();
      controls();
    }
    if (active && !$('voiceBackdrop').classList.contains('hidden')) downloadPoll = setTimeout(offlineModel, 500);
  }
  function select(next) {
    provider = defaults[next] ? next : 'system';
    const config = { ...defaults[provider], ...(status.profiles?.[provider] || (status.provider === provider ? status : {})) };
    document.querySelectorAll('#voiceProviderChoices button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.voiceProvider === provider)));
    $('voiceCloudFields').classList.toggle('hidden', local(provider));
    $('voiceApiKey').value = '';
    $('voiceBaseUrl').value = config.baseUrl;
    $('voiceAsrModel').value = config.asrModel;
    $('voiceTtsModel').value = config.ttsModel;
    $('voiceCustomVoice').value = config.voice;
    if (!Array.from($('voiceChoice').options).some(option => option.value === config.voice) && provider === 'openai') {
      const option = document.createElement('option'); option.value = config.voice; option.textContent = config.voice; $('voiceChoice').append(option);
    }
    $('voiceChoice').value = config.voice;
    $('voiceChoiceLabel').classList.toggle('hidden', provider !== 'openai');
    $('voiceCustomVoiceLabel').classList.toggle('hidden', provider !== 'custom');
    $('voiceBaseUrl').readOnly = provider !== 'custom';
    $('voiceAsrModel').readOnly = provider === 'bailian';
    $('voiceTtsModel').readOnly = provider === 'bailian';
    $('voiceServiceDetails').open = provider === 'custom';
    $('voiceServiceDetails').classList.toggle('hidden', provider === 'doubao');
    $('voiceServiceState').textContent = config.hasVoiceKey ? t('独立密钥已保存 · 留空保留') : status.keySource === 'chat' && provider === status.provider ? t('沿用北京地域百炼模型密钥') : t('语音密钥与聊天模型分别配置');
    $('voiceApiKey').placeholder = config.hasVoiceKey ? t('已保存，留空继续使用') : t('填入所选服务的密钥');
    $('voiceProviderHint').textContent = t({ system: '使用手机系统的识别与播报能力，无需 API Key。', sherpa: '下载一次后，手机可离线识别普通话和英文工具名，无需密钥。', doubao: '填写豆包语音项目的 API Key。豆包识别语音，手机负责播报。', bailian: '国内服务：阿里云百炼北京地域，支持流式识别与 Cherry 播报。', openai: '海外服务：使用 OpenAI API 密钥，需手机能访问其语音接口。', custom: '服务需同时支持 OpenAI 格式的转写与声音合成接口。' }[provider]);
    controls();
    offlineModel();
  }
  function renderInputStatus() {
    const cloud = !local(status.provider);
    $('voiceInputStatus').textContent = `${cloud ? status.cloudAvailable ? t('云端已配置 · 待测试') : t('云端尚未配置') : status.recognitionAvailable ? t('本机识别可用') : t('本机识别尚未就绪')} · ${status.microphoneGranted ? t('麦克风已授权') : t('录音时需授权')}`;
  }
  function refresh(value) {
    status = { ...value, provider: value.provider || (value.cloudAvailable ? 'bailian' : 'system') };
    const cloud = !local(status.provider);
    $('voiceActiveProvider').textContent = `${t('当前生效：')}${t({system:'本机语音',sherpa:'本机离线识别',doubao:'火山引擎 · 豆包语音',bailian:'阿里云百炼',openai:'OpenAI',custom:'自定义兼容接口'}[status.provider] || status.provider)}`;
    renderInputStatus();
    $('ttsEngineStatus').textContent = cloud && status.provider !== 'doubao' ? status.cloudAvailable ? t('云端已配置 · 待试听') : t('云端尚未配置') : status.localReady || status.ready ? t('本机声音已就绪') : t('本机声音不可用');
    $('voiceServiceState').textContent = status.hasVoiceKey ? t('独立密钥已保存 · 留空保留') : status.keySource === 'chat' ? t('沿用北京地域百炼模型密钥') : t('语音密钥与聊天模型分别配置');
    select(status.provider); saved = JSON.stringify(payload()); controls();
  }
  function testing(value) { busy = value; controls(); }
  function mount() {
    $('downloadOfflineVoice').addEventListener('click', () => offlineModel(true));
    if (window.OfficeI18n.language === 'en') {
      const overseas = document.querySelector('[data-voice-region="overseas"]');
      overseas.parentElement.insertBefore(overseas, document.querySelector('[data-voice-region="domestic"]'));
    }
    document.querySelectorAll('#voiceProviderChoices button').forEach(button => button.addEventListener('click', () => select(button.dataset.voiceProvider)));
    document.querySelectorAll('#voiceCloudFields input, #voiceCloudFields select').forEach(input => input.addEventListener('input', () => {
      // A changed destination must never silently reuse the previous destination's secret.
      if (input.id === 'voiceBaseUrl') $('voiceApiKey').placeholder = t('更换地址后需重新填写密钥');
      controls();
    }));
  }
  return { mount, refresh, payload, dirty, feedback, testing, offlineModel };
})();
