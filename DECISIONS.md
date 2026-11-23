# Decisions

Choices made where SPEC.md left room, newest milestone last.

## Milestone 1: back end skeleton

1. **Columns are found by header name, not position.** Reading and writing use the header row in the Sheet, so reordering columns by hand does not break anything. `setup()` adds any missing columns at the end.
2. **Text columns are formatted as plain text.** Otherwise Sheets turns `01` into `1`, and could reformat phone numbers or dates. Money, quantities and sort columns are numbers; `archived`, `active`, `voided` and similar are TRUE/FALSE. Every write also sets the cell format first, so new rows behave the same.
3. **Settings values are stored as text** in the Sheet and converted to numbers in code for the numeric keys (`upfront_percent_default`, the day counts, `next_quote_no`, `next_order_no`). `bootstrap` returns `terms_json` already parsed, as `settings.terms` (a list of `{ title, text }`).
4. **Session token randomness.** Apps Script has no secure random byte function, so the 32-byte token is SHA-256 of three `Utilities.getUuid()` values (random v4 UUIDs, about 366 bits of randomness) plus the time. Only the token's SHA-256 hash is stored.
5. **Passcode salt** is a fresh random token every time the passcode is set. Passcodes must be 6 to 20 digits.
6. **Login lockout** is tracked in Script Properties (not CacheService, which can be cleared at any time). The 10th wrong try within 15 minutes starts a 15-minute lock; while locked, even the right passcode is refused.
7. **Added a `ping` action** (no sign-in needed) that returns the API version and server time. Useful for the test page and later for a connection check. Opening the Web App URL in a browser (`doGet`) also shows a "running" message.
8. **Added the rest of `auth.*` and `backup.run` early** because they were small and share code with login and the backup trigger.
9. **Cache is cleared on any hand edit** of the Sheet through the `onEdit` simple trigger, so changes Terri makes directly in the Sheet show up right away.
10. **One backup per day.** Running a backup twice on the same day trashes the earlier copy with the same date. Old backups are moved to the Drive trash rather than permanently deleted, which is safer and still frees them after Google's 30-day trash period.
11. **Backups copy the whole spreadsheet file** (`makeCopy`), which also copies the attached script. That is harmless (never deployed, no triggers) and much simpler than copying tabs one by one.
12. **`setup()` asks for the passcode last**, after the tabs, data, folders and trigger are in place, so cancelling the prompt never leaves a half-built Sheet. If no passcode exists afterwards, the summary says so in capitals.
13. **Seed IDs are generated** like all other IDs (for example `PRD_3f9a…`), not fixed strings, so seeded rows look the same as rows added later.
14. **Back end tests run in Node** (`tests/backend.test.js`) against small fakes of SpreadsheetApp, Drive, Properties and so on. They are a developer tool only; nothing in the app depends on Node or npm.

## Milestone 2: front end shell

1. **Extra small modules.** Besides the files listed in SPEC 3.4, the shell adds `js/app.js` (start-up, header, tab bar, routes), `js/store.js` (data from `bootstrap`, shared by screens), `js/ui.js` (safe element builder, toasts, bottom sheets, confirm, pull-to-refresh) and `js/screens/coming-soon.js` (stand-in for New Order/New Quote until milestone 4). The Catalog tab lives in `screens/products.js`, as in the spec.
2. **Customer link base address is worked out automatically.** `BASE_URL` in `js/config.js` comes from where the app is served, so it is right on GitHub Pages, a custom domain and localhost with no edits. `BASE_PATH` stays in config for reference. The manifest and every app path are relative, so a custom domain needs no code changes.
3. **The sign-in token is kept in memory as well as localStorage.** If the browser blocks storage (private browsing, some `file://` pages), the app still works for that visit and just asks for the passcode next time. Milestone 1's API test page had exactly this bug, now fixed the same way.
4. **Service worker uses "stale while revalidate".** The app opens from its saved copy at once and refreshes the copy in the background, so a release appears on the next launch with no manual cache bumping. `VERSION` in `sw.js` only needs raising when files are added, removed or renamed. API calls (POST), the customer page and test pages are never cached. Google Fonts are cached so headings look right offline. On localhost it loads from the network first, so edits show right away.
5. **Smaller logo copies** (`logo-full-sm.png` 480 px, 200 KB; `logo-monogram-sm.png` 160 px, 28 KB) are used in the shell instead of the 548 KB and 428 KB originals. The originals stay for print and the customer page decision in milestone 5. README explains how to refresh the copies after replacing a logo.
6. **Pull-to-refresh is built in**, because iPhone Home Screen apps don't have one. Each screen can provide a refresh function; for now it reloads `bootstrap`.
7. **Home snapshot shows dashes** until real numbers exist (milestone 7), with a note, rather than fake zeros.
8. **Settings is read-only for now** (business info, Zelle, Google Sheet link, sign out, sign out all devices, version). Editing settings, terms, templates and the passcode comes with a later milestone.
9. **The passcode field doesn't auto-focus on phones**, so the keyboard doesn't cover the logo when the app opens. It does on larger screens.
10. **Local dev server** (`tests/dev-server.js`) serves the site at `/tr-orders/` like GitHub Pages, with a fake back end made from the real `.gs` code. Developer tool only.
