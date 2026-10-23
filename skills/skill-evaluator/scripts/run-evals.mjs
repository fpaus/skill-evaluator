#!/usr/bin/env node
// Runs a skill's eval cases through an agent's own headless CLI. Node >= 20, no dependencies.
// Usage: node run-evals.mjs --agent <id> --skill <skill-dir> [--cases <file>] [--model <m>] [--trials <n>]
//        [--case <id>] [--timeout <seconds>] [--agents <agents.json>] [--min-pass <0..1>]
// Agents are data in agents.json; the core knows none of them. Case format: EVALS.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)$/);
    if (m) opts[m[1]] = argv[++i];
  }
  return opts;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fill = (args, vars) => args.map((a) => a.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''));

// One CLI call. Resolves { code, stdout, stderr, timedOut }.
export function runAgent(agent, prompt, { cwd, cont, model, timeoutMs }) {
  const args = [...agent.run.slice(1), ...(cont ? agent.continue ?? [] : []), ...(model && agent.model ? fill(agent.model, { model }) : [])];
  if (agent.prompt === 'arg') args.push(prompt);
  return new Promise((resolve) => {
    // ponytail: shell on Windows so .cmd shims resolve; prompts go by stdin there to dodge cmd.exe quoting.
    // PWD too: some CLIs (opencode) take their folder from $PWD, which a child inherits from the parent.
    // detached on POSIX makes the agent a process-group leader, so a timeout kills its tools too.
    const win = process.platform === 'win32';
    const child = spawn(agent.run[0], args, { cwd, env: { ...process.env, PWD: cwd }, shell: win, detached: !win, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stderr += String(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.end(agent.prompt === 'arg' ? '' : prompt);
  });
}

// Final answer text: the last JSON line matching agent.final.match, read at agent.final.path; else raw stdout.
export function finalText(agent, stdout) {
  if (!agent.final) return stdout;
  let text;
  for (const line of stdout.split('\n')) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (Object.entries(agent.final.match).every(([k, v]) => obj[k] === v)) {
      const v = agent.final.path.split('.').reduce((o, k) => o?.[k], obj);
      if (typeof v === 'string') text = v;
    }
  }
  return text ?? stdout;
}

const re = (p) => new RegExp(p, 'i');

// Grades one trial. Each grader returns { grader, pass: true|false|null, detail }; null = not supported by this agent.
export async function grade(c, { agent, skill, stdouts, work, results, judge }) {
  const expect = c.expect ?? {};
  const out = [];
  const all = stdouts.join('\n');
  const text = finalText(agent, stdouts.at(-1) ?? '');
  const failed = results.find((r) => r.timedOut || r.code !== 0);
  out.push({ grader: 'exit', pass: !failed, detail: failed ? (failed.timedOut ? 'timed out' : `exit ${failed.code}: ${failed.stderr.trim().slice(-200)}`) : 'ok' });
  if ('triggered' in expect) {
    if (!agent.triggered) out.push({ grader: 'triggered', pass: null, detail: 'agent has no trigger pattern' });
    else {
      const fired = new RegExp(agent.triggered.replace('{skill}', escapeRe(skill))).test(all);
      out.push({ grader: 'triggered', pass: fired === expect.triggered, detail: `fired=${fired}` });
    }
  }
  for (const p of [].concat(expect.text ?? [])) out.push({ grader: 'text', pass: re(p).test(text), detail: `/${p}/` });
  for (const p of [].concat(expect.notText ?? [])) out.push({ grader: 'notText', pass: !re(p).test(text), detail: `/${p}/` });
  for (const [rel, rule] of Object.entries(expect.files ?? {})) {
    const file = path.join(work, rel);
    const exists = fs.existsSync(file);
    const body = exists ? fs.readFileSync(file, 'utf8') : '';
    let pass = 'exists' in rule ? exists === rule.exists : true;
    if (rule.contains) pass &&= re(rule.contains).test(body);
    if (rule.notContains) pass &&= !re(rule.notContains).test(body);
    out.push({ grader: 'file', pass, detail: `${rel} ${JSON.stringify(rule)}` });
  }
  if (expect.judge) out.push(await judge(expect.judge, c, text, work));
  return out;
}

function listTree(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)));
}

export async function main(argv) {
  const o = parseArgs(argv);
  if (!o.agent || !o.skill) {
    console.error('Usage: node run-evals.mjs --agent <id> --skill <skill-dir> [--cases <file>] [--model <m>] [--trials <n>] [--case <id>] [--timeout <s>] [--agents <file>] [--min-pass <0..1>]');
    return 2;
  }
  const agents = JSON.parse(fs.readFileSync(o.agents ?? path.join(HERE, 'agents.json'), 'utf8'));
  const agent = agents[o.agent];
  if (!agent) {
    console.error(`Unknown agent "${o.agent}". Known: ${Object.keys(agents).join(', ')}. Add an entry to agents.json (see EVALS.md).`);
    return 2;
  }
  if (agent.prompt === 'arg' && process.platform === 'win32') {
    console.error(`Agent "${o.agent}" takes the prompt as an argument; on Windows cmd.exe would parse it. Use "prompt": "stdin" if the CLI supports it.`);
    return 2;
  }
  const skillDir = path.resolve(o.skill);
  const skill = path.basename(skillDir);
  const casesFile = o.cases ?? path.join(skillDir, 'evals', 'cases.json');
  const { cases } = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const timeoutMs = Number(o.timeout ?? 600) * 1000;
  const minPass = Number(o['min-pass'] ?? 2 / 3);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `skill-evals-${skill}-`));

  const judge = async (rubric, c, text, work) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-judge-'));
    const prompt = [
      'You are grading one run of an AI agent. Use no tools. Judge only from the text below.',
      `Task given to the agent:\n${c.prompt}`,
      `Rubric:\n${rubric}`,
      `Files in the agent's working folder after the run:\n${listTree(work).join('\n') || '(none)'}`,
      `The agent's final answer:\n<answer>\n${text.slice(-20000)}\n</answer>`,
      'Explain briefly, then end with exactly one line: VERDICT: PASS or VERDICT: FAIL.',
    ].join('\n\n');
    const r = await runAgent(agent, prompt, { cwd: dir, model: o['judge-model'] ?? o.model, timeoutMs });
    const verdict = [...finalText(agent, r.stdout).matchAll(/VERDICT:\s*(PASS|FAIL)/gi)].at(-1)?.[1]?.toUpperCase();
    fs.rmSync(dir, { recursive: true, force: true });
    return { grader: 'judge', pass: verdict ? verdict === 'PASS' : false, detail: verdict ?? 'no verdict line', reasoning: finalText(agent, r.stdout).slice(-2000) };
  };

  const selected = cases.filter((x) => !o.case || x.id === o.case);
  if (!selected.length) {
    console.error(`No case matches "${o.case}". Known: ${cases.map((x) => x.id).join(', ')}.`);
    return 2;
  }
  const report = [];
  for (const c of selected) {
    const trials = Number(o.trials ?? c.trials ?? 3);
    const runs = [];
    for (let t = 1; t <= trials; t++) {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), `skill-eval-${c.id}-`));
      for (const [rel, body] of Object.entries(c.files ?? {})) {
        fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
        fs.writeFileSync(path.join(work, rel), body);
      }
      const results = [];
      for (const [i, prompt] of [c.prompt, ...(c.turns ?? [])].entries())
        results.push(await runAgent(agent, prompt, { cwd: work, cont: i > 0, model: o.model, timeoutMs }));
      const stdouts = results.map((r) => r.stdout);
      const grades = await grade(c, { agent, skill, stdouts, work, results, judge });
      const pass = grades.every((g) => g.pass !== false);
      const judged = grades.find((g) => g.reasoning);
      fs.writeFileSync(path.join(outDir, `${c.id}.${t}.log`), results.map((r, i) => `=== turn ${i + 1} (exit ${r.code})\n${r.stdout}\n--- stderr\n${r.stderr}`).join('\n') + (judged ? `\n=== judge\n${judged.reasoning}` : ''));
      fs.rmSync(work, { recursive: true, force: true });
      runs.push({ trial: t, pass, grades });
      console.error(`${c.id} trial ${t}/${trials}: ${pass ? 'PASS' : 'FAIL'}`);
    }
    const rate = runs.filter((r) => r.pass).length / runs.length;
    report.push({ id: c.id, rate, pass: rate >= minPass, runs });
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ agent: o.agent, model: o.model ?? null, skill, report }, null, 2));
  const fails = (r) => [...new Set(r.runs.flatMap((x) => x.grades.filter((g) => g.pass === false).map((g) => `${g.grader}: ${g.detail}`)))].join('; ');
  const na = (r) => [...new Set(r.runs.flatMap((x) => x.grades.filter((g) => g.pass === null).map((g) => g.grader)))].join(', ');
  console.log([
    `# Evals: ${skill} on ${o.agent}${o.model ? ` (${o.model})` : ''}`, '',
    '| Case | Pass rate | Result | Failed graders | Not supported |', '|---|---|---|---|---|',
    ...report.map((r) => `| ${r.id} | ${Math.round(r.rate * 100)}% | ${r.pass ? 'PASS' : 'FAIL'} | ${fails(r).replace(/\|/g, '\\|') || '-'} | ${na(r) || '-'} |`),
    '', `Logs and report.json: ${outDir}`,
  ].join('\n'));
  return report.every((r) => r.pass) ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)))
  process.exitCode = await main(process.argv.slice(2));
