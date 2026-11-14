# Friday Night

A shared watch list for Alex, Lyss, Julie, Blue, Ashe, Amanda, and Emi. Plain HTML, CSS, and JavaScript, hosted on GitHub Pages with a code-protected Supabase database.

## Deployment status

The live website is https://vailveix.github.io/friday-night/ and the source is https://github.com/VailVeix/friday-night. GitHub Pages publishes `main` automatically after checks pass. Shared storage runs in the `friday-night` Supabase project in VailVeix's personal organization, on the free plan in US East. The group code is private and is never included in the published files.

All 46 titles are imported. Live verification covered wrong-code rejection, sign-in, saving a response in one browser and reading it in a separate browser, and mobile layout. Temporary test responses were removed. The local sample website remains available at http://localhost:8080 in Docker.

The local sample data is for preview only. Production uses the shared database and does not upload or seed the fake responses.

## First deployment

1. For a separate installation, authenticate the GitHub and Supabase CLIs, or use their dashboards for the following steps. Use a new repository and project named `friday-night`. The existing deployment above is already configured.
2. Create the Supabase project. In SQL Editor, run `supabase/schema.sql` once, replacing `REPLACE-WITH-A-LONG-RANDOM-GROUP-CODE` with a private group code of 8–100 characters in the editor. Keep the real code out of repository files. Then run `supabase/seed.sql` to import the 46 titles.
3. Obtain the project's HTTPS URL and **publishable** API key. The database password and secret/service-role keys are not used by the website.
4. Create the GitHub repository and push this folder's `main` branch. GitHub Pages on GitHub Free requires a public repository; its source and initial title list will be public. Votes and watch progress stay in Supabase behind the group code.
5. Under repository **Settings → Secrets and variables → Actions → Variables**, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. These are public frontend settings, not privileged credentials. Leave local `config.js` blank to retain the local sample preview.
6. Under **Settings → Pages**, select **GitHub Actions** as the source. Run **Actions → Publish Friday Night → Run workflow** after configuring the variables.
7. The workflow checks the code, builds `_site/` from the six website assets, and publishes it. Its deployment output provides the actual website URL. Share that URL and the group code with the group.
8. Verify sharing in two separate browsers: choose different names, use the group code, update a response in one browser, and refresh the other. Check series progress and the Watched view. A wrong group code must not load the list.

The build refuses missing backend configuration and rejects secret/service-role API keys and concatenated key lists. It accepts exactly one publishable key or legacy anon JWT. This deployment uses a publishable key; legacy API keys are disabled and the legacy signing key is revoked. Publishing a preview that only saves to one browser is intentionally blocked.

References: [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Optional automatic metadata

Metadata is optional and is not required for sharing votes or tracking progress.

The live deployment has the metadata function and TMDB token connected. Line-by-line adds attempt to match each title before saving; include a year in parentheses to distinguish versions. Unique matches receive posters and details. Unmatched titles are still saved and offer **Find a match** in their details. A lookup outage does not prevent adding titles.

1. Obtain a TMDB API Read Access Token.
2. Set the Supabase Edge Function secrets `TMDB_READ_TOKEN` and `WATCH_PUBLIC_KEY` (the latter is the project's public publishable key).
3. Deploy `supabase/functions/metadata/index.ts` as `metadata`, with gateway JWT verification off. The function checks the private group code with `watch_api` before querying TMDB. CLI configuration is in `supabase/config.toml`.
4. Existing titles resolve automatically using known IMDb IDs or a unique exact title/year match. Ambiguous versions stay unresolved. Search is available when adding a title. Metadata credentials stay server-side.

## Using the list

- **Absolutely**: do not watch without me. **Yes**: I want to watch but can miss it. **IDC**: I will watch; either way is fine. **Nope !**: I do not want to watch.
- All seven initials appear on every title; grey means unanswered. After responding, use the pencil icon to edit. Clicking the selected response again clears it.
- Sorting remembers the last choice in this browser. With no saved choice, it defaults to date added, oldest first. Imported entries retain spreadsheet order; new additions receive timestamps.
- **Who’s here tonight?** edits an attendee selection. **Apply** commits it and collapses the panel. A selected person's Nope ! hides a title. Other responses and unanswered titles remain eligible. Absent friends' Absolutely responses are flagged. Clear selection and Apply restores the unfiltered list.
- Open a title for details, group watch history, and series checklists. Group and personal series progress are separate. Watched titles have their own view.
- Everyone with the group code can choose any listed name and edit the list. Names are not separate authenticated accounts.
- The group code is kept in session storage for the tab; the selected name is remembered locally. Shared data refreshes every 30 seconds between interactions.

## Database maintenance

For a fresh installation, `schema.sql` already includes series progress and IDC. Do not run migrations in addition to the fresh schema.

Existing older installations can run `progress-migration.sql` and `idc-migration.sql`. Rerunning `seed.sql` updates reviewed catalog fields by stable ID without resetting votes or watch status. It can overwrite edited imported title names; inspect before running.

Use Supabase database exports/backups for shared data. No backup-export button is present in the interface. To change the private group code, use the commented SQL example at the end of `schema.sql`; existing tabs must then enter the new code. Older installations with a 16-character minimum can run `group-code-length-migration.sql` to accept 8–100 characters. The live deployment already has this migration.

## Development and verification

No dependencies or frontend build are required. Use Node 24 for the checks and publishing helper:

```sh
node --check app.js
node --check seed.js
node --check series.js
node --test tests/*.test.cjs
node tests/browser-check.cjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

The browser check uses a separate temporary server and Chrome profile, saves screenshots in ignored `.qa/`, and exercises the current interface, fake data removal, attendance rules, editing votes, IDC persistence, watch history, series progress, and the help popup.

`tests/database.test.sql` verifies the schema and API in a disposable PostgreSQL database. It expects the test-only code `friday-night-test-code-only`, the Supabase-like `anon` and `authenticated` roles, and the schema/seed already loaded. Never run that test against a real shared project: it writes test records.

`node tools/build-site.cjs` builds the deployment assets using the two environment variables above (or configured public values from `config.js`). `_site/` is ignored by Git. Only `index.html`, `style.css`, `app.js`, `config.js`, `seed.js`, and `series.js` are published.

`catalog.json` is the reviewed original title import. `node tools/rebuild-catalog.cjs` regenerates `seed.js` and `supabase/seed.sql`. `series.js` supplies release-ordered feature-film checklists, including spin-offs and theatrical Muppet films. Unconfirmed title versions retain their original catalog notes.
