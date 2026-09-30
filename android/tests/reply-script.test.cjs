const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const source = path.resolve(__dirname, '../app/src/main/java/com/otterview/agentsessionbridge');
const javaHome = process.env.JAVA_HOME;
const java = javaHome ? path.join(javaHome, 'bin/java') : 'java';
const javac = javaHome ? path.join(javaHome, 'bin/javac') : 'javac';
let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'asb-reply-tests-'));
  execFileSync(javac, ['-d', root, path.join(source, 'RemoteReply.java'),
    path.join(__dirname, 'ReplyScriptHarness.java')]);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

function harness(...args) {
  return execFileSync(java, ['-cp', root, 'com.otterview.agentsessionbridge.ReplyScriptHarness', ...args],
    { encoding: 'utf8' });
}

function sh(script, env) {
  const result = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function waitForExit(log, env) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const content = sh(harness('poll', log), env);
    const [status] = harness('parse', content).split('\n');
    if (status !== 'running') return harness('parse', content);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('reply never finished');
}

test('a reply runs detached, returns at once and reports its exit status and output', async () => {
  const tmp = fs.mkdtempSync(path.join(root, 'tmp-'));
  const env = { TMPDIR: tmp };
  const message = "it's \"quoted\" $(touch should-not-exist) `and` -v\nsecond line";
  const command = `sleep 0.3; printf '%s\\n' ${"'" + message.replace(/'/g, "'\\''") + "'"}; echo oops >&2; exit 3`;
  const started = Date.now();
  const log = sh(harness('start', command), env).trim();
  assert.ok(Date.now() - started < 3000, 'start must not wait for the command');
  assert.match(log, /^\/.*asb-reply\.[A-Za-z0-9]+$/);
  const [status, ...rest] = (await waitForExit(log, env)).split('\n');
  const output = rest.join('\n');
  assert.equal(status, '3');
  assert.match(output, /it's "quoted" \$\(touch should-not-exist\) `and` -v\nsecond line/);
  assert.match(output, /oops/);
  assert.equal(fs.existsSync(path.join(tmp, 'should-not-exist')), false);
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('asb-reply-cmd')), []);
});

test('a reply still running is reported as running, not failed', () => {
  const tmp = fs.mkdtempSync(path.join(root, 'tmp-'));
  const log = sh(harness('start', 'sleep 5'), { TMPDIR: tmp }).trim();
  const content = sh(harness('poll', log), { TMPDIR: tmp });
  assert.equal(harness('parse', content).split('\n')[0], 'running');
});

test('poll refuses a log path that is not a plain absolute path', () => {
  for (const bad of ['relative/log', "/tmp/x'; rm -rf ~", '/tmp/../etc/passwd']) {
    const result = spawnSync(java, ['-cp', root, 'com.otterview.agentsessionbridge.ReplyScriptHarness', 'poll', bad],
      { encoding: 'utf8' });
    assert.notEqual(result.status, 0, bad);
  }
});
