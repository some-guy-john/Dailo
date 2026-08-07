# Wordle Content

The current source lists are:

- `C:\laragon\www\wordle-valid-guesses.txt`
- `C:\laragon\www\wordle-answers.txt`

Validate it without changing Supabase:

```powershell
npm run validate:content -- C:\laragon\www\wordle-answers.txt
```

Curate both lists against the established Wordle dictionary and the explicit project review rules:

```powershell
npm run curate:words -- C:\laragon\www\wordle-valid-guesses.txt C:\laragon\www\wordle-answers.txt
```

The baseline dictionary comes from the MIT-licensed `wordle-words` package, which reproduces the original Wordle answer and accepted-guess split. Project-specific review rules then remove explicit/slur/generated-noise entries and add a small documented set of familiar modern words.

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

Publish them explicitly when reviewed:

```powershell
npm run schedule:dailies -- C:\laragon\www\wordle-answers.txt 2026-08-08 365 --publish
```

Scheduling only inserts missing dates into `public.wordle_daily_assignments`. It never replaces an existing assignment and does not touch any other table.
