import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { bankPath, acquireBank } from '../storage.mjs';

const worker = new URL('../worker.mjs', import.meta.url);
async function invoke(root, request, callback = () => '{}') {
  const child = spawn(process.execPath, [worker.pathname], {
    env: { ...process.env, ASB_PI_DATA_DIR: root, PI_MEMORY_QMD_UPDATE: 'off', PI_MEMORY_NO_SEARCH: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const events = [];
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line);
    events.push(event);
    if (event.type === 'tool_request') child.stdin.write(JSON.stringify({ type: 'tool_result', id: event.id, result: callback(event) }) + '\n');
  });
  const exited = once(child, 'exit');
  child.stdin.write(JSON.stringify(request) + '\n');
  const [code] = await exited;
  assert.equal(code, 0, JSON.stringify(events) + '\n' + stderr);
  return events;
}

function stream(response, content, tool) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const data = delta => ({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason: null }] });
  response.write('data: ' + JSON.stringify(data(tool ? { role: 'assistant', tool_calls: [tool] } : { role: 'assistant', content })) + '\n\n');
  const end = data({}); end.choices[0].finish_reason = tool ? 'tool_calls' : 'stop';
  response.end('data: ' + JSON.stringify(end) + '\n\ndata: [DONE]\n\n');
}

test('real Pi loads pi-memory, writes Markdown, recalls after process restart and isolates tasks', { timeout: 90000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asb-pi-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer(async (incoming, response) => {
    let raw = ''; for await (const chunk of incoming) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
    const last = body.messages.at(-1);
    if (String(user).includes('Remember TRAIN_PROGRESS_482') && last.role !== 'tool') {
      stream(response, null, { index: 0, id: 'save-1', type: 'function', function: {
        name: 'memory_write', arguments: JSON.stringify({ target: 'long_term', content: '#decision TRAIN_PROGRESS_482: Show progress and explain failures. User confirmed.', mode: 'append' }),
      } });
    } else if (String(user).includes('Refresh task') && last.role !== 'tool') {
      stream(response, null, { index: 0, id: 'live-1', type: 'function', function: { name: 'get_task_output', arguments: '{"task_id":"S-11"}' } });
    } else stream(response, String(user).includes('Refresh task') ? 'Live output checked.' : 'Requirements recorded.');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = { protocol: 1, action: 'chat', namespace: 'test-app', scope: 'task-' + 'a'.repeat(64),
    model: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelId: 'fixture', apiKey: 'synthetic-test-key' },
    systemPrompt: 'You are the butler.', context: 'Training platform (S-11)', tools: [] };
  const events = await invoke(root, { ...base, id: 'first', message: 'Remember TRAIN_PROGRESS_482' });
  const tools = events.find(e => e.type === 'ready').tools;
  assert.ok(tools.includes('memory_read') && tools.includes('memory_write'));
  assert.ok(!tools.includes('bash') && !tools.includes('read') && !tools.includes('edit'));
  const bank = bankPath(root, base.namespace, base.scope);
  assert.match(await readFile(path.join(bank, 'memory/MEMORY.md'), 'utf8'), /TRAIN_PROGRESS_482/);
  assert.match((await readFile(path.join(bank, 'memory/daily', new Date().toISOString().slice(0, 10) + '.md'), 'utf8')), /Butler reported \(not independently verified\)/);
  assert.ok((await readdir(path.join(bank, 'sessions'))).some(f => f.endsWith('.jsonl')));

  const beforeRecall = requests.length;
  await invoke(root, { ...base, id: 'recall', message: 'What were my earlier requirements?' });
  assert.match(JSON.stringify(requests[beforeRecall].messages), /TRAIN_PROGRESS_482/);
  const beforeOther = requests.length;
  await invoke(root, { ...base, scope: 'task-' + 'b'.repeat(64), id: 'social', message: 'Write my social draft.' });
  assert.doesNotMatch(JSON.stringify(requests[beforeOther].messages), /TRAIN_PROGRESS_482/);
  const beforeReplay = requests.length;
  const replay = await invoke(root, { ...base, id: 'first', message: 'Remember TRAIN_PROGRESS_482' });
  assert.equal(requests.length, beforeReplay);
  assert.equal(replay.at(-1).replayed, true);

  let callbacks = 0;
  const queried = await invoke(root, { ...base, id: 'live', message: 'Refresh task', tools: [{ type: 'function', function: {
    name: 'get_task_output', description: 'Read current output', parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  } }] }, event => { callbacks++; assert.equal(event.args.task_id, 'S-11'); return '{"fresh":true,"lastOutput":"tests passed"}'; });
  assert.equal(callbacks, 1); assert.ok(queried.some(e => e.type === 'delta'));
  assert.equal(queried.at(-1).answer, 'Live output checked.');
  assert.ok(!JSON.stringify(await readFile(path.join(bank, 'memory/MEMORY.md'), 'utf8')).includes(base.model.apiKey));
  async function checkNoCredentials(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await checkNoCredentials(file);
      else assert.ok(!(await readFile(file, 'utf8')).includes(base.model.apiKey), `Credentials persisted in ${item.name}`);
    }
  }
  await checkNoCredentials(bank);
});

test('memory bank validates paths and rejects concurrent writers', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asb-pi-lock-')); t.after(() => rm(root, { recursive: true, force: true }));
  assert.throws(() => bankPath(root, '../escape', 'town'));
  assert.throws(() => bankPath(root, 'app', '../task'));
  const bank = bankPath(root, 'app', 'town'); const release = await acquireBank(bank);
  await assert.rejects(acquireBank(bank), /busy/);
  await release(); await (await acquireBank(bank))();
});
