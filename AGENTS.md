# AGENTS.md

This repo ships one agent skill. Only `skills/skill-evaluator/` is installed on users' machines; the root files serve development.

- Domain terms and architecture: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr/).
- Test a change through the installed copy. Reinstall from the working tree with `npx skills@1.7.4 add ./ -g -y`, then run the skill from a new agent session.
- Write agent documents (any `.md` under `skills/skill-evaluator/`, `AGENTS.md`, `CONTEXT.md`) with `writing-for-agents`. After you change one, reinstall first, so the dogfood run uses the changed skill, then run `skill-evaluator` on it. Before you commit, give every finding an outcome: applied, or rejected with a reason.
- Run the unit tests with `node --test tests/`; `tests/run-evals.test.mjs` drives the runner with a fake agent. Keep tests outside `skills/`, which ships to users. A new rule in `skills/skill-evaluator/scripts/check.mjs` cites its ID from `docs/research/analyzers.md` and gets a case in `tests/check.test.mjs`.
- Keep `skills/skill-evaluator/scripts/*.mjs` dependency-free and on Node 20 APIs.
- Run this skill's own behaviour cases with `node skills/skill-evaluator/scripts/run-evals.mjs --agent <id> --skill ~/.agents/skills/skill-evaluator --cases evals/cases.json`; that folder is where `npx skills@1.7.4 add ./ -g -y` installs. They cost real agent runs; ask before you run them.
- When `skills/skill-evaluator/scripts/agents.json` gains or changes an agent, ask to run one single-turn case (`--case <id>`) and, when the entry has `continue` flags, one multi-turn case. When the runs pass, set `verified` to `<Agent> <version>, <YYYY-MM-DD>` and state the turn scope covered there or in `note`. When a run fails, leave `verified` as it is and report the failure.
- Keep the skill agent-agnostic: reach other files by paths relative to the skill folder, and name agent-specific behaviour only as alternatives ("when your harness can spawn a subagent…").
- All repo content is in English.
