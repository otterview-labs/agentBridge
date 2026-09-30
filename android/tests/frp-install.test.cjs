const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const source = path.resolve(__dirname, '../app/src/main/java/com/otterview/agentsessionbridge');
const javaHome = process.env.JAVA_HOME;
const java = javaHome ? path.join(javaHome, 'bin/java') : 'java';
const javac = javaHome ? path.join(javaHome, 'bin/javac') : 'javac';
let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'asb-frp-tests-'));
  execFileSync(javac, ['-d', root, path.join(source, 'FrpInstallSupport.java'),
    path.join(__dirname, 'FrpScriptHarness.java')]);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

function fragment(mode, ...extra) {
  return execFileSync(java, ['-cp', root, 'com.otterview.agentsessionbridge.FrpScriptHarness', mode, ...extra],
    { encoding: 'utf8' });
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function fixture() {
  const home = fs.mkdtempSync(path.join(root, 'Home & Office '));
  const bin = path.join(home, 'mock-bin');
  const work = path.join(home, 'download');
  fs.mkdirSync(bin); fs.mkdirSync(work);
  const env = { ...process.env, HOME: home, LC_ALL: 'C', PATH: `${bin}:/usr/bin:/bin`,
    work, archive: 'https://fixture.invalid/frp_0.61.1_darwin_arm64.tar.gz',
    ARCHIVE_FIXTURE: path.join(home, 'fixture.tar.gz'),
    LAUNCH_LOG: path.join(home, 'launch.log') };
  const executable = (name, script) => fs.writeFileSync(path.join(bin, name),
    `#!/bin/sh\nset -eu\n${script}`, { mode: 0o755 });
  executable('curl', `
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then cp "$ARCHIVE_FIXTURE" "$2"; exit 0; fi
  shift
done
exit 2
`);
  return { home, bin, work, env, executable };
}

test('downloads verify the actual renamed archive outside the download working directory', () => {
  const f = fixture();
  const data = Buffer.from('fixture-only archive, never installed');
  fs.writeFileSync(f.env.ARCHIVE_FIXTURE, data);
  const result = spawnSync('/bin/sh', ['-eu', '-c', fragment('download', sha256(data))],
    { cwd: f.home, env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ASB_STAGE=checksum/);
  assert.match(result.stdout, /ASB_STAGE=install/);
  assert.equal(fs.readFileSync(path.join(f.work, 'frp.tar.gz'), 'utf8'), data.toString());
});

test('a wrong pinned checksum or an unlisted archive fails before installation', () => {
  for (const [archive, pinned] of [
    ['https://fixture.invalid/frp_0.61.1_darwin_arm64.tar.gz', '0'.repeat(64)],
    ['https://fixture.invalid/frp_0.61.1_linux_mips.tar.gz', sha256('fixture')]
  ]) {
    const f = fixture();
    f.env.archive = archive;
    fs.writeFileSync(f.env.ARCHIVE_FIXTURE, 'fixture');
    const result = spawnSync('/bin/sh', ['-eu', '-c', fragment('download', pinned)],
      { cwd: f.home, env: f.env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /ASB_STAGE=install/);
    assert.match(result.stderr, /checksum/);
  }
});

test('pinned checksums come from the app, never from the download source', () => {
  const script = fragment('pinned', '0.61.1');
  assert.match(script, /frp_0\.61\.1_linux_amd64\.tar\.gz\) expected=bff260b68ca7b1461182a46c4f34e9709ba32764eed30a15dd94ac97f50a2c40/);
  assert.doesNotMatch(script, /checksums\.txt/);
  const unsupported = spawnSync(java, ['-cp', root, 'com.otterview.agentsessionbridge.FrpScriptHarness', 'pinned', '0.1.0'],
    { encoding: 'utf8' });
  assert.notEqual(unsupported.status, 0);
});

test('an unsupported saved version fails only when a download is actually needed', () => {
  const script = fragment('refuse', "0.62.1'; touch pwned; '");
  const result = spawnSync('/bin/sh', ['-eu', '-c', script], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no pinned checksum/);
  assert.equal(fs.existsSync(path.join(root, 'pwned')), false);
  assert.match(fragment('refuse', '0.61.1'), /expected=/);
});

test('service directories are reset to modes the service account can use', () => {
  const script = fragment('directories');
  assert.match(script, /chmod 0755 \/opt\/asb-frp \/opt\/asb-frp\/bin/);
  assert.match(script, /chown root:asb-frp \/etc\/asb-frp/);
  assert.match(script, /chmod 0750 \/etc\/asb-frp/);
});

test('the service account step reuses an existing account and fails clearly otherwise', () => {
  const existing = fixture();
  existing.executable('id', 'exit 0\n');
  let result = spawnSync('/bin/sh', ['-eu', '-c', `SUDO=''\n${fragment('service-account')}`],
    { cwd: existing.home, env: existing.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const missing = fixture();
  missing.executable('id', 'exit 1\n');
  missing.executable('useradd', 'exit 9\n');
  missing.executable('adduser', 'exit 9\n');
  result = spawnSync('/bin/sh', ['-eu', '-c', `SUDO=''\n${fragment('service-account')}`],
    { cwd: missing.home, env: missing.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /asb-frp service account/);
});

test('a download error stops before checksum or install', () => {
  const f = fixture();
  f.executable('curl', 'echo \"fixture download timeout\" >&2; exit 28\n');
  const result = spawnSync('/bin/sh', ['-eu', '-c', fragment('download', sha256('unused'))],
    { cwd: f.home, env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /ASB_STAGE=checksum|ASB_STAGE=install/);
});

test('GitHub downloads fall back to a checksum-verified mirror', () => {
  const f = fixture();
  f.env.archive = 'https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_darwin_arm64.tar.gz';
  const data = Buffer.from('mirror archive fixture');
  fs.writeFileSync(f.env.ARCHIVE_FIXTURE, data);
  f.executable('curl', `
mirror=0
for arg in "$@"; do case "$arg" in https://gh-proxy.com/*) mirror=1 ;; esac; done
[ "$mirror" -eq 1 ] || { echo "fixture primary download timeout" >&2; exit 28; }
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then cp "$ARCHIVE_FIXTURE" "$2"; exit 0; fi
  shift
done
exit 2
`);
  const result = spawnSync('/bin/sh', ['-eu', '-c', fragment('download', sha256(data))],
    { cwd: f.home, env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ASB_STAGE=install/);
});

test('a tampered mirror archive is rejected', () => {
  const f = fixture();
  f.env.archive = 'https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_darwin_arm64.tar.gz';
  fs.writeFileSync(f.env.ARCHIVE_FIXTURE, 'tampered mirror archive');
  f.executable('curl', `
mirror=0
for arg in "$@"; do case "$arg" in https://gh-proxy.com/*) mirror=1 ;; esac; done
[ "$mirror" -eq 1 ] || exit 28
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then cp "$ARCHIVE_FIXTURE" "$2"; exit 0; fi
  shift
done
exit 2
`);
  const result = spawnSync('/bin/sh', ['-eu', '-c', fragment('download', sha256('the real archive'))],
    { cwd: f.home, env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
});

test('Mac launch agent uses escaped absolute paths and the GUI domain',
  { skip: !fs.existsSync('/usr/bin/plutil') && 'needs macOS plutil' }, () => {
  const f = fixture();
  f.executable('launchctl', 'printf "%s\\n" "$*" >> "$LAUNCH_LOG"\ncase "$1" in print) echo "state = running" ;; esac\n');
  f.executable('sleep', 'exit 0\n');
  const result = spawnSync('/bin/sh', ['-eu', '-c', fragment('mac')],
    { cwd: f.home, env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const plist = path.join(f.home, 'Library/LaunchAgents/com.agent-session-bridge.frpc.asb-machine-2-ssh.plist');
  const config = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  assert.equal(config.ProgramArguments[0], `${f.home}/.asb-frp/bin/frpc`);
  assert.equal(config.ProgramArguments[2], `${f.home}/.config/agent-session-bridge/frpc.toml`);
  assert.match(fs.readFileSync(f.env.LAUNCH_LOG, 'utf8'), /bootstrap gui\/[0-9]+ /);
  assert.doesNotMatch(fs.readFileSync(plist, 'utf8'), /\$HOME/);
});

test('Mac without a desktop session fails clearly without loading a service', () => {
  const f = fixture();
  f.executable('launchctl', 'exit 1\n');
  const result = spawnSync('/bin/sh', ['-eu', '-c', fragment('mac')],
    { cwd: f.home, env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sign in to the Mac desktop/);
  assert.equal(fs.existsSync(path.join(f.home, 'Library/LaunchAgents')), false);
});

test('all native installers use the verified fragment and visitor labels match teardown', () => {
  const bridge = fs.readFileSync(path.join(source, 'PhoneBridge.java'), 'utf8');
  assert.equal((bridge.match(/FrpInstallSupport.downloadOrRefuse\(server.optString\("version"\)\)/g) || []).length, 3);
  assert.equal((bridge.match(/FrpInstallSupport.serviceDirectories\(\)/g) || []).length, 3);
  assert.equal((bridge.match(/FrpInstallSupport.serviceHardening\(\)/g) || []).length, 3);
  assert.doesNotMatch(bridge, /\/etc\/asb-frp\/\$\{label\}/);
  assert.doesNotMatch(bridge, /\(name \+ "-visitor"\)/);
  assert.doesNotMatch(bridge, /archive=\$\{archive\//);
  assert.match(bridge, /verified = connectThroughRelay\(machine, server, relay\)/);
  assert.match(bridge, /远程命令超过/);
  assert.match(bridge, /SSH 连接中断或未返回退出状态/);
  assert.match(bridge, /setServerAliveInterval/);
  assert.doesNotMatch(bridge, /isExistingFrpsReusable|ASB_EXISTING_EXEC/);
  assert.match(bridge, /adopted-existing/);
  assert.match(bridge, /externalToken/);
  assert.match(bridge, /ASB_EXTERNAL_ARGS/);
  const deploy = bridge.slice(bridge.indexOf('public String deployFrpServer('), bridge.indexOf('public String setMachinePublicMode('));
  const adoption = deploy.slice(deploy.indexOf('Adopt a healthy third-party frps'), deploy.indexOf('if (!existingToken.isEmpty())'));
  assert.ok(adoption.indexOf('store.saveFrpServer(server)') < adoption.indexOf('return success'));
  assert.doesNotMatch(adoption, /buildFrpsInstaller|buildFrpsServiceEnabler/);
  const relay = bridge.slice(bridge.indexOf('public String deployFrpRelay('), bridge.indexOf('public String disableFrpRelay('));
  assert.ok(relay.indexOf('verified = connectThroughRelay') < relay.indexOf('relay.put("status", "online")'));
  assert.match(relay, /publicAccessError/);
});
