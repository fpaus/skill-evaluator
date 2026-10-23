// Run: node --test tests/
// A fake agent proves the runner core needs nothing agent-specific beyond an agents.json entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RUNNER = path.resolve(import.meta.dirname, '../skills/skill-evaluator/scripts/run-evals.mjs');

test('runner grades a fake agent through agents.json alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-'));
  // Fake agent: reads the prompt on stdin, writes a file, emits JSON lines. Judge prompts get a verdict.
  fs.writeFileSync(path.join(root, 'fake-agent.mjs'), `
    import fs from 'node:fs';
    const prompt = fs.readFileSync(0, 'utf8');
    if (process.env.PWD !== process.cwd()) { console.error('PWD mismatch'); process.exit(3); }
    if (prompt.includes('VERDICT')) { console.log(JSON.stringify({ type: 'result', result: 'Fine. VERDICT: PASS' })); process.exit(0); }
    if (process.argv.includes('--continue')) fs.writeFileSync('second.txt', 'turn two');
    fs.writeFileSync('out.txt', 'hello from ' + prompt.trim());
    console.log(JSON.stringify({ type: 'tool', name: 'skill', id: 'demo' }));
    console.log(JSON.stringify({ type: 'result', result: 'Done: ' + prompt.trim() }));
  `);
  fs.writeFileSync(path.join(root, 'agents.json'), JSON.stringify({
    fake: {
      run: [process.execPath, path.join(root, 'fake-agent.mjs')],
      continue: ['--continue'],
      prompt: 'stdin',
      triggered: '"name":"skill","id":"{skill}"',
      final: { match: { type: 'result' }, path: 'result' },
    },
  }));
  fs.mkdirSync(path.join(root, 'demo'));
  fs.writeFileSync(path.join(root, 'cases.json'), JSON.stringify({
    cases: [
      {
        id: 'passes', prompt: 'greet', turns: ['again'], trials: 2,
        files: { 'seed.md': '# Seed' },
        expect: {
          triggered: true, text: 'done: again', notText: 'error',
          files: { 'out.txt': { exists: true, contains: 'again' }, 'second.txt': { exists: true }, 'seed.md': { contains: 'seed' } },
          judge: 'The agent greeted.',
        },
      },
      { id: 'fails', prompt: 'greet', trials: 1, expect: { triggered: false, text: 'goodbye' } },
    ],
  }));
  let out;
  let code = 0;
  try {
    out = execFileSync(process.execPath, [RUNNER, '--agent', 'fake', '--skill', path.join(root, 'demo'),
      '--cases', path.join(root, 'cases.json'), '--agents', path.join(root, 'agents.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { out = e.stdout; code = e.status; }
  assert.equal(code, 1, 'one failing case makes the run fail');
  assert.match(out, /\| passes \| 100% \| PASS \|/);
  assert.match(out, /\| fails \| 0% \| FAIL \| triggered: fired=true; text: \/goodbye\/ \|/);
});
