# Contributing

Bug reports and pull requests are welcome. `AGENTS.md` has the technical
rules for changing the code; this file is about the process around it.

## Reporting something

Open an issue: <https://github.com/on6zg/horizon-survey/issues> -> New
issue. Useful things to include, roughly in order of how much they help:

- what you did, what you expected, what happened instead
- the phone and browser (e.g. "Pixel 7, Chrome 129"), because most of
  this project's behaviour is sensor-dependent
- a screenshot of the survey page, or the CSV that came out wrong

An issue that says "the azimuth is 30 degrees off when I hold the phone
tilted" is worth more than a patch, because it can be turned into a test.

## Sending a change

1. Open an issue first, unless one already exists. The order is
   **problem or feature -> issue -> PR**: the issue is where the problem
   and the agreed scope get written down before any code exists, so the
   pull request has a traceable reason to exist and the scope does not
   drift while you work.
2. Fork the repo (Fork button, top right of the GitHub page).
3. Branch from `master`, named for what it does: `fix/zoom-label`,
   `feat/declination-setting`, `chore/readme-hosting`.
4. Make the change. Read `AGENTS.md` first, particularly the rule that
   angle maths lives in `geometry.js` with a test.
5. Run the tests:
   ```bash
   npm test          # or: node --test
   ```
   There is nothing to install. `package.json` has no dependencies.
6. Commit, push to your fork, then open a pull request against
   `on6zg/horizon-survey` `master`.

Put `Closes #<n>` in the pull request description so merging it closes
the issue automatically.

Keep one topic per pull request. Two unrelated fixes in one branch means
neither can be merged until both are agreed on.

What the tests cannot cover: the camera, the compass and tilt sensors,
and anything about how a real phone behaves. Say in the pull request
which of those your change touches and what you actually tried on a
device, if anything.

## If you maintain this repo

Short version of the GitHub workflow, for reference.

**When someone opens an issue.** Nothing happens automatically. Read it,
reply in the thread if something is unclear, and close it when it is
fixed or when you decide not to fix it (closing with a sentence saying
why is a normal and useful answer). Issues are also fine to open on your
own repo as a to-do list; that is what most of them are for.

**When someone opens a pull request.** You get a diff and a Merge button.
Nothing changes in your repo until you press it, and a pull request from
a fork cannot touch anything else in your account.

To review it:

- The **Files changed** tab shows exactly what would change. Leave a
  comment on any line by clicking the blue `+` next to it.
- To try it locally before merging:
  ```bash
  gh pr checkout 12          # with the GitHub CLI, or:
  git fetch origin pull/12/head:pr-12 && git checkout pr-12
  npm test
  ```
  Then `git checkout master` to go back.
- **Merge pull request** merges it. **Squash and merge** collapses the
  branch into a single commit on `master`, which is usually what you want
  for a small fix. Both are reversible: GitHub offers a Revert button
  afterwards.
- Not merging is also an answer. Say why and close it.

Whatever you decide, **say it on the pull request** rather than only in
whatever tool you reviewed with (`gh pr comment <n>`, or the comment box
at the bottom of the PR page). Including when there is nothing to change:
the contributor cannot otherwise tell a branch you read and were happy
with from one you have not got to yet.

**Giving someone write access** is not needed for any of the above. A
contributor forks and opens pull requests with no permissions at all.
Write access (Settings -> Collaborators) only matters if you want someone
to push branches directly into this repo. On a personal repository that
is the only level GitHub offers, and it includes force-pushing and
deleting branches, so a fork is the safer default.

**Releases.** There are none. `master` is what people get, so it should
always be in a state you would hand to someone. If GitHub Pages is
enabled for this repo, `master` is also what is live.
