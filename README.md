# Friday Night

A shared watch list for Alex, Lyss, Julie, Blue, Ashe, Amanda, Emi, Wils, and Michelle. Plain HTML, CSS, and JavaScript, hosted on GitHub Pages with a code-protected Supabase database.

## Deployment status

The live website is https://vailveix.github.io/friday-night/ and the source is https://github.com/VailVeix/friday-night. GitHub Pages publishes `main` automatically after checks pass. Shared storage runs in the `friday-night` Supabase project in VailVeix's personal organization, on the free plan in US East. The group code is private and is never included in the published files.

All 46 titles are imported. Live verification covered wrong-code rejection, sign-in, saving a response in one browser and reading it in a separate browser, and mobile layout. Temporary test responses were removed. The local sample website remains available at http://localhost:8080 in Docker.

The local sample data is for preview only. Production uses the shared database and does not upload or seed the fake responses.

## First deployment

1. For a separate installation, authenticate the GitHub and Supabase CLIs, or use their dashboards for the following steps. Use a new repository and project named `friday-night`. The existing deployment above is already configured.
2. Create the Supabase project. In SQL Editor, run `supabase/schema.sql` once, replacing `REPLACE-WITH-A-LONG-RANDOM-GROUP-CODE` with a private group code of 8–100 characters in the editor. Keep the real code out of repository files. Then run `supabase/seed.sql` to import the 46 titles. Run `supabase/admin-migration.sql` and use its final commented statement to set a separate private admin password. Then run `supabase/personal-seen-migration.sql`.
3. Obtain the project's HTTPS URL and **publishable** API key. The database password and secret/service-role keys are not used by the website.
4. Create the GitHub repository and push this folder's `main` branch. GitHub Pages on GitHub Free requires a public repository; its source and initial title list will be public. Votes and watch progress stay in Supabase behind the group code.
5. Under repository **Settings → Secrets and variables → Actions → Variables**, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. These are public frontend settings, not privileged credentials. Leave local `config.js` blank to retain the local sample preview.
6. Under **Settings → Pages**, select **GitHub Actions** as the source. Run **Actions → Publish Friday Night → Run workflow** after configuring the variables.
7. The workflow checks the code, builds `_site/` from the watch-list and admin assets, and publishes it. Its deployment output provides the actual website URL. Share that URL and the group code with the group.
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

- **List / Grid** changes the library layout. Grid uses square poster cards; open a card for details, responses, and watch history. **Show response initials** hides or shows the roster squares in either layout. In compact grid cards, scroll the initials sideways to see the rest of a large roster. Both display preferences are remembered in this browser.
- To make **Mary-Kate & Ashley** one regular film series, run `supabase/mary-kate-ashley-series.sql` in Supabase SQL Editor after the watch-history migration. It moves existing matching movies into the series checklist, removes their individual entries and votes, and preserves group and personal viewing progress. The resulting series has one shared set of interest responses, like other series. The script is transactional and safe to rerun; unrelated title versions are excluded. Until that conversion, older data still uses the legacy grouped display.
- The library uses larger posters and touch controls. Open **View films** on a film series to see its individual movies, filter **All films / Remaining / Watched**, and track group or personal progress. The next group film appears on the series card. Search also matches movies inside a series. Series with group film progress appear in **Watched** even while the series remains on the watch list.
- In **Add title**, choose **Film**, **Film series**, or **TV show**. Shared title search runs as you type and shows poster thumbnails. Selecting a result leaves the dialog ready for another addition. Pasting one title per line still resolves exact matches automatically; after saving, a matching queue opens for unresolved titles, with suggestions and a **Skip this title** option. Skipped titles remain saved for later matching.
- Search-result posters require redeploying `supabase/functions/metadata/index.ts`; the frontend still works with the older function but shows a placeholder for those thumbnails. No database migration is needed for these UI changes.

- **★ Wait for me**: keep this off tonight's list when I am absent. **Yes**: I want to watch but can miss it. **Either way**: I will watch; either choice works for me. **Nope !**: hide this title when I am joining. Existing saved response values are unchanged.
- All people on the shared roster appear normally; tonight shows only the selected people. Grey means unanswered. After responding, **Your pick: Yes · Edit** (with your actual response) shows the saved choice and how to change it. While editing, **Cancel** or selecting the saved response again keeps the existing pick. Use **Clear response** to remove a pick explicitly.
- Responses can be added or edited in **Watched** and in title details as well as on the watch list. Updating a response leaves watch dates, attendance, and personal seen history unchanged.
- Sorting remembers the last choice in this browser. With no saved choice, it defaults to date added, oldest first. Imported entries retain spreadsheet order; new additions receive timestamps.
- **Who’s here tonight?**, beside **Sort** and **Refresh**, edits an attendee selection. **Apply** saves it in this browser, collapses the panel, and sorts eligible titles by **Group interest**. You can still choose another sort; that choice is remembered. The attendee selection survives refreshes and reopening the site. A selected person's Nope ! hides a title. Other responses and unanswered titles remain eligible. Titles with an absent friend's Wait for me response are hidden. **Clear selection** immediately removes the saved selection and restores the unfiltered list.
- On phones, Search and **Filters** share one row below the three library tabs and the Add title button. Filters contains title type, sort, Tonight attendance, Refresh, layout, and response initials. Desktop list cards show a one-line synopsis when metadata is available. Both the poster and title open details on all screen sizes.
- Group **Mark watched** and group film/episode checkboxes record a server timestamp, the calendar date in the marking browser's time zone, the applied Tonight attendees, and the selected name that recorded it. Details show the saved date and people. Changing the filter later leaves that snapshot intact; un-applied attendee drafts are ignored. No selection records unknown attendance, rather than assuming the whole roster attended. Attendees are also marked personally seen for a whole-title watch; a film/episode checkbox adds only that film/episode to their personal progress. Existing personal history is preserved, and absent people are untouched. Undo keeps their personal seen/progress and clears only the group watch record; checking again records a new date and attendance snapshot. Repeated true saves preserve the original snapshot.
- **Mark as seen** under a title records personal viewing history for the selected name. Click **Seen** again to undo. It does not change interest responses, tonight eligibility, series checklists, or the group Watched list. This status is shared across devices and survives group archive/restore.
- **My history** shows the selected person's seen titles, including titles still on the watch list and those in the group Watched archive. Switching names updates the history. Search, type, and sort still work; tonight's attendee filter does not hide personal history. Click **Seen** to remove a title from your history.
- Open a title for details, group watch history, and series checklists. Group and personal series progress are separate. Watched titles have their own view.
- TV details automatically load seasons and episode names. Choose a season and check episodes for the group or your selected name; counts and the next group episode update as you go. Progress syncs across devices and survives archiving. Episode keys include the TMDB show ID, season, and episode number so title changes do not reset progress. Unmatched shows need **Find a match** first.
- Everyone with the group code can choose any listed name and edit the list. Names are not separate authenticated accounts.
- After successful entry, the group code is remembered in this browser across visits. Existing tab sessions are upgraded automatically after verification. Use **? → Forget this device’s name & code** to remove it. The separate admin password is still never saved.
- The group code is kept in session storage for the tab; the selected name is remembered locally. Shared data refreshes every 30 seconds between interactions.

## Admin and people

Open https://vailveix.github.io/friday-night/admin/ and use the separate admin password. The group code does not grant admin access. Add a name to update the shared roster; names appear in both sign-in menus, response squares, and the tonight selector. Existing open watch lists receive additions on their next refresh. Names are unique regardless of capitalization, and adding a person leaves existing answers and watch history intact.

The admin page also lets the host change the admin password. It keeps the password only in page memory, clears the input after sign-in, and signs out when reloaded. The database stores a password hash, never a plaintext password. No admin credential is included in published files. The name-only roster is public, as names were in the original site; votes and watch progress remain group-code protected.

For an existing installation, apply `supabase/admin-migration.sql` once. It keeps the existing group code, titles, votes, progress, and imported names. Initial admin setup or host recovery uses the commented hash-update statement at the end of that migration. Do not put real credentials in source control.

Verification includes `tests/admin-database.test.sql` inside a rolled-back transaction and `node tests/admin-browser-check.cjs "C:\Program Files\Google\Chrome\Application\chrome.exe"` with an isolated mock backend.

## Database maintenance

For group watch dates and attendees, run `supabase/watch-history-migration.sql` in **Supabase → SQL Editor**, after the admin and personal-seen migrations. Run it for both existing and new installations, before publishing the corresponding frontend. It is safe to rerun and preserves existing titles, votes and progress. If you ran an earlier copy, rerun the updated file to enable automatic personal seen/progress for attendees. Historical watch dates and attendees remain unknown. The new frontend refuses group watch saves against an older backend so it cannot silently discard the snapshot. This does not require an Edge Function redeployment.

For a fresh installation, `schema.sql` includes series progress and IDC. Follow it with `admin-migration.sql` and `personal-seen-migration.sql`; the older progress and IDC migrations are unnecessary.

Existing older installations can run `progress-migration.sql` and `idc-migration.sql`. Rerunning `seed.sql` updates reviewed catalog fields by stable ID without resetting votes or watch status. It can overwrite edited imported title names; inspect before running.

Use Supabase database exports/backups for shared data. No backup-export button is present in the interface. To change the private group code, use the commented SQL example at the end of `schema.sql`; existing tabs must then enter the new code. Older installations with a 16-character minimum can run `group-code-length-migration.sql` to accept 8–100 characters. The live deployment already has this migration.

## Development and verification

No dependencies or frontend build are required. Use Node 24 for the checks and publishing helper:

```sh
node --check app.js
node --check seed.js
node --check series.js
node --test tests/*.test.cjs
node tests/watch-history-db-check.cjs
node tests/browser-check.cjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

The browser check uses a separate temporary server and Chrome profile, saves screenshots in ignored `.qa/`, and exercises the current interface, fake data removal, attendance rules, editing votes, IDC persistence, watch history, series progress, and the help popup.

The watch-history database check uses Docker and a local `postgres:17` image. It creates a disposable container with no network or exposed ports, runs all five database suites plus legacy-data and repeat-migration checks, and removes the container afterward. It never connects to the shared Supabase project.

`tests/database.test.sql` verifies the schema and API in a disposable PostgreSQL database. It expects the test-only code `friday-night-test-code-only`, the Supabase-like `anon` and `authenticated` roles, and the schema/seed already loaded. Never run that test against a real shared project: it writes test records.

`node tools/build-site.cjs` builds the deployment assets using the two environment variables above (or configured public values from `config.js`). `_site/` is ignored by Git. Only `index.html`, `style.css`, `app.js`, `config.js`, `seed.js`, `series.js`, and the three files in `admin/` are published.

`catalog.json` is the reviewed original title import. `node tools/rebuild-catalog.cjs` regenerates `seed.js` and `supabase/seed.sql`. `series.js` supplies release-ordered feature-film checklists, including spin-offs and theatrical Muppet films. Unconfirmed title versions retain their original catalog notes.
