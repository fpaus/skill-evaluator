# Context

## Glossary

- **Target** — the agent document under work: a skill, `AGENTS.md`, `CLAUDE.md` or subagent file.
- **Import** — a file the target pulls in directly: a relative markdown link, an `@path` line (Claude Code) or an `@[x](path)` line (Antigravity).
- **Analyzer** — the prompt in `ANALYZERS.md` that reviews a target and its imports. It runs in the host agent, in a fresh-context subagent when the harness has one.
- **Finding** — one row of the analyzer's table: category, severity, exact quoted text, problem, suggestion.
- **Ledger** — every finding across rounds with its outcome (*accepted*, *rejected*, *applied*, *open*). Re-runs receive it so findings do not repeat.
- **Host agent** — whichever agent runs the skill. The skill never assumes which one.
- **agy** — the command-line interface of Google Antigravity. "agy" and "Antigravity" name the same host agent.

## Architecture

The skill is plain Markdown. The host agent is the LLM, so the analyzers need no server, API key or model of their own. The writing reference is the separate `writing-for-agents` skill, resolved at run time from the sibling skill folder or by name.

Flow (`SKILL.md`): resolve `writing-for-agents` → resolve or draft the target → analyze → report → rewrite accepted findings → one re-run → finish. At most two rewrites.

Planned: an eval runner (`evals/`) that runs scenario cases through the host agent's own headless CLI, described per agent in a declarative `agents.json`.
