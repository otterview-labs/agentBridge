(function() {
  'use strict';

  const t = window.OfficeI18n.text;

  const state = {
    machines: [],
    tasks: [],
    deletedTasks: [],
    frpServer: null,
    frpRelays: [],
    studio: null,
    studioLoading: false,
    networkHint: '',
    view: 'offices',
    currentTaskId: null,
    drafts: new Map(),
    replySuggestions: new Map(),
    backgroundSends: new Map(),
    taskReceipts: new Map(),
    backgroundDiscovers: new Map(),
    backgroundTails: new Map(),
    backgroundReports: new Map(),
    backgroundNotices: [],
    sending: false,
    pendingChat: null,
    chatProgress: null,
    failedChat: null,
    chatNotices: [],
    modelChecking: false,
    modelCheckError: '',
    authType: 'password',
    frpAuthType: 'password',
    butlerPlanMode: loadButlerPlanMode(),
    voiceAutoSend: loadVoicePreference('voiceAutoSend', true),
    voiceSpeakReply: loadVoicePreference('voiceSpeakReply', true),
    voicePreferCloud: loadVoicePreference('voicePreferCloud', false),
    voiceRate: loadVoiceNumber('voiceRate', 1),
    voicePitch: loadVoiceNumber('voicePitch', 1),
    voiceRecording: false,
    acceptVoiceEvents: false,
    voiceLevel: 0,
    voiceStartedAt: 0,
    callMode: false,
    callMuted: false,
    callSpeaker: true,
    callStartedAt: 0,
    callStatus: '',
    callTranscript: '',
    collapsedSprites: loadCollapsedSprites()
  };
  const showDeletedOffices = new Set();
  const voicePointer = { id: null, x: 0, y: 0, startedAt: 0, cancelArmed: false };
  let chatLayoutFrame = null;
  const agentNames = { codex: 'Codex', 'claude-code': 'Claude', gemini: 'Gemini' };
  const $ = (id) => document.getElementById(id);
  console.log('phone-controller bootstrap');

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => selectView(tab.dataset.view));
  });
  $('attentionCount').addEventListener('click', () => selectView('todo'));
  $('cloudState').addEventListener('click', openCloudSheet);
  $('backgroundState').addEventListener('click', showBackgroundJobs);
  $('openCloudFromButler').addEventListener('click', openCloudSheet);
  $('refreshButler').addEventListener('click', () => void loadStudio());
  $('cloudForm').addEventListener('submit', saveCloudConnection);
  $('testModelConnection').addEventListener('click', checkModelConnection);
  $('checkButlerModel').addEventListener('click', checkModelConnection);
  $('saveVoiceService').addEventListener('click', () => saveVoiceService(false));
  $('clearVoiceService').addEventListener('click', () => saveVoiceService(true));
  $('sendPi').addEventListener('click', sendPiMessage);
  $('generateReport').addEventListener('click', generateTodayReport);
  if (window.PointerEvent) {
    $('voiceButton').addEventListener('pointerdown', beginVoicePointer);
    $('voiceButton').addEventListener('pointermove', moveVoicePointer);
    $('voiceButton').addEventListener('pointerup', endVoicePointer);
    $('voiceButton').addEventListener('pointercancel', cancelVoicePointer);
    $('voiceButton').addEventListener('contextmenu', (event) => event.preventDefault());
  } else {
    $('voiceButton').addEventListener('click', toggleVoiceInput);
  }
  $('voiceAutoSend').addEventListener('click', () => toggleVoicePreference('voiceAutoSend'));
  $('voiceSpeakReply').addEventListener('click', () => toggleVoicePreference('voiceSpeakReply'));
  $('openVoiceSettings').addEventListener('click', openVoiceSettings);
  $('voiceSpeakReplySetting').addEventListener('change', syncSpeakReplySetting);
  $('voicePreferCloudSetting').addEventListener('change', () => {
    state.voicePreferCloud = $('voicePreferCloudSetting').checked;
    try {
      localStorage.setItem('voicePreferCloud', String(state.voicePreferCloud));
    } catch (error) {
      // The in-memory preference still applies for this session.
    }
    try {
      AgentBridge.setTtsEnginePreference(state.voicePreferCloud);
    } catch (error) {
      // Older native builds always prefer the local engine.
    }
    toast(state.voicePreferCloud ? t("已优先使用云端语音（Cherry 音色）") : t("已优先使用本机语音"));
  });
  $('voiceRateSetting').addEventListener('input', () => updateVoiceTuning('voiceRate', 'voiceRateSetting', 'voiceRateEcho', '×'));
  $('voicePitchSetting').addEventListener('input', () => updateVoiceTuning('voicePitch', 'voicePitchSetting', 'voicePitchEcho', ''));
  $('ttsPreview').addEventListener('click', previewButlerVoice);
  $('startCall').addEventListener('click', startCallMode);
  $('callMute').addEventListener('click', toggleCallMute);
  $('callSpeaker').addEventListener('click', toggleCallSpeaker);
  $('callEnd').addEventListener('click', endCallMode);
  $('callRetry').addEventListener('click', retryCallListening);
  document.querySelectorAll('[data-quick-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      $('piInput').value = button.dataset.quickPrompt;
      autoResizeChatInput();
      void sendPiMessage();
    });
  });
  $('piInput').addEventListener('input', autoResizeChatInput);
  $('piInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendPiMessage();
    }
  });
  $('voiceAutoSend').classList.toggle('active', state.voiceAutoSend);
  $('voiceAutoSend').setAttribute('aria-pressed', String(state.voiceAutoSend));
  $('voiceSpeakReply').classList.toggle('active', state.voiceSpeakReply);
  $('voiceSpeakReply').setAttribute('aria-pressed', String(state.voiceSpeakReply));
  updateVoiceUi('stopped');
  applyVoiceTuning();
  refreshTtsEngineStatus();
  $('voicePreferCloudSetting').checked = state.voicePreferCloud;
  try { AgentBridge.setTtsEnginePreference(state.voicePreferCloud); } catch (error) {
    // Older native builds always prefer the local engine.
  }
  document.querySelectorAll('[data-plan-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.butlerPlanMode = button.dataset.planMode === 'records' ? 'records' : 'ai';
      try {
        localStorage.setItem('butlerPlanMode', state.butlerPlanMode);
      } catch (error) {
        // The in-memory mode still works if private storage is unavailable.
      }
      renderPiDetail();
    });
  });

  function selectView(view) {
    state.view = view;
    document.querySelectorAll('.tab').forEach((item) => {
      const selected = item.dataset.view === view;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    render();
  }

  $('openAdd').addEventListener('click', () => {
    $('scanPrefix').value = state.networkHint || '';
    openMachineSheet();
  });
  $('openScan').addEventListener('click', () => {
    $('scanPrefix').value = state.networkHint || '';
    openMachineSheet();
    setTimeout(() => runScan(), 50);
  });
  $('refreshAll').addEventListener('click', refreshAll);
  $('runScan').addEventListener('click', runScan);
  $('machineForm').addEventListener('submit', saveMachine);
  $('frpForm').addEventListener('submit', saveFrpServer);
  document.querySelectorAll('[data-frp-auth]').forEach((button) => {
    button.addEventListener('click', () => {
      state.frpAuthType = button.dataset.frpAuth;
      document.querySelectorAll('[data-frp-auth]').forEach((item) => item.classList.toggle('active', item === button));
      $('frpPasswordLabel').classList.toggle('hidden', state.frpAuthType !== 'password');
      $('frpKeyLabel').classList.toggle('hidden', state.frpAuthType !== 'key');
    });
  });
  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeSheet(button.dataset.close));
  });
  $('taskBackdrop').addEventListener('click', (event) => {
    if (event.target === $('taskBackdrop')) closeSheet('taskBackdrop');
  });
  $('replyText').addEventListener('input', () => {
    if (state.currentTaskId !== null) state.drafts.set(state.currentTaskId, $('replyText').value);
  });
  $('generateReplySuggestions').addEventListener('click', generateTaskReplySuggestions);

  let sheetTrigger = null;
  function openSheet(id) {
    sheetTrigger = document.activeElement;
    $(id).classList.remove('hidden');
    document.body.classList.add('sheetOpen');
    document.querySelector('.app').setAttribute('inert', '');
    $(id).querySelector('[data-close]').focus({ preventScroll: true });
  }

  function closeSheet(id) {
    if (state.sending || !$('busy').classList.contains('hidden')) return false;
    $(id).classList.add('hidden');
    document.body.classList.remove('sheetOpen');
    document.querySelector('.app').removeAttribute('inert');
    if (sheetTrigger && sheetTrigger.isConnected) sheetTrigger.focus({ preventScroll: true });
    else $('refreshAll').focus({ preventScroll: true });
    sheetTrigger = null;
    return true;
  }

  function closeTopSheet() {
    if (state.callMode) {
      endCallMode();
      return true;
    }
    if (state.sending || !$('busy').classList.contains('hidden')) return true;
    const sheet = document.querySelector('.sheetBackdrop:not(.hidden)');
    return sheet ? closeSheet(sheet.id) : false;
  }

  window.phoneUI = {
    closeTopSheet,
    notice(message) {
      addBackgroundNotice('error', message);
      renderBackgroundState();
      toast(message);
    }
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && closeTopSheet()) event.preventDefault();
    if (event.key !== 'Tab') return;
    const sheet = state.callMode ? $('callBackdrop') : document.querySelector('.sheetBackdrop:not(.hidden)');
    if (!sheet) return;
    const controls = Array.from(sheet.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary'
    )).filter((node) => {
      if (!node.getClientRects().length) return false;
      for (let parent = node.parentElement; parent && parent !== sheet; parent = parent.parentElement) {
        if (parent.matches('details:not([open])') && node !== parent.querySelector(':scope > summary')) return false;
      }
      return true;
    });
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  document.querySelectorAll('[data-auth]').forEach((button) => {
    button.addEventListener('click', () => {
      state.authType = button.dataset.auth;
      document.querySelectorAll('[data-auth]').forEach((item) => item.classList.toggle('active', item === button));
      $('passwordLabel').classList.toggle('hidden', state.authType !== 'password');
      $('keyLabel').classList.toggle('hidden', state.authType !== 'key');
    });
  });
  $('renameTask').addEventListener('click', renameCurrentTask);
  $('deleteTask').addEventListener('click', deleteCurrentTask);
  $('tailTask').addEventListener('click', refreshCurrentTask);
  $('sendTask').addEventListener('click', sendCurrentTask);

  // Bridge methods that open SSH connections. A direct call blocks the page
  // until it returns, so these run natively on a worker thread and are polled.
  const BACKGROUND_CALLS = new Set([
    'discoverTasks', 'probeMachine', 'scanNetwork', 'deployFrpServer', 'deployFrpRelay', 'disableFrpRelay'
  ]);

  function call(method, busyText) {
    const args = Array.prototype.slice.call(arguments, 2);
    if (BACKGROUND_CALLS.has(method) && typeof AgentBridge.beginBridgeCall === 'function') {
      return callInBackground(method, busyText, args);
    }
    return new Promise((resolve) => {
      showBusy(busyText);
      setTimeout(() => {
        let parsed;
        try {
          const raw = AgentBridge[method].apply(AgentBridge, args);
          parsed = JSON.parse(raw);
        } catch (error) {
          console.error('bridge call failed: ' + method + ': ' + (error && error.message ? error.message : String(error)));
          parsed = { ok: false, error: error && error.message ? error.message : String(error) };
        }
        hideBusy();
        if (!parsed.ok) toast(parsed.error || t("操作失败"));
        resolve(parsed);
      }, 40);
    });
  }

  async function callInBackground(method, busyText, args) {
    showBusy(busyText);
    let parsed;
    let operationId = null;
    try {
      const started = JSON.parse(AgentBridge.beginBridgeCall(method, JSON.stringify(args)));
      if (!started.ok) throw new Error(started.error || t("操作失败"));
      operationId = started.data.operation.id;
      for (;;) {
        await sleep(300);
        const current = JSON.parse(AgentBridge.operationState(operationId));
        if (!current.ok) throw new Error(current.error || t("无法读取操作状态"));
        const operation = current.data.operation;
        if (operation.state !== 'running') {
          parsed = operation.result || { ok: false, error: operation.message || t("操作失败") };
          break;
        }
      }
    } catch (error) {
      console.error('bridge call failed: ' + method + ': ' + (error && error.message ? error.message : String(error)));
      parsed = { ok: false, error: error && error.message ? error.message : String(error) };
    } finally {
      if (operationId !== null) {
        try { AgentBridge.clearOperation(operationId); } catch (error) { /* already cleared */ }
      }
    }
    hideBusy();
    if (!parsed.ok) toast(parsed.error || t("操作失败"));
    return parsed;
  }

  async function loadState() {
    console.log('loading state');
    const result = await call('state', t("读取本机数据…"));
    console.log('state result: ok=' + Boolean(result.ok)
      + ' machines=' + (result.data && result.data.machines ? result.data.machines.length : 0)
      + ' tasks=' + (result.data && result.data.tasks ? result.data.tasks.length : 0));
    if (!result.ok) return false;
    state.machines = result.data.machines || [];
    state.tasks = result.data.tasks || [];
    state.deletedTasks = result.data.deletedTasks || [];
    state.frpServer = result.data.frpServer || null;
    state.frpRelays = result.data.frpRelays || [];
    state.networkHint = result.data.networkHint || '';
    render();
    return true;
  }

  async function refreshAll() {
    if (!state.machines.length) {
      toast(t("先添加一台 SSH 机器"));
      openMachineSheet();
      return;
    }
    let failed = 0;
    const total = state.machines.length;
    for (const machine of state.machines) {
      const result = await call('discoverTasks', `${t("正在探查 ")}${machine.name}…`, machine.id);
      if (!result.ok) failed += 1;
    }
    if (!await loadState()) return;
    await loadStudio();
    toast(failed === total ? t("刷新失败，保留上次记录")
      : failed ? `${t("已刷新 ")}${total - failed}/${total}${t(" 台，其余保留上次记录")}`
        : t("任务已刷新"));
  }

  async function loadStudio() {
    if (state.studioLoading) return;
    state.studioLoading = true;
    try {
      const result = await call('studioOverview', t("读取管家与今日记录…"));
      if (result.ok) {
        state.studio = result.data;
        render();
      }
      return result.ok;
    } catch (error) {
      console.error('loadStudio failed: ' + (error && error.message ? error.message : String(error)));
      return false;
    } finally {
      state.studioLoading = false;
    }
  }

  async function runScan() {
    const prefix = $('scanPrefix').value.trim() || state.networkHint;
    const result = await call('scanNetwork', t("正在扫描局域网端口…"), prefix);
    const container = $('scanResult');
    container.textContent = '';
    if (!result.ok) return;
    if (!result.data.hosts.length) {
      container.appendChild(element('div', 'scanHost', t("这个网段暂未发现 22 端口开放设备")));
      return;
    }
    result.data.hosts.forEach((host) => {
      const row = element('button', 'scanHost', `${host}${t(" 选择")}`);
      row.type = 'button';
      row.addEventListener('click', () => {
        $('machineHost').value = host;
        if (!$('machineName').value) $('machineName').value = `${t("办公室 ")}${host.split('.').pop()}`;
        toast(t("已填入 SSH 地址"));
      });
      container.appendChild(row);
    });
  }

  async function saveMachine(event) {
    event.preventDefault();
    const payload = {
      id: Number($('machineId').value || 0),
      name: $('machineName').value.trim(),
      host: $('machineHost').value.trim(),
      username: $('machineUsername').value.trim(),
      port: Number($('machinePort').value || 22),
      authType: state.authType,
      password: $('machinePassword').value,
      privateKey: $('machineKey').value
    };
    const saved = await call('saveMachine', t("保存机器配置…"), JSON.stringify(payload));
    if (!saved.ok) return;
    closeSheet('machineBackdrop');
    await loadState();
    const probe = await call('probeMachine', `${t("正在连接 ")}${saved.data.machine.name}…`, saved.data.machine.id);
    if (probe.ok) toast(`${saved.data.machine.name}${t(" 已上线")}`);
    await loadState();
  }

  async function probeMachine(id) {
    await call('probeMachine', t("正在测试 SSH 连接…"), id);
    await loadState();
  }

  function discoverMachine(id) {
    if (state.backgroundDiscovers.has(id)) {
      toast(t("这间办公室正在发现员工，完成后会通知你"));
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(AgentBridge.beginDiscoverTasks(id));
    } catch (error) {
      parsed = { ok: false, error: t("无法提交发现员工任务") };
    }
    if (!parsed.ok) {
      toast(parsed.error || t("无法提交发现员工任务"));
      return;
    }
    const machine = state.machines.find(item => item.id === id);
    const operation = parsed.data.operation;
    state.backgroundDiscovers.set(id, {
      operation,
      machineName: machine ? machine.name : `${t("机器 ")}${id}`,
      message: t("正在发现员工…"),
      startedAt: operation.startedAt || Date.now()
    });
    renderOffices();
    renderBackgroundState();
    toast(t("发现员工已提交后台，完成后会通知你"));
    void pollBackgroundDiscover(id, operation);
  }

  async function pollBackgroundDiscover(machineId, startedOperation) {
    try {
      for (;;) {
        await sleep(1000);
        const entry = state.backgroundDiscovers.get(machineId);
        if (!entry || entry.operation.id !== startedOperation.id) return;
        let parsed;
        try {
          parsed = JSON.parse(AgentBridge.operationState(startedOperation.id));
        } catch (error) {
          parsed = { ok: false, error: t("无法读取发现员工状态") };
        }
        if (!parsed.ok) throw new Error(parsed.error || t("无法读取发现员工状态"));
        const operation = parsed.data.operation;
        entry.operation = operation;
        entry.message = operation.message || t("正在发现员工…");
        renderOffices();
        renderBackgroundState();
        if (operation.state === 'failed') throw new Error(operation.message || t("发现员工失败"));
        if (operation.state !== 'running') break;
      }
      await loadStateQuiet();
      const entry = state.backgroundDiscovers.get(machineId);
      const machineName = entry ? entry.machineName : `${t("机器 ")}${machineId}`;
      finishBackgroundDiscover(machineId, true, `${machineName}${t(" 已完成员工发现")}`);
    } catch (error) {
      const entry = state.backgroundDiscovers.get(machineId);
      const machineName = entry ? entry.machineName : `${t("机器 ")}${machineId}`;
      finishBackgroundDiscover(machineId, false, `${machineName}${t(" 发现失败：")}${error.message || String(error)}`);
    }
  }

  function finishBackgroundDiscover(machineId, succeeded, message) {
    const entry = state.backgroundDiscovers.get(machineId);
    const operation = entry ? entry.operation : null;
    state.backgroundDiscovers.delete(machineId);
    if (operation) {
      try { AgentBridge.clearOperation(operation.id); } catch (error) { /* already cleared */ }
    }
    addBackgroundNotice(succeeded ? 'success' : 'error', message);
    toast(message);
    render();
    renderBackgroundState();
  }

  async function loadStateQuiet() {
    let parsed;
    try {
      parsed = JSON.parse(AgentBridge.state());
    } catch (error) {
      parsed = { ok: false, error: t("读取本机数据失败") };
    }
    if (!parsed.ok) return false;
    const data = parsed.data;
    state.machines = data.machines || [];
    state.tasks = data.tasks || [];
    state.deletedTasks = data.deletedTasks || [];
    state.frpServer = data.frpServer || null;
    state.frpRelays = data.frpRelays || [];
    state.networkHint = data.networkHint || '';
    render();
    return true;
  }

  async function editMachine(id) {
    const machine = state.machines.find((item) => item.id === id);
    if (machine) openMachineSheet(machine);
  }

  async function resetHostKey(id) {
    const machine = state.machines.find((item) => item.id === id);
    if (!machine) return;
    if (!window.confirm(`${t("只有在你确认「")}${machine.name}${t("」重装过系统或换了机器时才重置。重置后下次连接会信任它当前的主机指纹。继续？")}`)) return;
    const result = await call('resetHostKey', t("重置主机指纹…"), id);
    if (!result.ok) return;
    await call('probeMachine', `${t("正在连接 ")}${machine.name}…`, id);
    await loadState();
  }

  async function deleteMachine(id) {
    const machine = state.machines.find((item) => item.id === id);
    if (!machine) return;
    if (!window.confirm(`${t("删除「")}${machine.name}${t("」和它的任务记录？")}`)) return;
    const deleted = await call('deleteMachine', t("删除办公室…"), id);
    if (deleted.ok) {
      state.tasks.filter(task => task.machineId === id).forEach(task => state.drafts.delete(task.id));
    }
    await loadState();
  }

  async function openTask(id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    state.currentTaskId = id;
    renderTaskDetail();
    $('replyText').value = state.drafts.get(id) || '';
    $('rawRecord').open = false;
    document.querySelector('.taskTools').open = false;
    openSheet('taskBackdrop');
    document.querySelector('.taskBody').scrollTop = 0;
  }

  function renderTaskDetail() {
    const task = currentTask();
    const background = task ? state.backgroundSends.get(task.id) : null;
    const tailing = task ? state.backgroundTails.get(task.id) : null;
    $('sendTask').disabled = !task || Boolean(background) || Boolean(tailing);
    $('sendTask').textContent = background ? t("处理中…") : t("发送 →");
    const receipt = task ? state.taskReceipts.get(task.id) : null;
    const delivery = $('taskDelivery');
    delivery.textContent = background ? background.message : receipt?.message || '';
    delivery.classList.toggle('hidden', !delivery.textContent);
    delivery.dataset.state = background ? 'pending' : receipt?.succeeded ? 'success' : 'error';
    $('tailTask').disabled = !task || Boolean(tailing);
    $('renameTask').disabled = !task;
    $('deleteTask').disabled = !task || Boolean(background) || Boolean(tailing);
    if (!task) {
      $('taskStatusLine').textContent = t("本次未发现此会话，以下为上次记录");
      $('taskNeed').classList.add('hidden');
      renderReplySuggestions(null);
      return;
    }
    $('taskAvatar').className = 'taskAvatarWrap';
    $('taskAvatar').replaceChildren(employeeSprite(task.agentType, Number(String(task.id).replace(/\D/g, '')) % 3));
    const resumable = task.controlMode === 'process' ? task.externalSessionId : task.paneId;
    $('sendTask').disabled = !resumable || Boolean(background) || Boolean(tailing);
    $('taskMeta').textContent = `${agentNames[task.agentType] || task.agentType} · ${task.controlMode === 'process' ? t("恢复会话") : 'tmux'} · ${background ? t("后台执行中") : tailing ? t("后台刷新中") : resumable ? t("可回复") : t("无会话 ID，暂不能回复")}`;
    $('taskTitle').textContent = task.title;
    const machine = state.machines.find((item) => item.id === task.machineId);
    $('taskStatusLine').textContent = [
      taskStatusText(task),
      machine ? `${machine.name} · ${machineCheckText(machine)}` : t("机器记录不存在"),
      task.workspacePath
    ].filter(Boolean).join(' · ');
    $('taskNeed').replaceChildren();
    if (task.requiredInput) {
      $('taskNeed').append(
        element('strong', 'taskNeedLabel', `${isRecordedTask(task) ? t("上次待确认") : t("需要你确认")}：`),
        element('span', 'taskNeedQuestion', task.requiredInput));
    }
    $('taskNeed').classList.toggle('hidden', !task.requiredInput);
    renderTaskStatusCard(task);
    $('taskStatusCard').classList.toggle('hidden', Boolean(task.requiredInput));
    renderConversationTimeline(task);
    const outputPre = $('taskOutput');
    outputPre.replaceChildren();
    appendRichOutput(outputPre, task.lastOutput || t("暂无输出"));
    renderReplySuggestions(task);
  }

  function replyContextKey(task) {
    return JSON.stringify(['id', 'machineId', 'title', 'status', 'requiredInput',
      'workSummary', 'lastOutput', 'updatedAt', 'externalSessionId', 'paneId']
      .map(key => String(task?.[key] ?? '')));
  }

  function renderReplySuggestions(task) {
    const button = $('generateReplySuggestions');
    const container = $('replySuggestionChoices');
    container.replaceChildren();
    const entry = task ? state.replySuggestions.get(task.id) : null;
    document.querySelector('.replySuggestions').dataset.expanded = entry ? 'true' : 'false';
    const busy = Boolean(task && (state.backgroundSends.has(task.id) || state.backgroundTails.has(task.id)));
    button.disabled = !task || Boolean(entry?.running) || busy;
    button.textContent = entry?.running ? t("正在写…") : entry?.result ? t("换一组") : t("帮我写回复");
    const status = $('replySuggestionStatus');
    if (!task) { status.textContent = t("找不到这条记录了，请重新选择员工。"); return; }
    if (entry?.running) { status.textContent = t("正在看这段对话，你可以先写。"); return; }
    if (entry && entry.key !== replyContextKey(task)) {
      status.textContent = t("记录更新了，请重新写一组。");
      return;
    }
    if (entry?.error) { status.textContent = entry.error; return; }
    if (!entry?.result) {
      status.textContent = state.studio?.model?.ready
        ? t("根据上次刷新的内容，帮你写几句。")
        : t("先配置模型，也可以自己写。");
      return;
    }
    const result = entry.result;
    status.textContent = `${result.summary}${t(" · AI 草稿，参考上次刷新记录。")}${result.decisionRequired ? t("怎么回，你来定。") : ''}`;
    result.choices.forEach(choice => {
      const pick = element('button', 'replySuggestionChoice');
      pick.type = 'button';
      pick.disabled = busy;
      pick.append(element('strong', '', choice.label), element('span', '', choice.text));
      pick.addEventListener('click', () => {
        const current = currentTask();
        if (!current || current.id !== task.id || replyContextKey(current) !== entry.key
            || state.backgroundSends.has(task.id) || state.backgroundTails.has(task.id)) {
          toast(t("记录变了，请重新写一组")); return;
        }
        const draft = $('replyText').value.trim();
        if (draft && draft !== choice.text.trim()) {
          toast(t("你已经写了内容，清空后再选")); return;
        }
        $('replyText').value = choice.text;
        state.drafts.set(task.id, choice.text);
        $('replyText').focus();
        toast(t("已填入，改好再发送"));
      });
      container.appendChild(pick);
    });
  }

  async function generateTaskReplySuggestions() {
    const task = currentTask();
    if (!task || state.replySuggestions.get(task.id)?.running
        || state.backgroundSends.has(task.id) || state.backgroundTails.has(task.id)) return;
    if (!state.studio?.model?.ready) {
      toast(t("先配置模型，再帮你写回复"));
      if (closeSheet('taskBackdrop')) openCloudSheet();
      return;
    }
    const entry = { key: replyContextKey(task), running: true };
    state.replySuggestions.set(task.id, entry);
    renderReplySuggestions(task);
    let operationId = null;
    try {
      const started = JSON.parse(AgentBridge.beginBridgeCall('generateReplySuggestions', JSON.stringify([task.id])));
      if (!started.ok) throw new Error(started.error || t("没能开始写回复，请再试一次"));
      operationId = started.data.operation.id;
      const deadline = Date.now() + 210000;
      let failures = 0;
      for (;;) {
        await sleep(300);
        let read;
        try { read = JSON.parse(AgentBridge.operationState(operationId)); }
        catch (error) { read = { ok: false }; }
        if (!read.ok) {
          if (++failures < 3 && Date.now() < deadline) continue;
          throw new Error(t("没读到回复建议，可以重试或自己写"));
        }
        failures = 0;
        const operation = read.data.operation;
        if (operation.state === 'running') {
          if (Date.now() >= deadline) throw new Error(t("等得有点久，可以重试或自己写"));
          continue;
        }
        if (operation.state !== 'succeeded' || !operation.result?.ok) {
          throw new Error(operation.result?.error || operation.message || t("没写出回复建议，可以重试"));
        }
        const result = operation.result.data;
        const latest = state.tasks.find(item => item.id === task.id);
        if (!latest || replyContextKey(result?.context) !== entry.key || replyContextKey(latest) !== entry.key) {
          throw new Error(t("记录更新了，请重新写一组"));
        }
        if (result.source !== 'model' || typeof result.summary !== 'string'
            || !Array.isArray(result.choices) || result.choices.length < 2 || result.choices.length > 3
            || result.choices.some(choice => typeof choice.label !== 'string' || !choice.label.trim()
              || typeof choice.text !== 'string' || !choice.text.trim() || choice.text.length > 600)) {
          throw new Error(t("没写出合适的建议，可以重试或自己写"));
        }
        entry.result = result;
        break;
      }
    } catch (error) {
      entry.error = error.message || t("没写出回复建议，可以自己写");
    } finally {
      entry.running = false;
      if (operationId !== null) {
        try { AgentBridge.clearOperation(operationId); } catch (error) { /* Drafting has no remote side effects. */ }
      }
      if (state.currentTaskId === task.id) renderReplySuggestions(currentTask());
    }
  }

  function uiIcon(name) {
    const paths = {
      user: 'M20 21v-2a7 7 0 0 0-14 0v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
      terminal: 'M4 5h16v14H4z M7 9l3 3-3 3 M13 15h4',
      attention: 'M12 3 2 21h20L12 3z M12 9v5 M12 17h.01',
      running: 'M8 5v14l12-7L8 5z',
      idle: 'M8 5v14 M16 5v14',
      arrow: 'M5 12h14 M13 6l6 6-6 6',
      other: 'M12 8v4 M12 16h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'uiIcon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name] || paths.other);
    svg.appendChild(path);
    return svg;
  }

  function renderTaskStatusCard(task) {
    const card = $('taskStatusCard');
    card.replaceChildren();
    const statusMap = {
      running: { label: t("执行中"), tone: 'running', icon: '▶', desc: t("正在工作，查看最新输出了解进展") },
      idle: { label: t("空闲"), tone: 'idle', icon: '⏸', desc: task.requiredInput ? t("在等你的回复") : t("已完成或暂停，需要人工核实") },
      error: { label: t("会话异常"), tone: 'attention', icon: '!', desc: t("查看错误详情后再重试") },
    };
    const info = statusMap[task.status] || { label: task.status || t("未知"), tone: 'other', icon: '•', desc: '' };
    if (task.requiredInput) {
      info.label = t("待输入");
      info.tone = 'attention';
      info.icon = '✋';
      info.desc = t("需要你回复才能继续");
    }
    card.dataset.tone = info.tone;
    const iconSpan = element('span', 'tscIcon');
    iconSpan.appendChild(uiIcon(info.tone));
    const labelSpan = element('strong', 'tscLabel', info.label);
    const descSpan = element('span', 'tscDesc', info.desc);
    card.append(iconSpan, labelSpan, descSpan);
  }

  function appendRichOutput(container, text) {
    const str = String(text || '');
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    while ((match = codeBlockRegex.exec(str)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(str.slice(lastIndex, match.index)));
      }
      const pre = document.createElement('pre');
      pre.className = 'codeBlock';
      const header = element('span', 'codeLang', match[1] || 'text');
      pre.appendChild(header);
      pre.appendChild(document.createTextNode(match[2]));
      container.appendChild(pre);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < str.length) {
      container.appendChild(document.createTextNode(str.slice(lastIndex)));
    }
    if (!container.childNodes.length) container.textContent = str;
  }

  function renderConversationTimeline(task) {
    const container = $('conversationTimeline');
    container.replaceChildren();
    const turns = conversationTurns(task).filter(turn => !(task.requiredInput
      && turn.title === t("等待确认") && turn.text === cleanConversationText(task.requiredInput)));
    const background = state.backgroundSends.get(task.id);
    const receipt = state.taskReceipts.get(task.id);
    const pending = background || (receipt?.succeeded && !receipt.hasReply && receipt.output === String(task.lastOutput || '') ? receipt : null);
    if (pending) turns.push({ role: 'user', title: t("我"), label: t("本次消息"), text: pending.prompt });
    container.classList.toggle('hidden', !turns.length && Boolean(task.requiredInput));
    if (container.classList.contains('hidden')) return;
    const header = element('div', 'conversationHeader');
    header.appendChild(element('strong', '', turns.length > 1 ? t("最近问答") : t("最新记录")));
    header.appendChild(element('small', '', isRecordedTask(task) ? t("上次同步记录") : t("来自当前会话")));
    container.appendChild(header);

    if (!turns.length) {
      const empty = element('div', 'conversationEmpty');
      empty.appendChild(element('strong', '', t("还没有可读的问答")));
      empty.appendChild(element('span', '', t("可以先发送一条指令，或点击“刷新输出”。")));
      container.appendChild(empty);
      return;
    }

    turns.forEach((turn) => {
      const row = element('article', `conversationTurn ${turn.role}`);
      const meta = element('div', 'conversationMeta');
      const avatar = element('span', `turnAvatar ${turn.role}`);
      avatar.appendChild(uiIcon(turn.role === 'user' ? 'user' : 'terminal'));
      meta.appendChild(avatar);
      const metaText = element('div', 'turnMetaText');
      metaText.appendChild(element('strong', '', turn.title));
      metaText.appendChild(element('span', '', turn.label));
      meta.appendChild(metaText);
      const body = element('div', 'conversationBody');
      appendFormattedConversationText(body, turn.text);
      row.appendChild(meta);
      row.appendChild(body);
      if (turn.footer) row.appendChild(element('small', 'conversationFooter', turn.footer));
      container.appendChild(row);
    });
    if (pending) {
      const waiting = element('p', 'taskReplyPending', pending.message || t("后台执行中…"));
      container.appendChild(waiting);
    }
  }

  function conversationTurns(task) {
    const summary = readableSessionOutput(task.workSummary);
    const output = readableSessionOutput(task.lastOutput);
    const receipt = state.taskReceipts.get(task.id);
    const hasReply = receipt?.succeeded && receipt.hasReply && receipt.output === String(task.lastOutput || '');
    const user = (hasReply ? receipt.prompt : '')
      || conversationLabeled(output, ['最近指令', '最近用户', '最近提问'])
      || conversationLabeled(summary, ['最近指令', '最近用户', '最近提问']);
    const assistant = conversationLabeled(output, ['本次输出', 'Latest output'])
      || conversationLabeled(output, ['最近输出', '最近回复', '最近结果'])
      || conversationLabeled(summary, ['最近输出', '最近回复', '最近结果'])
      || (hasReply ? output : '');
    const turns = [];
    if (user) {
      turns.push({
        role: 'user',
        title: t("我"),
        label: t("最近指令"),
        text: user,
        footer: ''
      });
    }
    if (assistant) {
      turns.push({
        role: 'assistant',
        title: agentNames[task.agentType] || t("员工"),
        label: task.status === 'error' ? t("会话错误") : task.status === 'running' ? t("最新进展") : t("最近回复"),
        text: assistant,
        footer: task.status === 'running' ? t("会话仍在执行，内容可能继续变化") : ''
      });
    }
    if (!turns.length && output) {
      turns.push({
        role: 'system',
        title: t("会话记录"),
        label: t("技术输出"),
        text: output,
        footer: t("已保留原始格式")
      });
    }
    if (!turns.length && task.requiredInput) {
      turns.push({
        role: 'assistant',
        title: t("等待确认"),
        label: t("需要你处理"),
        text: task.requiredInput,
        footer: ''
      });
    }
    return turns.map(turn => ({ ...turn, text: cleanConversationText(turn.text) })).filter(turn => turn.text);
  }

  function readableSessionOutput(value) {
    const text = String(value || '');
    // This four-line envelope is generated by our Codex Desktop adapter.
    // Keep it in the raw record, rather than presenting paths/IDs as an employee reply.
    const body = text.replace(/^Codex 线程：[^\n]+\n状态：[^\n]+\n来源：[^\n]+\n记录：[^\n]+(?:\n|$)/u, '').trim();
    if (/^Codex 线程：[^\n]*$/u.test(body)
      || body === '已发现 Codex Desktop 线程，暂未读取到文本记录。') return '';
    return body;
  }

  function conversationLabeled(source, labels) {
    const text = String(source || '');
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`${escaped}${t("\\s*[:：]\\s*([\\s\\S]*?)(?=\\n(?:最近指令|最近用户|最近提问|最近输出|最近回复|最近结果|本次输出|Latest output)\\s*[:：]|$)")}`, 'u').exec(text);
      if (match?.[1]?.trim()) return match[1].trim();
    }
    return '';
  }

  function cleanConversationText(value) {
    return String(value || '')
      .replace(/\r\n?/gu, '\n')
      .replace(/\[Image:[^\]]*\]/giu, '［图片］')
      .replace(/\[Audio:[^\]]*\]/giu, '［音频］')
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, '［图片］')
      .replace(/<command-name>[\s\S]*?<\/command-name>/giu, '')
      .replace(/<command-args>[\s\S]*?<\/command-args>/giu, '')
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/giu, '')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  }

  function appendFormattedConversationText(container, value) {
    container.appendChild(renderButlerText(value));
    if (!container.childElementCount) container.appendChild(element('span', '', t("（空内容）")));
  }

  async function renameCurrentTask() {
    const value = window.prompt(t("新的任务名称"), currentTask() ? currentTask().title : '');
    if (!value || !state.currentTaskId) return;
    const result = await call('renameTask', t("修改员工名牌…"), state.currentTaskId, value);
    if (result.ok) {
      $('taskTitle').textContent = result.data.task.title;
      await loadState();
    }
  }

  async function deleteCurrentTask() {
    const task = currentTask();
    if (!task) return;
    if (state.backgroundSends.has(task.id) || state.backgroundTails.has(task.id)) {
      toast(t("这个员工还有后台任务，完成后再删除"));
      return;
    }
    const name = taskDisplayName(task);
    if (!window.confirm(`${t("把「")}${name}${t("」移到已删除列表？\n\n不会删除机器上的项目、会话记录或文件。")}`)) return;
    const result = await call('deleteTask', t("移出办公室…"), task.id);
    if (!result.ok) return;
    state.drafts.delete(task.id);
    showDeletedOffices.add(task.machineId);
    closeSheet('taskBackdrop');
    await loadState();
    toast(t("已移到删除列表"));
  }

  function refreshCurrentTask() {
    const task = currentTask();
    if (!task) return;
    if (state.backgroundTails.has(task.id)) {
      toast(t("这个任务输出正在后台刷新，完成后会通知你"));
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(AgentBridge.beginTailTask(task.id));
    } catch (error) {
      parsed = { ok: false, error: t("无法提交后台刷新") };
    }
    if (!parsed.ok) {
      toast(parsed.error || t("无法提交后台刷新"));
      return;
    }
    const operation = parsed.data.operation;
    state.backgroundTails.set(task.id, {
      operation,
      machineId: task.machineId,
      stableKey: task.stableKey || operation.stableKey || '',
      taskName: compactTaskTitle(task),
      message: t("正在刷新任务输出…"),
      startedAt: operation.startedAt || Date.now()
    });
    renderTaskDetail();
    renderBackgroundState();
    toast(t("刷新输出已提交后台，完成后会通知你"));
    void pollBackgroundTail(task.id, operation);
  }

  async function pollBackgroundTail(taskId, startedOperation) {
    try {
      for (;;) {
        await sleep(1000);
        const entry = state.backgroundTails.get(taskId);
        if (!entry || entry.operation.id !== startedOperation.id) return;
        let parsed;
        try {
          parsed = JSON.parse(AgentBridge.operationState(startedOperation.id));
        } catch (error) {
          parsed = { ok: false, error: t("无法读取后台刷新状态") };
        }
        if (!parsed.ok) throw new Error(parsed.error || t("无法读取后台刷新状态"));
        const operation = parsed.data.operation;
        entry.operation = operation;
        entry.message = operation.message || t("正在刷新任务输出…");
        renderTaskDetail();
        renderBackgroundState();
        if (operation.state === 'failed') throw new Error(operation.message || t("刷新任务输出失败"));
        if (operation.state !== 'running') break;
      }
      const entry = state.backgroundTails.get(taskId);
      const stableKey = entry ? entry.stableKey : '';
      const machineId = entry ? entry.machineId : 0;
      await loadStateQuiet();
      let nextTask = state.tasks.find(item => item.id === taskId);
      if (!nextTask && stableKey) {
        nextTask = state.tasks.find(item => item.machineId === machineId && item.stableKey === stableKey);
      }
      if (nextTask && nextTask.id !== taskId) {
        if (state.currentTaskId === taskId) state.currentTaskId = nextTask.id;
        if (state.drafts.has(taskId)) {
          state.drafts.set(nextTask.id, state.drafts.get(taskId));
          state.drafts.delete(taskId);
        }
      }
      const title = nextTask ? compactTaskTitle(nextTask) : (entry ? entry.taskName : `${t("任务 ")}${taskId}`);
      finishBackgroundTail(taskId, true, `${title}${t(" 输出已刷新")}`);
    } catch (error) {
      const entry = state.backgroundTails.get(taskId);
      const title = entry ? entry.taskName : `${t("任务 ")}${taskId}`;
      finishBackgroundTail(taskId, false, `${title}${t(" 刷新失败：")}${error.message || String(error)}`);
    }
  }

  function finishBackgroundTail(taskId, succeeded, message) {
    const entry = state.backgroundTails.get(taskId);
    const operation = entry ? entry.operation : null;
    state.backgroundTails.delete(taskId);
    if (operation) {
      try { AgentBridge.clearOperation(operation.id); } catch (error) { /* already cleared */ }
    }
    addBackgroundNotice(succeeded ? 'success' : 'error', message);
    toast(message);
    renderTaskDetail();
    renderBackgroundState();
  }

  async function sendCurrentTask() {
    if (!state.currentTaskId || !currentTask()) return;
    const task = currentTask();
    if (state.backgroundSends.has(task.id)) {
      toast(t("这个任务已在后台执行，完成后会通知你"));
      return;
    }
    const value = $('replyText').value.trim();
    if (!value) {
      toast(t("先输入要发送回会话的内容"));
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(AgentBridge.beginSendPrompt(task.id, value, 'android'));
    } catch (error) {
      parsed = { ok: false, error: t("无法提交后台任务") };
    }
    if (!parsed.ok) {
      const message = parsed.error || t("无法提交后台任务");
      state.drafts.set(task.id, value);
      state.taskReceipts.set(task.id, { succeeded: false, message });
      renderTaskDetail();
      toast(message);
      return;
    }

    const operation = parsed.data.operation;
    state.taskReceipts.delete(task.id);
    state.backgroundSends.set(task.id, {
      operation,
      message: t("已提交，正在检查网络…"),
      network: null,
      prompt: value,
      startedAt: operation.startedAt || Date.now()
    });
    // Submission is accepted. Keep the draft empty to avoid an accidental duplicate.
    state.drafts.set(task.id, '');
    state.replySuggestions.delete(task.id);
    if (state.currentTaskId === task.id) $('replyText').value = '';
    renderTaskDetail();
    renderBackgroundState();
    toast(t("消息已提交，发送结果会通知你"));
    void pollBackgroundSend(task.id, operation);
  }

  async function pollBackgroundSend(taskId, startedOperation) {
    try {
      for (;;) {
        await sleep(1000);
        const currentEntry = state.backgroundSends.get(taskId);
        if (!currentEntry || currentEntry.operation.id !== startedOperation.id) return;

        let parsed;
        try {
          parsed = JSON.parse(AgentBridge.operationState(startedOperation.id));
        } catch (error) {
          parsed = { ok: false, error: t("无法读取后台任务状态") };
        }
        if (!parsed.ok) throw new Error(parsed.error || t("无法读取后台任务状态"));

        const operation = parsed.data.operation;
        currentEntry.operation = operation;
        currentEntry.message = operation.message || t("后台执行中…");
        currentEntry.network = operation.network || null;
        if (state.currentTaskId === taskId) renderTaskDetail();
        renderBackgroundState();
        if (operation.state === 'failed') throw new Error(operation.message || t("任务执行失败"));
        if (operation.state !== 'running') break;
      }

      const entry = state.backgroundSends.get(taskId);
      const operation = entry ? entry.operation : startedOperation;
      const updatedTask = operation.task;
      if (updatedTask && updatedTask.id === taskId) {
        const index = state.tasks.findIndex(item => item.id === taskId);
        if (index >= 0) state.tasks[index] = updatedTask;
      }
      finishBackgroundSend(taskId, true, operation.stillRunning
        ? `${updatedTask ? compactTaskTitle(updatedTask) + '：' : ''}${operation.message || t("回复已送达，远程仍在处理")}`
        : updatedTask ? `${t("消息已发送：")}${compactTaskTitle(updatedTask)}` : t("消息已发送"));
    } catch (error) {
      finishBackgroundSend(taskId, false, error.message || String(error));
    }
  }

  function finishBackgroundSend(taskId, succeeded, message) {
    const entry = state.backgroundSends.get(taskId);
    const operation = entry ? entry.operation : null;
    state.backgroundSends.delete(taskId);
    if (entry) {
      const task = state.tasks.find(item => item.id === taskId);
      state.taskReceipts.set(taskId, { succeeded, message, prompt: entry.prompt, output: String(task?.lastOutput || ''), hasReply: Boolean(operation?.task && !operation.stillRunning) });
    }
    if (operation) {
      try { AgentBridge.clearOperation(operation.id); } catch (error) { /* already cleared */ }
    }
    if (!succeeded && entry && entry.prompt) {
      state.drafts.set(taskId, entry.prompt);
      if (state.currentTaskId === taskId) $('replyText').value = entry.prompt;
    }
    addBackgroundNotice(succeeded ? 'success' : 'error', message);
    toast(message);
    if (navigator.vibrate) {
      try { navigator.vibrate(succeeded ? [80, 60, 80] : [160, 80, 160]); } catch (error) { /* optional */ }
    }
    render();
    renderBackgroundState();
    if (succeeded && state.currentTaskId === taskId && !$('taskBackdrop').classList.contains('hidden')) {
      requestAnimationFrame(() => {
        const latest = $('conversationTimeline').querySelector('.conversationTurn.assistant:last-child');
        (latest || $('conversationTimeline')).scrollIntoView({ block: 'start' });
      });
    }
  }

  function addBackgroundNotice(kind, message) {
    const time = new Date();
    state.backgroundNotices.unshift({
      kind,
      message,
      time: `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
    });
    state.backgroundNotices = state.backgroundNotices.slice(0, 20);
  }

  function showBackgroundJobs() {
    const running = [
      ...[...state.backgroundSends.entries()].map(([taskId, entry]) => {
        const task = state.tasks.find(item => item.id === taskId);
        return `${entry.message}\n${task ? compactTaskTitle(task) : `${t("任务 ")}${taskId}`}`;
      }),
      ...[...state.backgroundDiscovers.values()].map(entry => `${entry.message}\n${entry.machineName}`),
      ...[...state.backgroundTails.values()].map(entry => `${entry.message}\n${entry.taskName}`),
      ...[...state.backgroundReports.entries()].map(([date, entry]) => `${entry.message}\n${date}`)
    ];
    const notices = state.backgroundNotices.map(item => `${item.time} ${item.kind === 'success' ? '✅' : '❌'} ${item.message}`);
    if (!running.length && !notices.length) {
      toast(t("当前没有后台任务"));
      return;
    }
    window.alert([...running, ...notices].join('\n\n'));
    state.backgroundNotices = [];
    renderBackgroundState();
  }

  function compactTaskTitle(task) {
    return String(task.title || task.workSummary || `${t("任务 ")}${task.id}`).slice(0, 48);
  }

  function renderBackgroundState() {
    const button = $('backgroundState');
    const running = state.backgroundSends.size + state.backgroundDiscovers.size + state.backgroundTails.size + state.backgroundReports.size;
    button.textContent = running ? `${t("后台 ")}${running}` : state.backgroundNotices.length ? `${t("通知 ")}${state.backgroundNotices.length}` : t("后台");
    button.classList.toggle('connected', running > 0 || state.backgroundNotices.length > 0);
  }

  function currentTask() {
    return state.tasks.find((item) => item.id === state.currentTaskId);
  }

  function openMachineSheet(machine) {
    $('machineSheetTitle').textContent = machine ? `${t("编辑 ")}${machine.name}` : t("添加 SSH 机器");
    $('machineId').value = machine ? machine.id : '';
    $('machineName').value = machine ? machine.name : '';
    $('machineHost').value = machine ? machine.host : '';
    $('machineUsername').value = machine ? machine.username : '';
    $('machinePort').value = machine ? machine.port : 22;
    // Saved credentials never reach the page; an empty field keeps them.
    $('machinePassword').value = '';
    $('machineKey').value = '';
    $('machinePassword').placeholder = machine && machine.hasPassword ? t("已保存，留空则不修改") : '';
    $('machineKey').placeholder = machine && machine.hasPrivateKey
      ? t("已保存，留空则不修改") : '-----BEGIN OPENSSH PRIVATE KEY-----';
    state.authType = machine && machine.authType === 'key' ? 'key' : 'password';
    document.querySelectorAll('[data-auth]').forEach((item) => item.classList.toggle('active', item.dataset.auth === state.authType));
    $('passwordLabel').classList.toggle('hidden', state.authType !== 'password');
    $('keyLabel').classList.toggle('hidden', state.authType !== 'key');
    $('scanResult').textContent = '';
    openSheet('machineBackdrop');
  }

  function openFrpSheet() {
    const server = state.frpServer;
    const machine = server ? state.machines.find((item) => item.id === server.machineId) : null;
    $('frpMachineId').value = machine ? machine.id : '';
    $('frpName').value = machine ? machine.name : t("云端入口");
    $('frpHost').value = machine ? machine.host : '';
    $('frpUsername').value = machine ? machine.username : '';
    $('frpPort').value = machine ? machine.port : 22;
    $('frpPassword').value = '';
    $('frpKey').value = '';
    $('frpPassword').placeholder = machine && machine.hasPassword ? t("已保存，留空则不修改") : '';
    $('frpKey').placeholder = machine && machine.hasPrivateKey
      ? t("已保存，留空则不修改") : '-----BEGIN OPENSSH PRIVATE KEY-----';
    state.frpAuthType = machine && machine.authType === 'key' ? 'key' : 'password';
    document.querySelectorAll('[data-frp-auth]').forEach((item) => item.classList.toggle('active', item.dataset.frpAuth === state.frpAuthType));
    $('frpPasswordLabel').classList.toggle('hidden', state.frpAuthType !== 'password');
    $('frpKeyLabel').classList.toggle('hidden', state.frpAuthType !== 'key');
    $('frpAdvanced').open = state.frpAuthType === 'key';
    $('frpPublicAddress').value = server ? server.publicAddress : '';
    $('frpBindPort').value = server ? server.bindPort : 7001;
    $('frpVersion').value = server ? server.version : '0.61.1';
    $('frpDownloadBase').value = server ? server.downloadBase : 'https://github.com/fatedier/frp/releases/download';
    $('frpExistingToken').value = '';
    openSheet('frpBackdrop');
  }

  async function saveFrpServer(event) {
    event.preventDefault();
    const payload = {
      machineId: Number($('frpMachineId').value || 0),
      host: $('frpHost').value.trim(),
      username: $('frpUsername').value.trim(),
      port: Number($('frpPort').value || 22),
      authType: state.frpAuthType,
      password: $('frpPassword').value,
      privateKey: $('frpKey').value,
      name: $('frpName').value.trim() || t("云端入口"),
      publicAddress: $('frpPublicAddress').value.trim() || $('frpHost').value.trim(),
      bindPort: Number($('frpBindPort').value || 7001),
      version: $('frpVersion').value.trim(),
      downloadBase: $('frpDownloadBase').value.trim(),
      existingToken: $('frpExistingToken').value
    };
    const result = await call('saveFrpServer', t("保存公网入口…"), JSON.stringify(payload));
    if (!result.ok) return;
    closeSheet('frpBackdrop');
    await loadState();
    const deployed = await call('deployFrpServer', t("正在自动部署公网入口…"));
    await loadState();
    toast(deployed.ok ? frpDeploymentToast(deployed.data.frpServer) : t("入口已保存，请查看部署错误"));
  }

  async function deployFrpServer() {
    const result = await call('deployFrpServer', t("自动部署公网 FRP 服务端…"));
    await loadState();
    if (result.ok) toast(frpDeploymentToast(result.data.frpServer));
  }

  function frpDeploymentToast(server) {
    if (server && server.deployment === 'adopted-existing') return t("已复用服务器上的 FRP，请继续开通机器");
    if (server && server.deployment === 'reused') return t("agentBridge FRP 已复用，请继续开通机器");
    return t("入口服务已启动，请继续开通机器");
  }

  function frpDeploymentText(server) {
    if (!server || !server.deployment) return '';
    if (server.deployment === 'adopted-existing') return t(" · 复用已有 FRP");
    if (server.deployment === 'reused') return t(" · 复用 agentBridge FRP");
    return '';
  }

  async function deployPublicRelay(machineId) {
    const result = await call('deployFrpRelay', t("安装安全中转客户端…"), machineId);
    await loadState();
    if (result.ok) toast(t("公网中转 SSH 验证通过"));
  }

  async function disablePublicRelay(machineId) {
    if (!window.confirm(t("关闭这台机器的公网访问？关闭后出门时将不能远程操作它。"))) return;
    const result = await call('disableFrpRelay', t("关闭安全中转…"), machineId);
    await loadState();
    if (result.ok) toast(t("公网访问已关闭"));
  }

  async function setPublicMode(machineId, mode) {
    const result = await call('setMachinePublicMode', t("切换公网模式…"), machineId, mode);
    await loadState();
    if (result.ok) toast(t("公网模式已更新"));
  }

  function renderPublic() {
    const container = $('public');
    container.textContent = '';
    const server = state.frpServer;
    const serverMachine = server ? state.machines.find((item) => item.id === server.machineId) : null;

    const entry = element('article', 'publicCard');
    const header = element('header', 'publicHeader');
    header.appendChild(element('p', 'eyebrow', 'SECURE PUBLIC ENTRY'));
    header.appendChild(element('h2', '', server ? server.publicAddress : t("三步开通远程访问")));
    header.appendChild(element('p', 'publicMeta', server
      ? `SSH ${serverMachine ? serverMachine.username + '@' + serverMachine.host + ':' + serverMachine.port : t("未配置")} · FRP ${server.bindPort} · ${frpStatusText(server.status)}${frpDeploymentText(server)}`
      : t("填公网服务器、用户名、密码；优先复用已有 FRP，没有则自动部署；再给需要出门的机器一键开通。")));
    if (server && server.lastError) header.appendChild(element('p', 'deploymentError', server.lastError));
    const actions = element('div', 'officeActions');
    actions.appendChild(actionButton(server ? t("快速配置") : t("开始配置"), openFrpSheet, server ? '' : 'dark'));
    if (server) actions.appendChild(actionButton(server.deployment === 'adopted-existing' ? t("重新检查") : t("重新部署"), deployFrpServer));
    header.appendChild(actions);
    entry.appendChild(header);

    const body = element('div', 'publicBody');
    body.appendChild(element('p', 'securityNote', t("安全默认：只暴露公网入口的 SSH 和 FRP 端口；目标机器不直接暴露 SSH，出门访问走 SSH + FRP STCP 加密隧道。")));
    if (!server) {
      const steps = element('div', 'officeEmpty');
      steps.textContent = t("1. 添加一台公网 Linux 机器 → 2. 自动部署入口 → 3. 给办公室一键开通远程访问");
      body.appendChild(steps);
    } else {
      const candidates = state.machines.filter((item) => item.id !== server.machineId);
      if (!candidates.length) {
        body.appendChild(element('div', 'officeEmpty', t("还没有可配置远程访问的私有机器。")));
      } else {
        candidates.forEach((machine) => {
          const relay = state.frpRelays.find((item) => item.machineId === machine.id);
          const enabled = server.status === 'online' && relay && relay.enabled && relay.status === 'online';
          const card = element('div', 'publicMachine');
          const title = element('div', 'publicMachineTitle');
          title.appendChild(element('strong', '', machine.name));
          title.appendChild(element('span', `stateChip ${enabled ? 'running' : 'idle'}`,
            server.status !== 'online' ? t("入口未就绪") : relay ? frpStatusText(relay.status) : t("未开通")));
          card.appendChild(title);
          card.appendChild(element('small', '', `${machine.username}@${machine.host}:${machine.port} · ${enabled
            ? relay.verifiedAt ? `${t("上次验证 ")}${checkTime(relay.verifiedAt)}` : t("旧配置，请重新验证")
            : t("尚未验证公网连接")}`));
          const error = machine.publicAccessError || (relay && relay.lastError);
          if (error) card.appendChild(element('p', 'deploymentError', error));
          const row = element('div', 'officeActions');
          const deploy = actionButton(server.status !== 'online' ? t("先部署公网入口") : enabled ? t("重新配置") : t("一键开通远程访问"),
            () => deployPublicRelay(machine.id), 'dark');
          deploy.disabled = server.status !== 'online';
          row.appendChild(deploy);
          if (relay && relay.enabled) row.appendChild(actionButton(t("关闭远程"), () => disablePublicRelay(machine.id), 'warn'));
          card.appendChild(row);

          const advanced = element('details', 'advancedDetails');
          const summary = element('summary', '', t("连接模式"));
          advanced.appendChild(summary);
          const advancedBody = element('div', 'advancedBody');
          const modes = element('div', 'modeRow');
          [['off', t("不上公网")], ['auto', t("自动")], ['public', t("仅公网")]].forEach(([mode, label]) => {
            modes.appendChild(actionButton(label, () => setPublicMode(machine.id, mode),
              (machine.publicMode || 'off') === mode ? 'dark' : ''));
          });
          advancedBody.appendChild(modes);
          advancedBody.appendChild(element('p', 'formNote', t("自动：同 Wi-Fi 直连，出门走公网。仅公网：永远走公网入口。不上公网：关闭远程访问优先级。")));
          advanced.appendChild(advancedBody);
          card.appendChild(advanced);
          body.appendChild(card);
        });
      }
    }
    entry.appendChild(body);
    container.appendChild(entry);
  }

  function frpStatusText(status) {
    if (status === 'online') return t("在线");
    if (status === 'deploying') return t("部署中");
    if (status === 'error') return t("错误");
    if (status === 'disabled') return t("已关闭");
    return t("未部署");
  }

  function publicModeText(mode) {
    if (mode === 'auto') return t("自动");
    if (mode === 'public') return t("仅公网");
    return t("不上公网");
  }

  function render() {
    document.body.dataset.view = state.view;
    $('butlerChatDock').classList.toggle('hidden', state.view !== 'butler');
    $('butler').classList.toggle('hidden', state.view !== 'butler');
    $('offices').classList.toggle('hidden', state.view !== 'offices');
    $('todo').classList.toggle('hidden', state.view !== 'todo');
    $('public').classList.toggle('hidden', state.view !== 'public');
    $('taskCount').textContent = `${state.tasks.length}${t(" 位员工")}`;
    const attention = state.tasks.filter((task) => task.requiredInput).length;
    $('attentionCount').textContent = `${attention}${t(" 个待输入")}`;
    $('attentionCount').disabled = attention === 0;
    $('todoTab').textContent = attention ? `${t("待输入 · ")}${attention}` : t("待输入");
    $('networkLine').textContent = state.networkHint
      ? `${state.machines.length}${t(" 间办公室 · 手动刷新检查状态")}`
      : `${state.machines.length}${t(" 间办公室 · 未识别 Wi-Fi，可手动添加")}`;
    renderOffices();
    renderTodo();
    renderPublic();
    renderCloudState();
    renderBackgroundState();
    if (state.view === 'butler') renderPiDetail();
    if (!$('taskBackdrop').classList.contains('hidden')) renderTaskDetail();
  }

  function renderOffices() {
    const container = $('offices');
    container.textContent = '';
    const butler = element('button', 'townButler');
    butler.type = 'button';
    const avatar = element('span', 'townButlerAvatar');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.appendChild(employeeSprite('pi', 2));
    const advice = element('span', 'townButlerText');
    advice.appendChild(element('strong', '', t("找管家聊聊")));
    advice.appendChild(element('span', '', t("问进度，找待回复的任务")));
    butler.append(avatar, advice, uiIcon('arrow'));
    butler.addEventListener('click', () => {
      selectView('butler');
      $('piInput').focus({ preventScroll: true });
    });
    container.appendChild(butler);
    if (!state.machines.length) {
      const empty = element('div', 'empty');
      empty.innerHTML = t("<div class=\"emptyAvatar\"></div><h3>小镇还空着</h3><p>添加一台支持 SSH 的 Mac / Linux，<br>手机会直接去那里找 Claude 和 Codex 员工。</p>");
      container.appendChild(empty);
      return;
    }

    state.machines.forEach((machine) => {
      const office = element('article', 'office');
      const header = element('header', 'officeHeader');
      const title = element('div', 'officeTitle');
      title.appendChild(element('h2', '', machine.name));
      const titleMeta = element('p', 'officeMeta');
      titleMeta.appendChild(element('span', '', machineSubtitle(machine)));
      titleMeta.appendChild(element(
        'span',
        `officeStatus ${machine.lastStatus === 'online' ? 'online' : machine.lastStatus === 'offline' ? 'offline' : ''}`,
        machine.lastStatus === 'online' ? t("在线") : machine.lastStatus === 'offline' ? t("离线") : t("未检查"),
      ));
      const tools = machineToolsLabel(machine);
      if (tools) titleMeta.appendChild(element('span', 'officeTools', tools));
      title.appendChild(titleMeta);
      title.appendChild(element('p', `officeCheck${machine.lastStatus === 'offline' ? ' failed' : ''}`, machineCheckText(machine)));
      const actions = element('div', 'officeActions');
      const deletedTasks = state.deletedTasks.filter(task => task.machineId === machine.id);
      if (String(machine.lastError || '').includes('主机指纹')) {
        actions.appendChild(actionButton(t("重置主机指纹"), () => resetHostKey(machine.id), 'warn'));
      }
      actions.appendChild(actionButton(t("测试"), () => probeMachine(machine.id), 'advancedAction'));
      const discovering = state.backgroundDiscovers.has(machine.id);
      actions.appendChild(actionButton(discovering ? t("发现中") : t("找任务"), discovering ? () => toast(t("这间办公室正在发现员工")) : () => discoverMachine(machine.id), 'dark'));
      actions.appendChild(actionButton(isCollapsed(machine.id) ? t("展开") : t("收起"), () => toggleSprites(machine.id), 'spriteToggle advancedAction'));
      if (deletedTasks.length) {
        actions.appendChild(actionButton(
          showDeletedOffices.has(machine.id) ? t("收起删除") : `${t("删除 ")}${deletedTasks.length}`,
          () => toggleDeletedOffice(machine.id),
          'deletedToggle advancedAction',
        ));
      }
      actions.appendChild(actionButton(t("编辑"), () => editMachine(machine.id), 'advancedAction'));
      actions.appendChild(actionButton(t("删除"), () => deleteMachine(machine.id), 'warn advancedAction'));
      const more = actionButton(t("更多"), () => {
        more.setAttribute('aria-expanded', String(office.classList.toggle('showAdvanced')));
      });
      more.setAttribute('aria-expanded', 'false');
      actions.appendChild(more);
      header.appendChild(title);
      header.appendChild(actions);
      office.appendChild(header);

      const tasks = prioritizeTasks(state.tasks.filter((task) => task.machineId === machine.id));
      if (isCollapsed(machine.id)) {
        const attention = tasks.filter((task) => task.requiredInput).length;
        office.appendChild(element(
          'div',
          'officeCollapsedSummary',
          tasks.length
            ? `${tasks.length}${t(" 位员工已收起")}${attention ? ` · ${attention}${t(" 个待输入")}` : ''}`
            : t("员工列表已收起"),
        ));
      } else {
        const employees = element('div', 'employees');
        if (!tasks.length) {
          employees.appendChild(element('div', 'officeEmpty', t("这间办公室还没有发现员工，点击“找任务”试试。")));
        } else {
          tasks.forEach((task) => employees.appendChild(employeeCard(task)));
        }
        office.appendChild(employees);
      }
      if (showDeletedOffices.has(machine.id)) appendDeletedEmployees(office, deletedTasks);
      container.appendChild(office);
    });
  }

  function toggleDeletedOffice(machineId) {
    if (showDeletedOffices.has(machineId)) showDeletedOffices.delete(machineId);
    else showDeletedOffices.add(machineId);
    render();
  }

  function appendDeletedEmployees(office, tasks) {
    const section = element('section', 'deletedEmployees');
    const header = element('header');
    header.appendChild(element('strong', '', t("删除列表")));
    header.appendChild(element('small', '', t("不占用工作现场，可随时恢复")));
    section.appendChild(header);
    if (!tasks.length) {
      section.appendChild(element('p', 'officeEmpty', t("这里没有已删除员工。")));
      office.appendChild(section);
      return;
    }
    const list = element('div', 'deletedEmployeeList');
    tasks.forEach(task => {
      const row = element('article', 'deletedEmployee');
      const stage = element('span', 'employeeStage');
      stage.append(employeeSprite(task.agentType, Number(String(task.id).replace(/\D/g, '')) % 3));
      const info = element('div', 'deletedEmployeeInfo');
      info.appendChild(element('strong', '', taskDisplayName(task)));
      info.appendChild(element('small', '', `${agentNames[task.agentType] || task.agentType}${t(" · 删除于 ")}${checkTime(task.deletedAt)}`));
      const restore = actionButton(t("恢复"), () => void restoreDeletedTask(task.id), 'dark');
      row.append(stage, info, restore);
      list.appendChild(row);
    });
    section.appendChild(list);
    office.appendChild(section);
  }

  async function restoreDeletedTask(id) {
    const result = await call('restoreDeletedTask', t("恢复员工…"), id);
    if (!result.ok) return;
    await loadState();
    toast(t("员工已恢复"));
  }

  function renderPiDetail() {
    const chat = $('piMessages');
    const scrollPosition = chat.scrollTop;
    const followLatest = state.followChat || !chat.children.length || chat.scrollHeight - chat.clientHeight - chat.scrollTop < 32;
    const studio = state.studio || {};
    const model = studio.model || { ready: false, label: '' };
    const report = studio.report || {};
    const savedReport = studio.dailyReport && studio.dailyReport.content ? studio.dailyReport : studio.lastReport;
    const lastReport = savedReport && savedReport.content ? savedReport.content : null;
    const attention = state.tasks.filter(task => task.requiredInput);
    const sourceRecords = [
      ...(Array.isArray(report.completed) ? report.completed : []),
      ...(Array.isArray(report.ongoing) ? report.ongoing : []),
      ...(Array.isArray(report.suggestions) ? report.suggestions : []),
    ];
    const sourceById = new Map();
    sourceRecords.forEach(item => {
      const id = item.id || item.taskId;
      if (!id) return;
      sourceById.set(id, item.title);
      if (item.localTaskId) sourceById.set(`P-${item.localTaskId}`, item.title);
    });
    const shortSourceTitle = (id) => {
      const title = sourceById.get(id) || '';
      const clean = cleanButlerText(title).replace(/^(Codex|Claude|Gemini)\s*·\s*/u, '').trim();
      return compactButlerText(clean || id, 18);
    };
    const planSummary = lastReport ? [
      `${t("基于已同步记录：已验收 ")}${(lastReport.completed || []).length}${t(" 项")}`,
      `${t("推进 ")}${(lastReport.ongoing || []).length}${t(" 项")}`,
      `${t("阻塞 ")}${(lastReport.blockers || []).length}${t(" 项")}`,
      `${t("明天建议 ")}${(lastReport.tomorrow || []).length}${t(" 项")}`,
      `${t("待你决定 ")}${(lastReport.decisions || []).length}${t(" 项")}`,
    ].join('，') + '。' : '';
    const planItem = (item, label) => {
      const ids = Array.isArray(item.taskIds) ? item.taskIds.filter(Boolean) : [];
      const text = cleanButlerText(item.text)
        .replace(/（建议，未派发）/gu, '')
        .replace(/（未派发）/gu, '')
        .replace(/S-[A-Za-z0-9-]+/gu, '')
        .replace(/P-54bc7cd0-e008-4446-83eb-ac265d06ba01-[A-Za-z0-9-]+/gu, id => shortSourceTitle(id))
        .replace(/^[\s：，,；;]+/u, '')
        .replace(/\s{2,}/gu, ' ')
        .replace(/：\s*/gu, '：')
        .replace(/\s+([：，；、])/gu, '$1')
        .replace(/、\s+/gu, '、')
        .replace(/（\s+/gu, '（')
        .replace(/\s+）/gu, '）')
        .replace(/（\s*）/gu, '')
        .replace(/（Codex）/gu, '')
        .replace(/，属 CLI 自述未经人工验收/gu, '')
        .replace(/；\s*为同内容的空闲会话，待区分保留哪条。/gu, '；另一条同内容会话待区分保留。')
        .replace(/^处于待输入状态：到\s*/u, '到 ')
        .trim();
      return { title: text || t("未命名事项"), label: [label, ...ids].join(' · ') };
    };

    const aiTodayItems = lastReport
      ? [
          ...lastReport.completed.map(item => planItem(item, t("已做"))),
          ...lastReport.ongoing.map(item => planItem(item, t("推进中"))),
        ]
      : [];
    const aiTomorrowItems = lastReport && Array.isArray(lastReport.tomorrow)
      ? lastReport.tomorrow.map(item => planItem(item, t("明日建议")))
      : [];
    const rawTodayItems = [
      ...(Array.isArray(report.completed) ? report.completed : []).map(item => ({
        title: item.title,
        label: item.label || item.source || t("已做")
      })),
      ...(Array.isArray(report.ongoing) ? report.ongoing : []).map(item => ({
        title: item.title,
        label: item.label || item.source || t("推进中")
      })),
    ];
    const rawTomorrowItems = (Array.isArray(report.suggestions) ? report.suggestions : []).map(item => ({
      title: item.title,
      label: item.next || t("明日建议")
    }));
    const todayItems = state.butlerPlanMode === 'records' ? rawTodayItems : aiTodayItems;
    const tomorrowItems = state.butlerPlanMode === 'records' ? rawTomorrowItems : aiTomorrowItems;
    const suggestion = attention[0]
      ? `${t("先处理「")}${attention[0].title}${window.OfficeI18n.language === 'en' ? '”: ' : '」：'}${attention[0].requiredInput}`
      : (tomorrowItems[0] ? `${t("明天可以先做：")}${tomorrowItems[0].title}` : t("问我任务进展，或一起排个先后。"));

    const modelText = model.label ? model.label.replace(/^Pi\s*[·:-]?\s*/u, '').trim() : '';
    $('piAvatar').replaceChildren(employeeSprite('pi', 2));
    $('piAvatar').appendChild(element('span', 'employeeBubble', attention.length ? `${attention.length}${t(" 个待输入")}` : t("管家待命")));
    $('openCloudFromButler').textContent = model.ready ? t("模型设置") : t("配置模型");
    $('piMeta').textContent = model.ready && modelText ? modelText : t("模型未连接");
    $('piSheetTitle').textContent = t("聊聊任务");
    $('butlerEmployeeName').textContent = attention.length
      ? `${t("有 ")}${attention.length}${t(" 件事等你确认")}`
      : tomorrowItems.length ? t("明天的安排在这里") : t("想问哪件事？");
    $('butlerEmployeeSub').textContent = cleanButlerText(suggestion);
    document.querySelectorAll('[data-plan-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.planMode === state.butlerPlanMode);
    });
    $('butlerReportMeta').textContent = state.butlerPlanMode === 'records'
      ? `${t("原始记录 · 已同步 ")}${(Array.isArray(report.completed) ? report.completed : []).length + (Array.isArray(report.ongoing) ? report.ongoing : []).length}${t(" 条")}`
      : lastReport
      ? `${savedReport.model || modelText || 'AI'} · ${checkTime(savedReport.generatedAt)}`
      : t("尚未生成");
    $('butlerAiSummary').textContent = state.butlerPlanMode === 'records'
      ? t("这里是上次刷新的任务记录。“空闲”可能是做完了，也可能只是暂停。")
      : lastReport && lastReport.summary
      ? planSummary
      : t("看看今天做了什么，明天先做什么。");
    $('butlerMessageLabel').textContent = model.ready ? (modelText || t("模型已配置")) : t("未配置模型");
    $('butlerAttentionCount').textContent = `${attention.length}${t(" 件")}`;
    $('butlerPlanPreview').textContent = lastReport ? t("已有安排") : t("尚未整理");
    const connectionText = state.modelChecking ? t("正在测试连接…")
      : state.modelCheckError || (model.verifiedAt ? t("连接正常，可以聊天了。")
        : model.ready ? t("配置已保存，点「验证连接」试一下。") : t("先配置模型，再开始聊天。"));
    $('butlerConnectionText').textContent = connectionText;
    $('connectionHint').classList.toggle('error', Boolean(state.modelCheckError));
    $('checkButlerModel').textContent = !model.ready ? t("配置模型") : state.modelChecking ? t("验证中…") : t("验证连接");
    $('checkButlerModel').disabled = state.modelChecking || state.sending;

    renderPlainRows($('piToday'), todayItems, 'today', state.butlerPlanMode === 'records'
      ? t("今天还没有记录。")
      : t("点「整理任务」，看看今天做了什么。"));
    renderPlainRows($('piTomorrow'), tomorrowItems, 'tomorrow', state.butlerPlanMode === 'records'
      ? t("还没有明天的安排。")
      : t("点「整理任务」，想想明天先做什么。"));
    renderPlainRows($('piAttention'), attention.map(task => ({
      title: task.title, label: task.requiredInput
    })), 'attention', t("暂时没有任务等你回复。"));

    $('piMessages').replaceChildren();
    const messages = Array.isArray(studio.messages) ? studio.messages.slice(-20) : [];
    $('butler').classList.toggle('hasConversation', Boolean(messages.length || state.pendingChat || state.failedChat));
    if (!messages.length && !state.pendingChat && !state.failedChat) {
      const welcome = element('div', 'chatWelcome');
      welcome.appendChild(element('span', 'welcomeMark', '···'));
      welcome.appendChild(element('h4', '', model.ready ? t("想问哪件事？") : t("模型还没配置")));
      welcome.appendChild(element('p', '', model.ready
        ? t("可以问问任务做到哪了。")
        : t("点上方「配置模型」，保存后验证连接。")));
      $('piMessages').appendChild(welcome);
    } else {
      messages.forEach(message => {
        $('piMessages').appendChild(createChatMessage(message.role, message.content));
      });
    }
    if (state.pendingChat) {
      appendChatMessage('user', state.pendingChat);
      setChatTyping(true, state.chatProgress?.text, state.chatProgress?.streaming);
    }
    if (state.failedChat) {
      appendChatMessage('user', state.failedChat.value);
      appendChatNotice(state.failedChat.error, true);
    }
    state.chatNotices.forEach(notice => appendChatNotice(notice));
    $('sendPi').disabled = state.sending || Boolean(state.failedChat?.operation) || !$('piInput').value.trim();
    const reportRunning = state.backgroundReports.size > 0;
    $('generateReport').disabled = !model.ready || reportRunning;
    $('generateReport').textContent = reportRunning ? t("规划生成中…") : t("整理任务");
    requestAnimationFrame(() => {
      const messages = $('piMessages');
      updateChatLayout();
      if (messages) messages.scrollTop = followLatest ? messages.scrollHeight : scrollPosition;
      state.followChat = false;
    });
  }

  function renderPlainRows(container, items, kind, emptyText) {
    container.replaceChildren();
    if (!items || !items.length) {
      container.appendChild(element('p', 'formNote', emptyText || t("暂无记录。")));
      return;
    }
    items.slice(0, kind === 'tomorrow' ? 4 : 3).forEach(item => {
      const row = element('div', `plainRow ${kind}`);
      row.appendChild(element('span', '', ''));
      const copy = element('div');
      copy.appendChild(element('strong', '', compactButlerText(item.title || item.text || t("未命名事项"), 120)));
      copy.appendChild(element('small', '', compactButlerText(item.label || item.next || item.source || '', 140)));
      row.appendChild(copy);
      container.appendChild(row);
    });
  }

  function renderCloudState() {
    const studio = state.studio || {};
    const model = studio.model || {};
    const ready = Boolean(model.ready);
    $('cloudState').textContent = state.modelCheckError ? t("连接异常") : model.verifiedAt ? t("模型已验证") : ready ? t("模型待验证") : t("配置模型");
    $('cloudState').setAttribute('title', $('cloudState').textContent);
    $('cloudState').classList.toggle('connected', Boolean(model.verifiedAt) && !state.modelCheckError);
  }

  function openCloudSheet() {
    const modelSettings = state.studio && state.studio.modelSettings ? state.studio.modelSettings : {};
    $('modelBaseUrl').value = modelSettings.baseUrl || '';
    $('modelId').value = modelSettings.modelId || '';
    $('modelApiKey').value = '';
    openSheet('cloudBackdrop');
  }

  async function saveCloudConnection(event) {
    event.preventDefault();
    const baseUrl = $('modelBaseUrl').value.trim();
    const modelId = $('modelId').value.trim();
    const apiKey = $('modelApiKey').value;
    if (!baseUrl || !modelId) {
      toast(t("请填写模型 Base URL 和模型名称"));
      return;
    }
    const modelResult = await call('saveStudioModel', t("保存 OpenAI 格式模型…"), JSON.stringify({
      baseUrl, modelId, apiKey
    }));
    if (!modelResult.ok) return;
    state.studio = modelResult.data;
    state.modelCheckError = '';
    if (!state.failedChat?.operation) state.failedChat = null;
    state.chatNotices = [];
    $('modelApiKey').value = '';
    $('modelCheckResult').textContent = t("已保存，点「验证连接」试一下。");
    $('modelCheckResult').classList.remove('error');
    render();
    toast(t("配置已保存，请验证连接"));
  }

  async function checkModelConnection() {
    if (state.modelChecking || state.sending) return;
    if (!state.studio?.model?.ready) { openCloudSheet(); return; }
    state.modelChecking = true;
    state.modelCheckError = '';
    const button = $('testModelConnection');
    button.disabled = true;
    document.querySelector('#cloudForm button[type="submit"]').disabled = true;
    $('modelCheckResult').textContent = t("正在测试连接…");
    $('modelCheckResult').classList.remove('error');
    renderPiDetail();
    let operation;
    try {
      const result = JSON.parse(AgentBridge.beginStudioModelCheck());
      if (!result.ok) throw new Error(result.error || t("无法开始验证"));
      operation = result.data.operation;
      const startedAt = Date.now();
      while (operation.state === 'running' || !operation.state) {
        if (Date.now() - startedAt > 180000) throw new Error(t("验证超时，请检查手机网络和模型地址后重试"));
        await sleep(350);
        const current = JSON.parse(AgentBridge.operationState(operation.id));
        if (!current.ok) throw new Error(current.error || t("无法读取验证结果"));
        operation = current.data.operation;
      }
      if (operation.state !== 'succeeded') throw new Error(operation.message || t("验证失败"));
      state.studio = operation.studio || state.studio;
      $('modelCheckResult').textContent = t("连接正常，可以发消息了。");
      toast(t("连接正常，可以聊天了"));
    } catch (error) {
      state.modelCheckError = error.message || t("验证失败，请检查配置");
      $('modelCheckResult').textContent = state.modelCheckError;
      $('modelCheckResult').classList.add('error');
      toast(state.modelCheckError);
    } finally {
      if (operation) { try { AgentBridge.clearOperation(operation.id); } catch (error) { /* Best effort. */ } }
      state.modelChecking = false;
      button.disabled = false;
      document.querySelector('#cloudForm button[type="submit"]').disabled = false;
      render();
    }
  }

  let callTimerInterval = null;
  let callListenToken = 0;
  let callErrorCount = 0;
  let callSessionToken = 0;

  function startCallMode() {
    if (state.callMode) return;
    if (state.failedChat?.operation) {
      toast(t("先在聊天中继续查看上一条消息的回复"));
      return;
    }
    if (!state.studio?.model?.ready) {
      toast(t("先配置管家模型，再开始通话"));
      openCloudSheet();
      return;
    }
    try {
      const voice = JSON.parse(AgentBridge.getTtsStatus());
      if (voice.ok && (voice.data.recognitionAvailable === false && !voice.data.cloudAvailable
          || !voice.data.ready || state.voicePreferCloud && !voice.data.cloudAvailable)) {
        toast(t("先在语音设置中准备好识别和播报，再开始通话"));
        openVoiceSettings();
        $('voiceServiceDetails').open = true;
        return;
      }
    } catch (error) { /* Older native builds report capabilities during capture. */ }
    let parsed;
    try {
      parsed = JSON.parse(AgentBridge.startConversationAudio(state.callSpeaker));
    } catch (error) {
      parsed = { ok: false };
    }
    if (!parsed.ok) {
      toast(parsed.error || t("通话音频启动失败"));
      return;
    }
    state.callMode = true;
    state.acceptVoiceEvents = true;
    callSessionToken += 1;
    state.callMuted = false;
    state.callStartedAt = Date.now();
    state.callTranscript = t("正在准备麦克风和语音识别，准备好后再说话。");
    callErrorCount = 0;
    setCallStatus('connecting');
    // A call always sends what it hears and speaks the reply, without
    // overwriting the press-to-talk preferences the user saved.
    $('callBackdrop').classList.remove('hidden');
    document.querySelector('.app').setAttribute('inert', '');
    $('butlerChatDock').setAttribute('inert', '');
    $('callEnd').focus({ preventScroll: true });
    $('callAvatar').replaceChildren(employeeSprite('pi', 2));
    $('callMuteLabel').textContent = state.callMuted ? t("取消静音") : t("静音");
    $('callMute').classList.toggle('active', state.callMuted);
    $('callMute').setAttribute('aria-pressed', String(state.callMuted));
    $('callSpeaker').classList.toggle('active', state.callSpeaker);
    $('callSpeaker').setAttribute('aria-pressed', String(state.callSpeaker));
    renderCallMode();
    callTimerInterval = setInterval(renderCallMode, 1000);
    scheduleCallListening(450);
    toast(t("通话模式已开启"));
  }

  function endCallMode() {
    if (!state.callMode) return;
    state.callMode = false;
    state.acceptVoiceEvents = false;
    callSessionToken += 1;
    state.voiceRecording = false;
    callListenToken += 1;
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
    try { AgentBridge.cancelVoiceInput(); } catch (error) {
      try { AgentBridge.stopVoiceInput(); } catch (nested) { /* Native cleanup is best effort. */ }
    }
    try { AgentBridge.stopSpeaking(); } catch (error) { /* Native cleanup is best effort. */ }
    try { AgentBridge.stopConversationAudio(); } catch (error) { /* Audio cleanup is best effort. */ }
    $('callBackdrop').classList.add('hidden');
    document.querySelector('.app').removeAttribute('inert');
    $('butlerChatDock').removeAttribute('inert');
    $('startCall').focus({ preventScroll: true });
    document.body.classList.remove('voice-listening');
    updateVoiceUi('stopped');
    toast(t("通话已结束"));
  }

  function toggleCallMute() {
    state.callMuted = !state.callMuted;
    $('callMute').classList.toggle('active', state.callMuted);
    $('callMute').setAttribute('aria-pressed', String(state.callMuted));
    $('callMuteLabel').textContent = state.callMuted ? t("取消静音") : t("静音");
    if (state.callMuted) {
      callListenToken += 1;
      try { AgentBridge.cancelVoiceInput(); } catch (error) {
        try { AgentBridge.stopVoiceInput(); } catch (nested) { /* Keep the call alive. */ }
      }
      state.voiceRecording = false;
      setCallStatus('muted');
    } else {
      callErrorCount = 0;
      setCallStatus('connecting');
      scheduleCallListening(120);
    }
    renderCallMode();
  }

  function retryCallListening() {
    if (!state.callMode || state.sending) return;
    state.callMuted = false;
    callErrorCount = 0;
    $('callMute').classList.remove('active');
    $('callMute').setAttribute('aria-pressed', 'false');
    $('callMuteLabel').textContent = t("静音");
    state.callTranscript = t("正在准备麦克风和语音识别，准备好后再说话。");
    setCallStatus('connecting');
    scheduleCallListening(120);
  }

  function toggleCallSpeaker() {
    state.callSpeaker = !state.callSpeaker;
    $('callSpeaker').classList.toggle('active', state.callSpeaker);
    $('callSpeaker').setAttribute('aria-pressed', String(state.callSpeaker));
    try { AgentBridge.setConversationSpeaker(state.callSpeaker); } catch (error) {
      toast(t("扬声器切换失败"));
    }
    renderCallMode();
  }

  function setCallStatus(status) {
    state.callStatus = status;
    renderCallMode();
  }

  function renderCallMode() {
    if (!state.callMode) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - state.callStartedAt) / 1000));
    const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const seconds = String(elapsed % 60).padStart(2, '0');
    const statuses = {
      connecting: t("正在接通…"),
      listening: t("正在聆听"),
      thinking: t("管家思考中"),
      replying: t("正在回复…"),
      speaking: t("管家播报中"),
      muted: t("麦克风已静音"),
      error: t("通话异常")
    };
    document.querySelector('.callStage').dataset.status = state.callStatus;
    $('callTimer').textContent = `${minutes}:${seconds}`;
    $('callStatus').textContent = statuses[state.callStatus] || statuses.connecting;
    $('callTranscript').textContent = state.callTranscript || t("说话后会自动发给管家。");
    $('callRetry').classList.toggle('hidden', state.callStatus !== 'error');
    $('callRetry').disabled = state.sending;
    document.querySelectorAll('.callWave span').forEach((bar, index) => {
      const active = state.callStatus === 'listening'
        ? 30 + state.voiceLevel * 0.7
        : state.callStatus === 'speaking' ? 34 : 8 + index * 2;
      bar.style.height = `${Math.max(8, Math.min(42, active))}px`;
    });
  }

  function scheduleCallListening(delay = 350) {
    const token = ++callListenToken;
    setTimeout(() => {
      if (!state.callMode || state.callMuted || state.sending || state.voiceRecording) return;
      if (token !== callListenToken) return;
      state.acceptVoiceEvents = true;
      setCallStatus('connecting');
      let parsed;
      try {
        parsed = JSON.parse(AgentBridge.startVoiceInput(true));
      } catch (error) {
        parsed = { ok: false };
      }
      if (parsed.ok) {
        state.voiceRecording = true;
      } else {
        state.callTranscript = parsed.error || t("麦克风启动失败，可点“取消静音”重试。");
        setCallStatus('error');
      }
    }, delay);
  }

  async function sendPiMessage(resume = false) {
    if (state.sending) return;
    const recovery = resume === true ? state.failedChat?.operation : null;
    if (!recovery && state.failedChat?.operation) {
      toast(t("上一条消息已提交，请先继续查看回复"));
      return;
    }
    const value = recovery ? state.failedChat.value : $('piInput').value.trim();
    if (!value) {
      toast(t("先输入要问管家的内容"));
      return;
    }
    if (!recovery && !state.studio?.model?.ready) {
      toast(t("先配置管家模型，再发送消息"));
      openCloudSheet();
      return;
    }
    const callSession = state.callMode ? callSessionToken : null;
    const stillInCall = () => callSession !== null
      && state.callMode && callSession === callSessionToken;
    state.sending = true;
    state.pendingChat = value;
    state.chatProgress = null;
    state.followChat = true;
    state.failedChat = null;
    state.chatNotices = [];
    $('sendPi').disabled = true;
    if (!recovery || $('piInput').value.trim() === value) $('piInput').value = '';
    autoResizeChatInput();
    renderPiDetail();
    if (state.callMode) {
      state.callTranscript = `${t("我：")}${value}`;
      setCallStatus('thinking');
    }
    setChatTyping(true);
    let operation = recovery;
    let terminal = false;
    try {
      if (!operation) {
        let parsed;
        try {
          parsed = JSON.parse(AgentBridge.beginStudioMessage(value));
        } catch (error) {
          parsed = { ok: false, error: t("无法启动管家回复") };
        }
        if (!parsed.ok) throw new Error(parsed.error || t("无法启动管家回复"));
        operation = parsed.data.operation;
      }
      let pollingFailures = 0;
      while (true) {
        await sleep(220);
        let currentResult;
        try {
          currentResult = JSON.parse(AgentBridge.operationState(operation.id));
        } catch (error) {
          currentResult = { ok: false, error: t("无法读取管家回复状态") };
        }
        if (!currentResult.ok) {
          // The bridge/Activity can be recreated after a turn committed but
          // before the page read its operation. Match the stored turn by ID.
          try {
            const saved = JSON.parse(AgentBridge.studioOverview());
            const reply = saved.ok && saved.data.messages?.find(message =>
              message.id === `studio-${operation.id}-assistant`);
            if (reply) currentResult = { ok: true, data: { operation: {
              ...operation, state: 'succeeded', studio: { ...saved.data, reply }
            } } };
          } catch (error) { /* Keep waiting for the submitted operation. */ }
          if (!currentResult.ok) {
            pollingFailures += 1;
            if (pollingFailures < 3) { await sleep(500); continue; }
            throw new Error(t("消息已提交，暂时无法读取回复。请继续查看，避免重复发送。"));
          }
        }
        pollingFailures = 0;
        const current = currentResult.data.operation;
        setChatTyping(true, current.partialReply || current.message, Boolean(current.partialReply));
        if (stillInCall() && current.partialReply) {
          state.callTranscript = `${t("我：")}${value}${t("\n管家：")}${current.partialReply}`;
          setCallStatus('replying');
        }
        if (current.state !== 'running') {
          if (!['failed', 'succeeded'].includes(current.state)) throw new Error(t("暂时无法确认回复状态，请继续查看"));
          terminal = true;
          operation = current;
          if (current.state === 'failed') throw new Error(current.message || t("管家回复失败"));
          break;
        }
      }
      state.studio = operation.studio || state.studio;
      state.pendingChat = null;
      setChatTyping(false);
      renderPiDetail();
      render();
      const messages = Array.isArray(state.studio.messages) ? state.studio.messages : [];
      const reply = operation.studio?.reply || messages[messages.length - 1];
      if (stillInCall()) {
        state.callTranscript = reply?.role === 'assistant'
          ? `${t("我：")}${value}${t("\n管家：")}${reply.content}` : `${t("我：")}${value}`;
      }
      const shouldSpeak = stillInCall()
        || (callSession === null && !state.callMode && state.voiceSpeakReply);
      if (reply && reply.role === 'assistant' && shouldSpeak) {
        let spoken = false;
        try {
          const speech = JSON.parse(AgentBridge.speakText(cleanSpeakText(reply.content) || t("管家已回复。")));
          spoken = speech.ok;
          if (!speech.ok) {
            state.chatNotices.push(speech.error || t("播报失败，回复已保留在对话中"));
            if (stillInCall()) state.callTranscript += `\n${speech.error || t("播报失败，请检查语音设置")}`;
            toast(speech.error || t("语音播报失败"));
          }
        } catch (error) {
          spoken = false;
        }
        if (stillInCall()) {
          if (spoken) setCallStatus('speaking');
          else { setCallStatus('error'); callListenToken += 1; }
        }
      } else if (stillInCall()) {
        scheduleCallListening(500);
      }
    } catch (error) {
      setChatTyping(false);
      state.failedChat = { value, error: error.message || String(error), operation: terminal ? null : operation };
      if (!$('piInput').value.trim() && (callSession === null || stillInCall())) {
        $('piInput').value = value;
        autoResizeChatInput();
      }
      toast(error.message || String(error));
      if (stillInCall()) {
        state.callTranscript = error.message || String(error);
        setCallStatus('error');
        callListenToken += 1;
      }
    } finally {
      state.sending = false;
      state.pendingChat = null;
      if (operation && terminal) {
        try { AgentBridge.clearOperation(operation.id); } catch (error) { /* Already cleared. */ }
      }
      renderPiDetail();
      // A new call may have started while the previous call's model request
      // was still pending. Its initial listen attempt was held by sending.
      if (state.callMode && callSession !== callSessionToken
        && ['connecting', 'listening'].includes(state.callStatus) && !state.voiceRecording) {
        scheduleCallListening(350);
      }
    }
  }

  function appendChatMessage(role, content) {
    $('piMessages').appendChild(createChatMessage(role, content));
    $('piMessages').scrollTop = $('piMessages').scrollHeight;
  }

  function createChatMessage(role, content) {
    const user = role === 'user';
    const row = element('article', `piMessage ${user ? 'user' : 'assistant'}`);
    const meta = element('div', 'messageMeta');
    if (!user) {
      const avatar = element('span', 'messageAvatar');
      avatar.setAttribute('aria-hidden', 'true');
      avatar.appendChild(employeeSprite('pi', 2));
      meta.appendChild(avatar);
    }
    meta.appendChild(element('strong', 'piMessageAuthor', user ? t("我") : t("管家")));
    row.appendChild(meta);
    row.appendChild(user ? element('div', 'messageUserText', content) : renderButlerText(content));
    if (!user) appendChatTaskLinks(row, content);
    return row;
  }

  function appendChatTaskLinks(row, content) {
    // Ignore fenced code and URLs: remote text can reference an existing task,
    // but it cannot construct a destination or a command.
    const prose = String(content || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
      .replace(/https?:\/\/\S+/g, '');
    const ids = new Set(Array.from(prose.matchAll(/\bS-(\d+)\b/g), match => match[1]));
    const tasks = state.tasks.filter(task => ids.has(String(task.id)));
    if (!tasks.length) return;
    const links = element('div', 'chatTaskLinks');
    for (const task of tasks.slice(0, 3)) {
      const link = element('button', 'chatTaskLink');
      link.type = 'button';
      link.dataset.taskId = task.id;
      const text = element('span');
      text.append(element('strong', '', task.title), element('small', '',
        `${agentNames[task.agentType] || task.agentType} · ${taskStatusText(task)}`));
      link.append(text, uiIcon('arrow'));
      link.addEventListener('click', () => {
        if (!state.tasks.some(item => item.id === task.id)) {
          toast(t("找不到这条记录了，请重新选择员工。")); return;
        }
        openTask(task.id);
      });
      links.appendChild(link);
    }
    row.appendChild(links);
  }

  // Render a small, shared Markdown subset with DOM text nodes only. Remote
  // output is untrusted: HTML, links and code are never executed.
  function renderButlerText(content) {
    const holder = element('div', 'butlerRich messageRich');
    const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
    const cells = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/u).map(cell => cell.trim().replace(/\\\|/g, '|'));
    const tableRule = line => line && line.includes('|') && cells(line).every(cell => /^:?-{3,}:?$/.test(cell));
    const listMatch = line => /^\s*(?:([-*+•])\s+|(\d+)[.、)]\s+)(.+)$/.exec(line);
    const fenceMatch = line => /^\s*(`{3,}|~{3,})([^\s]*)\s*$/.exec(line);
    const blockStart = index => !lines[index]?.trim() || fenceMatch(lines[index])
      || /^#{1,6}\s+|^>\s?/u.test(lines[index]) || listMatch(lines[index])
      || tableRule(lines[index + 1]);
    const inline = (node, value) => { node.appendChild(renderInlineMarkup(value)); return node; };
    for (let index = 0; index < lines.length;) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }
      const fence = fenceMatch(line);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length) {
          const closing = fenceMatch(lines[index]);
          if (closing && closing[1][0] === fence[1][0] && closing[1].length >= fence[1].length && !closing[2]) { index += 1; break; }
          code.push(lines[index++]);
        }
        const block = element('div', 'messageCode');
        block.appendChild(element('div', 'messageCodeLanguage', fence[2] || 'text'));
        const pre = element('pre', 'conversationCode');
        pre.appendChild(element('code', '', code.join('\n')));
        block.appendChild(pre);
        holder.appendChild(block);
        continue;
      }
      if (line.includes('|') && tableRule(lines[index + 1])) {
        const wrap = element('div', 'messageTableWrap');
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', t("表格"));
        const table = element('table', 'messageTable');
        const head = element('thead'), heading = element('tr');
        cells(line).forEach(cell => {
          const th = inline(element('th'), cell); th.scope = 'col'; heading.appendChild(th);
        });
        head.appendChild(heading); table.appendChild(head);
        const body = element('tbody');
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes('|') && !fenceMatch(lines[index])) {
          const row = element('tr');
          cells(lines[index++]).forEach(cell => row.appendChild(inline(element('td'), cell)));
          body.appendChild(row);
        }
        table.appendChild(body); wrap.appendChild(table); holder.appendChild(wrap);
        continue;
      }
      const heading = /^#{1,6}\s+(.+)$/u.exec(line);
      if (heading) { holder.appendChild(inline(element('h4', 'butlerHeading'), heading[1])); index += 1; continue; }
      const item = listMatch(line);
      if (item) {
        const ordered = Boolean(item[2]);
        const list = element(ordered ? 'ol' : 'ul', 'butlerList');
        if (ordered) list.start = Number(item[2]);
        while (index < lines.length) {
          const next = listMatch(lines[index]);
          if (!next || Boolean(next[2]) !== ordered) break;
          list.appendChild(inline(element('li', 'butlerListItem'), next[3])); index += 1;
        }
        holder.appendChild(list); continue;
      }
      if (/^>\s?/u.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/u.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/u, ''));
        holder.appendChild(inline(element('blockquote', 'messageQuote'), quote.join('\n'))); continue;
      }
      const paragraph = [line]; index += 1;
      while (index < lines.length && !blockStart(index)) paragraph.push(lines[index++]);
      holder.appendChild(inline(element('p', 'butlerPara'), paragraph.join('\n')));
    }
    return holder;
  }

  function renderInlineMarkup(text) {
    const fragment = document.createDocumentFragment();
    const parts = String(text).split(/(\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const part of parts) {
      const file = /^\[([^\]\n]+)\]\(([^\s)]+)\)$/.exec(part);
      if (file) {
        const reference = element('span', 'fileReference', file[1]);
        reference.title = file[2];
        fragment.appendChild(reference);
      } else if (/^\*\*[^*]+\*\*$/.test(part)) {
        fragment.appendChild(element('b', '', part.slice(2, -2)));
      } else if (/^`[^`]+`$/.test(part)) {
        fragment.appendChild(element('code', '', part.slice(1, -1)));
      } else if (part) {
        fragment.appendChild(document.createTextNode(part.replace(/\*\*/g, '')));
      }
    }
    return fragment;
  }

  function cleanSpeakText(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/#{1,4}\s*/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/https?:\/\/\S+/g, '链接')
      .replace(/[|>#*_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 460);
  }

  function appendChatNotice(content, retry = false) {
    const row = element('div', 'chatNotice');
    if (retry) { row.classList.add('error'); row.setAttribute('role', 'alert'); }
    row.textContent = content;
    if (retry) {
      const button = element('button', '', state.failedChat?.operation ? t("继续查看回复") : t("重试这条消息"));
      button.type = 'button';
      button.addEventListener('click', () => {
        if (state.sending || !state.failedChat) return;
        if (state.failedChat.operation) {
          void sendPiMessage(true);
          return;
        }
        if ($('piInput').value.trim() && $('piInput').value.trim() !== state.failedChat.value) {
          toast(t("输入框中有新的草稿，请先发送或清空"));
          return;
        }
        $('piInput').value = state.failedChat.value;
        void sendPiMessage();
      });
      row.appendChild(button);
    }
    $('piMessages').appendChild(row);
    $('piMessages').scrollTop = $('piMessages').scrollHeight;
  }

  function setChatTyping(typing, message, streaming = false) {
    let row = document.getElementById('chatTyping');
    if (!typing) {
      row?.remove();
      state.chatProgress = null;
      return;
    }
    const text = message || t("正在思考…");
    state.chatProgress = { text, streaming };
    // Polling an unchanged operation should not rebuild the message or move the reader.
    if (row?.dataset.replyText === text && row.classList.contains('streaming') === streaming) return;
    const chat = $('piMessages');
    const scrollPosition = chat.scrollTop;
    const followLatest = state.followChat || chat.scrollHeight - chat.clientHeight - scrollPosition < 32;
    if (!row) {
      row = createChatMessage('assistant', text);
      row.classList.add('typing');
      row.id = 'chatTyping';
      row.querySelector('.messageMeta').appendChild(element('span', 'replyProgress'));
      chat.appendChild(row);
    } else {
      row.querySelector('.butlerRich').replaceWith(renderButlerText(text));
    }
    row.dataset.replyText = text;
    row.classList.toggle('streaming', streaming);
    row.setAttribute('aria-busy', 'true');
    const progress = row.querySelector('.replyProgress');
    progress.setAttribute('role', 'status');
    progress.textContent = streaming ? t("正在回复…") : t("正在处理…");
    chat.scrollTop = followLatest ? chat.scrollHeight : scrollPosition;
  }

  function autoResizeChatInput() {
    const input = $('piInput');
    input.style.height = 'auto';
    input.style.height = `${Math.min(112, input.scrollHeight)}px`;
    $('sendPi').disabled = state.sending || Boolean(state.failedChat?.operation) || !input.value.trim();
  }

  function toggleVoiceInput() {
    if (state.voiceRecording) {
      state.voiceRecording = false;
      updateVoiceUi('processing');
      updateVoiceUi('stopped');
      try { AgentBridge.stopVoiceInput(); } catch (error) { /* Native state callback handles errors. */ }
      return;
    }
    state.acceptVoiceEvents = true;
    let parsed;
    try {
      parsed = JSON.parse(AgentBridge.startVoiceInput(state.voiceAutoSend));
    } catch (error) {
      parsed = { ok: false };
    }
    if (!parsed.ok) {
      updateVoiceUi('error', t("语音识别不可用"));
      return;
    }
    state.voiceRecording = true;
    state.voiceStartedAt = Date.now();
    updateVoiceUi('ready');
  }

  function beginVoicePointer(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    voicePointer.id = event.pointerId;
    voicePointer.x = event.clientX;
    voicePointer.y = event.clientY;
    voicePointer.startedAt = Date.now();
    voicePointer.cancelArmed = false;
    try {
      $('voiceButton').setPointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture is only an enhancement; the pointerup listener still works.
    }
    toggleVoiceInput();
  }

  function moveVoicePointer(event) {
    if (voicePointer.id === null || event.pointerId !== voicePointer.id || !state.voiceRecording) return;
    voicePointer.cancelArmed = event.clientY < voicePointer.y - 68;
    updateVoiceUi(state.voiceRecording ? 'recording' : 'stopped');
  }

  function endVoicePointer(event) {
    if (voicePointer.id === null || event.pointerId !== voicePointer.id) return;
    const heldMs = Date.now() - voicePointer.startedAt;
    const shouldFinish = state.voiceRecording && (heldMs >= 260 || voicePointer.cancelArmed);
    const shouldCancel = voicePointer.cancelArmed;
    releaseVoicePointer(event.pointerId);
    if (!shouldFinish) {
      if (state.voiceRecording) updateVoiceUi('recording');
      return;
    }
    if (shouldCancel) {
      cancelVoiceInput();
      return;
    }
    finishVoiceInput();
  }

  function cancelVoicePointer(event) {
    if (voicePointer.id === null || event.pointerId !== voicePointer.id) return;
    releaseVoicePointer(event.pointerId);
    if (state.voiceRecording) cancelVoiceInput();
  }

  function releaseVoicePointer(pointerId) {
    try {
      if ($('voiceButton').hasPointerCapture(pointerId)) $('voiceButton').releasePointerCapture(pointerId);
    } catch (error) {
      // The pointer may already be released by WebView.
    }
    voicePointer.id = null;
    voicePointer.cancelArmed = false;
  }

  function finishVoiceInput() {
    state.voiceRecording = false;
    updateVoiceUi('processing');
    try { AgentBridge.stopVoiceInput(); } catch (error) {
      updateVoiceUi('error', t("语音识别连接失败"));
    }
  }

  function cancelVoiceInput() {
    state.acceptVoiceEvents = false;
    state.voiceRecording = false;
    updateVoiceUi('stopped');
    try { AgentBridge.cancelVoiceInput(); } catch (error) {
      // Native cancellation is best-effort.
    }
  }

  function updateVoiceUi(type, text) {
    const labels = {
      ready: t("正在听…轻点结束，或按住后松手"),
      recording: t("正在听…松手发送，上滑取消"),
      partial: t("正在识别…"),
      processing: t("正在整理…"),
      'cloud-recording': t("正在录音…松手转文字，上滑取消"),
      'cloud-processing': t("正在转文字…"),
      final: t("识别完成"),
      speaking: t("管家播报中"),
      'speak-ended': t("播报完成"),
      'speak-error': text || t("播报失败，请检查语音设置"),
      stopped: t("按住麦克风说话"),
      'permission-denied': text || t("需要麦克风权限"),
      error: text || t("语音识别失败")
    };
    $('voiceStateText').textContent = labels[type] || labels.stopped;
    const listening = state.voiceRecording;
    const transcribing = type === 'cloud-processing' || type === 'processing';
    document.body.classList.toggle('voice-listening', listening);
    $('voicePanel').classList.toggle('hidden', !listening && !transcribing);
    $('voicePanel').classList.toggle('cancel', Boolean(voicePointer.cancelArmed));
    $('voicePanelTitle').textContent = voicePointer.cancelArmed
      ? t("松开取消")
      : transcribing ? t("转写中…") : t("正在听…");
    $('voicePanelHint').textContent = transcribing
      ? t("正在上传识别，马上就好")
      : voicePointer.cancelArmed
        ? t("这次录音不会发给管家")
        : state.voiceAutoSend ? t("松开后转文字并发送") : t("松开后放入输入框");
    $('voiceButton').classList.toggle('recording', state.voiceRecording);
    $('voiceButton').style.setProperty('--voice-level', `${Math.max(12, Math.min(100, state.voiceLevel))}%`);
    renderCallMode();
  }

  window.phoneVoice = {
    update(value) {
      const event = typeof value === 'string' ? JSON.parse(value) : value;
      const captureEvent = ['ready', 'recording', 'cloud-recording', 'partial', 'final',
        'processing', 'cloud-processing', 'level', 'error', 'permission-denied'].includes(event.type);
      if (captureEvent && !state.acceptVoiceEvents && !state.callMode) return;
      state.voiceLevel = event.type === 'level' ? Number(event.text) || 0 : state.voiceLevel;
      if (event.type === 'partial' || event.type === 'final') {
        $('piInput').value = event.text || '';
        autoResizeChatInput();
      }
      if (state.callMode && event.type === 'partial' && event.text) {
        state.callTranscript = `${t("我：")}${event.text}`;
        renderCallMode();
      }
      if (event.type === 'recording' || event.type === 'ready' || event.type === 'cloud-recording') state.voiceRecording = true;
      if (event.type === 'cloud-processing' || event.type === 'processing'
        || event.type === 'speaking' || event.type === 'speak-error') state.voiceRecording = false;
      if (event.type === 'final' || event.type === 'error' || event.type === 'stopped'
        || event.type === 'permission-denied') state.voiceRecording = false;
      updateVoiceUi(event.type, event.text);
      if (event.type === 'error' || event.type === 'speak-error') {
        if (event.text) {
          state.chatNotices = [...state.chatNotices.slice(-2), event.text];
          renderPiDetail();
        }
        toast(event.text || t("语音服务失败，请检查语音设置"));
      }
      if (state.callMode) {
        if (event.type === 'recording' || event.type === 'ready' || event.type === 'cloud-recording') {
          if (callErrorCount > 0 || state.callTranscript === t("正在准备麦克风和语音识别，准备好后再说话。")) {
            state.callTranscript = t("通话已接通。你说话，管家回复后会继续聆听。");
          }
          callErrorCount = 0;
          setCallStatus('listening');
        }
        if (event.type === 'cloud-processing' || event.type === 'processing') {
          setCallStatus('thinking');
        }
        if (event.type === 'speaking') setCallStatus('speaking');
        if (event.type === 'speak-ended') {
          setCallStatus('connecting');
          scheduleCallListening(260);
        }
        if (event.type === 'speak-error') {
          state.callTranscript = event.text || t("播报失败，请检查语音设置");
          setCallStatus('error');
          callListenToken += 1;
        }
        if (event.type === 'final') callErrorCount = 0;
        if (event.type === 'permission-denied') {
          endCallMode();
          toast(event.text || t("需要麦克风权限才能通话"));
          return;
        }
        if (event.type === 'error') {
          state.callTranscript = event.text || t("语音识别失败");
          callErrorCount += 1;
          if (callErrorCount >= 3) {
            // Retrying a broken microphone or network forever only drains the battery.
            state.callTranscript = `${event.text || t("语音识别失败")}${t("。已连续失败 ")}${callErrorCount}${t(" 次，请检查语音设置后点“重新聆听”。")}`;
            state.callMuted = true;
            $('callMute').classList.add('active');
            $('callMute').setAttribute('aria-pressed', 'true');
            $('callMuteLabel').textContent = t("取消静音");
            setCallStatus('error');
            return;
          }
          setCallStatus('error');
          scheduleCallListening(1000 * callErrorCount);
        }
        if (event.type === 'stopped' && !state.sending) {
          setCallStatus('connecting');
          scheduleCallListening(500);
        }
      }
      if (event.type === 'final' && event.autoSend && event.text?.trim()) {
        const callSession = state.callMode ? callSessionToken : null;
        setTimeout(() => {
          if (callSession !== null && (!state.callMode || callSession !== callSessionToken)) return;
          if (callSession === null && state.callMode) return;
          void sendPiMessage();
        }, 180);
      }
    }
  };

  function generateTodayReport() {
    if (state.backgroundReports.size) {
      toast(t("任务安排正在后台生成，完成后会通知你"));
      return;
    }
    const date = state.studio && state.studio.date
      ? state.studio.date
      : new Date().toISOString().slice(0, 10);
    let parsed;
    try {
      parsed = JSON.parse(AgentBridge.beginStudioReport(date));
    } catch (error) {
      parsed = { ok: false, error: t("无法提交任务安排生成任务") };
    }
    if (!parsed.ok) {
      toast(parsed.error || t("无法提交任务安排生成任务"));
      return;
    }
    const operation = parsed.data.operation;
    state.backgroundReports.set(date, {
      operation,
      message: t("正在生成任务安排…"),
      startedAt: operation.startedAt || Date.now()
    });
    renderPiDetail();
    renderBackgroundState();
    toast(t("任务安排生成已提交后台，完成后会通知你"));
    void pollBackgroundReport(date, operation);
  }

  async function pollBackgroundReport(date, startedOperation) {
    try {
      for (;;) {
        await sleep(1000);
        const entry = state.backgroundReports.get(date);
        if (!entry || entry.operation.id !== startedOperation.id) return;
        let parsed;
        try {
          parsed = JSON.parse(AgentBridge.operationState(startedOperation.id));
        } catch (error) {
      parsed = { ok: false, error: t("无法读取任务安排状态") };
        }
        if (!parsed.ok) throw new Error(parsed.error || t("无法读取任务安排状态"));
        const operation = parsed.data.operation;
        entry.operation = operation;
        entry.message = operation.message || t("正在生成任务安排…");
        renderPiDetail();
        renderBackgroundState();
        if (operation.state === 'failed') throw new Error(operation.message || t("任务安排生成失败"));
        if (operation.state !== 'running') break;
      }

      const entry = state.backgroundReports.get(date);
      const operation = entry ? entry.operation : startedOperation;
      if (operation.task) state.studio = operation.task;
      state.butlerPlanMode = 'ai';
      try { localStorage.setItem('butlerPlanMode', 'ai'); } catch (error) { /* in-memory mode still works */ }
      finishBackgroundReport(date, true, t("任务安排已生成"));
    } catch (error) {
      finishBackgroundReport(date, false, `${t("任务安排生成失败：")}${error.message || String(error)}`);
    }
  }

  function finishBackgroundReport(date, succeeded, message) {
    const entry = state.backgroundReports.get(date);
    const operation = entry ? entry.operation : null;
    state.backgroundReports.delete(date);
    if (operation) {
      try { AgentBridge.clearOperation(operation.id); } catch (error) { /* already cleared */ }
    }
    addBackgroundNotice(succeeded ? 'success' : 'error', message);
    toast(message);
    state.butlerPlanMode = succeeded ? 'ai' : state.butlerPlanMode;
    render();
    renderBackgroundState();
  }

  function cleanButlerText(value) {
    return String(value || '')
      .replace(/\[Image:[^\]]+\]/giu, '图片')
      .replace(/\[Audio:[^\]]+\]/giu, '音频')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  function loadButlerPlanMode() {
    try {
      const value = localStorage.getItem('butlerPlanMode');
      return value === 'records' ? 'records' : 'ai';
    } catch (error) {
      return 'ai';
    }
  }

  function loadVoicePreference(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value === 'true';
    } catch (error) {
      return fallback;
    }
  }

  function loadVoiceNumber(key, fallback) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function applyVoiceTuning() {
    try {
      AgentBridge.setTtsSettings(state.voiceRate, state.voicePitch);
    } catch (error) {
      // Older builds simply use the engine default.
    }
  }

  function refreshTtsEngineStatus() {
    let status = t("语音状态未知");
    try {
      const parsed = JSON.parse(AgentBridge.getTtsStatus());
      if (parsed.ok && parsed.data.ready) {
        status = parsed.data.mode === 'cloud'
          ? t("本机语音引擎不可用，已自动切换云端语音（qwen3-tts）")
          : `${t("本机语音引擎已就绪 · ")}${parsed.data.language || 'zh-CN'}`;
      } else {
        status = t("声音尚未就绪：启用本机中文语音引擎，或配置下方云端语音。");
      }
      if (parsed.ok) {
        const data = parsed.data;
        $('voiceInputStatus').textContent = `${data.cloudAvailable ? t("云端识别已配置")
          : data.recognitionAvailable ? t("本机识别可用") : t("识别尚未就绪，请配置云端语音")} · ${data.microphoneGranted ? t("麦克风已授权") : t("首次录音时需授权麦克风")}`;
        $('voiceServiceState').textContent = data.hasVoiceKey ? t("独立密钥已保存")
          : data.cloudAvailable ? t("沿用模型密钥") : t("可单独配置");
        $('voiceApiKey').placeholder = data.hasVoiceKey ? t("已保存，留空保持原值") : t("输入百炼北京地域 API Key");
      }
    } catch (error) {
      status = t("当前版本不支持语音状态读取");
    }
    $('ttsEngineStatus').textContent = status;
  }

  function saveVoiceService(clear) {
    try {
      const parsed = JSON.parse(AgentBridge.saveVoiceService(JSON.stringify({
        apiKey: $('voiceApiKey').value.trim(), clear
      })));
      if (!parsed.ok) throw new Error(parsed.error || t("保存语音配置失败"));
      $('voiceApiKey').value = '';
      refreshTtsEngineStatus();
      toast(clear ? t("独立语音密钥已清除") : t("语音配置已保存，请试听并测试识别"));
    } catch (error) {
      toast(error.message || t("当前版本不支持独立语音配置"));
    }
  }

  function openVoiceSettings() {
    $('voiceApiKey').value = '';
    $('voiceSpeakReplySetting').checked = state.voiceSpeakReply;
    $('voicePreferCloudSetting').checked = state.voicePreferCloud;
    $('voiceRateSetting').value = String(state.voiceRate);
    $('voicePitchSetting').value = String(state.voicePitch);
    $('voiceRateEcho').textContent = `${state.voiceRate.toFixed(2)}×`;
    $('voicePitchEcho').textContent = state.voicePitch.toFixed(2);
    refreshTtsEngineStatus();
    openSheet('voiceBackdrop');
  }

  function syncSpeakReplySetting() {
    if (state.voiceSpeakReply !== $('voiceSpeakReplySetting').checked) {
      toggleVoicePreference('voiceSpeakReply');
    }
  }

  function updateVoiceTuning(key, inputId, echoId, suffix) {
    const value = Number($(inputId).value);
    if (!Number.isFinite(value)) return;
    state[key] = value;
    $(echoId).textContent = `${value.toFixed(2)}${suffix}`;
    try {
      localStorage.setItem(key, String(value));
    } catch (error) {
      // The in-memory value still applies for this session.
    }
    applyVoiceTuning();
  }

  function previewButlerVoice() {
    try {
      const parsed = JSON.parse(AgentBridge.speakText(t("你好，我是管家。这是当前的语速和音调。")));
      if (!parsed.ok) toast(parsed.error || t("语音播报不可用"));
    } catch (error) {
      toast(t("语音播报不可用"));
    }
  }

  function toggleVoicePreference(key) {
    state[key] = !state[key];
    const button = $(key === 'voiceAutoSend' ? 'voiceAutoSend' : 'voiceSpeakReply');
    button.classList.toggle('active', state[key]);
    button.setAttribute('aria-pressed', String(state[key]));
    try {
      localStorage.setItem(key, String(state[key]));
    } catch (error) {
      // The current in-memory choice still applies.
    }
  }

  function compactButlerText(value, maximum) {
    const clean = cleanButlerText(value);
    return clean.length <= maximum ? clean : clean.slice(0, maximum - 1) + '…';
  }

  function renderTodo() {
    const container = $('todo');
    container.textContent = '';
    const tasks = prioritizeTasks(state.tasks.filter((task) => task.requiredInput));
    if (!tasks.length) {
      const empty = element('div', 'empty');
      empty.innerHTML = t("<div class=\"emptyAvatar\"></div><h3>暂无待输入记录</h3><p>点击顶部刷新，检查最新会话状态。</p>");
      container.appendChild(empty);
      return;
    }
    tasks.forEach((task) => {
      const card = element('button', 'todoCard');
      card.dataset.state = 'attention';
      card.dataset.record = isRecordedTask(task) ? 'true' : 'false';
      const avatar = element('div', 'todoAvatarWrap');
      avatar.append(employeeSprite(task.agentType, Number(String(task.id).replace(/\D/g, '')) % 3));
      const info = element('div');
      info.appendChild(element('strong', '', task.title));
      info.appendChild(element('p', 'employeeSub', `${agentNames[task.agentType] || task.agentType} · ${taskStatusText(task)}`));
      const machine = state.machines.find((item) => item.id === task.machineId);
      if (machine) info.appendChild(element('p', 'employeeSub', `${machine.name} · ${machineCheckText(machine)}`));
      info.appendChild(element('p', 'todoNeed', task.requiredInput));
      card.appendChild(avatar);
      card.appendChild(info);
      card.addEventListener('click', () => openTask(task.id));
      container.appendChild(card);
    });
  }

  function employeeCard(task) {
    const card = element('button', 'employee');
    const currentState = employeeState(task);
    card.dataset.state = currentState;
    card.dataset.agent = task.agentType;
    card.dataset.taskId = String(task.id);
    card.dataset.record = isRecordedTask(task) ? 'true' : 'false';
    card.type = 'button';
    const displayName = taskDisplayName(task);
    card.setAttribute('aria-label', `${displayName}，${taskStatusText(task)}`);
    const info = element('div', 'employeeInfo');
    const stage = element('span', 'employeeStage');
    stage.append(employeeSprite(task.agentType, Number(String(task.id).replace(/\D/g, '')) % 3));
    const bubble = element('span', 'employeeBubble', taskBubbleText(task, currentState));
    bubble.setAttribute('aria-hidden', 'true');
    stage.append(bubble);
    card.appendChild(stage);
    info.appendChild(element('span', 'employeeName', displayName));
    const preview = element('span', 'employeePreview');
    const previewLabel = task.requiredInput ? (isRecordedTask(task) ? t("上次待确认") : t("需要你确认"))
      : readableSessionOutput(task.lastOutput) ? t("最近回复") : t("最新进展");
    preview.append(element('span', 'employeePreviewLabel', previewLabel),
      element('span', 'employeeSub', taskCardSummary(task)));
    info.appendChild(preview);
    info.appendChild(element('span', `stateChip ${currentState}`, `${agentNames[task.agentType] || task.agentType} · ${taskStatusText(task)}`));
    card.appendChild(info);
    const open = element('span', 'employeeOpen');
    open.appendChild(uiIcon('arrow'));
    open.setAttribute('aria-hidden', 'true');
    card.appendChild(open);
    card.addEventListener('click', () => openTask(task.id));
    return card;
  }

  function isRecordedTask(task) {
    const machine = state.machines.find(item => item.id === task.machineId);
    return !machine || machine.lastStatus !== 'online' || !checkTime(machine.lastCheckedAt);
  }

  function taskDisplayName(task) {
    const title = String(task.title || t("未命名任务")).trim();
    let normalized = title
      .replace(/^(?:Codex|Claude|Gemini)\s*·\s*/u, '')
      .replace(/\[Image:[^\]]*\]/giu, '图片输入')
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, '图片输入')
      .replace(/\s+/gu, ' ')
      .trim();
    if (/^\[Image:/iu.test(normalized)) normalized = t("图片输入");
    return normalized || t("未命名任务");
  }

  function taskCardSummary(task) {
    const record = readableSessionOutput(task.workSummary) || readableSessionOutput(task.lastOutput);
    const source = String(task.requiredInput || conversationLabeled(record, ['最近输出', '最近回复', '最近结果', '本次输出', 'Latest output']) || record);
    if (!task.requiredInput && /\[Image:|!\[[^\]]*\]\([^)]*\)/u.test(`${task.title || ''}\n${source}`)) {
      return t("收到一张图片输入，点击查看上下文。");
    }
    // Only simplify the preview. The original text stays in the conversation
    // and raw record, and the preview never infers completion from prose.
    return source.slice(0, 6000)
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
      .replace(/\[([^\]\n]+)\]\([^\s)]+\)/g, '$1')
      .replace(/^(?:最近指令|最近用户|最近提问|最近输出|最近回复|最近结果|本次输出|Latest output)\s*[:：]\s*/gm, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/\*\*|`/g, '')
      .replace(/\s+/g, ' ').trim() || t("暂无工作摘要");
  }

  function taskBubbleText(task, currentState) {
    if (isRecordedTask(task)) return t("上次");
    if (currentState === 'attention') return t("举手");
    if (currentState === 'running') return t("敲键盘");
    if (currentState === 'idle') return t("空闲");
    return t("记录");
  }

  function taskStatusText(task) {
    return `${isRecordedTask(task) ? t("上次：") : ''}${statusText(task)}`;
  }

  function prioritizeTasks(tasks) {
    const stateRank = task => {
      if (task.requiredInput) return 0;
      // A user-provided name is an explicit importance marker. Renamed tasks
      // queue above ordinary running/idle employees, but below pending input.
      if (String(task.customTitle || '').trim()) return 1;
      if (task.status === 'running') return 2;
      if (task.status === 'idle') return 3;
      if (task.status === 'stopped' || task.status === 'missing') return 5;
      return 3;
    };
    const activityTime = task => Date.parse(task.lastActiveAt || task.updatedAt || '');
    const activityScore = task => {
      const time = activityTime(task);
      if (!Number.isFinite(time)) return 0;
      const hours = Math.max(0, (Date.now() - time) / 36e5);
      return Math.max(0, 300 - Math.min(300, hours * 5));
    };
    return tasks.slice().sort((left, right) => {
      const recordedPenalty = task => (isRecordedTask(task) ? 1000 : 0);
      const leftScore = 10000 - stateRank(left) * 1000 + activityScore(left) - recordedPenalty(left);
      const rightScore = 10000 - stateRank(right) * 1000 + activityScore(right) - recordedPenalty(right);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return (activityTime(right) || 0) - (activityTime(left) || 0);
    });
  }

  function loadCollapsedSprites() {
    try {
      const value = JSON.parse(localStorage.getItem('officeCollapseV2') || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (error) {
      return {};
    }
  }

  function isCollapsed(machineId) {
    return Boolean(state.collapsedSprites[String(machineId)]);
  }

  function toggleSprites(machineId) {
    const key = String(machineId);
    if (state.collapsedSprites[key]) delete state.collapsedSprites[key];
    else state.collapsedSprites[key] = true;
    try {
      localStorage.setItem('officeCollapseV2', JSON.stringify(state.collapsedSprites));
    } catch (error) {
      // Rendering still works if private storage is temporarily unavailable.
    }
    render();
  }

  function employeeState(task) {
    if (task.requiredInput) return 'attention';
    if (task.status === 'error') return 'attention';
    if (task.status === 'running') return 'running';
    if (task.status === 'idle') return 'idle';
    return 'finished';
  }

  function svgPixelNode() {
    return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  }

  function rect(svg, x, y, width, height, fill) {
    const item = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    item.setAttribute('x', String(x));
    item.setAttribute('y', String(y));
    item.setAttribute('width', String(width));
    item.setAttribute('height', String(height));
    item.setAttribute('fill', fill);
    svg.append(item);
  }

  function employeeSprite(agentType, variant) {
    const palettes = {
      codex: { shirt: '#7488bc', trim: '#5a6c9b' },
      'claude-code': { shirt: '#cc8250', trim: '#a96940' },
      gemini: { shirt: '#8b7fc0', trim: '#6d64a1' },
      pi: { shirt: '#3f6b44', trim: '#315737' }
    };
    const palette = palettes[agentType] || { shirt: '#6d7f94', trim: '#546374' };
    const skin = '#f6d1ae';
    const outline = '#2f2a41';
    const hair = '#3b3348';
    const svg = svgPixelNode();
    svg.setAttribute('viewBox', '0 0 18 22');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('pixelAvatar');

    if (variant === 0) {
      rect(svg, 4, 1, 1, 1, hair); rect(svg, 5, 0, 1, 2, hair); rect(svg, 6, 1, 1, 1, hair);
      rect(svg, 11, 1, 1, 1, hair); rect(svg, 12, 0, 1, 2, hair); rect(svg, 13, 1, 1, 1, hair);
    } else if (variant === 1) {
      rect(svg, 4, 0, 2, 4, hair); rect(svg, 12, 0, 2, 4, hair);
      rect(svg, 4, 0, 2, 1, '#f4a7b8'); rect(svg, 12, 0, 2, 1, '#f4a7b8');
    } else {
      rect(svg, 2, 1, 3, 3, hair); rect(svg, 13, 1, 3, 3, hair);
    }

    rect(svg, 3, 10, 12, 6, palette.shirt);
    rect(svg, 8, 10, 2, 1, '#fffaf0');
    rect(svg, 4, 3, 10, 7, skin);
    rect(svg, 4, 2, 10, 2, hair);
    rect(svg, 3, 3, 1, 3, hair); rect(svg, 14, 3, 1, 3, hair);
    rect(svg, 6, 6, 2, 2, outline); rect(svg, 10, 6, 2, 2, outline);
    rect(svg, 7, 8, 1, 1, '#c26060'); rect(svg, 10, 8, 1, 1, '#c26060');
    rect(svg, 8, 8, 2, 1, '#a95050');
    rect(svg, 5, 8, 1, 1, '#f5a8a8'); rect(svg, 12, 8, 1, 1, '#f5a8a8');
    rect(svg, 2, 11, 2, 4, palette.trim); rect(svg, 14, 11, 2, 4, palette.trim);
    rect(svg, 2, 15, 2, 1, skin); rect(svg, 14, 15, 2, 1, skin);
    rect(svg, 6, 16, 2, 4, '#39415d'); rect(svg, 10, 16, 2, 4, '#39415d');
    rect(svg, 5, 20, 3, 2, '#28304b'); rect(svg, 10, 20, 3, 2, '#28304b');
    return svg;
  }

  function machineSubtitle(machine) {
    return `${machine.username}@${machine.host}:${machine.port}`;
  }

  function machineToolsLabel(machine) {
    const tools = (machine.tools || []).map((tool) => agentNames[tool] || tool);
    if (!tools.length) return '';
    return tools.length <= 2 ? tools.join(' / ') : `${tools.slice(0, 2).join(' / ')} +${tools.length - 2}`;
  }

  function checkTime(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function machineCheckText(machine) {
    const checked = checkTime(machine.lastCheckedAt);
    if (!checked) return t("尚未检查 · 点击找任务");
    const status = machine.lastStatus === 'online' ? t("上次连接正常")
      : machine.lastStatus === 'offline' ? t("检查失败 · 保留旧记录") : t("状态待确认");
    return `${status} · ${checked}`;
  }

  function statusText(task) {
    if (task.requiredInput) return t("等待你输入");
    if (task.status === 'running') return t("正在工作");
    if (task.status === 'idle') return t("会话空闲");
    if (task.status === 'error') return t("会话异常");
    if (task.status === 'stopped') return t("已停止");
    if (task.status === 'missing') return t("已消失");
    return task.status || t("未知");
  }

  function actionButton(label, handler, extra) {
    const button = element('button', `smallAction${extra ? ' ' + extra : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  let busyCount = 0;
  function showBusy(text, network) {
    busyCount = Math.max(1, busyCount);
    $('busyText').textContent = text || t("处理中…");
    $('busyNetwork').textContent = network || '';
    if (!network) $('busyElapsed').textContent = '';
    $('busy').classList.remove('hidden');
  }
  function hideBusy() {
    busyCount = Math.max(0, busyCount - 1);
    if (!busyCount) $('busy').classList.add('hidden');
  }

  function updateBusyElapsed(startedAt) {
    const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    $('busyElapsed').textContent = `${t("已等待 ")}${elapsed}${t(" 秒")}`;
  }

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }


  function updateChatLayout() {
    chatLayoutFrame = null;
    if (state.view !== 'butler') return;
    const viewport = window.visualViewport;
    const keyboardOffset = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
    const dock = $('butlerChatDock').getBoundingClientRect();
    const messages = $('piMessages').getBoundingClientRect();
    document.documentElement.style.setProperty('--dock-height', `${dock.height + keyboardOffset}px`);
    const followLatest = $('piMessages').scrollHeight - $('piMessages').clientHeight - $('piMessages').scrollTop < 32;
    document.documentElement.style.setProperty('--chat-height', `${Math.max(0, dock.top - messages.top - 16)}px`);
    if (followLatest) $('piMessages').scrollTop = $('piMessages').scrollHeight;
  }

  function scheduleChatLayout() {
    if (chatLayoutFrame !== null) cancelAnimationFrame(chatLayoutFrame);
    chatLayoutFrame = requestAnimationFrame(updateChatLayout);
  }

  window.addEventListener('resize', scheduleChatLayout);
  window.visualViewport?.addEventListener('resize', scheduleChatLayout);
  window.visualViewport?.addEventListener('scroll', scheduleChatLayout);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(scheduleChatLayout);
    ['butlerChatDock', 'connectionHint'].forEach(id => observer.observe($(id)));
    observer.observe(document.querySelector('.butlerHero'));
  }

  let toastTimer = null;
  function toast(text) {
    $('toast').textContent = text;
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 5200);
  }

  window.phoneDebug = {
    loadStudio: () => loadStudio(),
    snapshot: () => ({
      studioLoading: state.studioLoading,
      studioModel: state.studio?.model || null,
      view: state.view
    })
  };

  loadState().then((ok) => {
    void loadStudio();
    const task = /^#task=([1-9]\d*)$/.exec(window.location.hash);
    if (ok && task && state.tasks.some(item => item.id === Number(task[1]))) {
      openTask(Number(task[1]));
    }
  });
})();
