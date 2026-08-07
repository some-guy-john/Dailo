# Wordo Content

The current source lists are:

- `C:\laragon\www\wordle-valid-guesses.txt`
- `C:\laragon\www\wordle-answers.txt`

Validate it without changing Supabase:

```powershell
npm run validate:content -- C:\laragon\www\wordle-answers.txt
```

Curate both lists against the established source dictionary and the explicit project review rules:

```powershell
npm run curate:words -- C:\laragon\www\wordle-valid-guesses.txt C:\laragon\www\wordle-answers.txt
```

The baseline dictionary comes from the MIT-licensed `wordle-words` package, which provides the answer and accepted-guess split used as Wordo's starting point. Project-specific review rules then remove explicit/slur/generated-noise entries and add a small documented set of familiar modern words.

Import it in safe batches:

```powershell
npm run import:words -- C:\laragon\www\wordle-valid-guesses.txt C:\laragon\www\wordle-answers.txt
```

The importer only writes to `public.wordle_words`. Existing rows absent from the new lists are retired rather than deleted, preserving game-session and daily-assignment references. It uses normalized-word conflicts so rerunning it is safe and does not touch any other application tables.

Valid guesses receive `accepted_guess = true`. Only the curated answer list receives `eligible_answer = true`.

Schedule future dailies as drafts first:

```powershell
npm run schedule:dailies -- C:\laragon\www\wordle-answers.txt 2026-08-08 365
```

Use `--spread` to distribute the answer file across the year instead of following its alphabetical order:

```powershell
npm run schedule:dailies -- C:\laragon\www\wordle-answers.txt 2026-08-08 365 --spread
```

Review proposed dates, answer eligibility, conflicts, and existing statuses without writing:

```powershell
npm run review:schedule -- C:\laragon\www\wordle-answers.txt 2026-08-08 30 --spread
```

When reviewing a later range, the command keeps the source offset from the schedule anchor. The current production schedule starts on `2026-08-08`; for another schedule use `--schedule-start` with the date used when it was created:

```powershell
npm run review:schedule -- C:\laragon\www\wordle-answers.txt 2026-09-07 30 --schedule-start 2026-08-08
```

The report is read-only. Every row must be understood before publishing:

- `READY: insert draft` means the date is not scheduled yet.
- `READY: publish draft` means the existing draft matches the proposed answer.
- `UNCHANGED: existing assignment` means the published assignment is preserved.
- `BLOCK` means the answer is missing/ineligible or an existing date has a different answer.
- `proposed_uses` greater than `1` means the source list is too short for the requested range and needs review.
- The command exits with a failure status when any row is marked `BLOCK`.

The review selection must use the same ordering option as scheduling. Use `--spread` when the schedule was created with `--spread`, and use the same `--schedule-start` anchor.

Publish them explicitly when reviewed:

```powershell
npm run schedule:dailies -- C:\laragon\www\wordle-answers.txt 2026-08-08 365 --publish
```

Publish existing reviewed drafts without inserting or replacing assignments:

```powershell
npm run publish:dailies -- 2026-08-08 30
```

Scheduling only inserts missing dates into `public.wordle_daily_assignments`. It never replaces an existing assignment and does not touch any other table.
