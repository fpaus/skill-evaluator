---
name: skill-evaluator
description: Evaluate, improve or create an agent document (SKILL.md, AGENTS.md, CLAUDE.md, subagent) with writing-for-agents, verified by prompt analyzers. Use when asked to evaluate, audit or improve one, or to create one and check it.
---

# Skill evaluator

Write or rewrite an agent document with `writing-for-agents`, run the **analyzers** on it, report the **findings**, and fix the accepted ones. The loop holds at most two rewrites.

The analyzer prompt lives in [`ANALYZERS.md`](ANALYZERS.md), beside this file.

## Steps

1. **Resolve `writing-for-agents`.** Find its `SKILL.md`: first `../writing-for-agents/SKILL.md` relative to this skill's folder; else `writing-for-agents/SKILL.md` under `.agents/skills/`, `~/.agents/skills/`, `.claude/skills/` or `~/.claude/skills/`; else, when your harness exposes `writing-for-agents` only through a skill tool, invoke it and use the base directory it reports. When none of these finds it, stop and tell the user to install it with `npx skills add mattpocock/skills -s writing-for-agents -g`. Done when you hold the absolute path of its `SKILL.md`; `SKILL-MECHANICS.md` sits beside it.

2. **Resolve the target.** Get the target path from the user; ask when it is missing. Take its **type** from the file name and location, and ask when they do not settle it:
   - **skill** — a `SKILL.md`;
   - **subagent** — an agent definition file with frontmatter;
   - **instructions** — `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `copilot-instructions.md` or another always-loaded rule file;
   - **reference** — a doc reached through a pointer.

   Then pick the branch:
   - **Create** when the user asks for a new document. Ask for its **purpose**, read `writing-for-agents` (plus `SKILL-MECHANICS.md` for a skill or subagent), and write the draft. When the path already exists, ask before you overwrite it.
   - **Improve** when the file exists and the user asks to evaluate, audit or improve it: use it as it stands. When the path does not exist, ask whether to create it.

   Collect the target's direct **imports**: files it links by relative path with markdown links (`[x](path.md)`), `@path` lines (Claude Code) and `@[x](path)` lines (Antigravity), resolved relative to the target's folder, with `~` expanded. Keep text files only; skip URLs and imports of imports. Done when you hold the target path, its type, the purpose (Create only) and the list of import paths that exist.

3. **Analyze.** Resolve the absolute path of `ANALYZERS.md`. When your harness can spawn a subagent, dispatch one with fresh context and give it: the `ANALYZERS.md` path, the `writing-for-agents` path, the target path, its type, the purpose (Create only), the import paths, and the **ledger** (all findings from earlier rounds with their outcome; empty on round 1). Tell it to follow `ANALYZERS.md`, to edit no file, and to return only its findings table. A fresh reviewer judges the text the way a cold agent reads it. Without subagents, follow `ANALYZERS.md` inline. Done when you hold a findings table, which may be empty.

4. **Report.** When the table is empty, go to step 7. Otherwise show the table, ordered by severity, and ask which findings to apply: all, a subset by ID, or none. When the user rejects every finding, go to step 7. Done when each finding is marked *accepted* or *rejected* in the ledger.

5. **Rewrite.** Read `writing-for-agents`. Edit the target in place with the file-editing tool, resolving each accepted finding with its suggestion or a better fix that `writing-for-agents` supports. Keep the document's intent and structure; change only what the accepted findings require. Done when each accepted finding is resolved in the file and marked *applied*, or marked *open* in the ledger with a one-line reason why no fix fits.

6. **Re-run.** After the first rewrite, return to step 3 with the updated ledger. After the second rewrite, go to step 7.

7. **Finish.** Report what changed across all rounds (or "no changes"), the ledger, and every open finding: those marked *open*, and those the analyzer reported as "Not resolved". Call the document clean only when the last analyzer pass returned no findings; when the last rewrite had no analyzer pass, say so.
