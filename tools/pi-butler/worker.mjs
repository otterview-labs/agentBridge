#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acquireBank, appendJournal, bankPath, readReceipt, writeReceipt } from './storage.mjs';
import { createRuntime } from './runtime.mjs';

process.umask(0o077);
const root = process.env.ASB_PI_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');
const send = value => process.stdout.write(JSON.stringify({ protocol: 1, ...value }) + '\n');

if (process.argv.includes('--check')) {
  await import('@earendil-works/pi-coding-agent');
  send({ type: 'ready', runtime: 'pi', memory: 'pi-memory', dataDirectory: root });
  process.exit(0);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let first = true;
let start;
const requestPromise = new Promise(resolve => { start = resolve; });
const pending = new Map();
lines.on('line', line => {
  try {
    if (Buffer.byteLength(line) > 256000) throw new Error('Request too large');
    const data = JSON.parse(line);
    if (first) { first = false; start(data); }
    else if (data.type === 'tool_result' && pending.has(data.id)) {
      pending.get(data.id).resolve(String(data.result));
      pending.delete(data.id);
    }
  } catch { send({ type: 'error', message: 'Invalid protocol input' }); process.exit(1); }
});
lines.on('close', () => {
  for (const value of pending.values()) value.reject(new Error('Phone disconnected'));
});
const request = await requestPromise;
let release, runtime;
const timer = setTimeout(() => { send({ type: 'error', message: 'Pi turn timed out' }); process.exit(1); }, 180000);
try {
  if (request.protocol !== 1 || !['chat', 'status'].includes(request.action)) throw new Error('Unsupported request');
  const bank = bankPath(root, request.namespace, request.scope);
  release = await acquireBank(bank);
  if (request.action === 'status') {
    send({ type: 'done', answer: 'Memory directory ready; use the app connection check to test Pi and model.', scope: request.scope, memoryDirectory: path.join(bank, 'memory') });
  } else {
    if (typeof request.message !== 'string' || !request.message.trim() || request.message.length > 4000
      || typeof request.systemPrompt !== 'string' || !request.model?.apiKey || !request.model?.modelId) throw new Error('Invalid chat request');
    const url = new URL(request.model.baseUrl);
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid model URL');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('HTTP requires a local model');
    const receipt = await readReceipt(bank, request);
    if (receipt) send({ type: 'done', answer: receipt.answer, scope: request.scope, replayed: true });
    else {
      runtime = await createRuntime(request, bank, send, (id, name, args) => new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ type: 'tool_request', id, name, args });
      }));
      send({ type: 'ready', tools: runtime.session.getActiveToolNames(), scope: request.scope });
      const answer = await runtime.prompt();
      if (!request.check) await appendJournal(bank, request, answer);
      await writeReceipt(bank, request, answer);
      send({ type: 'done', answer, scope: request.scope, memoryDirectory: path.join(bank, 'memory') });
    }
  }
} catch {
  // Model/extension errors can contain request headers. Do not forward those to
  // the UI or stdout. Technical details can be reproduced with synthetic tests.
  send({ type: 'error', message: 'Pi request failed. Check worker dependencies, selected model and memory scope lock.' });
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  runtime?.dispose();
  await release?.();
  lines.close();
}
