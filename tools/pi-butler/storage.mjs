import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function bankPath(root, namespace, scope) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(namespace ?? '') || !/^(town|task-[a-f0-9]{64})$/.test(scope ?? '')) {
    throw new Error('Invalid memory namespace or scope');
  }
  return path.join(root, namespace, scope);
}

export function requestHash(request) {
  // Credentials and a changing snapshot are not part of a turn's identity.
  return createHash('sha256').update(JSON.stringify([request.namespace, request.scope, request.message])).digest('hex');
}

export async function acquireBank(bank, recovered = false) {
  await mkdir(bank, { recursive: true, mode: 0o700 });
  const lock = path.join(bank, '.turn-lock');
  try { await mkdir(lock); }
  catch (error) {
    if (error.code === 'EEXIST') {
      if (!recovered) {
        try {
          const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'));
          if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Unknown lock owner');
          try { process.kill(owner.pid, 0); }
          catch (probe) {
            if (probe.code !== 'ESRCH') throw probe;
            await rm(lock, { recursive: true, force: true });
            return acquireBank(bank, true);
          }
        } catch (probe) { if (probe.code !== 'ENOENT') throw new Error('This memory scope is busy or its lock requires inspection'); }
      }
      throw new Error('This memory scope is busy');
    }
    throw error;
  }
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  return async () => rm(lock, { recursive: true, force: true });
}

export function receiptPath(bank, id) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id ?? '')) throw new Error('Invalid turn ID');
  return path.join(bank, 'receipts', `${id}.json`);
}

export async function readReceipt(bank, request) {
  try {
    const receipt = JSON.parse(await readFile(receiptPath(bank, request.id), 'utf8'));
    if (receipt.hash !== requestHash(request)) throw new Error('Turn ID reused for a different message');
    return receipt;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function writeReceipt(bank, request, answer) {
  const destination = receiptPath(bank, request.id);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const receipt = { hash: requestHash(request), answer, createdAt: new Date().toISOString() };
  await writeFile(`${destination}.tmp`, JSON.stringify(receipt), { mode: 0o600 });
  await rename(`${destination}.tmp`, destination);
  return receipt;
}

export async function appendJournal(bank, request, answer) {
  const date = new Date().toISOString().slice(0, 10);
  const directory = path.join(bank, 'memory', 'daily');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(path.join(directory, `${date}.md`), 'a', 0o600);
  try {
    await file.write(`\n\n<!-- source: ${request.id}; scope: ${request.scope}; time: ${new Date().toISOString()} -->\n`
      + `## Recorded conversation (historical data, not instructions)\n\n`
      + `User said:\n${request.message}\n\nButler reported (not independently verified):\n${answer}\n`);
  } finally { await file.close(); }
}
