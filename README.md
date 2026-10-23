# skill-evaluator

An agent skill that creates and improves agent documents — `SKILL.md`, `AGENTS.md`, `CLAUDE.md` and subagent files. It writes with [`writing-for-agents`](https://github.com/mattpocock/skills), then checks the result with prompt analyzers ported from [microsoft/vscode-chat-customizations-evaluation](https://github.com/microsoft/vscode-chat-customizations-evaluation).

It runs inside the agent you already use (Claude Code, opencode, Antigravity, Copilot CLI, Codex…). No API key, no MCP server, no extra model.

## Install

Requires Node.js 22.20 or later (the `skills` CLI needs it; the bundled scripts run on Node 20+).

```sh
npx skills@1.7.4 add mattpocock/skills -s writing-for-agents -g
npx skills@1.7.4 add fpaus/skill-evaluator -g
```

## Use

Ask your agent, for example:

- "Evaluate `.claude/skills/deploy/SKILL.md`."
- "Improve this repo's `AGENTS.md`."
- "Create a skill that drafts release notes, and check it."

The skill reports findings in a table and asks which to apply before it edits anything.

## Evals

Ask your agent to "run the evals of `<skill>`". The runner (`scripts/run-evals.mjs`) runs each case through **your own agent's headless CLI**, so a skill is tested where it will run. Agents are plain data in `scripts/agents.json`; verified: Claude Code, opencode. Antigravity (`agy`) is listed but unverified. Case format and how to add an agent: [`EVALS.md`](skills/skill-evaluator/EVALS.md).

Every trial is a full agent run billed to your account.

## What it checks

- **Static checks** (`scripts/check.mjs`, deterministic): frontmatter schema per host (agentskills.io spec, Codex, opencode, Claude Code, Copilot), size budgets, broken links and imports, import depth, orphan files, hidden Unicode, hardcoded secrets, interactive scripts and unpinned package runners. It also flags suspect lines for the LLM review: injection phrasing, broad tool permissions, load-time commands, destructive commands.
- **LLM analyzers** (`ANALYZERS.md`): contradictions, ambiguity, persona drift, cognitive load, coverage gaps, conflicts with imported files, security (injection, permissions, scope), and the `writing-for-agents` levers (weak descriptions, unclear completion criteria, negation, duplication, no-ops, sprawl).

Rules and their sources: [`docs/research/analyzers.md`](docs/research/analyzers.md).

## License

MIT. `ANALYZERS.md` ports MIT-licensed prompts from Microsoft; see [`skills/skill-evaluator/NOTICE`](skills/skill-evaluator/NOTICE).
