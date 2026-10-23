# Candidate analyzers for skill-evaluator

Research date: 2026-10-23. Question: which checks can make `skills/skill-evaluator/ANALYZERS.md` more complete?

## Method and scope

- Primary sources only: vendor docs, specs and source code at pinned commits. Sources are in [Sources](#sources), cited as `[S#]`.
- Third-party linters (agnix, waza, Cisco, Sentry) are used for their **rule lists**. Where a rule cites a vendor doc, the vendor doc owns it. Where it does not, the row says "tool-only".
- **Strength** column: `MUST` = the spec or vendor doc rejects or truncates. `SHOULD` = vendor recommendation. `tool-only` = a threshold one tool chose, with no vendor source.
- **Mode** column: `Det` = a script can decide it. `LLM` = needs judgment. `Hybrid` = a script flags candidates, the LLM decides.
- Architecture fit ([ADR 0001](../adr/0001-host-agent-runs-the-analyzers.md)): the host agent runs everything. A `Det` check means the host runs a bundled script, or `skills-ref validate` when installed [S2]. No server.
- Description trigger testing (should-trigger / should-not-trigger queries) [S4] belongs to the planned eval runner, not to the static analyzers.

## Key finding: rules differ by host

A single frontmatter schema produces false positives. Make the schema check host-aware: run the spec core first, then add each host's field set.

| Host | Required fields | Allowed fields | Unknown field | Source |
|---|---|---|---|---|
| agentskills.io spec / `skills-ref` | `name`, `description` | `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility` | error | [S1] §Frontmatter; [S2] L14–22, L104–115 |
| Codex `quick_validate.py` | `name`, `description` | the same set without `compatibility` | error | [S12] |
| Claude Code skill | none (`name` defaults to the folder name; `description` is recommended) | about 20 fields (`when_to_use`, `disable-model-invocation`, `context`, `hooks`, `paths`, …) | silently ignored | [S6] §Frontmatter reference |
| Claude Code subagent | `name` (≤ 256 characters, no `:`), `description` | `tools`, `model`, `permissionMode`, `skills`, `hooks`, … | — | [S8] |
| opencode skill | `name` (regex `^[a-z0-9]+(-[a-z0-9]+)*$`), `description` (1–1024) | `license`, `compatibility`, `metadata` (string map) | not stated | [S11] |
| Copilot `*.instructions.md` | `applyTo` (path-specific files) | `applyTo`, `excludeAgent` (`code-review` or `cloud-agent`) | — | [S9] |

Self-test: the repo's own `skills/skill-evaluator/SKILL.md` passes the `skills-ref` rules (2 fields, a valid name that matches its folder, a 224-character description).

## Candidate analyzers

### A. Structure and schema (deterministic)

| # | Analyzer | Detects | Mode | Strength | Why it matters | Source |
|---|---|---|---|---|---|---|
| A1 | Frontmatter schema (host-aware) | Missing or unparsable frontmatter; missing required fields; fields the host does not allow; wrong types (for example a non-boolean `disable-model-invocation`) | Det | MUST (spec, Codex); Claude Code ignores unknown fields silently, so report a warning there | A rejected skill never loads. A misspelled Claude Code field does nothing, with no error | [S1] §Frontmatter; [S2] L118–147; [S12]; [S6] ("Claude Code ignores a field it doesn't recognize without reporting an error"); agnix AS-001..003, AS-016, CC-SK-017, CC-AG-019, COP-004 [S13] |
| A2 | Name format | Length > 64; uppercase; leading, trailing or double hyphen; characters outside `[a-z0-9-]`; name ≠ parent folder | Det | MUST | Spec clients reject the skill | [S1] §name (L61–65); [S2] L25–67; [S11] |
| A3 | Reserved words and XML in name/description | `anthropic` or `claude` in the name; XML tags in name or description. Codex also rejects `<` and `>` in the description | Det | MUST (Claude API; Codex) | Upload or load fails | [S5] §Skill structure ("Cannot contain reserved words", "Cannot contain XML tags"); [S12]. Note: waza checks only the prefixes `claude-` and `anthropic-` [S14] `spec_checks.go` L324–420, while Anthropic says "contain" |
| A4 | Description length | Empty; > 1024 characters; Claude Code: `description` + `when_to_use` > 1,536 characters (truncated in the listing) | Det | MUST (1–1024); truncation (1,536) | Truncated text loses triggers; the key use case must come first | [S1] §description (L94); [S6] §Frontmatter reference. waza also demands ≥ 150 characters: **tool-only** [S14] `internal/scoring/scoring.go` L296–305 |
| A5 | `compatibility` length | > 500 characters | Det | MUST | Spec violation | [S1] L126; [S2] L87–101 |
| A6 | Leftover scaffold | `[TODO: …]` placeholders in the description or body (outside code fences) | Det | MUST (Codex validator) | Unfinished skills ship | [S12]; agnix AS-027 [S13] |
| A7 | Host-specific value checks | Invalid `model`, `effort`, `context`, `agent` without `context: fork`, invalid `applyTo` glob, invalid `excludeAgent` | Det | MUST | The field fails or is ignored | [S6]; [S9]; agnix CC-SK-001..005, COP-003, COP-005 [S13] |

### B. Size and context budget (deterministic)

| # | Analyzer | Detects | Mode | Strength | Why it matters | Source |
|---|---|---|---|---|---|---|
| B1 | Body length per file type | SKILL.md body > 500 lines or > 5,000 tokens; CLAUDE.md > 200 lines; Copilot instruction file > ~1,000 lines | Det | SHOULD | "Longer files consume more context and reduce adherence" | [S1] §Progressive disclosure (L220–224); [S5] §Token budgets; [S7] §Write effective instructions ("target under 200 lines"); [S10] ("maximum of about 1,000 lines"). waza's 500-token soft limit is **tool-only** [S14] `scoring.go` L22–23 |
| B2 | Combined always-loaded budget | Codex: combined AGENTS.md chain > 32 KiB (`project_doc_max_bytes`); later files are dropped. Claude Code: subagent descriptions > 15,000 tokens in total | Det | MUST (Codex truncates); SHOULD (Claude warns) | Instructions past the cap never reach the model | [S15] §Size limit; [S8] |
| B3 | Compaction position | A skill longer than 5,000 tokens: rules placed after the first 5,000 tokens drop when Claude Code re-attaches the skill after compaction (shared budget 25,000 tokens) | Det (token position) | Vendor behaviour | Late rules silently disappear in long sessions | [S6] §Skill content lifecycle |
| B4 | Long reference without table of contents | Reference file > 100 lines with no contents list at the top | Det | SHOULD | Claude may preview with `head -100` and miss sections | [S5] §Structure longer reference files with a table of contents |

### C. Links, imports and references (deterministic)

| # | Analyzer | Detects | Mode | Strength | Why it matters | Source |
|---|---|---|---|---|---|---|
| C1 | Broken relative link / missing import | Markdown links and `@path` imports that resolve to no file; quoted `@` paths or unescaped spaces (Claude Code does not import them) | Det | MUST | The agent reads nothing, or fails | [S7] §Import additional files; agnix REF-001, REF-002, CC-MEM-001, CC-MEM-019 [S13]; waza link scorer [S14] `cmd/waza/dev/links.go` L74–160 |
| C2 | Import depth and cycles | Claude Code: > 4 hops. Gemini CLI: > 5 levels (default), circular imports | Det | MUST | Deeper imports are not loaded | [S7] ("maximum depth of four hops"); [S16] |
| C3 | Skill reference depth | A reference file that links to a further file (chain > 1 level from SKILL.md) | Det | SHOULD | "Claude might partially read files when they're referenced from other referenced files" | [S1] L237; [S5] §Avoid deeply nested references; agnix AS-013 |
| C4 | Pointer without load condition | "See references/ for details" with no trigger for when to read it | LLM | SHOULD | The agent loads too much or never loads the file | [S3] L90; agnix AS-026 |
| C5 | Orphan bundled file | A file in `scripts/`, `references/` or `assets/` that the skill never mentions | Det | SHOULD | Dead weight, or a missing instruction | [S5] §Observe how Claude navigates Skills ("Ignored content"); agnix AS-023 |
| C6 | Nonexistent command or tool | A command, script or tool name that does not exist in the repo or host; MCP tools without the `Server:tool` prefix | Hybrid | SHOULD | "tool not found" errors | [S5] §MCP tool references; [S7] line "run a prompt audit" (`/doctor prompt-audit` checks "references to files or commands that don't exist"); agnix CC-MEM-004, CC-SK-008 |

### D. Content quality (mostly LLM)

| # | Analyzer | Detects | Mode | Strength | Overlap with existing category | Source |
|---|---|---|---|---|---|---|
| D1 | Description: third person, what + when, specific | "I can help…" / "You can use…"; no trigger clause; vague ("Helps with documents") | Hybrid | SHOULD | Lever "weak description": make these explicit sub-checks | [S5] §Writing effective descriptions; [S1] L95–96; [S8] ("use proactively" for subagents) |
| D2 | Time-sensitive content | Dates and "before/after <month year>" conditions; version-pinned facts in the main flow | Hybrid | SHOULD | New | [S5] §Avoid time-sensitive information; [S17] (excludes "Information that changes frequently") |
| D3 | Inconsistent terminology | Several terms for one concept ("field", "box", "element") | LLM | SHOULD | Partly Ambiguity | [S5] §Use consistent terminology |
| D4 | Too many options, no default | "You can use A, or B, or C…" without a default | LLM | SHOULD | Cognitive load | [S5] §Avoid offering too many options; [S3] §Provide defaults, not menus |
| D5 | Knowledge the model already has | Tutorials, standard conventions, "write clean code", file-by-file codebase tours | LLM | SHOULD | No-ops lever (extend it with this exclude list) | [S17] §Write an effective CLAUDE.md (Include/Exclude table); [S5] §Concise is key; [S10] (vague quality directives) |
| D6 | Emphasis overuse | Many lines marked IMPORTANT / MUST / ALWAYS | Hybrid | SHOULD | New (keyword counting is the flag) | [S17] ("If you emphasize many lines, none of them stands out"); agnix CC-MEM-017. waza counts `must not`/`never`/`always` > 5 as risk: **tool-only** threshold [S14] `advisory_checks.go` L152–191 |
| D7 | One-time steps where standing rules are needed | A skill's content enters context once and is not re-read; rules written as one-off steps fade | LLM | Vendor behaviour | Partly Coverage gap | [S6] §Skill content lifecycle |
| D8 | Instructions for older models | Workarounds or emphasis written for earlier model generations | LLM | SHOULD | New | [S7] (`/doctor prompt-audit`: "instructions written for older models") |
| D9 | Missing verification step | A workflow with destructive or batch steps and no validate → fix → repeat loop | LLM | SHOULD | Completion-criteria lever | [S5] §Implement feedback loops, §Create verifiable intermediate outputs; [S3] §Validation loops |
| D10 | Over-specific content | Hard-coded user-home paths, IPs, ports, internal URLs; Windows backslash paths | Det | SHOULD | New | [S5] §Avoid Windows-style paths; [S3] using-scripts L91 (relative paths); waza `over-specificity` [S14] `advisory_checks.go` L271–300; agnix XP-SK-002, XP-SK-004 |
| D11 | Duplicated README / file listings in CLAUDE.md | Directory trees, README copies | Hybrid | SHOULD | Duplication lever | [S17] Exclude table ("File-by-file descriptions"); agnix CC-MEM-010, CC-MEM-021 |

### E. Bundled scripts (deterministic + LLM)

| # | Analyzer | Detects | Mode | Strength | Why it matters | Source |
|---|---|---|---|---|---|---|
| E1 | Interactive script | `input()`, `read -p`, TTY prompts, confirmation menus | Det | MUST ("hard requirement") | "A script that blocks on interactive input will hang indefinitely" | [S3] using-scripts L229–231; agnix AS-022 |
| E2 | Unpinned package runner | `npx pkg`, `uvx pkg`, `pip install pkg` without a version | Det | SHOULD | Behaviour drifts; supply-chain risk | [S3] using-scripts L46, L85, L153; Cisco "Supply Chain Attack" (unpinned dependencies) [S18] L87 |
| E3 | Unlisted dependency | A script or step needs a package the skill does not name | Hybrid | SHOULD | Fails on hosts without network | [S5] §Package dependencies, §Avoid assuming tools are installed |
| E4 | Run vs read ambiguity; voodoo constants | The skill does not say whether to run or read a script; unexplained magic numbers | LLM | SHOULD | Ambiguity lever | [S5] §Provide utility scripts, §Solve, don't defer |

### F. Security (hybrid)

| # | Analyzer | Detects | Mode | Strength | Why it matters | Source |
|---|---|---|---|---|---|---|
| F1 | Prompt-injection phrasing | "Ignore previous instructions", unrestricted-mode / bypass-policy text, requests to reveal the system prompt, concealment ("do not tell the user") | Hybrid: script flags, LLM decides whether the text **performs** injection or only **discusses** it | Security | Hijacks the host agent | OWASP LLM01, LLM07 [S19]; Cisco `prompt_injection.yaml` rule IDs [S18]; Sentry Phase 4 and its false-positive rule [S20] L70–80 |
| F2 | Hidden or encoded content | Zero-width, bidi-override and Unicode tag characters (U+E0000), homoglyphs, base64 blobs, hidden HTML, text in image metadata | Det | Security | The reader cannot see what the model reads | Cisco AISubtech-1.1.2 [S18] L77, `core/rules/unicode_smuggling.py`; Sentry `references/prompt-injection-patterns.md` §Obfuscation, §Hidden Content Vectors [S20]. Nuance: Claude Code strips block-level HTML comments from CLAUDE.md [S7], but other hosts and SKILL.md bodies keep them |
| F3 | Hardcoded secrets | API keys, tokens, passwords in the document or bundled files | Det | Security | Leakage; every reader of the context gets the secret | OWASP LLM02, LLM07 [S19]; Cisco `hardcoded_secrets.yaml` [S18]; agnix XP-SK-003 |
| F4 | Tool-permission scope (least privilege) | `allowed-tools` with unrestricted `Bash` or `*`; granted tools the body never uses; subagent without `tools` (inherits every tool); `permissionMode: bypassPermissions`; Copilot skill pre-approving `shell` | Hybrid | Security (SHOULD) | Claude Code applies a project skill's `allowed-tools` "even in a `-p` run in a folder you've never trusted" | [S6] §Pre-approve tools for a skill; [S8] (`tools`: "Inherits every tool … if omitted"); OWASP LLM06 Excessive Agency [S19]; Sentry Phase 8 [S20] L142–156; Cisco `_check_allowed_tools_violations` [S18] `core/analyzers/static.py` L4206; agnix CC-SK-007, CC-AG-012, CC-AG-022, CP-SK-002 |
| F5 | Load-time execution surfaces | `` !`cmd` `` injection lines (run before the model sees the prompt); frontmatter `hooks` (stay active for the session); test files and npm `postinstall` that run as side effects | Det (flag) + LLM (judge) | Security | Code runs without a model decision | [S6] §Dynamic context injection, `hooks` row; Sentry Phase 5 "Structural attacks" [S20] L82–112 |
| F6 | Config / memory poisoning | Instructions to edit `CLAUDE.md`, `MEMORY.md`, `settings.json`, `.mcp.json`, hooks, or to add allowlist entries | LLM | Security | Persists after the skill is removed | Sentry Phase 5 [S20]; OWASP LLM04 [S19] |
| F7 | Description–behaviour mismatch and scope creep | The body does things the description does not announce (reads `~/.ssh`, gathers env vars, installs other skills) | LLM | Security | Trigger hijack and hidden capability | Sentry Phase 5 [S20]; Cisco "Skill Discovery Abuse", "Undeclared capability use" [S18] L80–81, `trigger_analyzer.py` L17–23 |
| F8 | Destructive commands without a gate | `rm -rf`, `git push --force`, `DROP`, fetch-and-execute (`curl … \| sh`) with no confirmation or plan-validate step; side-effect skills without `disable-model-invocation` | Hybrid | SHOULD / Security | Irreversible actions | [S5] §Create verifiable intermediate outputs; [S6] (`disable-model-invocation` for manual workflows); [S17] (side-effect workflows); Cisco "Code Execution" [S18] L85; agnix CC-SK-006 |
| F9 | Remote instruction loading | URLs whose content the agent must fetch and follow as instructions | LLM | Security | Indirect prompt injection (transitive trust) | Cisco AITech-1.2 [S18] L78; Sentry Phase 7 [S20] L132–140; OWASP LLM01 [S19] |

### G. Cross-file (deterministic + LLM)

| # | Analyzer | Detects | Mode | Overlap | Source |
|---|---|---|---|---|---|
| G1 | Instruction-file precedence | Conflicts between nested AGENTS.md / CLAUDE.md / user and project rules; Codex: the closer file wins; Claude: user and project rules have no precedence ("Claude may follow either one") | LLM | Extends Composition conflict beyond the import list | [S15] §Concatenation; [S7] §User-level rules; [S9] §Precedence |
| G2 | Duplicate skill names / overlapping triggers across a catalog | Two skills with one name, or descriptions that compete for one request | Hybrid | Weak-description lever | agnix AS-025 (cites [S1] client implementation); Cisco `cross_skill_scanner.py` "complementary triggers" [S18]; [S3] best-practices L80 (scope) |

## Not verified at a primary source

- **Copilot code review reads only the first 4,000 characters.** The fetched Copilot pages [S9], [S10] do not state it. Do not implement it.
- **agnix rules whose vendor pages I did not open:** COP-011 (custom-agent prompt length), CX-SK-* (Codex skill fields and catalog budget), CL-SK-*, CR-SK-*, XP-004/XP-005 (conflicting build/tool commands). Their rule text cites vendor docs; I did not read those docs.
- **Snyk agent-scan:** cloned, rules not read (detection seems to run server-side; unverified).
- **promptfoo:** not investigated. It is an eval and red-team tool; its assertions fit the planned eval runner, not the static analyzers.
- **Gemini CLI GEMINI.md authoring rules:** the docs give discovery and import mechanics only [S16], no content rules.

## Recommendation: add these first

Order = impact × cheapness. Items 1–4 are scripts the host runs; items 5–8 extend the LLM prompt.

1. **Host-aware frontmatter schema** (A1–A7). Spec core plus per-host field sets. Fails loudly today only in the host, after shipping. Overlaps nothing.
2. **Size budgets per file type** (B1–B4): 500 lines / 5,000 tokens for SKILL.md, 200 lines for CLAUDE.md, 32 KiB for the Codex chain, 1,536 characters for the Claude listing, 15,000 tokens of subagent descriptions, the 5,000-token compaction cut. Gives the "sprawl" lever hard numbers.
3. **Links, imports and depth** (C1–C3, C5): missing files, Claude 4 hops, Gemini 5 levels, skill references one level deep, orphan files.
4. **Hidden content and secrets** (F2, F3). Pure scripts, high harm, no false-positive judgment needed.
5. **Prompt-injection phrasing** (F1, F9): script flags, LLM decides "performs vs discusses" (Sentry's rule).
6. **Tool-permission scope and load-time execution** (F4, F5, F8): `allowed-tools`, missing subagent `tools`, `` !`cmd` ``, `hooks`, destructive commands without a gate.
7. **Description–behaviour mismatch and config poisoning** (F6, F7). One LLM category: "Security / scope".
8. **Script hygiene** (E1, E2): interactive prompts and unpinned runners. Cheap regexes.

### Overlap with the existing categories

| Candidate | Existing category | Action |
|---|---|---|
| D1 description checks; G2 trigger overlap; Cisco trigger hijack | Lever: weak description | Add explicit sub-checks (third person, what + when, specificity) |
| waza `negative-delta-risk` "conflicting procedure paths" [S14] L145–150 | Contradiction | Already covered |
| D4 too many options | Cognitive load | Add as an example |
| D3 terminology; agnix PE-004 | Ambiguity | Add as an example |
| agnix PE-006 negative-only instructions | Lever: negation | Already covered |
| D5 known knowledge; PE-005 | Lever: no-ops | Add the Claude Code Include/Exclude table as the reference list |
| B1–B4 size; C4 load conditions | Lever: sprawl | Give it numbers per host |
| D9 verification step | Lever: completion criteria | Already covered |
| D11 README duplication | Lever: duplication | Already covered |
| F7 description vs body | Coverage gap | Different direction (body does more than announced); keep it under Security |
| G1 precedence across nested files | Composition conflict | Extend scope from imports to the discovery chain |

New categories with no overlap: frontmatter schema, size budgets, links/imports, time-sensitive content (D2), emphasis overuse (D6), older-model instructions (D8), over-specific content (D10), script hygiene (E), all security checks (F).

## Sources

Pinned commits are permalinks; line numbers refer to those commits.

- [S1] Agent Skills specification — https://agentskills.io/specification; source https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx
- [S2] `skills-ref` validator — https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/skills-ref/src/skills_ref/validator.py
- [S3] agentskills.io best practices and scripts — https://agentskills.io/skill-creation/best-practices, https://agentskills.io/skill-creation/using-scripts; source `docs/skill-creation/best-practices.mdx`, `using-scripts.mdx` at the [S1] commit
- [S4] agentskills.io optimizing descriptions — https://agentskills.io/skill-creation/optimizing-descriptions
- [S5] Anthropic, Skill authoring best practices — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- [S6] Claude Code, Skills — https://code.claude.com/docs/en/skills
- [S7] Claude Code, Memory (CLAUDE.md) — https://code.claude.com/docs/en/memory
- [S8] Claude Code, Subagents — https://code.claude.com/docs/en/sub-agents
- [S9] GitHub Copilot, repository custom instructions — https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- [S10] GitHub Copilot, customize code review — https://docs.github.com/en/copilot/tutorials/customize-code-review
- [S11] opencode, Skills — https://opencode.ai/docs/skills/
- [S12] Codex skill-creator validator — https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/scripts/quick_validate.py (read at `main`, not pinned)
- [S13] agnix rule catalog (702 rules, each with `evidence.source_urls`) — https://github.com/agent-sh/agnix/blob/96df606d7e2298a624c958f671c9917ee08c2e1d/knowledge-base/rules.json, prose in `knowledge-base/VALIDATION-RULES.md`
- [S14] Microsoft waza checks — https://github.com/microsoft/waza/tree/1b763c094145f2dd7e5148898bee957737c6922b/internal/checks (`spec_checks.go`, `advisory_checks.go`, `score_checkers.go` L25–55), `internal/scoring/scoring.go`, `cmd/waza/dev/links.go`
- [S15] OpenAI Codex, AGENTS.md — https://learn.chatgpt.com/docs/agent-configuration/agents-md (redirected from developers.openai.com/codex/guides/agents-md)
- [S16] Gemini CLI, GEMINI.md and Memory Import Processor — https://geminicli.com/docs/cli/gemini-md/, https://geminicli.com/docs/reference/memport
- [S17] Claude Code, Best practices — https://code.claude.com/docs/en/best-practices §Write an effective CLAUDE.md
- [S18] Cisco AI Defense skill-scanner — https://github.com/cisco-ai-defense/skill-scanner/blob/de5fcf08fe0b32841602513c5b760a11ef4cbc4a/docs/architecture/threat-taxonomy.md (L69–90), signatures in `skill_scanner/data/packs/core/signatures/`
- [S19] OWASP Top 10 for LLM Applications 2025 — https://genai.owasp.org/llm-top-10/
- [S20] Sentry skill-scanner — https://github.com/getsentry/skills/blob/f57ada2d0b640406ea7e25b11d636c530e77c58b/skills/skill-scanner/SKILL.md (phases L60–156), `references/prompt-injection-patterns.md`, `references/permission-analysis.md`
- Ported origin: microsoft/vscode-chat-customizations-evaluation at `5332191f38fb15ea14d978c7019aaebb3fff3641` has only LLM analyzers (`src/analyzers/llm.ts`); its static checks come from waza.
