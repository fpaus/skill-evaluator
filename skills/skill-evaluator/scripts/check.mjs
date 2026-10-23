#!/usr/bin/env node
// Static checks for an agent document. Node >= 20, no dependencies.
// Usage: node check.mjs <target> [--type skill|subagent|instructions|reference]
// Prints two markdown tables: Static findings (final) and Flags (the analyzer confirms or drops each).
// Rule IDs (A1, B1, ...) and sources: docs/research/analyzers.md in the skill-evaluator repo.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ---------- host profiles ----------
const SPEC = ['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'];
const SKILL_HOSTS = {
  // strict: an unknown field makes the host reject the skill.
  'agentskills.io spec': { required: ['name', 'description'], allowed: SPEC, strict: true },
  'Codex': { required: ['name', 'description'], allowed: SPEC.filter((f) => f !== 'compatibility'), strict: true },
  'opencode': { required: ['name', 'description'], allowed: ['name', 'description', 'license', 'compatibility', 'metadata'], strict: false },
  'Claude Code': {
    required: [],
    allowed: ['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable',
      'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
      'metadata', 'license', 'compatibility'],
    strict: false,
  },
};
const CLAUDE_SUBAGENT = ['name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns',
  'autoCompactWindow', 'skills', 'mcpServers', 'hooks', 'memory', 'background', 'omitClaudeMd', 'effort', 'isolation',
  'color', 'initialPrompt', 'experimental'];
const COPILOT_INSTRUCTIONS = ['applyTo', 'excludeAgent'];
const BOOLEANS = ['disable-model-invocation', 'user-invocable', 'background', 'omitClaudeMd'];
const BOOL_VALUES = /^(true|false|yes|no|on|off|1|0)$/i;

// ---------- parsing ----------
const tokens = (text) => Math.ceil(text.length / 4); // ponytail: chars/4 approximation, swap for a tokenizer if limits get tight

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return { error: 'unclosed frontmatter', fields: {}, bodyStart: 0 };
  // ponytail: top-level keys only, enough for schema and length checks; nested maps are kept as raw text.
  const fields = {};
  let current = null;
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      current = { value: m[2].replace(/^(['"])(.*)\1$/, '$2'), line: i + 1 };
      fields[m[1]] = current;
    } else if (current && /^\s/.test(lines[i])) {
      current.value = [current.value.replace(/^[>|][+-]?$/, ''), lines[i].trim()].filter(Boolean).join(' ');
    }
  }
  return { fields, bodyStart: end + 1 };
}

// Lines outside code fences, with inline code removed, keyed by 1-based line number.
function proseLines(text) {
  const out = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (!fenced) out.push({ n: i + 1, text: line.replace(/`[^`]*`/g, '') });
  });
  return out;
}

// Direct imports: relative markdown links, @path lines (Claude Code), @[x](path) lines (Antigravity).
function imports(file, text) {
  const dir = path.dirname(file);
  const found = [];
  for (const { n, text: line } of proseLines(text)) {
    for (const m of line.matchAll(/(@?)\[[^\]]*\]\(([^)\s]+)\)/g)) found.push({ n, ref: m[2], kind: m[1] ? 'import' : 'link' });
    for (const m of line.matchAll(/(?:^|\s)@(~?[\w./-]+\.\w+)/g)) found.push({ n, ref: m[1], kind: 'import' });
  }
  return found
    .filter(({ ref }) => !/^([a-z]+:|#|mailto:)/i.test(ref))
    .map((i) => {
      const clean = decodeURIComponent(i.ref.split('#')[0]);
      return { ...i, abs: clean.startsWith('~') ? path.join(os.homedir(), clean.slice(1)) : path.resolve(dir, clean) };
    });
}

function inferType(file, fm) {
  const base = path.basename(file);
  if (base === 'SKILL.md') return 'skill';
  if (/^(AGENTS|CLAUDE|GEMINI)\.md$|copilot-instructions\.md$|\.instructions\.md$/.test(base)) return 'instructions';
  if (fm && /(^|[\\/])agents[\\/]/.test(path.relative(process.cwd(), file)) ) return 'subagent';
  return 'reference';
}

// ---------- checks ----------
function check(target, type) {
  const findings = [];
  const flags = [];
  const rel = (f) => path.relative(process.cwd(), f) || f;
  const add = (list, rule, severity, file, line, quote, problem, suggestion) =>
    list.push({ rule, severity, where: `${rel(file)}:${line}`, quote: String(quote ?? '').slice(0, 120), problem, suggestion });
  const finding = (...a) => add(findings, ...a);
  const flag = (...a) => add(flags, ...a);

  const text = fs.readFileSync(target, 'utf8');
  const fm = parseFrontmatter(text);
  type ??= inferType(target, fm);
  const f = fm?.fields ?? {};
  const body = text.split(/\r?\n/).slice(fm?.bodyStart ?? 0).join('\n');
  const val = (k) => f[k]?.value ?? '';
  const at = (k) => f[k]?.line ?? 1;

  // A1-A7 frontmatter
  if (fm?.error) finding('A1', 'high', target, 1, '---', `Frontmatter is ${fm.error}.`, 'Close the frontmatter with a `---` line.');
  if (type === 'skill') {
    if (!fm) finding('A1', 'high', target, 1, text.split('\n')[0], 'No frontmatter. Spec hosts and Codex reject the skill.', 'Start the file with `---`, `name:`, `description:`, `---`.');
    for (const [host, p] of Object.entries(SKILL_HOSTS)) {
      for (const k of p.required) if (!f[k]) finding('A1', 'high', target, 1, '---', `${host} requires \`${k}\`.`, `Add \`${k}:\` to the frontmatter.`);
      for (const k of Object.keys(f)) if (!p.allowed.includes(k)) {
        finding('A1', p.strict ? 'high' : 'low', target, at(k), `${k}:`,
          p.strict ? `${host} rejects the unknown field \`${k}\`.` : `${host} does not document \`${k}\`; it is likely ignored without an error.`,
          p.strict ? `Remove \`${k}\`, move it under \`metadata\`, or accept that the skill does not load on ${host}.` : `Check the spelling of \`${k}\` against the ${host} docs.`);
      }
    }
    const name = val('name');
    if (name) {
      if (name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) finding('A2', 'high', target, at('name'), name, 'The name breaks the spec format: 1-64 characters, lowercase letters, digits and single inner hyphens.', 'Rename it to kebab-case, e.g. `my-skill`.');
      if (name !== path.basename(path.dirname(target))) finding('A2', 'high', target, at('name'), name, `The name differs from the folder name \`${path.basename(path.dirname(target))}\`.`, 'Make the folder name and `name` equal.');
      if (/anthropic|claude/i.test(name)) finding('A3', 'high', target, at('name'), name, 'The name contains a reserved word (`anthropic` or `claude`).', 'Remove the reserved word from the name.');
    }
    const desc = val('description');
    if (f.description && !desc) finding('A4', 'high', target, at('description'), 'description:', 'The description is empty.', 'Write what the skill does and when to use it.');
    if (desc.length > 1024) finding('A4', 'high', target, at('description'), desc, `The description has ${desc.length} characters; the spec maximum is 1024.`, 'Cut it to the key use cases, the most important first.');
    if (desc.length + val('when_to_use').length > 1536) finding('A4', 'medium', target, at('description'), desc, 'Claude Code truncates `description` + `when_to_use` at 1,536 characters in the skill listing.', 'Put the key use case first and shorten the rest.');
    if (/<[^>]+>/.test(name + desc)) finding('A3', 'high', target, at('description'), desc, 'XML tags in `name` or `description` are rejected by the Claude API and Codex.', 'Remove the angle brackets.');
    if (val('compatibility').length > 500) finding('A5', 'high', target, at('compatibility'), val('compatibility'), '`compatibility` exceeds 500 characters.', 'Shorten it to 500 characters or fewer.');
    if (f.agent && val('context') !== 'fork') finding('A7', 'medium', target, at('agent'), 'agent:', 'Claude Code applies `agent` only with `context: fork`.', 'Add `context: fork`, or remove `agent`.');
    if (f.context && val('context') !== 'fork') finding('A7', 'medium', target, at('context'), val('context'), '`fork` is the only documented `context` value.', 'Use `context: fork` or remove the field.');
    if (f.effort && !/^(low|medium|high|xhigh|max)$/.test(val('effort'))) finding('A7', 'medium', target, at('effort'), val('effort'), 'Invalid `effort` value.', 'Use low, medium, high, xhigh or max.');
  }
  if (type === 'subagent') {
    for (const k of ['name', 'description']) if (!f[k]) finding('A1', 'high', target, 1, '---', `Claude Code subagents require \`${k}\`.`, `Add \`${k}:\`.`);
    const name = val('name');
    if (name.length > 256 || name.includes(':') || name.startsWith('-')) finding('A2', 'high', target, at('name'), name, 'A subagent name has at most 256 characters, no `:` and no leading `-`.', 'Rename it.');
    for (const k of Object.keys(f)) if (!CLAUDE_SUBAGENT.includes(k)) finding('A1', 'low', target, at(k), `${k}:`, `Claude Code does not document the subagent field \`${k}\`; it is ignored without an error.`, 'Check the spelling; subagent fields are camelCase.');
    if (!f.tools) flag('F4', 'medium', target, 1, '---', 'No `tools` field: the subagent inherits every tool.', 'List only the tools it needs in `tools`.');
    if (val('permissionMode') === 'bypassPermissions') flag('F4', 'high', target, at('permissionMode'), 'bypassPermissions', '`permissionMode: bypassPermissions` skips every permission prompt.', 'Use a narrower mode, e.g. `acceptEdits`.');
  }
  if (/\.instructions\.md$/.test(target) && fm) {
    for (const k of Object.keys(f)) if (!COPILOT_INSTRUCTIONS.includes(k)) finding('A1', 'low', target, at(k), `${k}:`, `Copilot instruction files document only \`applyTo\` and \`excludeAgent\`.`, `Remove \`${k}\` or check its spelling.`);
    if (f.excludeAgent && !/^(code-review|cloud-agent)$/.test(val('excludeAgent'))) finding('A7', 'medium', target, at('excludeAgent'), val('excludeAgent'), 'Invalid `excludeAgent` value.', 'Use `code-review` or `cloud-agent`.');
  }
  for (const k of BOOLEANS) if (f[k] && !BOOL_VALUES.test(val(k))) finding('A1', 'medium', target, at(k), val(k), `\`${k}\` must be a boolean.`, 'Use `true` or `false`.');
  for (const { n, text: line } of proseLines(text)) {
    if (/\[TODO\b/i.test(line)) finding('A6', 'high', target, n, line.trim(), 'Leftover scaffold placeholder.', 'Replace the placeholder with real content.');
  }

  // B1-B4 size budgets
  const lines = body.split(/\r?\n/).length;
  const base = path.basename(target);
  if (type === 'skill' && (lines > 500 || tokens(body) > 5000)) finding('B1', 'medium', target, 1, base, `The body has ${lines} lines and about ${tokens(body)} tokens; the guidance is under 500 lines and 5,000 tokens.`, 'Move reference material into separate files behind pointers.');
  if (base === 'CLAUDE.md' && lines > 200) finding('B1', 'medium', target, 1, base, `${lines} lines; Claude Code recommends under 200.`, 'Move topic rules into docs reached by pointers.');
  if (/copilot-instructions\.md$|\.instructions\.md$/.test(base) && lines > 1000) finding('B1', 'medium', target, 1, base, `${lines} lines; Copilot recommends about 1,000 at most.`, 'Split it into path-specific instruction files.');
  if (type === 'skill' && tokens(text) > 5000) {
    const cut = text.slice(0, 5000 * 4).split(/\r?\n/).length;
    finding('B3', 'medium', target, cut, text.split(/\r?\n/)[cut - 1], 'After compaction Claude Code re-attaches only the first ~5,000 tokens of a skill; rules after this line drop.', 'Move standing rules above this line, or shorten the skill.');
  }
  if (base === 'AGENTS.md') {
    let total = 0;
    const home = path.join(os.homedir(), '.codex', 'AGENTS.md');
    if (fs.existsSync(home)) total += fs.statSync(home).size;
    for (let d = path.dirname(path.resolve(target)); ; d = path.dirname(d)) {
      const p = path.join(d, 'AGENTS.md');
      if (fs.existsSync(p)) total += fs.statSync(p).size;
      if (fs.existsSync(path.join(d, '.git')) || d === path.dirname(d)) break;
    }
    if (total > 32 * 1024) finding('B2', 'high', target, 1, base, `The Codex AGENTS.md chain totals ${total} bytes; Codex drops content past 32 KiB.`, 'Shorten the chain or move detail into docs reached by pointers.');
  }

  // C1-C3, C5 links and imports
  const seen = new Set();
  const walk = (file, depth, stack) => {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { return; }
    for (const imp of imports(file, content)) {
      if (!fs.existsSync(imp.abs)) {
        if (!seen.has(imp.abs)) finding('C1', 'high', file, imp.n, imp.ref, `The ${imp.kind} target does not exist.`, 'Fix the path or remove the reference.');
        seen.add(imp.abs);
        continue;
      }
      seen.add(imp.abs);
      if (imp.kind !== 'import' || !/\.md$/.test(imp.abs)) continue;
      if (stack.includes(imp.abs)) { finding('C2', 'high', file, imp.n, imp.ref, 'Circular import.', 'Break the cycle.'); continue; }
      if (depth + 1 > 4) { finding('C2', 'high', file, imp.n, imp.ref, `Import depth ${depth + 1}: Claude Code follows at most 4 hops, Gemini CLI 5 levels.`, 'Flatten the import chain.'); continue; }
      walk(imp.abs, depth + 1, [...stack, imp.abs]);
    }
  };
  walk(target, 0, [path.resolve(target)]);

  const skillDir = path.dirname(path.resolve(target));
  if (type === 'skill') {
    const refs = imports(target, text).filter((i) => /\.md$/.test(i.abs) && fs.existsSync(i.abs));
    for (const r of refs) {
      const content = fs.readFileSync(r.abs, 'utf8');
      for (const deeper of imports(r.abs, content)) {
        if (/\.md$/.test(deeper.abs) && deeper.abs !== path.resolve(target) && fs.existsSync(deeper.abs) && deeper.abs.startsWith(skillDir))
          finding('C3', 'medium', r.abs, deeper.n, deeper.ref, 'A reference file links to a further reference; agents may read nested references only partly.', 'Link the file directly from SKILL.md.');
      }
      if (content.split(/\r?\n/).length > 100 && !/^\s*[-*\d.]+\s*\[[^\]]+\]\(#/m.test(content.split(/\r?\n/).slice(0, 40).join('\n')))
        finding('B4', 'low', r.abs, 1, path.basename(r.abs), 'A reference over 100 lines with no table of contents near the top.', 'Add a contents list of heading links at the top.');
    }
    // C5 orphan bundled files: never named in SKILL.md or a file it links.
    const corpus = [text, ...refs.map((r) => fs.readFileSync(r.abs, 'utf8'))].join('\n');
    for (const file of listFiles(skillDir)) {
      const relPath = path.relative(skillDir, file);
      if (relPath === 'SKILL.md' || /^(LICENSE|README)/i.test(path.basename(file))) continue;
      if (!corpus.includes(path.basename(file))) finding('C5', 'low', file, 1, relPath, 'Bundled file that the skill never mentions.', 'Reference it with its load condition, or delete it.');
    }
  }

  // F1-F5, F8 security flags and E1-E2 script hygiene, over the target and bundled text files.
  const scan = type === 'skill' ? [path.resolve(target), ...listFiles(skillDir).filter((p) => p !== path.resolve(target))] : [path.resolve(target)];
  for (const file of scan) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (content.includes('\u0000')) continue; // binary
    const isScript = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1)$/.test(file);
    if (/[\\/]scripts[\\/]check(\.test)?\.mjs$/.test(file)) continue; // this checker holds the patterns it searches for
    content.split(/\r?\n/).forEach((line, i) => {
      const n = i + 1;
      // F2 hidden content
      if (/[​-‏‪-‮⁠-⁤⁦-⁩]|[\u{E0000}-\u{E007F}]|﻿/u.test(line.slice(i === 0 ? 1 : 0)))
        finding('F2', 'high', file, n, JSON.stringify(line).slice(0, 80), 'Invisible or bidi-control Unicode characters: the model reads text the reader cannot see.', 'Delete the hidden characters.');
      if (/[A-Za-z0-9+/]{200,}={0,2}/.test(line)) finding('F2', 'medium', file, n, line.slice(0, 60), 'A long base64-like blob hides its content from review.', 'Replace it with readable text or a referenced file.');
      if (/<!--/.test(line) && !isScript) flag('F2', 'low', file, n, line.trim(), 'HTML comment: hidden in rendered views, but most hosts pass it to the model.', 'Confirm the comment holds no instruction.');
      // F3 secrets
      if (/(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{22,}|sk-ant-[\w-]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}|xox[baprs]-[\w-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(line)
        || /(api[_-]?key|secret|token|passw(or)?d)\s*[:=]\s*['"]?[A-Za-z0-9/+_.-]{16,}/i.test(line))
        finding('F3', 'high', file, n, line.trim().replace(/([:=]\s*['"]?).{6}.*/, '$1******'), 'Hardcoded secret: every reader of the context gets it.', 'Remove it, rotate it, and read it from the environment.');
      // F1 / F9 injection phrasing
      if (/ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|rules)|disregard (all |the )?(previous|prior|above|system)|reveal (the |your )?system prompt|(developer|unrestricted|god) mode|do not (tell|inform|mention (this )?to) the user|without (telling|informing) the user/i.test(line))
        flag('F1', 'high', file, n, line.trim(), 'Prompt-injection phrasing.', 'Decide whether the text performs an injection or only discusses one.');
      if (/(fetch|download|curl|read|follow)[^.]{0,40}https?:\/\/[^\s)]+[^.]{0,40}(instructions|and follow|then follow)/i.test(line))
        flag('F9', 'medium', file, n, line.trim(), 'Remote content loaded as instructions.', 'Decide whether the agent follows fetched text; prefer bundling it.');
      // F5 load-time execution
      if (/^\s*!`[^`]+`/.test(line)) flag('F5', 'high', file, n, line.trim(), 'A `!`cmd`` line runs before the model sees the prompt.', 'Confirm the command is safe and needed at load time.');
      // F8 destructive commands
      if (/rm\s+-[a-z]*r[a-z]*f|git\s+push\s+(--force|-f)\b|git\s+reset\s+--hard|DROP\s+(TABLE|DATABASE)|(curl|wget)[^|]*\|\s*(ba|z)?sh/i.test(line))
        flag('F8', 'high', file, n, line.trim(), 'Destructive or fetch-and-execute command.', 'Check for a confirmation or validate step before it.');
      // E1 interactive scripts, E2 unpinned runners
      if (isScript && /\binput\(|\bread\s+-[a-z]*p|Read-Host|readline\.createInterface|\bprompt\(/.test(line))
        finding('E1', 'high', file, n, line.trim(), 'The script waits for interactive input and hangs in an agent run.', 'Take the value from an argument or environment variable.');
      for (const m of line.matchAll(/\b(npx|uvx|pipx run)\s+(-y\s+|--yes\s+)?([@\w./-]+)/g))
        if (!/@\d|==\d/.test(m[3].replace(/^@/, '')) && !/^-/.test(m[3])) finding('E2', 'low', file, n, m[0], `\`${m[1]} ${m[3]}\` runs an unpinned package version.`, `Pin it, e.g. \`${m[1]} ${m[3]}@<version>\`.`);
      if (/\bpip install\s+(?!-r)([\w-]+)(?![=<>~])/.test(line)) finding('E2', 'low', file, n, line.trim(), 'Unpinned `pip install`.', 'Pin the version with `==`.');
    });
  }

  // F4 / F5 frontmatter permissions
  if (f['allowed-tools']) {
    const tools = val('allowed-tools');
    if (/(^|[\s,[])(Bash|\*)(?![(\w])/.test(tools)) flag('F4', 'high', target, at('allowed-tools'), tools, 'Unrestricted `Bash` or `*` in `allowed-tools` pre-approves any command, even in untrusted folders.', 'Scope it, e.g. `Bash(git status:*)`.');
    else flag('F4', 'low', target, at('allowed-tools'), tools, 'Pre-approved tools.', 'Check that the body uses each tool and needs no broader scope.');
  }
  if (f.hooks) flag('F5', 'high', target, at('hooks'), 'hooks:', 'Frontmatter hooks run code without a model decision while the skill is active.', 'Confirm each hook is safe and needed.');

  return { type, findings, flags };
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.') && !/node_modules|\.git/.test(e.parentPath ?? e.path))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

function table(rows, prefix) {
  if (!rows.length) return 'None.';
  const order = { high: 0, medium: 1, low: 2 };
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return ['| ID | Rule | Severity | File:line | Quoted text | Problem | Suggestion |', '|---|---|---|---|---|---|---|',
    ...rows.sort((a, b) => order[a.severity] - order[b.severity])
      .map((r, i) => `| ${prefix}${i + 1} | ${r.rule} | ${r.severity} | ${esc(r.where)} | ${esc(r.quote)} | ${esc(r.problem)} | ${esc(r.suggestion)} |`)].join('\n');
}

export { check, parseFrontmatter, imports };

// realpath on both sides: skills install through symlinks, and Node resolves them for import.meta.url only.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const typeArg = args.includes('--type') ? args[args.indexOf('--type') + 1] : undefined;
  const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--type');
  if (!target || !fs.existsSync(target)) {
    console.error('Usage: node check.mjs <target> [--type skill|subagent|instructions|reference]');
    process.exit(2);
  }
  const { type, findings, flags } = check(target, typeArg);
  console.log(`# Static checks: ${target} (type: ${type})\n\n## Findings\n\n${table(findings, 'S')}\n\n## Flags for review\n\n${table(flags, 'G')}`);
}
