# Evals

Run a skill's **cases** through your own agent's headless CLI and grade each run. The runner knows no agent: `scripts/agents.json` describes each one.

## Run

1. Identify yourself: the agent ID in `scripts/agents.json` that matches the CLI you run in (`claude`, `opencode`, `agy`, …). When none matches, go to [Add an agent](#add-an-agent) first.
2. Find the cases: `<skill-dir>/evals/cases.json` by default. When the skill has none, draft them with the user from the [case format](#case-format), and save them where the user chooses.
3. Tell the user the cost before you start: every trial is a full agent run on their account, and a `judge` grader adds one more run.
4. Run, from any folder:

   ```sh
   node <this skill's folder>/scripts/run-evals.mjs --agent <id> --skill <skill-dir> [--cases <file>] [--model <model>] [--trials <n>] [--case <id>]
   ```

   It prints a table per case and the folder holding the logs and `report.json`. Exit code 0 means every case passed.
5. Report the table. For each failing case, read its log and say why it failed. Done when every case has a pass rate and every failure has a cause.

The runner evaluates the **installed** skill: the agent loads skills the usual way, so install the version under test first.

## Case format

```json
{
  "cases": [
    {
      "id": "audits-agents-md",
      "prompt": "Audit AGENTS.md with prompt analyzers. Report findings, apply none.",
      "turns": ["Apply all findings."],
      "files": { "AGENTS.md": "# Rules\n- Always ask first.\n- Never ask questions.\n" },
      "trials": 3,
      "expect": {
        "triggered": true,
        "text": ["contradict"],
        "notText": ["error"],
        "files": { "AGENTS.md": { "exists": true, "contains": "ask", "notContains": "Never ask" } },
        "judge": "The answer reports the conflict between 'Always ask first' and 'Never ask questions'."
      }
    }
  ]
}
```

- `prompt` opens a new session; each entry of `turns` continues it. Use `turns` to answer a skill that asks questions.
- `files` seeds a fresh temporary folder per trial; the agent runs there. Put a string that exists only in the seed files into at least one `text` grader: a run that read the wrong folder then fails without a paid `judge` run.
- Graders: `triggered` (did the skill fire), `text` / `notText` (case-insensitive regexes on the final answer), `files` (state after the run), `judge` (the same agent grades the answer against a rubric in a separate run). Every trial also fails on a non-zero exit or a timeout.
- A case passes when at least 2/3 of its trials pass (`--min-pass` changes it).
- A grader the agent cannot support (no `triggered` pattern) shows under "Not supported" and does not count.

## Add an agent

Add an entry to `scripts/agents.json`. Read the agent's `--help` for each field, show the entry to the user, and run one case with `--trials 1` to verify it.

| Field | Meaning |
|---|---|
| `run` | Command and flags for one non-interactive turn that auto-approves file edits in its working folder. |
| `continue` | Flags that continue the most recent session in the same folder. |
| `model` | Flags that pick a model; `{model}` is replaced by `--model`. |
| `prompt` | `stdin` or `arg`: how the prompt reaches the CLI. Prefer `stdin`; on Windows the runner refuses `arg`, because cmd.exe would parse the prompt. |
| `triggered` | Regex that matches the CLI's output when the skill fires; `{skill}` is replaced by the skill name. Omit when unknown. |
| `final` | Which JSON output line holds the final answer: `match` (key/value pairs on the line) and `path` (dot path to the text). Omit for plain-text output. |
| `verified` | Agent version and date of the last real run, or `false`. |

Find `triggered` and `final` by running one prompt that uses a skill with the JSON output format and reading the lines.
