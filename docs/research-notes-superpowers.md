# Superpowers vs agent-kit: Research Report

Date: 2026-08-01

## 1. What Superpowers Is

**Superpowers** (v6.2.0, https://github.com/obra/superpowers, MIT license, by Jesse Vincent / Prime Radiant) is a **cross-harness agent skills kit**: a library of composable `SKILL.md` files plus a bootstrap that injects skill awareness at session start, causing the agent to auto-trigger skills before acting.

### Architecture

Three layers:

1. **Skills (harness-agnostic)**: `skills/*/SKILL.md` — YAML frontmatter (`name`, `description`) + Markdown instruction body. Skills describe *actions* ("invoke a skill", "read a file", "dispatch a subagent") and never name a specific tool. This is what lets one skill body run on Claude Code, Codex, Gemini CLI, Cursor, Pi, OpenCode, Kimi Code, and others verbatim.

2. **Tool mapping (per-harness)**: `skills/using-superpowers/references/<harness>-tools.md` (or inline in the bootstrap injector) translates action vocabulary into real tool names. Says e.g. *dispatch a subagent* → call `task` with `subagent_type`, or (Pi) *read the relevant SKILL.md with the `read` tool*.

3. **Bootstrap (per-harness)**: The `using-superpowers/SKILL.md` content is injected into every session via one of three shapes:
   - **Shape A (shell-hook)**: harness runs a shell command at session start, reads JSON stdout. `hooks/session-start` is a bash script that `cat`s `using-superpowers/SKILL.md`, wraps it in `<EXTREMELY_IMPORTANT>` tags, and outputs the harness-specific JSON shape. Used by Claude Code (`hookSpecificOutput.additionalContext`), Cursor (`additional_context`), and Copilot CLI (`additionalContext`).
   - **Shape B (in-process plugin)**: harness loads a JS/TS module exposing lifecycle callbacks. Bootstrap is assembled in code (strip frontmatter → wrap → inject as user-role message). Dedup guard + compaction re-injection. Used by OpenCode (`.opencode/plugins/superpowers.js`) and Pi (`.pi/extensions/superpowers.ts`).
   - **Shape C (instructions-file)**: harness has neither hook nor code plugin; loads an extension-declared context file. `GEMINI.md` is just two `@`-includes (the bootstrap skill + tool mapping). Used by Gemini CLI.

### Skill Format

```
skills/
  <skill-name>/
    SKILL.md              # Required: YAML frontmatter + Markdown body
    visual-companion.md   # Optional support files
    implementer-prompt.md # Optional prompt templates
    task-reviewer-prompt.md
    scripts/              # Optional helper scripts for subagent bookkeeping
```

Frontmatter fields: `name` (e.g. `brainstorming`), `description` (auto-trigger hint: "You MUST use this before any creative work...").

Key skill bodies use consistent patterns: `.dot` flowcharts, `<HARD-GATE>` and `<EXTREMELY-IMPORTANT>` wrappers, "Common Rationalizations" tables (Excuse → Reality), structured processes with numbered phases, and inline `<SUBAGENT-STOP>` markers to suppress skill activation in subagent context.

### Skill Inventory (14 skills)

| Category | Skill | Auto-trigger |
|---|---|---|
| Meta | `using-superpowers` | Every session |
| Meta | `writing-skills` | Creating/editing skills |
| Design | `brainstorming` | Before any creative work |
| Design | `writing-plans` | After approved design |
| Implementation | `test-driven-development` | Any feature/bugfix |
| Implementation | `subagent-driven-development` | Plan execution (same session) |
| Implementation | `executing-plans` | Plan execution (parallel session, no subagents) |
| Implementation | `dispatching-parallel-agents` | 2+ independent tasks |
| Debugging | `systematic-debugging` | Any bug/failure |
| Debugging | `verification-before-completion` | Before claiming fixed |
| Review | `requesting-code-review` | Between tasks, before merge |
| Review | `receiving-code-review` | When review feedback arrives |
| VCS | `using-git-worktrees` | Before feature work |
| VCS | `finishing-a-development-branch` | When work complete |

### Hooks System

- `hooks/hooks.json` — Claude Code: `{ "hooks": { "Startup": [...] } }` with `matcher: "startup|clear|compact"`, commands referencing `${CLAUDE_PLUGIN_ROOT}`.
- `hooks/hooks-cursor.json` — Cursor: `{ "version": 1, "hooks": { "sessionStart": [...] } }` with relative command path.
- `hooks/run-hook.cmd` — polyglot batch/shell dispatcher for Windows support.
- `hooks/session-start` — bash script that detects harness from env vars, reads the bootstrap skill, JSON-escapes it, and prints harness-specific output.

### Distribution / Install Model

Superpowers ships through each harness's own install mechanism, never by hand-editing user config:

| Harness | Channel |
|---|---|
| Claude Code | Official Anthropic plugin marketplace + `superpowers-marketplace` |
| Codex | OpenAI plugin marketplace + fork sync script |
| Cursor | Plugin marketplace (`/add-plugin superpowers`) |
| Gemini CLI | `gemini extensions install https://github.com/obra/superpowers` |
| Pi | `pi install git:github.com/obra/superpowers` (declared via `package.json` fields `pi.extensions` + `pi.skills`) |
| OpenCode | `opencode.json` plugin git URL |
| Kimi Code | `/plugins install https://github.com/obra/superpowers` |
| Factory Droid | `droid plugin install superpowers@superpowers` |
| Copilot CLI | `copilot plugin install superpowers@superpowers-marketplace` |

Version tracking: `.version-bump.json` lists each per-harness manifest with its version field path; `scripts/bump-version.sh` keeps them in lockstep.

### Project Philosophy

- **Test-Driven Development** — always write tests first.
- **Systematic over ad-hoc** — process over guessing.
- **Complexity reduction** — simplicity as primary goal.
- **Evidence over claims** — verify before declaring success.
- **Zero runtime dependencies** — by design, with one carve-out for new harness ports.
- **Skills are behavior-shaping code** — tested with eval harnesses (drill/tmux sessions + LLM verifier), not prose.
- **94% PR rejection rate** — extremely strict contributor guidelines (disclose model/harness/plugins, target `dev`, no "compliance" rewrites, no speculative fixes, no third-party deps, no domain-specific skills).
- **"Human partner" language** — deliberate, not interchangeable with "the user."

---

## 2. Side-by-Side Comparison

| Dimension | Superpowers | agent-kit (this repo) |
|---|---|---|
| **Philosophy** | Cross-harness skills library: teach agents *how* to work (TDD, systematic debugging, plan→execute→review). Multi-harness install via plugin system. | Lightweight deterministic crew workflow: teach agents *how to coordinate* (delegation, isolation, reporting). Single-harness primary + multi-crew model via Herdr + worktrees. |
| **Skill format** | `skills/<name>/SKILL.md`: YAML frontmatter (`name`, `description`) + Markdown body. Supports prompt templates, scripts, reference files in skill dir. Cross-harness tool-agnostic vocabulary. | `.agents/skills/<name>/SKILL.md`: YAML frontmatter (`name`, `description`, `argument-hint`). Markdown body. Pi-native, uses Pi tool names (`read`, `write`, `edit`, `bash`). |
| **Skill loading** | Bootstrap injects `using-superpowers` skill at session start → model learns to check for skills before acting → invokes skill via native `Skill` tool or `read SKILL.md` fallback. | Pi native skill system: skills listed in available_skills XML block in system prompt. No runtime bootstrap; no auto-trigger logic beyond Pi's description matching. |
| **Auto-trigger** | Yes — bootstrap trains model to scan skill descriptions and invoke before any action. "Even 1% chance a skill might apply → MUST invoke." Rationalization table blocks excuses. | Partial — Pi infers skill applicability from description fields. No `<EXTREMELY_IMPORTANT>` wrapper or anti-rationalization table. Depends on model judgment. |
| **Automation / Hooks** | Extensive: `session-start` hooks inject bootstrap; `session_compact` re-injects; `agent_end` resets. For Pi: `resources_discover`, `session_start`, `session_compact`, `agent_end`, `context` lifecycle events. | Minimal: `ak` wrapper script (`crew-spawn`, `crew-report`, `crew-finish`) coordinates Herdr + VCS workspaces. Pi extension (`ak-context-file-imports.ts`) only handles `@shared.md` expansion. No lifecycle hooks. |
| **Isolation** | `using-git-worktrees` skill creates isolated worktrees per feature. `subagent-driven-development` creates per-plan git-ignored workspace (`.superpowers/sdd/<plan>/`). | `crew-spawn` creates isolated VCS workspace (`jj workspace` or git worktree `ak/<slug>`) per crew. Each crew gets its own Herdr tab. |
| **Safety** | "No production code without a failing test first." Delete code written before tests. "No fixes without root cause investigation." Spec self-review → user review gate. Hard gates (`<HARD-GATE>`) block premature implementation. Five-round fix loop circuit breaker. | Human-supervised: no merge/force-push/reset/clean without explicit approval. `crew-finish` refuses dirty worktrees. `crew-report` → `crew-finish` lifecycle. Primary reviews before cleanup. |
| **Reporting** | Subagent statuses (DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED). Ledger-based progress tracking (`progress.md`) survives compaction. Task reviewer verdicts (spec compliance + quality). Final whole-branch review. | Push-first: `crew-report <slug> "<summary>"` → writes report, appends inbox, marks crew as `reported`, wakes primary via Herdr notification + message injection. `crew-cost` ledger for spend. |
| **Extensibility** | Per-harness tool mapping reference files. `writing-skills` skill teaches how to create new skills with TDD. Eval harness (`superpowers-evals`/drill). Marketplace + plugin ecosystem. | Simple: `.agents/skills/` directory for new skills. `extensions/pi/` for Pi lifecycle extensions. No marketplace or external distribution model. |
| **VCS model** | git-only (assumes git worktrees). `sdd-workspace` script and `review-package` script for subagent bookkeeping. | jj-first with git fallback. `crew-spawn`/`crew-finish` handle both. jj workspace cleanup (abandon empty change, forget workspace). git worktree cleanup (delete worktree, branch, prune unreachable commits). |
| **Cost tracking** | Not built-in. SDD controller selects cheapest sufficient model per task role (mechanical → cheap, judgment → standard, architecture → strong). | Built-in: `crew-cost <slug> <usd\|unknown>`, `crew-cost-summary`, `crew-cost-prompt`. Local TSV ledger under `.agent-kit/crew/<slug>/cost.tsv`. |
| **Delegation model** | Subagent dispatch within one session: fresh subagent per task, two-stage review (spec + quality), fix loop with re-reviews. Parallel agents for independent work. Controller coordinates, never fixes code. | Crew delegation across sessions: primary spawns isolated crews in separate Herdr tabs. Crews report back via push reporting. Primary reviews, then finishes crews. |
| **Harness support** | 10+ harnesses (Claude Code, Codex, Cursor, Gemini CLI, Pi, OpenCode, Kimi Code, Copilot CLI, Antigravity, Factory Droid). | Pi-first, with Claude Code via shared instructions symlink. Install script supports opencode. |
| **Evals / testing** | Skill-behavior evals: drill harness drives tmux sessions, LLM verifier judges compliance. Plugin-infrastructure unit tests (`tests/hooks/`, `tests/pi/`, `tests/opencode/`). | No automated eval system. Manual verification via crew reports, Herdr auditing, and deterministic workflow loop. |

---

## 3. Strengths We Could Adopt

### 3.1 Auto-trigger bootstrap pattern

**What**: Superpowers injects the `using-superpowers` skill at session start, wrapped in `<EXTREMELY_IMPORTANT>` tags with a comprehensive anti-rationalization table. This causes the agent to check for relevant skills *before any action*, including "just looking" or "simple questions."

**Where it would live**:
- New file: `.agents/skills/using-agent-kit/SKILL.md` — bootstrap skill teaching the agent to check for crew-delegation and lavish when appropriate.
- Modified: `extensions/pi/ak-context-file-imports.ts` (or a new extension `agent-kit-bootstrap.ts`) — inject the bootstrap as a user message on `session_start` and `session_compact`, with a dedup guard.
- Reference: `/tmp/superpowers/.pi/extensions/superpowers.ts` for the Pi-specific injection pattern.

**Concrete change**: Create a Pi extension that, on `context` event, injects a message like:
```
<EXTREMELY_IMPORTANT>
You have agent-kit. Before any non-trivial action, check whether crew-delegation or lavish applies.
[anti-rationalization table]
</EXTREMELY_IMPORTANT>
```

### 3.2 Anti-rationalization tables in skill instructions

**What**: Superpowers skills include "Common Rationalizations" / "Red Flags" tables that list the exact thoughts an agent will have when trying to skip the skill, with explicit rebuttals. This measurably improves compliance (TDD skill: deleting the "Why Order Matters" section degraded test-first behavior from 8/10 to 5/10 in evals).

**Where it would live**:
- `.agents/skills/crew-delegation/SKILL.md` — add:
  ```
  | Excuse | Reality |
  |--------|---------|
  | "This is a simple investigation" | Simple things become complex. Spawn a crew. |
  | "I can just grep this myself" | That's delegatable research. Use a crew. |
  | "Delegation overhead exceeds the work" | The overhead is one command. The risk of context pollution is higher. |
  ```
- `.agents/skills/lavish/SKILL.md` — add similar table for "I'll just describe it in text."

### 3.3 Hard gates for workflow transitions

**What**: `brainstorming` has `<HARD-GATE>`: "Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it." `systematic-debugging` has "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST."

**Where it would live**:
- `shared.md` — add a general `<HARD-GATE>` for the delegation gate:
  ```
  <HARD-GATE>
  Before any non-trivial tool use, classify as DIRECT or DELEGATE.
  DIRECT requires stating the whitelist reason. DELEGATE requires spawning a crew.
  </HARD-GATE>
  ```
- `docs/deterministic-workflow.md` — reinforce with anti-skip language.

### 3.4 Per-plan workspaces with ledger-based progress

**What**: Superpowers SDD creates `.superpowers/sdd/<plan-basename>/` per plan with a `progress.md` ledger that survives context compaction. Task completion lines (`Task <N>: complete`) prevent re-dispatching already-completed tasks.

**Where it would live**:
- `bin/ak` — `crew-spawn` already creates per-crew worktrees and `.agent-kit/crew/<slug>/`. Could add:
  - `.agent-kit/crew/<slug>/progress.md` with ledger format
  - `crew-resume` command that reads the ledger to skip completed work
- `docs/herdr-workflow.md` — document progress recovery pattern.

### 3.5 Spec design → plan → execute pipeline

**What**: Superpowers enforces a linear pipeline: `brainstorming` (design + user approval) → `writing-plans` (bite-sized 2-5 min tasks with exact file paths) → `subagent-driven-development` or `executing-plans` (per-task dispatch with reviews) → `finishing-a-development-branch`. Each step gates the next.

**Where it would live**:
- This is more a workflow convention than code. Could add reference docs:
  - `docs/spec-to-plan-pipeline.md` — documenting the canonical flow for complex feature work in agent-kit.
  - `.agents/skills/crew-delegation/SKILL.md` — reference brainstorming/planning patterns before spawning implementation crews.

### 3.6 Model selection by task complexity

**What**: SDD explicitly categorizes tasks (mechanical → cheap model, integration/judgment → standard, architecture → strong) and requires explicit model specification when dispatching subagents.

**Where it would live**:
- `.agents/skills/crew-delegation/SKILL.md` — already has a "Model selection" section with cheap/mid/strong tiers. Could strengthen to match SDD's specificity.
- `shared.md` — the primary-agent section already says "choose the lightest sufficient crew model." Could add SDD-style task categorization.

### 3.7 Review-in-the-loop pattern

**What**: SDD dispatches a task reviewer after every task (spec compliance + code quality verdicts), with scoped re-reviews in a fix loop (up to 5 rounds, circuit breaker with controller adjudication). Final whole-branch review uses the most capable model.

**Where it would live**:
- This is largely covered by agent-kit's crew supervision model (`crew-audit`, `crew-report`, primary review). The structured two-stage review (spec then quality) and fix loop could be documented as a skill:
  - New: `.agents/skills/code-review/SKILL.md` or add to crew-delegation.

### 3.8 Write-designs-before-code convention

**What**: `brainstorming` writes design docs to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commits them before any code exists.

**Where it would live**:
- `docs/deterministic-workflow.md` — add step "for non-trivial features, write and commit a short design doc before spawning implementation crews."
- Could use `.agent-kit/specs/` as the convention path.

---

## 4. Things to Adapt or Reject

### Adapt (with modification)

| Item | Reason | Adaptation |
|---|---|---|
| **Eval harness** | Superpowers uses drill + tmux + LLM judge. Too heavy for this kit's scope. | Use lightweight manual checklist verification: `crew-audit` already checks worktree cleanliness and report presence. Add a checklist gate: does the crew follow the deterministic loop? Document in `docs/crew-quality-checklist.md`. |
| **Subagent dispatch within one session** | SDD dispatches subagents from the controller session. Agent-kit uses Herdr tabs with separate sessions. Both are valid isolation strategies. | Keep Herdr model. The key insight — fresh context per task — is already achieved by separate crew tabs. Document the analogy in docs. |
| **Ledger-based progress tracking** | SDD's `progress.md` is critical for compaction survival. Agent-kit crews are shorter-lived (typically one session/tab), but long-running crews could benefit. | Add optional `progress.md` to crew metadata. Lightweight: just a list of completed items. |
| **"Human partner" language** | Superpowers uses this deliberately; agent-kit uses "user." Both are fine. | Keep "user" — agent-kit's tone is technical, not relational. The important part is the structural pattern (rationalization tables, hard gates), not the specific word choice. |

### Reject (with reasons)

| Item | Reason |
|---|---|
| **Full brainstorming → plan → SDD pipeline** | Agent-kit is a coordination/orchestration layer, not a development methodology. The user chooses their own development style. Enforcing a specific pipeline (TDD, design-first, etc.) would be a philosophy mismatch. The kit provides *coordination* tools (delegation, isolation, reporting); it doesn't prescribe *how to code*. |
| **Cross-harness skill portability** | Agent-kit targets Pi specifically, with Claude Code as secondary. Maintaining 10+ harness tool mappings is heavy maintenance and outside scope. The `shared.md` approach (one instructions file, symlinked) is simpler and sufficient. |
| **Zero-dependency plugin install model** | Agent-kit ships as a git repo with an `install.sh` script that symlinks files. This is simpler than per-harness marketplace registrations and appropriate for a personal/team tool. |
| **The full "subagent-driven-development" loop** | The five-round fix loop with re-reviews, task briefs, review packages, scoped re-reviewers, and circuit-breaker adjudication is powerful but complex. Agent-kit's model is lighter: delegate to a crew, let it report back, then the primary reviews. Implementing SDD-style review loops would dramatically increase the kit's complexity. |
| **Skill eval harness (drill + tmux)** | Requires running real agent sessions with LLM judges. Too heavy for a personal coordination kit. Manual supervision is sufficient at this scale. |
| **Skill index / runtime skill listing** | Superpowers needs to teach models to discover skills across harnesses. Since agent-kit is Pi-first, Pi already provides the skills XML block. |
| **Per-skill scripts (e.g. `sdd-workspace`, `task-brief`, `review-package`)** | These are tightly coupled to SDD's workflow. Not needed for agent-kit's coordination model. |
| **The "writing-skills" skill** | For creating new skills with TDD methodology applied to documentation. Too heavy for this kit; adding a skill is a simple `.agents/skills/<name>/SKILL.md` write. |
| **Visual companion feature** | Browser-based visual brainstorming companion. Interesting but out of scope; Lavish serves a similar purpose for agent-kit. |
| **94% PR rejection rate / contributor guidelines** | Superpowers has a public contribution model with strict gates. Agent-kit is a personal/team tool with no external contribution pipeline. |
| **Autonomous multi-hour execution** | Superpowers advertises autonomous work for "a couple hours at a time without deviating from the plan." Agent-kit's deterministic workflow is deliberately lower-autonomy: smaller tasks, more frequent human checkpoints via `crew-report`. Keep the shorter feedback loop. |

---

## 5. Concrete Prioritized Action List (smallest first)

### Tier 1: Quick wins (low effort, high impact)

1. **Add anti-rationalization table to `crew-delegation/SKILL.md`**
   - File: `.agents/skills/crew-delegation/SKILL.md`
   - Add a "Common Rationalizations" table (Excuse → Reality) modeled on Superpowers' `using-superpowers/SKILL.md` Red Flags table.
   - Targets: "this is just a simple investigation," "I can grep this myself," "delegation overhead exceeds the work," "I'll just do this one thing first."
   - Estimated: ~15 lines of Markdown.

2. **Add anti-rationalization table to `lavish/SKILL.md`**
   - File: `.agents/skills/lavish/SKILL.md`
   - Add a similar table for "I'll just describe it in text," "this isn't complex enough for Lavish."
   - Estimated: ~10 lines.

3. **Add `<HARD-GATE>` language to delegation rule in `shared.md`**
   - File: `shared.md`
   - Replace the current "Mandatory delegation gate" bullet list with a `<HARD-GATE>`-style block that is harder to rationalize past.
   - Estimated: ~10 lines changed.

### Tier 2: Moderate effort (medium impact)

4. **Create Pi extension for bootstrap injection**
   - New file: `extensions/pi/agent-kit-bootstrap.ts`
   - Pattern: copy the injection pattern from `/tmp/superpowers/.pi/extensions/superpowers.ts` (lifecycle flags, dedup guard, compaction re-injection, user-role message injection).
   - Injects a short "you have agent-kit" bootstrap pointing at the delegation gate and Lavish.
   - Declare in a `package.json` `pi` field or `~/.pi/agent/extensions/`.
   - Estimated: ~50 lines of TypeScript.

5. **Add model-selection task complexity signals**
   - File: `.agents/skills/crew-delegation/SKILL.md`
   - Expand existing "Model selection" section to include SDD-style task categorization:
     - Touches 1-2 files with complete spec → cheap model
     - Multi-file with integration → standard
     - Architecture/design judgment → strong
   - Estimated: ~15 lines added.

6. **Add optional progress ledger to crew metadata**
   - File: `bin/ak`
   - Add `crew-checkpoint <slug> <item>` command that appends to `.agent-kit/crew/<slug>/progress.md`.
   - Add `crew-resume <slug>` command that reads ledger to show completed items.
   - Document in `docs/herdr-workflow.md`.
   - Estimated: ~30 lines of shell script + doc update.

### Tier 3: Higher effort (lower priority, evaluate after Tier 1+2)

7. **Document spec → plan → crew pipeline convention**
   - New file: `docs/spec-to-plan-pipeline.md`
   - Document the canonical flow for complex feature work: short design doc → implementation plan → spawn crews → review → finish.
   - Reference Superpowers' pipeline as inspiration but keep it lightweight (no mandatory design-first, no TDD enforcement).
   - Estimated: ~40 lines of documentation.

8. **Create a structured code-review skill**
   - New file: `.agents/skills/code-review/SKILL.md`
   - Adapt Superpowers' `requesting-code-review` pattern: base/head SHA diff, dispatch reviewer crew, spec compliance + quality verdicts.
   - Keep it optional and lightweight; don't enforce per-task review loops.
   - Estimated: ~50 lines.

9. **Experiment with drill-style eval for crew-report compliance**
   - Not code, but a process recommendation: periodically run a dummy crew and verify that the primary-agent delegation loop fires correctly.
   - Document in `docs/crew-quality-checklist.md`.

---

## Appendix: Key File References

### Superpowers (v6.2.0)
- `/tmp/superpowers/README.md` — architecture overview, philosophy, install instructions
- `/tmp/superpowers/skills/using-superpowers/SKILL.md` — bootstrap skill with anti-rationalization table
- `/tmp/superpowers/skills/brainstorming/SKILL.md` — design pipeline with `<HARD-GATE>`
- `/tmp/superpowers/skills/subagent-driven-development/SKILL.md` — SDD controller with fix loop
- `/tmp/superpowers/skills/test-driven-development/SKILL.md` — TDD with rationalization table
- `/tmp/superpowers/skills/systematic-debugging/SKILL.md` — root-cause-first debugging
- `/tmp/superpowers/.pi/extensions/superpowers.ts` — Pi extension: bootstrap injection, lifecycle flags
- `/tmp/superpowers/hooks/session-start` — shell-hook bootstrap injector
- `/tmp/superpowers/package.json` — declares `pi.extensions` + `pi.skills`
- `/tmp/superpowers/AGENTS.md` / `CLAUDE.md` — contributor guidelines, 94% PR rejection rate
- `/tmp/superpowers/docs/porting-to-a-new-harness.md` — the definitive integration guide
- `/tmp/superpowers/RELEASE-NOTES.md` — history of changes, eval methodology

### agent-kit (this repo)
- `shared.md` — operating posture, delegation gate, deterministic workflow
- `docs/primary-agent-model.md` — DIRECT/DELEGATE classification, model selection
- `docs/deterministic-workflow.md` — the engineering loop
- `docs/herdr-workflow.md` — Herdr coordination model
- `docs/safety-model.md` — crew lifecycle, safety boundaries
- `docs/reporting-model.md` — push-first reporting, primary wakeup
- `docs/vcs-workflow.md` — jj/git worktree lifecycle
- `docs/supervision-model.md` — primary supervision commands
- `docs/research-notes.md` — original firstmate/lavish research that shaped this kit
- `.agents/skills/crew-delegation/SKILL.md` — delegation skill with model selection
- `.agents/skills/lavish/SKILL.md` — Lavish visualization workflow
- `bin/ak` — helper script (crew-spawn, crew-report, crew-finish, etc.)
- `extensions/pi/ak-context-file-imports.ts` — Pi extension for `@shared.md` imports
