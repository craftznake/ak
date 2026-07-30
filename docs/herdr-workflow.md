# Herdr workflow

The user's preferred multiplexer is Herdr. This repo uses it as the visible coordination layer for a primary agent plus isolated crews.

## Model

- one primary agent coordinates the workflow.
- each crew gets its own VCS workspace (`jj workspace` for jj repos, git worktree for git repos).
- each crew is surfaced in Herdr as `ak-<slug>`.
- the primary agent remains responsible for checks, safety, and handoff in chat.

## Manual task launch

```sh
herdr workspace create --label agent-kit --cwd "$PWD" --no-focus
herdr tab create --label ak-fix-login --cwd "$PWD" --no-focus
```

Then start the desired harness/model in the tab, for example `pi`, `claude`, `opencode`, or `codex`. Choose the lightest sufficient model for the crew's workload.

## Helper script

`bin/ak` provides a small wrapper:

```sh
bin/ak doctor
bin/ak init
bin/ak primary-set
bin/ak plan "migration strategy"
bin/ak lavish .lavish/migration-strategy.html
bin/ak herdr-tab fix-login .
bin/ak crew-spawn fix-login "stabilize the flaky login test"
AK_CREW_COMMAND='<harness/model command>' bin/ak crew-spawn docs-sweep "update related docs with a lightweight model"
bin/ak crew-status
bin/ak crew-audit
bin/ak crew-report fix-login "ready for review"
bin/ak crew-peek fix-login 120
bin/ak crew-send fix-login "how's the test fix going?"
bin/ak crew-finish fix-login
```

The wrapper refuses Herdr operations when `herdr` is missing; it does not silently fall back to tmux or another multiplexer.

## Safety boundaries

- Herdr is presentation/coordination, not authority.
- Git state and project instructions remain authoritative.
- Do not infer ownership from a tab label alone.
- Do not close or delete workspaces/tabs containing unknown or unlanded work.
- Finish a crew only after its worktree is clean and a report exists.
