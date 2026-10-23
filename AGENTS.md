# AGENTS.md

This repo ships one agent skill. Only `skills/skill-evaluator/` is installed on users' machines; the root files serve development.

- Domain terms and architecture: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr/).
- Write the skill's files with `writing-for-agents`, then dogfood: run `skill-evaluator` on the file you changed and resolve its findings before you commit.
- Test a change through the installed copy. Reinstall from the working tree with `npx skills add ./ -g -y`, then run the skill from a new agent session.
- Keep the skill agent-agnostic: reach other files by paths relative to the skill folder, and name agent-specific behaviour only as alternatives ("when your harness can spawn a subagent…").
- All repo content is in English.
