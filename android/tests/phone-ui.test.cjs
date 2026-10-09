const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const assets = path.resolve(__dirname, '../app/src/main/assets');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function openPhone(t, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 363, height: 800 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce'
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.on('console', m => console.log('PAGE:', m.text()));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('http://phone.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'phone.html';
    const contentType = name.endsWith('.css') ? 'text/css'
      : name.endsWith('.js') ? 'application/javascript'
      : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    const file = name === 'language.js' && options.language === 'en'
      ? path.resolve(assets, '../../en/assets/language.js') : path.join(assets, name);
    return route.fulfill({ body: fs.readFileSync(file), contentType });
  });
  await page.addInitScript(options => {
    const checkedAt = '2026-09-20T03:00:00Z';
    const data = {
      networkHint: '192.168.1',
      machines: [
        { id: 1, name: 'Mac Pro · 开发办公室', username: 'demo', host: '192.168.1.8',
          port: 22, lastStatus: 'online', lastCheckedAt: checkedAt, tools: ['codex', 'claude-code'] },
        { id: 2, name: 'Linux · 测试办公室', username: 'demo', host: '192.168.1.9',
          port: 22, lastStatus: 'offline', lastCheckedAt: checkedAt, tools: ['codex'] }
      ],
      tasks: [
        { id: 1, machineId: 1, title: '修复手机版任务状态显示', agentType: 'codex',
          status: 'running', workSummary: '正在检查状态映射与移动端回归测试',
          workspacePath: '/workspace/agent-session-bridge', controlMode: 'process',
          externalSessionId: 'demo-1', lastOutput: '运行单元测试中' },
        { id: 2, machineId: 1, title: '检查部署配置与远程连接', agentType: 'claude-code',
          status: 'idle', requiredInput: '是否允许执行部署脚本？',
          workSummary: '已完成配置检查，等待确认', controlMode: 'tmux', paneId: '%2' },
        { id: 3, machineId: 2, title: '[Image: original 720x1600, displayed at 360x800. Multiply', agentType: 'codex',
          status: 'idle', workSummary: '最近一次记录：会话空闲', controlMode: 'process' }
      ],
      deletedTasks: []
    };
    if (options.englishSamples) {
      data.machines[0].name = 'Mac Pro · Development';
      data.machines[1].name = 'Linux · Testing';
      Object.assign(data.tasks[0], { title: 'Fix mobile task status',
        workSummary: 'Checking status mapping and mobile regression tests', lastOutput: 'Running unit tests' });
      Object.assign(data.tasks[1], { title: 'Review deployment settings',
        requiredInput: 'May I run the deployment script?', workSummary: 'Checks finished. Waiting for your decision.' });
      data.tasks[2].workSummary = 'Last record: session idle';
    }
    if (options.taskPreviewRecords) Object.assign(data.tasks[0], options.taskPreviewRecords);
    if (options.empty) { data.machines = []; data.tasks = []; }
    if (options.frpStatus) {
      data.frpServer = { machineId: 2, publicAddress: 'public.example.test',
        bindPort: 7001, status: options.frpStatus,
        lastError: options.frpStatus === 'error' ? '部署公网入口失败：阶段 checksum' : '' };
      data.machines[0].publicAccessError = options.frpStatus === 'error'
        ? '连接目标机器 SSH 失败：地址不可达' : '';
      if (options.frpStatus === 'online') {
        data.frpRelays = [{ machineId: 1, enabled: true, status: 'online', verifiedAt: checkedAt }];
      }
    }
    if (options.noCheckedAt) {
      data.machines.forEach(machine => {
        delete machine.lastCheckedAt;
        machine.updatedAt = checkedAt;
      });
    }
    if (options.longText) {
      data.machines[0].name = 'VeryLongOfficeName'.repeat(8);
      data.tasks[0].title = 'VeryLongTaskTitle'.repeat(10);
      data.tasks[0].workspacePath = '/workspace/' + 'long-path'.repeat(20);
    }
    if (options.legacySuggestion) data.tasks[1].suggestedReply = '确认，继续。';
    const ok = data => JSON.stringify({ ok: true, data });
    const fail = error => JSON.stringify({ ok: false, error });
    let reads = 0;
    let operation;
    let tailOperation;
    const studio = {
      date: '2026-09-20', timeZone: 'Asia/Shanghai',
      scope: '当前手机的 SSH 记录、本机记忆和本机模型配置；不经过 Hub。',
      model: { ready: Boolean(options.modelReady), verifiedAt: options.modelVerified ? checkedAt : '', label: options.modelReady ? 'test-model' : '模型未配置' },
      modelSettings: {
        enabled: Boolean(options.modelReady), provider: 'openai-compatible',
        modelId: options.modelReady ? 'test-model' : '', baseUrl: options.modelReady ? 'https://model.example.test/v1' : '',
        hasApiKey: Boolean(options.modelReady), source: options.modelReady ? 'local' : 'unconfigured'
      },
      machines: [], tasks: [], memories: [], messages: [],
      dailyReport: null, reportHistory: [],
      report: { completed: [], ongoing: [], suggestions: [] }
    };
    window.sendCount = 0;
    window.suggestionCount = 0;
    const suggestionOperations = new Map();
    window.chatCount = 0;
    window.chatOperationsCleared = [];
    window.allowChatPoll = false;
    window.speechTexts = [];
    window.tailCount = 0;
    window.voiceCalls = [];
    window.callCalls = [];
    let chatOperation;
    let modelCheckOperation;
    let hasVoiceKey = false;
    window.AgentBridge = {
      state: () => ++reads > 1 && options.stateFails
        ? fail('读取失败') : ok(data),
      studioOverview: () => ok(studio),
      generateReplySuggestions: id => {
        if (options.suggestionFails) return fail('模型返回 HTTP 401，请检查 API Key');
        const task = structuredClone(data.tasks.find(item => item.id === id));
        return ok({ source: 'model', context: task, decisionRequired: Boolean(task.requiredInput),
          summary: `回应任务 ${id} 的待处理问题`, choices: options.invalidSuggestions ? [] : [
            { label: '先看影响', text: '请列出这次操作的影响范围和回滚步骤，我看完再决定。', intent: 'clarify' },
            { label: '暂缓操作', text: options.longSuggestion ? '说明需要补充的验证信息。'.repeat(35)
              : '先暂停执行，保留当前状态，等我确认。', intent: 'hold' }
          ] });
      },
      beginBridgeCall: (method, args) => {
        if (method !== 'generateReplySuggestions') return fail('不支持的测试方法');
        window.suggestionCount += 1;
        const result = JSON.parse(window.AgentBridge.generateReplySuggestions(JSON.parse(args)[0]));
        const operation = { id: `suggestion-${window.suggestionCount}`, state: 'running', result };
        suggestionOperations.set(operation.id, operation);
        return ok({ operation });
      },
      saveStudioModel: payload => {
        const input = JSON.parse(payload);
        studio.modelSettings = {
          enabled: true, provider: 'openai-compatible', modelId: input.modelId,
          baseUrl: input.baseUrl, hasApiKey: true, source: 'local'
        };
        studio.model = { ready: true, label: input.modelId };
        return ok(studio);
      },
      beginStudioModelCheck: () => {
        studio.model.verifiedAt = options.modelCheckFails ? '' : checkedAt;
        modelCheckOperation = { id: 'test-model-check', state: options.modelCheckFails ? 'failed' : 'succeeded',
          message: options.modelCheckFails ? '模型返回 HTTP 401，请检查 API Key' : '模型连接成功', studio };
        return ok({ operation: modelCheckOperation });
      },
      discoverTasks: id => (options.failedIds || []).includes(id)
        ? fail('SSH 无法连接') : ok({ tasks: data.tasks }),
      tailTask: () => {
        if (options.taskDisappears) data.tasks.shift();
        else {
          data.tasks[0].status = 'idle';
          data.tasks[0].workSummary = '会话已空闲，尚未验收';
          data.tasks[0].lastOutput = '最新输出';
        }
        return ok({});
      },
      deleteTask: id => {
        const index = data.tasks.findIndex(task => task.id === id);
        if (index < 0) return fail('员工不存在');
        const [task] = data.tasks.splice(index, 1);
        task.deletedAt = checkedAt;
        data.deletedTasks.push(task);
        return ok({ tasks: data.tasks, deletedTasks: data.deletedTasks });
      },
      restoreDeletedTask: id => {
        const index = data.deletedTasks.findIndex(task => task.id === id);
        if (index < 0) return fail('已删除员工不存在');
        const [task] = data.deletedTasks.splice(index, 1);
        delete task.deletedAt;
        data.tasks.push(task);
        return ok({ tasks: data.tasks, deletedTasks: data.deletedTasks });
      },
      beginSendPrompt: () => {
        window.sendCount += 1;
        if (options.rejectSend) return fail('会话暂时无法连接，请稍后重试');
        operation = { kind: 'send', id: 'test-send', startedAt: Date.now(),
          task: structuredClone(data.tasks[0]) };
        return ok({ operation });
      },
      beginTailTask: id => {
        window.tailCount += 1;
        const task = data.tasks.find(item => item.id === id) || data.tasks[0];
        tailOperation = { kind: 'tail', id: 'test-tail', startedAt: Date.now(),
          taskId: id, stableKey: task.stableKey || '', machineId: task.machineId };
        return ok({ operation: tailOperation });
      },
      operationState: id => {
        if (suggestionOperations.has(id)) {
          const operation = suggestionOperations.get(id);
          return ok({ operation: { ...operation,
            state: options.holdSuggestions && !window.releaseSuggestions ? 'running' : 'succeeded' } });
        }
        if (id === 'test-model-check') return ok({ operation: modelCheckOperation });
        if (chatOperation) {
          if (options.chatPollFails && !window.allowChatPoll) return fail('临时状态读取失败');
          return ok({ operation: chatOperation });
        }
        const current = operation?.kind === 'send' && (!tailOperation || window.sendCount)
          ? operation : tailOperation;
        if (!current) return fail('后台任务不存在');
        if (current.kind === 'send' && options.holdSend && !window.releaseSend) {
          return ok({ operation: { ...current, state: 'running', message: '执行中' } });
        }
        if (options.sendFails) {
          return ok({ operation: { ...current, state: 'failed', message: '发送失败' } });
        }
        if (current.kind === 'tail') {
          if (options.taskDisappears) data.tasks.shift();
          else {
            data.tasks[0].status = 'idle';
            data.tasks[0].workSummary = '会话已空闲，尚未验收';
            data.tasks[0].lastOutput = '最新输出';
          }
          return ok({ operation: { ...current, state: 'succeeded', message: '任务输出已刷新' } });
        }
        data.tasks[0].status = 'idle';
        data.tasks[0].lastOutput = '回复后的新输出';
        data.tasks[0].workSummary = '回复已结束，等待下一条指令';
        return ok({ operation: { ...current, state: 'succeeded', message: '回复已发送',
          task: structuredClone(data.tasks[0]) } });
      },
      clearOperation: id => window.chatOperationsCleared.push(id),
      beginStudioMessage: content => {
        window.chatCount += 1;
        chatOperation = { kind: 'chat', id: 'test-chat', state: options.chatFails ? 'failed' : 'succeeded',
          message: options.chatFails ? '模型返回 HTTP 401，请检查 API Key' : '管家已回复',
          studio: { ...studio, messages: [
            { role: 'user', content },
            { role: 'assistant', content: '通话测试回复：先处理待输入员工。' }
          ] } };
        if (options.chatCommittedWhilePollLost) {
          studio.messages = [
            { id: 'studio-test-chat-user', role: 'user', content },
            { id: 'studio-test-chat-assistant', role: 'assistant', content: '已保存的唯一回复' }
          ];
        }
        if (options.chatReplyCorrelation) {
          chatOperation.studio.reply = { role: 'assistant', content: '属于这次请求的回复' };
          chatOperation.studio.messages.push({ role: 'assistant', content: '其他请求的回复' });
        }
        return ok({ operation: chatOperation });
      },
      startVoiceInput: autoSend => {
        window.voiceCalls.push(['start', autoSend]);
        return ok({ recording: true });
      },
      stopVoiceInput: () => {
        window.voiceCalls.push(['stop']);
        return ok({ recording: false });
      },
      cancelVoiceInput: () => {
        window.voiceCalls.push(['cancel']);
        return ok({ recording: false });
      },
      speakText: text => {
        window.speechTexts.push(text);
        window.callCalls.push(['speak']);
        return ok({ speaking: true });
      },
      startConversationAudio: speaker => {
        window.callCalls.push(['start', speaker]);
        return ok({ callAudio: true });
      },
      setConversationSpeaker: speaker => {
        window.callCalls.push(['speaker', speaker]);
        return ok({ speakerOn: speaker });
      },
      stopConversationAudio: () => {
        window.callCalls.push(['stop']);
        return ok({ callAudio: false });
      },
      setTtsSettings: (rate, pitch) => {
        window.callCalls.push(['tts-settings', rate, pitch]);
        return ok({ rate, pitch });
      },
      getTtsStatus: () => ok({ ready: !options.voiceUnavailable || hasVoiceKey,
        recognitionAvailable: !options.voiceUnavailable, cloudAvailable: hasVoiceKey,
        hasVoiceKey, microphoneGranted: true, engine: 'test-engine', language: 'zh-CN' }),
      saveVoiceService: payload => {
        const input = JSON.parse(payload);
        hasVoiceKey = input.clear ? false : Boolean(input.apiKey) || hasVoiceKey;
        return ok({ hasVoiceKey });
      }
    };
    if (options.savedCredentials) {
      Object.assign(data.machines[0], { hasPassword: true, password: 'must-not-appear' });
    }
    // Keep older fixtures on their direct-call path; suggestion scenarios
    // expose the new drafting operation explicitly.
    if (!options.modelReady) delete window.AgentBridge.beginBridgeCall;
    if (options.hostKeyChanged) {
      Object.assign(data.machines[0], { lastStatus: 'offline',
        lastError: '「Mac Pro · 开发办公室」的 SSH 主机指纹和上次不一致，已拒绝连接。' });
    }
    if (options.voiceAutoSendOff) localStorage.setItem('voiceAutoSend', 'false');
    if (options.backgroundCalls) {
      // Native runs SSH-bound methods on a worker thread; the page polls.
      window.backgroundCalls = [];
      let backgroundOperation = null;
      const plainOperationState = window.AgentBridge.operationState;
      window.AgentBridge.beginBridgeCall = (method, args) => {
        window.backgroundCalls.push(method);
        backgroundOperation = { id: `bg-${window.backgroundCalls.length}`, state: 'running',
          method, args: JSON.parse(args) };
        return ok({ operation: backgroundOperation });
      };
      window.AgentBridge.operationState = id => {
        if (backgroundOperation && id === backgroundOperation.id) {
          const result = JSON.parse(window.AgentBridge[backgroundOperation.method](...backgroundOperation.args));
          return ok({ operation: { ...backgroundOperation, state: 'succeeded', result } });
        }
        return plainOperationState(id);
      };
    }
  }, options);
  await page.goto('http://phone.test/phone.html');
  await page.locator(options.empty ? '.empty' : '.employee').first().waitFor();
  return page;
}

async function expectToast(page, text) {
  await page.waitForFunction(expected =>
    document.getElementById('toast').textContent === expected, text);
}

test('English app localizes controls while preserving session text and human drafts', async t => {
  const page = await openPhone(t, { language: 'en', modelReady: true, modelVerified: true });
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('h1').textContent(), 'Office Town');
  for (const width of [320, 363, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  }
  assert.equal(await page.locator('[data-view="butler"]').textContent(), 'Butler');
  assert.match(await page.locator('[data-task-id="1"]').textContent(), /修复手机版任务状态显示/);
  await page.locator('[data-task-id="1"]').click();
  assert.doesNotMatch(await page.locator('#sendTask').textContent(), /[\u4e00-\u9fff]/);
  const draft = '保留这条中文回复 / Keep this exact text.';
  await page.locator('#replyText').fill(draft);
  await page.keyboard.press('Escape');
  await page.locator('[data-task-id="1"]').click();
  assert.equal(await page.locator('#replyText').inputValue(), draft);
  await page.keyboard.press('Escape');
  await page.locator('[data-view="butler"]').click();
  assert.doesNotMatch(await page.locator('#piInput').getAttribute('placeholder'), /[\u4e00-\u9fff]/);
  await page.locator('#startCall').click();
  await page.locator('#callBackdrop').waitFor();
  assert.doesNotMatch(await page.locator('#callBackdrop').textContent(), /[\u4e00-\u9fff]/);
  await page.locator('#callEnd').click();
});

test('compact office controls, responsive layout and navigation', async t => {
  const page = await openPhone(t);
  for (const width of [320, 363, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  }
  await page.setViewportSize({ width: 363, height: 800 });
  const office = page.locator('.office').first();
  assert.equal(await office.locator('.officeActions button:visible').count(), 2);
  assert.equal(await office.getByRole('button', { name: '删除', exact: true }).isVisible(), false);
  assert.match(await office.locator('.officeCheck').textContent(), /上次连接正常.*2026\/09\/20 11:00/);
  assert.match(await page.locator('.employee').nth(2).locator('.employeeName').textContent(), /图片输入/);
  assert.doesNotMatch(await page.locator('.employee').nth(2).textContent(), /\[Image:/);
  await office.getByRole('button', { name: '更多', exact: true }).click();
  assert.equal(await office.getByRole('button', { name: '删除', exact: true }).isVisible(), true);
  await office.getByRole('button', { name: '收起', exact: true }).click();
  assert.equal(await office.locator('.employee').count(), 0);
  await page.reload();
  await page.locator('.officeCollapsedSummary').first().waitFor();
  await office.getByRole('button', { name: '更多', exact: true }).click();
  await office.getByRole('button', { name: '展开', exact: true }).click();
  assert.equal(await office.locator('.employee').count(), 2);
  if (process.env.SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'phone-offices.png') });
  }
  await page.locator('[data-view="todo"]').click();
  assert.equal(await page.locator('.todoCard').count(), 1);
  await page.locator('.todoCard').click();
  assert.match(await page.locator('#taskMeta').textContent(), /tmux · 可回复/);
  await page.locator('[data-close="taskBackdrop"]').click();
  await page.locator('[data-view="public"]').click();
  await page.getByRole('button', { name: '开始配置', exact: true }).click();
  assert.equal(await page.locator('#frpForm').isVisible(), true);
});

test('refresh reports success, partial failure and total failure accurately', async t => {
  for (const [failedIds, expected] of [
    [[], '任务已刷新'],
    [[2], '已刷新 1/2 台，其余保留上次记录'],
    [[1, 2], '刷新失败，保留上次记录']
  ]) {
    await t.test(expected, async t => {
      const page = await openPhone(t, { failedIds });
      await page.locator('#refreshAll').click();
      await expectToast(page, expected);
    });
  }
});

test('SSH-bound calls run as native background operations and keep their results', async t => {
  const page = await openPhone(t, { backgroundCalls: true, failedIds: [2] });
  await page.locator('#refreshAll').click();
  await expectToast(page, '已刷新 1/2 台，其余保留上次记录');
  assert.deepEqual(await page.evaluate(() => window.backgroundCalls), ['discoverTasks', 'discoverTasks']);
});

test('saved SSH credentials are never put back into the edit form', async t => {
  const page = await openPhone(t, { savedCredentials: true });
  const office = page.locator('.office').first();
  await office.getByRole('button', { name: '更多' }).click();
  await office.getByRole('button', { name: '编辑' }).click();
  await page.locator('#machineBackdrop').waitFor();
  assert.equal(await page.locator('#machinePassword').inputValue(), '');
  assert.match(await page.locator('#machinePassword').getAttribute('placeholder'), /已保存/);
  assert.equal(await page.evaluate(() => document.body.innerHTML.includes('must-not-appear')), false);
});

test('a changed host key offers an explicit reset instead of a silent retry', async t => {
  const page = await openPhone(t, { hostKeyChanged: true });
  await page.locator('.office').first().getByRole('button', { name: '重置主机指纹' }).waitFor();
  assert.equal(await page.locator('.office').nth(1).getByRole('button', { name: '重置主机指纹' }).count(), 0);
});

test('state read failure is not replaced by a success toast', async t => {
  const page = await openPhone(t, { stateFails: true });
  await page.locator('#refreshAll').click();
  await expectToast(page, '读取失败');
  assert.equal(await page.locator('.employee').count(), 3);
});

test('detail refresh updates status and output without clearing a draft', async t => {
  const page = await openPhone(t);
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('尚未发送的草稿');
  await page.locator('#tailTask').click();
  await expectToast(page, '刷新输出已提交后台，完成后会通知你');
  await page.waitForFunction(() => document.getElementById('taskOutput').textContent === '最新输出');
  assert.match(await page.locator('#taskStatusLine').textContent(), /会话空闲/);
  assert.equal(await page.locator('#replyText').inputValue(), '尚未发送的草稿');
});

test('reply completion displays fresh state, not the initial operation snapshot', async t => {
  const page = await openPhone(t);
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('测试消息，不发送到真实机器');
  await page.locator('#sendTask').click();
  await expectToast(page, '消息已提交，发送结果会通知你');
  await page.waitForFunction(() => document.getElementById('sendTask').disabled === false);
  assert.equal(await page.locator('#taskOutput').textContent(), '回复后的新输出');
  assert.match(await page.locator('#taskStatusLine').textContent(), /会话空闲/);
  assert.equal(await page.locator('#replyText').inputValue(), '');
});

test('a missing task cannot receive another reply', async t => {
  const page = await openPhone(t, { taskDisappears: true });
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#tailTask').click();
  await expectToast(page, '刷新输出已提交后台，完成后会通知你');
  await page.waitForFunction(() => /本次未发现/.test(document.getElementById('taskStatusLine').textContent));
  assert.match(await page.locator('#taskStatusLine').textContent(), /本次未发现/);
});

test('editing timestamps are not presented as connection checks', async t => {
  const page = await openPhone(t, { noCheckedAt: true });
  assert.equal(await page.locator('.officeCheck').first().textContent(), '尚未检查 · 点击找任务');
});

test('long titles and paths fit narrow screens', async t => {
  const page = await openPhone(t, { longText: true });
  await page.setViewportSize({ width: 320, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await page.locator('[data-task-id="1"]').click();
  assert.equal(await page.locator('.taskSheet').evaluate(el => el.scrollWidth <= el.clientWidth), true);
});

test('empty state does not imply active supervision', async t => {
  const page = await openPhone(t, { empty: true });
  await page.locator('[data-view="todo"]').click();
  assert.match(await page.locator('#todo').textContent(), /暂无待输入记录.*检查最新会话状态/);
  assert.equal(await page.locator('#attentionCount').isDisabled(), true);
  await page.locator('#refreshAll').click();
  await page.locator('#machineForm').waitFor({ state: 'visible' });
});

test('attention shortcut and employee ordering prioritize pending input', async t => {
  const page = await openPhone(t);
  assert.equal(await page.locator('.employee').first().getAttribute('data-task-id'), '2');
  assert.equal(await page.locator('#todoTab').textContent(), '待输入 · 1');
  await page.locator('#attentionCount').click();
  assert.equal(await page.locator('#todoTab').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#todo').isVisible(), true);
  await page.locator('.todoCard').click();
  assert.equal(await page.locator('#taskNeed').textContent(), '需要你确认：是否允许执行部署脚本？');
  if (process.env.SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'phone-task.png') });
  }
});

test('town butler shortcut opens chat without submitting a message', async t => {
  for (const language of ['zh-CN', 'en']) {
    const page = await openPhone(t, { language, modelReady: true });
    const shortcut = page.locator('.townButler');
    assert.match(await shortcut.textContent(), language === 'en'
      ? /Talk to the butler.*Check progress and pending replies/
      : /找管家聊聊.*问进度，找待回复的任务/);
    await shortcut.click();
    assert.equal(await page.locator('#butler').isVisible(), true);
    assert.equal(await page.locator('.tab[data-view="butler"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.chatCount), 0);
    await page.locator('[data-view="offices"]').click();
    await page.locator('[data-task-id="2"]').click();
    assert.match(await page.locator('#taskNeed').textContent(), /是否允许执行部署脚本/);
  }
});

test('office connection details stay available behind expanded controls', async t => {
  const page = await openPhone(t);
  const office = page.locator('.office').first();
  const address = office.locator('.officeMeta > span').first();
  const more = office.getByRole('button', { name: '更多', exact: true });
  assert.equal(await address.isVisible(), false);
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
  await more.click();
  assert.equal(await more.getAttribute('aria-expanded'), 'true');
  assert.equal(await address.isVisible(), true);
  assert.match(await address.textContent(), /demo@192\.168\.1\.8:22/);
  assert.equal(await office.locator('.officeCheck').isVisible(), true);
  await more.click();
  assert.equal(await address.isVisible(), false);
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
});

test('offline employees show historical status with no work animation', async t => {
  const page = await openPhone(t);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const recorded = page.locator('[data-task-id="3"]');
  assert.equal(await recorded.getAttribute('data-record'), 'true');
  assert.equal(await recorded.locator('.employeeBubble').textContent(), '上次');
  assert.match(await recorded.locator('.stateChip').textContent(), /上次：会话空闲/);
  // Query and read in one page task: the office can re-render when the
  // butler overview finishes loading, and a replaced node reports no style.
  const animation = selector => page.evaluate(css => {
    const node = document.querySelector(css);
    return { name: node ? getComputedStyle(node).animationName : 'missing',
      connected: Boolean(node && node.isConnected),
      state: node ? node.closest('[data-task-id]')?.getAttribute('data-state') : null };
  }, selector);
  const idle = await animation('[data-task-id="3"] .pixelAvatar');
  assert.equal(idle.name, 'none', JSON.stringify(idle));
  const running = await animation('[data-task-id="1"] .pixelAvatar');
  assert.notEqual(running.name, 'none', JSON.stringify(running));
});

test('task drafts remain separate when closing and reopening sheets', async t => {
  const page = await openPhone(t);
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('任务一的草稿');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#taskBackdrop').isVisible(), false);
  assert.equal(await page.evaluate(() => document.body.classList.contains('sheetOpen')), false);
  await page.locator('[data-task-id="2"]').click();
  assert.equal(await page.locator('#replyText').inputValue(), '');
  await page.locator('#replyText').fill('任务二的草稿');
  assert.equal(await page.evaluate(() => window.phoneUI.closeTopSheet()), true);
  await page.locator('[data-task-id="1"]').click();
  assert.equal(await page.locator('#replyText').inputValue(), '任务一的草稿');
  await page.locator('[data-close="taskBackdrop"]').click();
  await page.locator('[data-task-id="2"]').click();
  assert.equal(await page.locator('#replyText').inputValue(), '任务二的草稿');
});

test('modal contains focus, locks background and restores focus on close', async t => {
  const page = await openPhone(t);
  const trigger = page.locator('[data-task-id="1"]');
  await trigger.focus();
  await trigger.click();
  assert.equal(await page.evaluate(() => document.querySelector('.app').hasAttribute('inert')), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
  await page.locator('[data-close="taskBackdrop"]').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.matches('.taskTools summary')), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.close), 'taskBackdrop');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.taskId), '1');
  assert.equal(await page.evaluate(() => document.querySelector('.app').hasAttribute('inert')), false);
});

test('confirmed sends update from operation data even if state reads fail', async t => {
  const page = await openPhone(t, { stateFails: true });
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('只发送一次');
  await page.locator('#sendTask').click();
  await expectToast(page, '消息已提交，发送结果会通知你');
  await page.waitForFunction(() => document.getElementById('sendTask').disabled === false);
  assert.equal(await page.locator('#replyText').inputValue(), '');
  await page.locator('[data-close="taskBackdrop"]').click();
  await page.locator('[data-task-id="1"]').click();
  assert.equal(await page.locator('#replyText').inputValue(), '');
});

test('failed replies retain the draft for correction', async t => {
  const page = await openPhone(t, { sendFails: true });
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('需要保留的回复');
  await page.locator('#sendTask').click();
  await expectToast(page, '发送失败');
  assert.equal(await page.locator('#sendTask').isEnabled(), true);
  await page.locator('[data-close="taskBackdrop"]').click();
  await page.locator('[data-task-id="1"]').click();
  assert.equal(await page.locator('#replyText').inputValue(), '需要保留的回复');
});

test('background sending prevents duplicate submissions and allows navigation', async t => {
  const page = await openPhone(t, { holdSend: true });
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('测试并发点击');
  await page.evaluate(() => {
    const button = document.getElementById('sendTask');
    button.dispatchEvent(new Event('click'));
    button.dispatchEvent(new Event('click'));
  });
  await page.waitForFunction(() => window.sendCount === 1);
  assert.equal(await page.evaluate(() => window.phoneUI.closeTopSheet()), true);
  assert.equal(await page.locator('#taskBackdrop').isVisible(), false);
  assert.equal(await page.locator('#sendTask').isDisabled(), true);
  await page.evaluate(() => { window.releaseSend = true; });
  await page.waitForFunction(() => /^通知|^后台/.test(document.getElementById('backgroundState').textContent)
    && !document.getElementById('backgroundState').textContent.startsWith('后台'));
  assert.equal(await page.evaluate(() => window.sendCount), 1);
  await page.locator('[data-task-id="1"]').click();
  assert.equal(await page.locator('#sendTask').isEnabled(), true);
});

test('unidentified sessions cannot receive a reply', async t => {
  const page = await openPhone(t);
  await page.locator('[data-task-id="3"]').click();
  assert.equal(await page.locator('#sendTask').isDisabled(), true);
  assert.match(await page.locator('#taskMeta').textContent(), /无会话 ID，暂不能回复/);
});

test('deleted employees move to a separate restorable list', async t => {
  const page = await openPhone(t);
  assert.equal(await page.locator('.employee').count(), 3);
  const dialogs = [];
  page.on('dialog', dialog => {
    dialogs.push(dialog.message());
    dialog.accept();
  });
  await page.locator('[data-task-id="1"]').click();
  await page.locator('.taskTools summary').click();
  await page.locator('#deleteTask').click();
  await page.waitForFunction(() => document.body.innerText.includes('删除列表'));
  assert.equal(await page.locator('.employee').count(), 2);
  assert.equal(await page.locator('.deletedEmployee').count(), 1);
  assert.match(await page.locator('.deletedEmployee').textContent(), /修复手机版任务状态显示/);
  assert.equal(dialogs.some(message => message.includes('不会删除机器上的项目、会话记录或文件')), true);
  await page.locator('.deletedEmployee button', { hasText: '恢复' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.employee').length === 3);
  assert.equal(await page.locator('.deletedEmployee').count(), 0);
});

test('butler model is configured directly without a Hub dependency', async t => {
  const page = await openPhone(t, { modelReady: false });
  await page.locator('[data-view="butler"]').click();
  assert.equal(await page.locator('#cloudState').textContent(), '配置模型');
  assert.equal(await page.locator('#sendPi').isDisabled(), true);
  await page.locator('#openCloudFromButler').click();
  await page.locator('#modelBaseUrl').fill('https://model.example.test/v1');
  await page.locator('#modelId').fill('test-model');
  await page.locator('#modelApiKey').fill('test-only-secret');
  await page.locator('#cloudForm button[type="submit"]').click();
  await page.waitForFunction(() => document.getElementById('cloudState').textContent === '模型待验证');
  assert.equal(await page.locator('#cloudBackdrop').isVisible(), true);
  await page.locator('#testModelConnection').click();
  await page.waitForFunction(() => document.getElementById('cloudState').textContent === '模型已验证');
  assert.equal(await page.locator('#piMeta').textContent(), 'test-model');
  assert.equal(await page.locator('#modelApiKey').inputValue(), '');
  assert.equal(await page.evaluate(() => document.body.innerText.includes('test-only-secret')), false);
});

test('failed model verification stays visible and does not claim a connection', async t => {
  const page = await openPhone(t, { modelReady: true, modelCheckFails: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#checkButlerModel').click();
  await page.waitForFunction(() => document.getElementById('butlerConnectionText').textContent.includes('HTTP 401'));
  assert.equal(await page.locator('#cloudState').textContent(), '连接异常');
  assert.equal(await page.locator('#checkButlerModel').isEnabled(), true);
});

test('chat errors preserve the message and a working retry after a refresh', async t => {
  const page = await openPhone(t, { modelReady: true, chatFails: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#piInput').fill('请帮我看今天的进展');
  await page.locator('#sendPi').click();
  await page.getByRole('button', { name: '重试这条消息' }).waitFor();
  assert.equal(await page.locator('#piInput').inputValue(), '请帮我看今天的进展');
  assert.match(await page.locator('#piMessages').textContent(), /HTTP 401/);
  await page.locator('#refreshButler').click();
  await page.getByRole('button', { name: '重试这条消息' }).waitFor();
  await page.getByRole('button', { name: '重试这条消息' }).click();
  await page.waitForFunction(() => window.chatCount === 2);
});

test('lost chat polling resumes the same submitted turn and preserves a new draft', async t => {
  const page = await openPhone(t, { modelReady: true, chatPollFails: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#piInput').fill('只提交一次的消息');
  await page.locator('#sendPi').click();
  await page.getByRole('button', { name: '继续查看回复' }).waitFor();
  assert.equal(await page.evaluate(() => window.chatCount), 1);
  assert.equal(await page.evaluate(() => window.chatOperationsCleared.includes('test-chat')), false);
  await page.locator('#piInput').fill('另一条草稿');
  assert.equal(await page.locator('#sendPi').isDisabled(), true);
  await page.evaluate(() => { window.allowChatPoll = true; });
  await page.getByRole('button', { name: '继续查看回复' }).click();
  await page.waitForFunction(() => window.chatOperationsCleared.includes('test-chat'));
  assert.equal(await page.evaluate(() => window.chatCount), 1);
  assert.equal(await page.locator('#piInput').inputValue(), '另一条草稿');
  assert.match(await page.locator('#piMessages').textContent(), /通话测试回复/);
});

test('a committed reply is recovered from storage when its operation is unavailable', async t => {
  const page = await openPhone(t, { modelReady: true, chatPollFails: true, chatCommittedWhilePollLost: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#piInput').fill('已成功但没读到状态');
  await page.locator('#sendPi').click();
  await page.waitForFunction(() => document.getElementById('piMessages').textContent.includes('已保存的唯一回复'));
  assert.equal(await page.getByRole('button', { name: '重试这条消息' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '继续查看回复' }).count(), 0);
  assert.equal(await page.evaluate(() => window.chatCount), 1);
});

test('speech uses the reply belonging to this request rather than the last history entry', async t => {
  const page = await openPhone(t, { modelReady: true, chatReplyCorrelation: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#piInput').fill('给我本次回复');
  await page.locator('#sendPi').click();
  await page.waitForFunction(() => window.speechTexts.length > 0);
  assert.equal(await page.evaluate(() => window.speechTexts[0]), '属于这次请求的回复');
});

test('call setup shows missing voice services and stores a separate voice key without exposing it', async t => {
  const page = await openPhone(t, { modelReady: true, voiceUnavailable: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.locator('#voiceBackdrop').waitFor();
  assert.equal(await page.locator('#callBackdrop').isHidden(), true);
  assert.match(await page.locator('#voiceInputStatus').textContent(), /尚未就绪/);
  await page.locator('#voiceApiKey').fill('voice-test-secret');
  await page.locator('#saveVoiceService').click();
  assert.equal(await page.locator('#voiceApiKey').inputValue(), '');
  assert.match(await page.locator('#voiceServiceState').textContent(), /独立密钥已保存/);
  assert.equal(await page.evaluate(() => document.body.innerText.includes('voice-test-secret')), false);
  await page.locator('#voiceBackdrop [data-close]').click();
  await page.locator('#startCall').click();
  await page.locator('#callBackdrop').waitFor();
  await page.locator('#callEnd').click();
});

test('butler puts chat above collapsed planning without horizontal overflow', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  assert.equal(await page.locator('#butlerPlanDetails').getAttribute('open'), null);
  await page.waitForFunction(() => document.getElementById('piMessages').getBoundingClientRect().bottom <= document.getElementById('butlerChatDock').getBoundingClientRect().top);
  const layout = await page.evaluate(() => ({
    chatBottom: document.getElementById('piMessages').getBoundingClientRect().bottom,
    dockTop: document.getElementById('butlerChatDock').getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > innerWidth
  }));
  assert.equal(layout.overflow, false);
  assert.ok(layout.chatBottom <= layout.dockTop, JSON.stringify(layout));
});

test('call mode waits for microphone readiness before inviting the user to speak', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.waitForFunction(() => window.voiceCalls.some(call => call[0] === 'start'));
  assert.match(await page.locator('#callStatus').textContent(), /接通/);
  assert.match(await page.locator('#callTranscript').textContent(), /准备好后再说话/);
  assert.doesNotMatch(await page.locator('#callTranscript').textContent(), /通话已接通/);
  await page.evaluate(() => window.phoneVoice.update({ type: 'cloud-recording' }));
  assert.match(await page.locator('#callStatus').textContent(), /聆听/);
  assert.match(await page.locator('#callTranscript').textContent(), /通话已接通/);
  await page.locator('#callMute').click();
  await page.locator('#callMute').click();
  assert.match(await page.locator('#callStatus').textContent(), /接通/);
  await page.evaluate(() => window.phoneVoice.update({ type: 'ready' }));
  assert.match(await page.locator('#callStatus').textContent(), /聆听/);
  await page.locator('#callEnd').click();
});

test('call mode supports voice in, TTS out, and continuous listening', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.locator('#callBackdrop').waitFor();
  assert.match(await page.locator('#callStatus').textContent(), /聆听|接通/);
  const avatarLayout = await page.evaluate(() => {
    const avatar = document.querySelector('#callAvatar .pixelAvatar').getBoundingClientRect();
    const stage = document.querySelector('.callStage').getBoundingClientRect();
    return avatar.top >= stage.top && avatar.bottom <= stage.bottom
      && avatar.left >= stage.left && avatar.right <= stage.right;
  });
  assert.equal(avatarLayout, true);
  assert.equal(await page.locator('.app').getAttribute('inert'), '');
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'start' && call[1] === true)), true);
  await page.evaluate(() => window.phoneVoice.update({
    type: 'final', text: '今天最应该先处理什么？', autoSend: true
  }));
  await page.waitForFunction(() => document.getElementById('callTranscript').textContent.includes('通话测试回复'));
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'speak')), true);
  assert.match(await page.locator('#callStatus').textContent(), /播报/);
  await page.evaluate(() => window.phoneVoice.update({ type: 'speak-ended' }));
  await page.waitForFunction(() => window.voiceCalls.some(call => call[0] === 'start' && call[1] === true));
  await page.locator('#callSpeaker').click();
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'speaker' && call[1] === false)), true);
  await page.locator('#callMute').click();
  assert.match(await page.locator('#callStatus').textContent(), /静音/);
  await page.locator('#callEnd').click();
  assert.equal(await page.locator('#callBackdrop').isHidden(), true);
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'stop')), true);
});

test('call mode keeps listening after a recognizer error and shows live partials', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.locator('#callBackdrop').waitFor();
  await page.evaluate(() => window.phoneVoice.update({ type: 'partial', text: '帮我看下登录' }));
  assert.match(await page.locator('#callTranscript').textContent(), /帮我看下登录/);
  await page.evaluate(() => {
    window.__startCountBeforeError = window.voiceCalls.filter(call => call[0] === 'start').length;
  });
  await page.evaluate(() => window.phoneVoice.update({ type: 'error', text: '没有听到内容' }));
  assert.match(await page.locator('#callStatus').textContent(), /异常/);
  await page.waitForFunction(() => window.voiceCalls.filter(call => call[0] === 'start').length
    > window.__startCountBeforeError);
  await page.evaluate(() => window.phoneVoice.update({ type: 'cloud-recording' }));
  assert.match(await page.locator('#callStatus').textContent(), /聆听/);
  assert.doesNotMatch(await page.locator('#callTranscript').textContent(), /没有听到内容/);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const starts = await page.evaluate(() => window.voiceCalls.filter(call => call[0] === 'start').length);
    await page.evaluate(() => window.phoneVoice.update({ type: 'error', text: '临时断线' }));
    await page.waitForFunction(before => window.voiceCalls.filter(call => call[0] === 'start').length > before, starts);
    await page.evaluate(() => window.phoneVoice.update({ type: 'cloud-recording' }));
    assert.match(await page.locator('#callStatus').textContent(), /聆听/);
    assert.doesNotMatch(await page.locator('#callTranscript').textContent(), /临时断线|连续失败/);
    assert.equal(await page.locator('#callMute').getAttribute('aria-pressed'), 'false');
  }
  await page.locator('#callEnd').click();
});

test('call mode ends on a denied microphone and leaves saved voice preferences alone', async t => {
  const page = await openPhone(t, { modelReady: true, voiceAutoSendOff: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.locator('#callBackdrop').waitFor();
  await page.evaluate(() => window.phoneVoice.update({ type: 'permission-denied', text: '需要麦克风权限才能使用语音' }));
  await page.locator('#callBackdrop').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => localStorage.getItem('voiceAutoSend')), 'false');
});

test('call mode stops retrying after repeated recognizer errors', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.locator('#callBackdrop').waitFor();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => window.phoneVoice.update({ type: 'error', text: 'ASR 连接失败' }));
  }
  await page.waitForFunction(() => document.getElementById('callTranscript').textContent.includes('连续失败 3 次'));
  const starts = await page.evaluate(() => window.voiceCalls.filter(call => call[0] === 'start').length);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(await page.evaluate(() => window.voiceCalls.filter(call => call[0] === 'start').length), starts);
  await page.locator('#callEnd').click();
});

test('call mode completes the cloud-recording voice loop', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.locator('#callBackdrop').waitFor();
  await page.evaluate(() => {
    window.voiceCalls.length = 0;
    window.phoneVoice.update({ type: 'cloud-recording', text: '', autoSend: true });
    window.phoneVoice.update({ type: 'level', text: '42', autoSend: true });
  });
  assert.match(await page.locator('#callStatus').textContent(), /聆听/);
  await page.evaluate(() => window.phoneVoice.update({ type: 'cloud-processing', text: '', autoSend: true }));
  assert.match(await page.locator('#callStatus').textContent(), /思考/);
  await page.evaluate(() => {
    window.phoneVoice.update({ type: 'final', text: '帮我看下今天先做哪个', autoSend: true });
  });
  await page.waitForFunction(() => document.getElementById('callTranscript').textContent.includes('通话测试回复'));
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'speak')), true);
  await page.evaluate(() => window.phoneVoice.update({ type: 'speak-ended' }));
  await page.waitForFunction(() => window.voiceCalls.some(call => call[0] === 'start' && call[1] === true));
  await page.locator('#callEnd').click();
  assert.equal(await page.evaluate(() => window.voiceCalls.some(call => call[0] === 'cancel')), true);
});

test('voice settings tune TTS rate and pitch and preview through the engine', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#openVoiceSettings').click();
  await page.locator('#voiceBackdrop').waitFor();
  assert.match(await page.locator('#ttsEngineStatus').textContent(), /已就绪/);
  await page.locator('#voiceRateSetting').fill('1.3');
  await page.locator('#voicePitchSetting').fill('0.9');
  assert.equal(await page.evaluate(() => window.callCalls.some(call =>
    call[0] === 'tts-settings' && call[1] === 1.3 && call[2] === 0.9)), true);
  await page.locator('#ttsPreview').click();
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'speak')), true);
  await page.locator('#voiceBackdrop [data-close]').click();
  assert.equal(await page.locator('#voiceBackdrop').isHidden(), true);
});

test('a queued cloud reply keeps hang-up responsive and stops pending speech', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.evaluate(() => {
    window.AgentBridge.speakText = () => {
      window.callCalls.push(['speak', 'queued']);
      return JSON.stringify({ ok: true, data: { queued: true, mode: 'cloud' } });
    };
    window.AgentBridge.stopSpeaking = () => {
      window.callCalls.push(['stop-speaking']);
      return JSON.stringify({ ok: true });
    };
  });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.waitForFunction(() => window.voiceCalls.some(call => call[0] === 'start'));
  await page.evaluate(() => window.phoneVoice.update({ type: 'final', text: '查看任务', autoSend: true }));
  await page.waitForFunction(() => window.callCalls.some(call => call[0] === 'speak'));
  await page.locator('#callEnd').click();
  assert.equal(await page.locator('#callBackdrop').isHidden(), true);
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'stop-speaking')), true);
});

test('hanging up while the model is thinking suppresses its later voice reply', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.evaluate(() => {
    const read = window.AgentBridge.operationState;
    window.AgentBridge.operationState = id => {
      if (id === 'test-chat' && !window.releaseChat) {
        return JSON.stringify({ ok: true, data: { operation: {
          id, state: 'running', message: '思考中'
        } } });
      }
      return read(id);
    };
  });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.waitForFunction(() => window.voiceCalls.some(call => call[0] === 'start'));
  await page.evaluate(() => window.phoneVoice.update({ type: 'final', text: '查看任务', autoSend: true }));
  await page.locator('#chatTyping').waitFor();
  await page.locator('#callEnd').click();
  await page.evaluate(() => { window.releaseChat = true; });
  await page.waitForFunction(() => document.getElementById('piMessages').textContent.includes('通话测试回复'));
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'speak')), false);
  assert.equal(await page.locator('#callBackdrop').isHidden(), true);
});

test('hanging up before the final transcript send timer prevents a late message', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.evaluate(() => {
    window.phoneVoice.update({ type: 'final', text: '不应发送', autoSend: true });
    document.getElementById('callEnd').click();
  });
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(await page.locator('#chatTyping').count(), 0);
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'speak')), false);
  assert.equal(await page.evaluate(() => window.chatCount), 0);
});

test('a new call resumes listening without playing the previous call reply', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.evaluate(() => {
    const read = window.AgentBridge.operationState;
    window.AgentBridge.operationState = id => id === 'test-chat' && !window.releaseChat
      ? JSON.stringify({ ok: true, data: { operation: { id, state: 'running' } } })
      : read(id);
  });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.waitForFunction(() => window.voiceCalls.some(call => call[0] === 'start'));
  await page.evaluate(() => window.phoneVoice.update({ type: 'final', text: '第一通电话', autoSend: true }));
  await page.locator('#chatTyping').waitFor();
  await page.locator('#callEnd').click();
  await page.locator('#startCall').click();
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await page.evaluate(() => window.voiceCalls.filter(call => call[0] === 'start').length), 1);
  await page.evaluate(() => { window.releaseChat = true; });
  await page.waitForFunction(() => window.voiceCalls.filter(call => call[0] === 'start').length === 2);
  assert.equal(await page.evaluate(() => window.callCalls.some(call => call[0] === 'speak')), false);
  assert.match(await page.locator('#callTranscript').textContent(), /准备好后再说话/);
  await page.locator('#callEnd').click();
});

test('butler replies render markdown emphasis without raw asterisks', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#piInput').fill('看下任务');
  await page.evaluate(() => {
    const reply = '**结论**\n- 先处理登录页\n- 再补 `list` 接口';
    window.AgentBridge.beginStudioMessage = content => {
      return JSON.stringify({
        ok: true,
        data: {
          operation: { kind: 'chat', id: 'md-chat', state: 'running', message: '思考中' }
        }
      });
    };
    window.AgentBridge.operationState = () => JSON.stringify({
      ok: true,
      data: {
        operation: {
          kind: 'chat', id: 'md-chat', state: 'succeeded', message: 'ok',
          studio: { messages: [
            { role: 'user', content: '看下任务' },
            { role: 'assistant', content: reply }
          ] }
        }
      }
    });
  });
  await page.locator('#sendPi').click();
  await page.waitForFunction(() => document.getElementById('piMessages').textContent.includes('先处理登录页'));
  const markup = await page.evaluate(() => document.getElementById('piMessages').innerHTML);
  assert.equal(markup.includes('**'), false);
  assert.equal(markup.includes('<b>结论</b>'), true);
});

test('butler composer supports hold-to-talk and slide-to-cancel', async t => {
  const page = await openPhone(t);
  await page.locator('[data-view="butler"]').click();
  const button = page.locator('#voiceButton');
  const box = await button.boundingBox();
  assert.ok(box);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.locator('#voicePanel').waitFor();
  assert.match(await page.locator('#voicePanelHint').textContent(), /转文字并发送/);

  await page.mouse.move(x, y - 90, { steps: 4 });
  await page.locator('#voicePanel.cancel').waitFor();
  await page.mouse.up();
  assert.equal(await page.locator('#voicePanel').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => window.voiceCalls), [['start', true], ['cancel']]);

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(320);
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.voiceCalls.slice(-2)), [['start', true], ['stop']]);
  assert.match(await page.locator('#voiceStateText').textContent(), /正在整理/);
});

test('public setup shows persistent stage errors and gates deployment on entry readiness', async t => {
  const page = await openPhone(t, { frpStatus: 'error' });
  await page.locator('[data-view="public"]').click();
  assert.match(await page.locator('.publicHeader .deploymentError').textContent(), /阶段 checksum/);
  assert.match(await page.locator('.publicMachine .deploymentError').textContent(), /连接目标机器 SSH/);
  assert.equal(await page.getByRole('button', { name: '先部署公网入口' }).isDisabled(), true);
  assert.match(await page.locator('.publicMachine').textContent(), /尚未验证公网连接/);
});

test('successful relay shows a past verification time, not a continuous connectivity claim', async t => {
  const page = await openPhone(t, { frpStatus: 'online' });
  await page.locator('[data-view="public"]').click();
  assert.match(await page.locator('.publicMachine').textContent(), /上次验证 2026\/09\/20 11:00/);
  assert.doesNotMatch(await page.locator('.publicMachine').textContent(), /已可远程访问/);
  assert.equal(await page.getByRole('button', { name: '重新配置', exact: true }).isEnabled(), true);
});

test('native reply commands do not force bypass and guard the Codex command group', () => {
  const source = fs.readFileSync(path.resolve(assets, '../java/com/otterview/agentsessionbridge/PhoneBridge.java'), 'utf8');
  assert.doesNotMatch(source, /--dangerously-skip-permissions/);
  assert.match(source, /&& \{ codex_bin=/);
  assert.match(source, /thread=.*shellQuote\(sessionId\).*message=.*shellQuote\(value\)/s);
  assert.match(source, /queue --thread/);
  assert.ok(source.includes('--message=\\"$message\\"'));
  // A reply that starts with "-" must reach the agent as text, not as a flag.
  assert.ok(source.includes('exec resume --skip-git-repo-check -- \\"$thread\\"'));
  assert.match(source, /--print -- " \+ shellQuote\(value\)/);
  assert.match(source, /__ASB_CODEX_QUEUED__/);
  assert.match(source, /RemoteReply\.start\(command\)/);
  assert.equal((source.match(/\.put\("lastCheckedAt", now\(\)\)/g) || []).length, 2);
});

test('phone butler calls the model directly and contains no Hub client path', () => {
  const source = fs.readFileSync(path.resolve(assets, '../java/com/otterview/agentsessionbridge/PhoneBridge.java'), 'utf8');
  assert.doesNotMatch(source, /StudioHubClient|saveStudioHub|disconnectStudioHub|beginStudioHub/);
  assert.match(source, /chat\/completions/);
  assert.match(source, /Bearer " \+ model\.getString\("apiKey"\)/);
  assert.match(source, /不经过 Hub/);
});

test('discovery collapses duplicate Claude processes and Codex subagents', () => {
  const source = fs.readFileSync(path.resolve(assets, '../java/com/otterview/agentsessionbridge/PhoneBridge.java'), 'utf8');
  assert.match(source, /dedupeProcessTasksBySession/);
  assert.match(source, /"claude:" \+ externalSessionId/);
  assert.match(source, /"subagent"\.equals\(threadSource\) \|\| !parentThreadId\.isEmpty\(\)/);
  // Renames must survive the stable-key migration from PID to session ID.
  assert.match(source, /oldByExternalSession\.get\(externalSessionId\)/);
  assert.match(source, /withoutDeletedTasks\(discovered\)/);
  assert.match(source, /dedupeSemanticTasks\(discovered\)/);
  assert.match(source, /deleteTask\(int id\)/);
  assert.match(source, /restoreDeletedTask\(int id\)/);
});

test('SSH sockets bypass an always-on VPN through the physical network', () => {
  const source = fs.readFileSync(path.resolve(assets, '../java/com/otterview/agentsessionbridge/PhoneBridge.java'), 'utf8');
  const manifest = fs.readFileSync(path.resolve(assets, '../AndroidManifest.xml'), 'utf8');
  assert.match(source, /DirectNetworkSocketFactory/);
  assert.match(source, /TRANSPORT_VPN/);
  assert.match(source, /TRANSPORT_WIFI/);
  assert.match(source, /network\.bindSocket\(socket\)/);
  assert.match(source, /Inet4Address/);
  assert.match(manifest, /android\.permission\.ACCESS_NETWORK_STATE/);
});

test('late voice transcripts after hanging up cannot send a chat or replace a draft', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.waitForFunction(() => window.voiceCalls.some(call => call[0] === 'start'));
  await page.locator('#callEnd').click();
  await page.locator('#piInput').fill('挂断后的新草稿');
  await page.evaluate(() => window.phoneVoice.update({type: 'final', text: '旧录音结果', autoSend: true}));
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.chatCount), 0);
  assert.equal(await page.locator('#piInput').inputValue(), '挂断后的新草稿');
});

test('speech playback failure remains visible and offers manual call recovery', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#startCall').click();
  await page.waitForFunction(() => window.voiceCalls.some(call => call[0] === 'start'));
  await page.evaluate(() => window.phoneVoice.update({type: 'speak-error', text: '云端语音播放失败'}));
  assert.match(await page.locator('#callTranscript').textContent(), /云端语音播放失败/);
  await page.locator('#callRetry').waitFor();
  await page.locator('#callRetry').click();
  await page.waitForFunction(() => window.voiceCalls.filter(call => call[0] === 'start').length === 2);
  await page.locator('#callEnd').click();
  assert.match(await page.locator('#piMessages').textContent(), /云端语音播放失败/);
});

test('employee replies ignore legacy approval templates and require deliberate selection', async t => {
  const page = await openPhone(t, { modelReady: true, legacySuggestion: true });
  await page.locator('[data-task-id="2"]').click();
  assert.equal(await page.locator('#replyText').inputValue(), '');
  await page.locator('#generateReplySuggestions').click();
  await page.locator('.replySuggestionChoice').first().waitFor();
  assert.match(await page.locator('#replySuggestionStatus').textContent(), /AI 草稿.*怎么回，你来定/);
  assert.equal(await page.locator('#replyText').inputValue(), '');
  assert.equal(await page.evaluate(() => window.sendCount), 0);
  await page.locator('.replySuggestionChoice').first().click();
  assert.match(await page.locator('#replyText').inputValue(), /影响范围和回滚步骤/);
  assert.equal(await page.evaluate(() => window.sendCount), 0);
  await page.locator('.replySuggestionChoice').nth(1).click();
  await expectToast(page, '你已经写了内容，清空后再选');
  assert.match(await page.locator('#replyText').inputValue(), /影响范围和回滚步骤/);
  if (process.env.SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.locator('.replySuggestions').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'phone-employee-replies.png') });
  }
});

test('reply drafting reports missing model, provider and malformed response without canned suggestions', async t => {
  for (const options of [{}, { modelReady: true, suggestionFails: true }, { modelReady: true, invalidSuggestions: true }]) {
    const page = await openPhone(t, options);
    await page.locator('[data-task-id="2"]').click();
    await page.locator('#replyText').fill('我自己的草稿');
    await page.locator('#generateReplySuggestions').click();
    if (!options.modelReady) {
      await page.locator('#cloudBackdrop:not(.hidden)').waitFor();
      assert.equal(await page.evaluate(() => window.suggestionCount), 0);
    } else {
      await page.waitForFunction(() => /401|没写出合适/.test(document.getElementById('replySuggestionStatus').textContent));
      assert.equal(await page.locator('.replySuggestionChoice').count(), 0);
      assert.equal(await page.locator('#replyText').inputValue(), '我自己的草稿');
      assert.equal(await page.locator('#sendTask').isEnabled(), true);
    }
    assert.equal(await page.evaluate(() => window.sendCount), 0);
  }
});

test('late drafting results stay with their employee and preserve other drafts', async t => {
  const page = await openPhone(t, { modelReady: true, holdSuggestions: true });
  await page.locator('[data-task-id="2"]').click();
  await page.locator('#generateReplySuggestions').click();
  await page.evaluate(() => document.getElementById('generateReplySuggestions').click());
  assert.equal(await page.evaluate(() => window.suggestionCount), 1);
  await page.locator('[data-close="taskBackdrop"]').click();
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('另一位员工的草稿');
  await page.evaluate(() => { window.releaseSuggestions = true; });
  await page.waitForFunction(() => window.chatOperationsCleared.some(id => String(id).startsWith('suggestion-')));
  assert.equal(await page.locator('.replySuggestionChoice').count(), 0);
  assert.equal(await page.locator('#replyText').inputValue(), '另一位员工的草稿');
  await page.locator('[data-close="taskBackdrop"]').click();
  await page.locator('[data-task-id="2"]').click();
  assert.equal(await page.locator('.replySuggestionChoice').count(), 2);
  assert.match(await page.locator('#replySuggestionStatus').textContent(), /任务 2/);
  assert.equal(await page.locator('#replyText').inputValue(), '');
});

test('output refresh invalidates suggestions for an older conversation', async t => {
  const page = await openPhone(t, { modelReady: true, holdSuggestions: true });
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#generateReplySuggestions').click();
  await page.locator('#replyText').fill('保留这条草稿');
  await page.locator('#tailTask').click();
  await page.waitForFunction(() => document.getElementById('taskOutput').textContent === '最新输出');
  await page.evaluate(() => { window.releaseSuggestions = true; });
  await page.waitForFunction(() => document.getElementById('generateReplySuggestions').disabled === false);
  assert.match(await page.locator('#replySuggestionStatus').textContent(), /记录更新了/);
  assert.equal(await page.locator('.replySuggestionChoice').count(), 0);
  assert.equal(await page.locator('#replyText').inputValue(), '保留这条草稿');
  await page.locator('#generateReplySuggestions').click();
  await page.locator('.replySuggestionChoice').first().waitFor();
});

test('long reply suggestions wrap within a narrow task sheet', async t => {
  const page = await openPhone(t, { modelReady: true, longSuggestion: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.locator('[data-task-id="2"]').click();
  await page.locator('#generateReplySuggestions').click();
  await page.locator('.replySuggestionChoice').first().waitFor();
  const dimensions = await page.locator('.taskSheet').evaluate(sheet => ({ client: sheet.clientWidth, scroll: sheet.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions));
  assert.equal(await page.evaluate(() => window.sendCount), 0);
});


test('latest task output replaces a stale summary and displays file labels safely', async t => {
  const page = await openPhone(t);
  await page.evaluate(() => {
    const original = AgentBridge.state;
    AgentBridge.state = () => {
      const result = JSON.parse(original());
      Object.assign(result.data.tasks[0], {
        workSummary: '旧摘要：仍在等确认',
        lastOutput: '本次输出：\n测试通过，文件：[redirect.test.js](/tmp/demo/redirect.test.js)。\n[unsafe](javascript:alert(1))'
      });
      return JSON.stringify(result);
    };
  });
  await page.locator('#refreshAll').click();
  await page.locator('[data-task-id="1"]').click();
  assert.match(await page.locator('#conversationTimeline').textContent(), /测试通过/);
  assert.doesNotMatch(await page.locator('#conversationTimeline').textContent(), /旧摘要/);
  assert.equal(await page.locator('#conversationTimeline .fileReference').first().textContent(), 'redirect.test.js');
  assert.equal(await page.locator('#conversationTimeline a').count(), 0);
  const layout = await page.evaluate(() => ({
    send: document.querySelector('#sendTask').getBoundingClientRect().toJSON(),
    viewport: innerHeight
  }));
  assert.ok(layout.send.bottom <= layout.viewport && layout.send.top >= 0, JSON.stringify(layout));
});

test('employee model failures are visible instead of appearing to continue running', async t => {
  const error = 'stream disconnected before completion: request frequency has been limited.';
  for (const language of ['zh-CN', 'en']) {
    const page = await openPhone(t, { language, taskPreviewRecords: {
      status: 'error', requiredInput: '', workSummary: '最近输出：' + error, lastOutput: error
    } });
    await page.locator('[data-task-id="1"]').click();
    assert.match(await page.locator('#taskStatusCard').textContent(), /会话异常|Session error/);
    assert.match(await page.locator('#conversationTimeline').textContent(), /request frequency has been limited/);
    assert.doesNotMatch(await page.locator('#conversationTimeline').textContent(), /会话仍在执行|Session still executing/);
  }
});

test('latest butler reply stays above the composer at compact height', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.setViewportSize({ width: 363, height: 620 });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#piInput').fill('谁在等我');
  await page.locator('#sendPi').click();
  await page.waitForFunction(() => document.querySelector('#piMessages').textContent.includes('先处理待输入员工'));
  await page.waitForTimeout(80);
  const layout = await page.evaluate(() => {
    const chat = document.querySelector('#piMessages'), dock = document.querySelector('#butlerChatDock');
    return { bottom: chat.getBoundingClientRect().bottom, dockTop: dock.getBoundingClientRect().top,
      remaining: chat.scrollHeight - chat.clientHeight - chat.scrollTop };
  });
  assert.ok(layout.bottom <= layout.dockTop, JSON.stringify(layout));
  assert.ok(layout.remaining <= 2, JSON.stringify(layout));
});

test('butler and employee replies share safe code, table and list formatting', async t => {
  const page = await openPhone(t, { modelReady: true });
  const code = '  const literal = "**raw**";\n  const html = "<img src=x onerror=alert(1)>";';
  const reply = '# 测试结果\n\n两项测试通过。\n\n- 保留查询参数\n- 保留锚点\n\n| 检查 | 结果 |\n| --- | --- |\n| 登录回跳 | 通过 |\n\n```js\n' + code + '\n```\n\n[unsafe](javascript:alert(1))';
  await page.evaluate(reply => {
    const studio = AgentBridge.studioOverview;
    AgentBridge.studioOverview = () => {
      const data = JSON.parse(studio());
      data.data.messages = [{ role: 'user', content: '看看测试结果' }, { role: 'assistant', content: reply }];
      return JSON.stringify(data);
    };
    const state = AgentBridge.state;
    AgentBridge.state = () => {
      const data = JSON.parse(state());
      data.data.tasks[0].lastOutput = '最近指令：看看测试结果\n最近输出：' + reply;
      return JSON.stringify(data);
    };
  }, reply);
  await page.locator('[data-view="butler"]').click();
  await page.locator('#refreshButler').click();
  await page.locator('#piMessages .messageTable').waitFor();
  const check = async region => {
    assert.equal(await region.locator('.messageCode code').textContent(), code);
    assert.equal(await region.locator('.messageCodeLanguage').textContent(), 'js');
    assert.equal(await region.locator('.messageTable th').count(), 2);
    assert.equal(await region.locator('.butlerListItem').count(), 2);
    assert.equal(await region.locator('img,script,a').count(), 0);
    assert.match(await region.locator('.butlerHeading').textContent(), /测试结果/);
  };
  await check(page.locator('#piMessages'));
  await page.locator('[data-view="offices"]').click();
  await page.locator('#refreshAll').click();
  await page.locator('[data-task-id="1"]').click();
  await check(page.locator('#conversationTimeline'));
});

test('employee input stays visible while reading long replies at keyboard height', async t => {
  const page = await openPhone(t);
  await page.evaluate(() => {
    const read = AgentBridge.state;
    AgentBridge.state = () => {
      const result = JSON.parse(read());
      result.data.tasks[0].lastOutput = '最近输出：' + '这是一段较长的任务回复。\n\n'.repeat(50);
      return JSON.stringify(result);
    };
  });
  await page.locator('#refreshAll').click();
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('保留我的草稿');
  for (const height of [800, 420]) {
    await page.setViewportSize({ width: 363, height });
    await page.locator('.taskBody').evaluate(body => { body.scrollTop = body.scrollHeight; });
    const bounds = await page.evaluate(() => ({
      input: document.getElementById('replyText').getBoundingClientRect().toJSON(),
      send: document.getElementById('sendTask').getBoundingClientRect().toJSON(),
      body: document.querySelector('.taskBody').getBoundingClientRect().toJSON(), height: innerHeight
    }));
    assert.ok(bounds.input.top >= bounds.body.bottom - 1 && bounds.input.bottom <= bounds.height, JSON.stringify(bounds));
    assert.ok(bounds.send.bottom <= bounds.height, JSON.stringify(bounds));
  }
  assert.equal(await page.locator('#replyText').inputValue(), '保留我的草稿');
});

test('employee send shows the submitted message and a persistent returned result', async t => {
  const page = await openPhone(t, { holdSend: true });
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('请保留现有实现，只补测试');
  await page.locator('#sendTask').click();
  assert.match(await page.locator('#taskDelivery').textContent(), /已提交/);
  assert.match(await page.locator('.conversationTurn.user').last().textContent(), /请保留现有实现，只补测试/);
  await page.evaluate(() => { window.releaseSend = true; });
  await page.waitForFunction(() => document.getElementById('taskDelivery').dataset.state === 'success');
  assert.match(await page.locator('.conversationTurn.assistant').textContent(), /回复后的新输出/);
  assert.match(await page.locator('.conversationTurn.user').textContent(), /请保留现有实现，只补测试/);
  await page.locator('[data-close="taskBackdrop"]').click();
  await page.locator('[data-task-id="1"]').click();
  assert.equal(await page.locator('#taskDelivery').isVisible(), true);
});

test('rejected employee submission keeps the draft and a visible error for retry', async t => {
  const page = await openPhone(t, { rejectSend: true });
  await page.locator('[data-task-id="1"]').click();
  await page.locator('#replyText').fill('请保留现有实现，只补测试');
  await page.locator('#sendTask').click();
  assert.equal(await page.locator('#taskDelivery').isVisible(), true);
  assert.equal(await page.locator('#taskDelivery').getAttribute('data-state'), 'error');
  assert.match(await page.locator('#taskDelivery').textContent(), /会话暂时无法连接/);
  assert.equal(await page.locator('#replyText').inputValue(), '请保留现有实现，只补测试');
  assert.equal(await page.locator('#sendTask').isEnabled(), true);
  await page.locator('[data-close="taskBackdrop"]').click();
  await page.locator('[data-task-id="1"]').click();
  assert.equal(await page.locator('#taskDelivery').isVisible(), true);
  assert.equal(await page.locator('#replyText').inputValue(), '请保留现有实现，只补测试');
});


test('butler task references open only existing tasks and never send messages', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.evaluate(() => {
    const read = AgentBridge.studioOverview;
    AgentBridge.studioOverview = () => {
      const result = JSON.parse(read());
      result.data.messages = [{ role: 'assistant', content: '检查部署配置与远程连接（S-2）在等你确认。不存在的 S-999 不应打开。\n\n```text\nS-1\n```\nhttps://example.test/S-3' }];
      return JSON.stringify(result);
    };
  });
  await page.locator('[data-view="butler"]').click();
  await page.locator('#refreshButler').click();
  const links = page.locator('.chatTaskLink');
  await links.first().waitFor();
  assert.equal(await links.count(), 1);
  assert.equal(await links.getAttribute('data-task-id'), '2');
  await links.click();
  assert.equal(await page.locator('#taskTitle').textContent(), '检查部署配置与远程连接');
  assert.equal(await page.locator('#replyText').inputValue(), '');
  assert.equal(await page.evaluate(() => window.sendCount), 0);
});


test('task previews show the pending decision, clean only display markup, and retain raw records', async t => {
  const output = '最近指令：先检查。\n最近输出：已修改 [training-jobs.js](/private/tmp/demo/training-jobs.js)。\n\n**6 项通过，0 项失败。**';
  const page = await openPhone(t, { taskPreviewRecords: { status: 'idle', requiredInput: '是否只在训练中显示进度？', workSummary: output, lastOutput: output } });
  const card = page.locator('.employee[data-task-id="1"]');
  assert.equal(await card.locator('.employeePreviewLabel').textContent(), '需要你确认');
  assert.equal(await card.locator('.employeeSub').textContent(), '是否只在训练中显示进度？');
  await card.click();
  assert.equal(await page.locator('#taskOutput').textContent(), output);
  await page.locator('[data-close="taskBackdrop"]').click();
  const result = await openPhone(t, { taskPreviewRecords: { status: 'idle', requiredInput: '', workSummary: output, lastOutput: output } });
  const preview = result.locator('.employee[data-task-id="1"] .employeeSub');
  assert.match(await preview.textContent(), /已修改 training-jobs\.js.*6 项通过，0 项失败/);
  assert.doesNotMatch(await preview.textContent(), /最近指令|private\/tmp|\*\*/);
  assert.match(await result.locator('.employee[data-task-id="1"] .stateChip').textContent(), /会话空闲/);
});

test('butler shows streamed text before completion without committing a partial reply', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.evaluate(() => {
    window.chatDone = false;
    window.AgentBridge.beginStudioMessage = () => JSON.stringify({ ok: true, data: {
      operation: { id: 321, state: 'running' }
    } });
    window.AgentBridge.operationState = () => JSON.stringify({ ok: true, data: {
      operation: window.chatDone
        ? { id: 321, state: 'succeeded', studio: { messages: [
            { role: 'user', content: '现在谁等我回复' },
            { role: 'assistant', content: '登录任务正在等你确认测试范围。' }
          ] } }
        : { id: 321, state: 'running', message: '整理中', partialReply: '登录任务正在等你' }
    } });
  });
  await page.locator('#piInput').fill('现在谁等我回复');
  await page.locator('#sendPi').click();
  await page.locator('#chatTyping').filter({ hasText: '登录任务正在等你' }).waitFor();
  assert.equal(await page.locator('#sendPi').isDisabled(), true);
  await page.evaluate(() => { window.chatDone = true; });
  await page.waitForFunction(() => !document.getElementById('chatTyping'));
  assert.equal(await page.locator('#piMessages').getByText('登录任务正在等你确认测试范围。', { exact: true }).count(), 1);
});

test('stream updates preserve the reader position and unchanged text nodes', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.evaluate(() => {
    window.streamText = '逐步返回的文字。\n'.repeat(80);
    window.AgentBridge.beginStudioMessage = () => JSON.stringify({ ok: true, data: { operation: { id: 322, state: 'running' } } });
    window.AgentBridge.operationState = () => JSON.stringify({ ok: true, data: { operation: {
      id: 322, state: 'running', message: '整理中', partialReply: window.streamText
    } } });
  });
  await page.locator('#piInput').fill('说说进展');
  await page.locator('#sendPi').click();
  await page.locator('#chatTyping.streaming').waitFor();
  assert.match(await page.locator('#chatTyping .replyProgress').textContent(), /正在回复/);
  await page.evaluate(() => {
    window.streamNode = document.querySelector('#chatTyping .butlerRich');
    document.getElementById('piMessages').scrollTop = 0;
  });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.streamNode === document.querySelector('#chatTyping .butlerRich')), true);
  await page.evaluate(() => { window.streamText += '最后新增的一句。'; });
  await page.locator('#chatTyping').filter({ hasText: '最后新增的一句。' }).waitFor();
  assert.equal(await page.locator('#piMessages').evaluate(el => el.scrollTop), 0);
});

test('call transcript streams before TTS and switches to playback only after completion', async t => {
  const page = await openPhone(t, { modelReady: true });
  await page.locator('[data-view="butler"]').click();
  await page.evaluate(() => {
    window.finishStream = false;
    window.AgentBridge.beginStudioMessage = () => JSON.stringify({ ok: true, data: { operation: { id: 323, state: 'running' } } });
    window.AgentBridge.operationState = () => JSON.stringify({ ok: true, data: { operation: window.finishStream
      ? { id: 323, state: 'succeeded', studio: { messages: [
        { role: 'user', content: '看看进展' }, { role: 'assistant', content: '完整回复到了。' }
      ] } }
      : { id: 323, state: 'running', partialReply: '刚生成的半句', message: '整理中' }
    } });
  });
  await page.locator('#startCall').click();
  await page.evaluate(() => window.phoneVoice.update({ type: 'final', text: '看看进展', autoSend: true }));
  await page.waitForFunction(() => document.getElementById('callTranscript').textContent.includes('刚生成的半句'));
  assert.match(await page.locator('#callStatus').textContent(), /正在回复/);
  assert.equal(await page.evaluate(() => window.speechTexts.length), 0);
  await page.evaluate(() => { window.finishStream = true; });
  await page.waitForFunction(() => window.speechTexts.includes('完整回复到了。'));
  assert.match(await page.locator('#callStatus').textContent(), /播报/);
  await page.locator('#callEnd').click();
});

test('adapter IDs and record paths stay in raw records while readable progress remains visible', async t => {
  const envelope = 'Codex 线程：thread-123\n状态：task_started\n来源：Codex Desktop\n记录：/private/project/record.jsonl\n\n';
  for (const [summary, readable] of [['Codex 线程：训练平台2', false], ['最近输出：登录测试已通过。', true]]) {
    const page = await openPhone(t, { taskPreviewRecords: { workSummary: summary, lastOutput: envelope + summary } });
    await page.locator('[data-task-id="1"]').click();
    const timeline = await page.locator('#conversationTimeline').textContent();
    assert.doesNotMatch(timeline, /thread-123|record\.jsonl|task_started/);
    if (readable) assert.match(timeline, /登录测试已通过/);
    else assert.match(timeline, /还没有可读的问答/);
    await page.locator('#rawRecord > summary').click();
    assert.equal(await page.locator('#taskOutput').textContent(), envelope + summary);
  }
});
