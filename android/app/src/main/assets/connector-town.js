/* Desktop projections stay separate from SSH tasks and never persist credentials. */
window.ConnectorTown = {
  create({ $, t, element, gameSprite, uiIcon, actionButton, renderMessage, render, toast, state }) {
    let data = { paired: false, sessions: [], pending: [] }, choice = '', computer = '', local = false, preferred = '';
    let loading = '', failed = '', lastLoad = '';
    const messageDrafts = new Map();
    const draftKey = () => data.paired && !local ? `${computer}:${choice}` : 'phone';
    const api = () => window.phoneConnector;
    const session = () => data.sessions.find(item => item.id === choice);
    const active = () => data.paired && !local;
    const pending = () => data.pending.find(item => item.sessionId === choice && item.computerId === computer);
    const canSend = () => !!session()?.canReply && data.online && !data.busy && !loading && !state.sending && !pending();
    const storageKey = () => `desktopButler:${computer}`;
    function remember(value) { try { localStorage.setItem(storageKey(), value); } catch (_) { /* memory choice remains */ } }
    function update(value) {
      const previousDraft = draftKey();
      messageDrafts.set(previousDraft, $('piInput').value);
      if (value.computer?.id !== computer) {
        computer = value.computer?.id || ''; choice = ''; preferred = ''; local = false; failed = ''; lastLoad = '';
        try { const saved = localStorage.getItem(storageKey()); local = saved === 'phone'; preferred = local ? '' : saved || ''; choice = preferred; } catch (_) { /* defaults */ }
      }
      data = value;
      if (!data.sessions.some(item => item.id === choice)) {
        choice = '';
        const replyable = data.sessions.filter(item => item.canReply);
        if (data.sessions.some(item => item.id === preferred)) choice = preferred;
        else if (replyable.length === 1) choice = replyable[0].id;
        else if (data.sessions.length === 1) choice = data.sessions[0].id;
      }
      if (previousDraft !== draftKey()) $('piInput').value = messageDrafts.get(draftKey()) || '';
      render();
      if (state.view === 'butler') void load();
    }
    async function load(force = false) {
      if (!active() || !data.online || data.busy || !choice || loading) return;
      const key = `${computer}:${choice}`;
      if (!force && (data.conversation?.computerId === computer && data.conversation?.sessionId === choice || lastLoad === key)) return;
      loading = key; lastLoad = key; failed = '';
      try { await api().loadTown(choice); }
      catch (error) { failed = error.message; }
      finally { loading = ''; render(); }
    }
    async function refresh() {
      failed = ''; lastLoad = '';
      try { await api().refreshTown(); await load(true); }
      catch (error) { failed = error.message; toast(error.message); }
      render();
    }
    function source() {
      const row = $('butlerSourceRow'), select = $('butlerSource');
      row.hidden = !data.paired;
      select.replaceChildren();
      if (!data.paired) return;
      const blank = element('option', '', t('选择聊天对象')); blank.value = ''; select.append(blank);
      const phone = element('option', '', t('手机管家（自选模型）')); phone.value = 'phone'; select.append(phone);
      for (const item of data.sessions) {
        const option = element('option', '', `${item.agent || 'Agent'} · ${item.title || t('未命名任务')} · ${t(item.canReply ? '可回复' : '只读')}`);
        option.value = item.id; select.append(option);
      }
      select.value = local ? 'phone' : choice;
      select.disabled = data.busy || !!loading || state.sending;
    }
    function selectSource(value) {
      if (!data.paired || data.busy || loading || state.sending || state.callMode) return false;
      messageDrafts.set(draftKey(), $('piInput').value);
      local = value === 'phone'; choice = local ? choice : value;
      $('piInput').value = messageDrafts.get(draftKey()) || '';
      preferred = local ? '' : choice; remember(local ? 'phone' : choice); failed = ''; lastLoad = ''; render(); void load();
      return true;
    }
    $('butlerSource').addEventListener('change', event => selectSource(event.target.value));
    function office(container) {
      if (!data.paired) return false;
      const article = element('article', 'office gameOffice connectorOffice');
      if (state.scene === 'map') {
        const map = element('section', 'townMap connectorTownMap'); map.setAttribute('aria-label', t('电脑地图'));
        const plots = element('div', 'mapPlots'), building = element('button', 'mapBuilding selected');
        building.type = 'button'; building.dataset.connection = data.online ? 'online' : 'record';
        const art = element('img', 'mapBuildingArt'); art.src = 'game-art/office-building.png'; art.alt = '';
        const plaque = element('span', 'mapPlaque');
        plaque.append(element('strong', '', data.computer?.name || t('已配对电脑')),
          element('small', '', `${t(data.online ? '在线' : '连接待恢复')} · ${data.sessions.length}${t(' 位员工')}`));
        building.append(art, plaque); building.addEventListener('click', () => {
          article.tabIndex = -1; article.scrollIntoView({ block: 'start', behavior: 'instant' }); article.focus({ preventScroll: true });
        });
        plots.append(building); map.append(plots, element('p', 'mapInstruction', t('点击一栋楼，查看这台电脑的员工'))); container.append(map);
      }
      article.dataset.source = 'desktop'; article.dataset.connection = data.online ? 'online' : 'record';
      const header = element('header', 'officeHeader'), title = element('div', 'officeTitle');
      title.append(element('h2', '', data.computer?.name || t('已配对电脑')),
        element('p', 'officeMeta', `${t('扫码连接')} · ${t(data.online ? '在线' : '连接待恢复')}`),
        element('p', 'officeCheck', t('员工对应电脑授权的工具会话；可回复的员工使用电脑模型。')));
      const actions = element('div', 'officeActions');
      actions.append(actionButton(t(data.online ? '刷新员工' : '重新连接'), () => void refresh(), 'dark'));
      header.append(title, actions); article.append(header);
      const employees = element('div', 'employees');
      if (!data.sessions.length) employees.append(element('p', 'officeEmpty', t(data.busy
        ? '正在读取电脑员工…' : data.online ? '还没有发现电脑会话。请在桌面“连接手机”启用自动发现，并在工具中新建会话。' : '电脑连接恢复后会自动读取已分享的员工。')));
      for (let index = 0; index < data.sessions.length; index += 2) {
        const floor = element('div', 'gameFloor');
        data.sessions.slice(index, index + 2).forEach(item => {
          const card = element('button', 'employee'); card.type = 'button';
          card.dataset.source = 'desktop'; card.dataset.sessionId = item.id;
          card.dataset.state = !data.online ? 'record' : item.status === 'running' ? 'working' : 'idle';
          const stage = element('span', 'employeeStage'); stage.setAttribute('aria-hidden', 'true');
          stage.append(gameSprite(item.agent || 'codex', state.scene === 'workstations'));
          stage.append(element('span', 'employeeBubble', t(!data.online ? '连接待恢复' : item.status === 'running' ? '运行中' : item.canReply ? '可回复' : '只读')));
          const info = element('div', 'employeeInfo');
          info.append(element('span', 'employeeName', item.title || t('未命名任务')),
            element('span', 'employeeSub', data.online ? (item.canReply ? t('沿用电脑模型，继续当前任务') : (item.replyReason || t('点击查看电脑会话'))) : t('上次同步的会话，连接后可查看')),
            element('span', 'stateChip', `${item.agent || 'Agent'} · ${t(item.canReply ? '可回复' : '只读')}`));
          const arrow = element('span', 'employeeOpen'); arrow.append(uiIcon('arrow'));
          card.append(stage, info, arrow); card.addEventListener('click', () => api().openSession(item.id)); floor.append(card);
        });
        employees.append(floor);
      }
      article.append(employees); container.append(article); return true;
    }
    function butler() {
      source();
      for (const id of ['butlerAttentionDetails', 'butlerPlanDetails', 'openManaged']) $(id).classList.toggle('hidden', active());
      $('butler').dataset.source = active() ? 'desktop' : 'phone';
      $('connectionHint').classList.toggle('desktopNotice', !!(active() && (failed || pending() || !data.online || !session() || !session().canReply)));
      if (!active()) return false;
      const selected = session(), kept = pending(), ready = !!selected && data.online && selected.canReply;
      $('piAvatar').replaceChildren(gameSprite('pi')); $('butler').dataset.modelReady = String(ready);
      $('piSheetTitle').textContent = t('小镇管家');
      $('piMeta').textContent = data.computer?.name || t('电脑助手');
      $('butlerEmployeeName').textContent = selected?.title || t('选择电脑助手'); $('butlerEmployeeName').disabled = false;
      $('butlerEmployeeSub').textContent = selected && !selected.canReply ? (selected.replyReason || t('当前员工仅支持查看历史消息，请切换可回复的电脑助手。')) : (selected?.replyNotice || t('沿用所选会话的上下文和电脑模型。'));
      $('openCloudFromButler').querySelector('.actionLabel').textContent = t('手机模型');
      $('piMemoryScopeRow').classList.add('hidden'); $('butlerScopePreview').textContent = selected?.title || t('电脑会话');
      $('connectionHint').classList.remove('error');
      window.ButlerLayout.notice(failed || (kept ? t(kept.status === 'unknown' || kept.status === 'failed'
        ? '上一条发送尚未确认，请先查看发送状态' : '电脑助手正在回复…') : !data.online ? data.status || t('连接待恢复')
        : !selected ? t('选择一个已分享的会话作为电脑助手。') : !selected.canReply
        ? (session()?.replyReason || t('当前会话只读：该工具尚未接入回复，或会话状态不满足条件。')) : t('已使用电脑模型，可以直接发消息。')), false);
      $('checkButlerModel').textContent = t(kept ? '查看发送状态' : data.online ? '刷新对话' : '重新连接');
      $('checkButlerModel').disabled = data.busy || !!loading || state.sending;
      const chat = $('piMessages'), follow = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
      const scroll = chat.scrollTop; chat.replaceChildren();
      const current = data.conversation?.computerId === computer && data.conversation?.sessionId === choice ? data.conversation : null;
      const messages = (current?.messages || []).filter(item => ['user', 'assistant'].includes(item.role));
      if (messages.length) messages.forEach(item => chat.append(renderMessage(item.role, item.text || '')));
      else {
        const welcome = element('div', 'chatWelcome');
        welcome.append(element('h4', '', t(!data.online ? '正在连接电脑助手' : selected ? '直接和电脑助手聊聊' : '用电脑上的模型继续聊')),
          element('p', '', t(selected ? '这里显示所选会话的消息；手机不需要再填 API Key。' : '选择上方的电脑会话，无需在手机重复配置模型。')));
        chat.append(welcome);
      }
      if (kept && !messages.some(item => item.role === 'user' && item.text === kept.text)) chat.append(renderMessage('user', kept.text));
      $('butler').classList.toggle('hasConversation', !!(messages.length || kept));
      $('sendPi').disabled = !canSend() || !$('piInput').value.trim();
      requestAnimationFrame(() => { chat.scrollTop = follow ? chat.scrollHeight : scroll; });
      void load(); return true;
    }
    async function send() {
      if (!active()) return false;
      if (state.sending || data.busy || loading) return true;
      if (!session() || !data.online || !session().canReply) { toast(t('请先选择可回复的电脑助手')); return true; }
      if (pending()) { toast(t('上一条发送尚未确认，请先查看发送状态')); return true; }
      const text = $('piInput').value.trim(); if (!text) return true;
      state.sending = true; failed = ''; render();
      try { await api().sendTown(choice, text); if ($('piInput').value.trim() === text) $('piInput').value = ''; }
      catch (error) { failed = error.message; toast(error.message); }
      finally { state.sending = false; render(); }
      return true;
    }
    return { update, active, canSend, office, butler, send, refresh, source,
      count: () => data.paired ? data.sessions.length : 0,
      paired: () => data.paired,
      usePhone: () => selectSource('phone'),
      online: () => !!data.online,
      choose: () => {
        const select = $('butlerSource');
        select.focus();
        if (!select.disabled) {
          try { select.showPicker?.(); } catch (_) { /* The focused selector remains available. */ }
        }
      },
      inspect: () => pending() ? api().openSession(choice) : void refresh()
    };
  }
};
