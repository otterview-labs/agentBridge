/* Conversation presentation; source routing remains owned by ConnectorTown. */
(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);
  const en = () => document.documentElement.lang.startsWith('en');
  const text = (zh, english) => en() ? english : zh;
  function button(label, action, className) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = className || 'messageAction';
    node.textContent = label; node.addEventListener('click', action); return node;
  }
  async function copy(value, trigger) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const active = document.activeElement;
        const area = document.createElement('textarea');
        area.value = value; area.className = 'clipboardBuffer'; document.body.append(area);
        area.select(); const ok = document.execCommand('copy'); area.remove(); active?.focus();
        if (!ok) throw new Error('Clipboard unavailable');
      }
      trigger.textContent = text('已复制', 'Copied');
    } catch (_) { trigger.textContent = text('复制失败，请长按选择', 'Copy failed; select text'); }
  }
  function copyButton(value, label) {
    let node;
    node = button(label || text('复制', 'Copy'), () => copy(value, node)); return node;
  }
  function decorate(row, content) {
    const actions = document.createElement('div'); actions.className = 'messageActions';
    actions.append(copyButton(String(content || '')));
    actions.append(button(text('引用', 'Quote'), () => {
      const input = $('piInput');
      if (input.disabled || input.readOnly) return;
      const quote = String(content || '').split('\n').map(line => '> ' + line).join('\n');
      input.value = (input.value ? input.value + '\n\n' : '') + quote + '\n\n';
      input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
    }));
    row.append(actions);
  }
  function reasoning(content, render) {
    // Only an explicit leading reasoning block is special. HTML stays text.
    const match = /^\s*<think>([\s\S]*?)(?:<\/think>([\s\S]*)|$)/.exec(String(content || ''));
    if (!match) return render(content);
    const wrapper = document.createElement('div'); wrapper.className = 'messageBody';
    const details = document.createElement('details'); details.className = 'messageReasoning';
    const summary = document.createElement('summary'); summary.textContent = text('思考过程', 'Reasoning');
    details.append(summary, render(match[1])); wrapper.append(details);
    if (match[2]?.trim()) wrapper.append(render(match[2]));
    return wrapper;
  }
  function revision(row, user, reply, submit) {
    const actions = row.querySelector('.messageActions');
    actions.append(button(text('重新生成', 'Regenerate'), () => submit(user.content)));
    actions.append(button(text('编辑问题', 'Edit question'), () => {
      if (row.querySelector('.messageEditArea')) return;
      const form = document.createElement('div'); form.className = 'messageEditArea';
      const input = document.createElement('textarea'); input.value = user.content; input.maxLength = 4000;
      input.setAttribute('aria-label', text('编辑当前最后一轮问题', 'Edit the latest question'));
      const hint = document.createElement('p'); hint.className = 'messageRevisionInfo';
      hint.textContent = text('仅替换当前最后一轮。新回复成功后才保存，失败保留原回复。', 'Only the latest turn is replaced, after a successful reply. Failures keep the original.');
      const save = button(text('保存并重新生成', 'Save and regenerate'), () => { if (input.value.trim()) submit(input.value.trim()); });
      form.append(hint, input, save, button(text('取消', 'Cancel'), () => form.remove())); row.append(form); input.focus(); form.lastElementChild.scrollIntoView({block: 'nearest'});
    }));
    if (reply.revisions?.length) {
      const details = document.createElement('details'); details.className = 'messageRevisionInfo';
      const summary = document.createElement('summary'); summary.textContent = text('查看此前版本', 'Previous versions'); details.append(summary);
      for (const version of reply.revisions) {
        const entry = document.createElement('p'); entry.textContent = text('我：', 'Me: ') + version.user.content + '\n' + text('管家：', 'Assistant: ') + version.assistant.content; details.append(entry);
      }
      row.append(details);
    }
  }
  function mount() {
    const select = $('butlerSource'), sheet = $('butlerAssistantDialog'), search = $('butlerAssistantSearch');
    const trigger = $('butlerAssistantPicker');
    document.querySelector('.butlerHeroHeader').append(trigger);
    if (en()) {
      $('butlerAssistantTitle').textContent = 'Choose assistant';
      $('butlerAssistantClose').textContent = 'Close';
      $('butlerAssistantClose').setAttribute('aria-label', 'Close');
      $('butlerAssistantSearch').placeholder = 'Search tools or conversations';
      $('butlerAssistantSearch').setAttribute('aria-label', 'Search assistants');
      $('butlerAssistantConfigure').textContent = 'Configure phone model';
      sheet.querySelector('p').textContent = 'Computer assistants keep their conversation model and context. Configure your own model for the phone assistant.';
    }
    const refresh = () => {
      const option = select.selectedOptions[0];
      trigger.textContent = text('助手 · ', 'Assistant · ') +
        (!select.closest('[hidden]') && option?.value && option.value !== 'phone' ? option.textContent : $('piMeta').textContent || text('手机管家', 'Phone assistant'));
      trigger.disabled = select.disabled || $('sendPi').disabled && document.body.classList.contains('callMode');
      trigger.title = trigger.textContent;
    };
    const list = () => {
      const target = $('butlerAssistantList'); target.replaceChildren();
      const options = select.closest('[hidden]') ? [] : Array.from(select.options).filter(item => item.value);
      if (!options.some(item => item.value === 'phone')) options.unshift({ value: 'phone', textContent: text('手机管家 · 自定义模型', 'Phone assistant · Custom model') });
      const profiles = global.ModelLibrary?.profiles() || [];
      for (const option of options.filter(item => (!profiles.length || item.value !== 'phone') && item.textContent.toLowerCase().includes(search.value.trim().toLowerCase()))) {
        const choice = button(option.textContent, () => {
          if (select.disabled) return;
          if (!select.closest('[hidden]')) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
          sheet.close(); refresh();
        }, 'assistantChoice');
        choice.setAttribute('aria-pressed', String(option.value === (select.value || 'phone')));
        choice.disabled = select.disabled; target.append(choice);
      }
      for (const profile of profiles.filter(item => `${item.name} ${item.modelId}`.toLowerCase().includes(search.value.trim().toLowerCase()))) {
        const choice = button(`${text('手机模型 · ', 'Phone model · ')}${profile.name || profile.modelId}${profile.favorite ? text(' · 收藏', ' · Favorite') : ''}`, async () => {
          choice.disabled = true;
          if (await global.ModelLibrary.choose(profile.profileId, false)) {
            if (!select.closest('[hidden]')) { select.value = 'phone'; select.dispatchEvent(new Event('change', {bubbles:true})); }
            sheet.close(); refresh();
          } else choice.disabled = select.disabled;
        }, 'assistantChoice');
        choice.disabled = select.disabled; target.append(choice);
      }
      if (!target.childElementCount) target.textContent = text('没有匹配的助手', 'No matching assistants');
    };
    trigger.addEventListener('click', () => { search.value = ''; list(); sheet.showModal(); search.focus(); });
    $('butlerAssistantClose').addEventListener('click', () => sheet.close());
    $('butlerAssistantConfigure').addEventListener('click', () => { sheet.close(); $('openCloudFromButler').click(); });
    search.addEventListener('input', list);
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true });
    new MutationObserver(refresh).observe($('piMeta'), { childList: true, subtree: true, characterData: true });
    refresh();
  }
  global.ButlerWorkspace = { decorate, reasoning, copyButton, revision, mount };
})(window);
