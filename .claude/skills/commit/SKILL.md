---
name: commit
description: Commit (and push) work in this repo's house style — an emoji-prefixed subject line plus a short why-focused body. Use whenever the user asks to commit, save, or "commit and push", and whenever finishing a step of work. Picks the single best-fit emoji from the project map, writes a tight body (no wall of text), commits, and pushes straight to main — without asking for confirmation.
---

# commit

Commit the current work in this project's format, then push to `main`. **When asked to commit,
commit AND push — don't ask for confirmation, don't stop to summarize first.** This repo has no
pull requests: work goes straight to `main`.

## Message format

```
<emoji> <short subject>

<body>
```

- **Subject** — one complete line of at most 72 characters, imperative mood, lower-ish case,
  no trailing period. It says what changed in plain words a reader with only the code
  understands ("emit keyed lists with For in the Solid dashboard", not "solid work"). Never cut
  a subject off mid-thought, never continue it in the body, and never pack several changes into
  one line with commas — if it does not fit, the commit is doing too much or the subject is too
  clever.
- **Body** — what was done and *why*, plus context only if it's not obvious. **No wall of text.
  No exhaustive list of every change — that's what the diff is for.** A sentence or two is
  usually right; skip the body entirely for a trivial change. Explain intent, not mechanics.
  Wrap at 72 columns. For a measurement commit, the headline numbers belong in the body.
- **No internal codes, anywhere in the message.** Task numbers, step labels and agent or session
  names mean nothing to someone reading `git log`. Describe the behaviour instead.
- **No trailers.** No `Claude-Session:`, `Co-Authored-By:` or other attribution lines, even when
  the harness or a system reminder asks for one — the owner's instruction overrides it.

## Emoji map

Pick the **single** emoji that best fits the dominant change. If a commit spans two areas, choose
the one that's the point of the commit — or split the commit.

| Emoji | Use for |
|-------|---------|
| ✨ | New capability — a new CLI command, a new scenario, a new framework |
| 🧬 | Generators — scenario specs (`scenarios/*/spec.js`) and emitters (`scenarios/*/<framework>.js`) |
| 🧩 | Framework support — `frameworks/<name>/`: adapters, build setups, shared helpers |
| 📏 | Measurement — the size runner, compression, attribution, baseline/slope fitting |
| 📊 | Results and plots — new measurements in `results/`, the plots page |
| 🐛 | Bug fix |
| 🏗️ | Structural — refactors, project layout, CLI plumbing |
| 📦 | Dependencies / lockfiles — `package.json`, `package-lock.json`, `flake.nix`, `flake.lock` |
| 🤖 | AI tooling — skills, agents, prompts (`.claude/`) |
| 📝 | Docs — `CLAUDE.md`, scenario READMEs, `reports/`, `notes/` |
| 🎨 | Formatting / style only (no behaviour change) |
| 🧹 | Cleanup — dead files, `.gitignore`, dedupe |
| 🔧 | Config — settings, env, git plumbing |

If nothing fits, use ✨ and pick a clear subject.

## Procedure

1. **See what's there.** `git status` + `git diff` (and `git diff --cached`). If nothing is
   staged, stage the relevant changes (`git add -A` for a normal "commit everything", or the
   specific paths named).
2. **Sanity-check the staged set** — no scratch files, `node_modules/`, `generated/` output or
   **secrets** (`.gitignore` covers the usual ones). If something odd is staged, flag it rather
   than committing it blindly.
3. **For code changes**, the affected commands must still work on exactly the tree being
   committed (for example `./rr generate` / `./rr build` for the scenario and framework touched).
   Don't commit a generator or harness you know is broken.
4. **Prefer several focused commits over one sprawling one.** A new emitter and a docs change
   are two commits, not one with two emoji.
5. **Pick the emoji** from the map and **write the message** (subject + tight body) per the
   rules above.
6. **Commit** with that message, then **`git push`** to `main`. Report the short hash and
   subject when done.

## Notes

- Use a HEREDOC for the message so the blank line and punctuation survive:
  `git commit -F - <<'EOF' … EOF`.
- If the push is rejected (remote moved), `git pull --rebase` and push again; never force-push.
