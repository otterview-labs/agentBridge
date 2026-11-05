(function (root) {
  'use strict';

  // Parse connection text only. Nothing imported here is executed or persisted.
  function parseSshConnection(raw) {
    const text = String(raw || '').trim();
    if (!text || text.length > 2048 || /[\r\n]/.test(text)) throw new Error('请填写一条 SSH 地址或连接命令');
    let target = text, username, port;
    const validPort = value => {
      if (!/^\d{1,5}$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535)
        throw new Error('SSH 端口应为 1–65535');
      return Number(value);
    };
    if (/^ssh\s/.test(text)) {
      if ((text.match(/"/g) || []).length % 2 || (text.match(/'/g) || []).length % 2)
        throw new Error('SSH 命令中的引号不完整');
      const tokens = text.match(/"[^"]*"|'[^']*'|[^\s"']+/g) || [];
      if (tokens.join('').replace(/["']/g, '') !== text.replace(/\s|["']/g, ''))
        throw new Error('SSH 命令中的引号不完整');
      const args = tokens.slice(1).map(value => value.replace(/^(['"])(.*)\1$/, '$2'));
      const targets = [];
      for (let i = 0; i < args.length; i++) {
        const value = args[i];
        if (value === '-p' || value === '-l') {
          const next = args[++i];
          if (!next) throw new Error('SSH 命令缺少账号或端口');
          if (value === '-p') port = validPort(next);
          else username = next;
        } else if (/^-p\d+$/.test(value)) port = validPort(value.slice(2));
        else if (/^-l.+/.test(value)) username = value.slice(2);
        else if (value.startsWith('-')) throw new Error('只读取 SSH 地址、账号和端口；其他命令选项请在电脑上处理');
        else targets.push(value);
      }
      if (targets.length !== 1) throw new Error('请只粘贴 SSH 连接命令，不要附带远程命令');
      target = targets[0];
    }
    if (target.startsWith('ssh://')) {
      let url;
      try { url = new URL(target); } catch (error) { throw new Error('SSH 连接地址格式不正确'); }
      if (url.password || url.search || url.hash || (url.pathname && url.pathname !== '/'))
        throw new Error('SSH 地址只填写账号、主机和端口，密码请填在密码框');
      target = url.hostname;
      if (url.username) {
        const account = decodeURIComponent(url.username);
        if (username && username !== account) throw new Error('SSH 命令中的账号不一致');
        username = account;
      }
      if (url.port) {
        const number = validPort(url.port);
        if (port && port !== number) throw new Error('SSH 命令中的端口不一致');
        port = number;
      }
    } else {
      const at = target.lastIndexOf('@');
      if (at >= 0) {
        const account = target.slice(0, at);
        if (!account) throw new Error('SSH 主机或账号格式不正确');
        if (username && username !== account) throw new Error('SSH 命令中的账号不一致');
        username = account;
        target = target.slice(at + 1);
      }
      const address = target.match(/^(\[[0-9a-fA-F:.]+\]|[^:]+):(\d+)$/);
      if (address) {
        const number = validPort(address[2]);
        if (port && port !== number) throw new Error('SSH 命令中的端口不一致');
        port = number;
        target = address[1];
      }
    }
    target = target.replace(/^\[([0-9a-fA-F:.]+)\]$/, '$1');
    if (!/^[a-zA-Z0-9_.-]+$/.test(target) && !/^[0-9a-fA-F:.]*:[0-9a-fA-F:.]+$/.test(target))
      throw new Error('SSH 主机地址格式不正确');
    if (target.startsWith('-') || (username && !/^[a-zA-Z0-9_.-]+\$?$/.test(username)))
      throw new Error('SSH 主机或账号格式不正确');
    if (target.includes(':')) {
      try { new URL('http://[' + target + ']/'); }
      catch (error) { throw new Error('SSH 主机地址格式不正确'); }
    }
    // A pasted ssh command or URI has SSH's default port, even after editing a
    // different office that used a custom port. A bare host preserves the field.
    if (port === undefined && /^ssh(?:\s|:\/\/)/.test(text)) port = 22;
    return { host: target, username, port };
  }

  function parseModelConfig(raw) {
    if (!raw || raw.length > 16000) throw new Error('请粘贴不超过 16000 字符的模型 JSON 配置');
    let input;
    try { input = JSON.parse(raw); } catch (error) { throw new Error('配置不是有效 JSON，请检查引号和逗号'); }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('请粘贴包含地址、模型名和密钥的 JSON 对象');
    const field = names => {
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(input, name)) {
          if (typeof input[name] !== 'string') throw new Error('模型配置的字段应为文本');
          return input[name].trim();
        }
      }
      return '';
    };
    const baseUrl = field(['baseUrl', 'baseURL', 'base_url', 'OPENAI_BASE_URL']);
    const modelId = field(['modelId', 'model', 'model_id', 'OPENAI_MODEL']);
    const apiKey = field(['apiKey', 'api_key', 'OPENAI_API_KEY']);
    if (!baseUrl || !modelId) throw new Error('配置中需要 baseUrl 和 model（或 modelId）');
    let url;
    try { url = new URL(baseUrl); } catch (error) { throw new Error('模型地址格式不正确'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('模型地址应为不含账号、密钥或查询参数的 HTTP(S) 地址');
    if (modelId.length > 160) throw new Error('模型名称最多 160 字符');
    return { baseUrl, modelId, apiKey };
  }

  // Defaults are editable; a preset never submits a request or copies a saved key.
  const providers = {
    bailian: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-plus' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-flash' }
  };
  const api = { parseSshConnection, parseModelConfig, providers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BridgeSetup = api;
})(typeof window === 'undefined' ? globalThis : window);
