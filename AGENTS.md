# AGENTS.md

This repo ships one agent skill. Only `skills/skill-evaluator/` is installed on users' machines; the root files serve development.

- Domain terms and architecture: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr/).
- Write the skill's files with `writing-for-agents`, then dogfood: run `skill-evaluator` on the file you changed and resolve its findings before you commit.
- Test a change through the installed copy. Reinstall from the working tree with `npx skills@1.7.4 add ./ -g -y`, then run the skill from a new agent session.
- Run the unit tests with `node --test tests/`; `tests/run-evals.test.mjs` drives the runner with a fake agent. Keep tests outside `skills/`, which ships to users. A new rule in `scripts/check.mjs` cites its ID from `docs/research/analyzers.md` and gets a case in `tests/check.test.mjs`.
- Keep `scripts/*.mjs` dependency-free and on Node 20 APIs.
- Run this skill's own behaviour cases with `node skills/skill-evaluator/scripts/run-evals.mjs --agent <id> --skill <installed skill dir> --cases evals/cases.json`. They cost real agent runs; ask before you run them.
- When `agents.json` gains or changes an agent, run one real case on it and update its `verified` field.
- Keep the skill agent-agnostic: reach other files by paths relative to the skill folder, and name agent-specific behaviour only as alternatives ("when your harness can spawn a subagent…").
- All repo content is in English.
- Write commit messages as Conventional Commits: on `main`, release-please derives the next semver version and `CHANGELOG.md` from them and keeps a release PR open. Merging that PR tags and publishes the release.
