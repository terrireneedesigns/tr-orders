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

## Milestone 3: catalog and customers

1. **Catalog has two sections, Products and Patches.** SPEC 6.9 says "three sub-tabs" but describes two; add-ons live inside each product (as the spec's Products section describes), so a third tab would be empty.
2. **Package price lines are replaced as a set.** Template lines are a definition, not a record, so saving a package rewrites that package's lines (other packages untouched). This is the one place rows are removed from the Sheet. Orders keep their own copied lines, so old orders never change.
3. **`catalog.savePackage` can also save the lines** (`lines` in the same call), so editing a package is one trip to the server. `catalog.saveTemplateLines` still exists on its own.
4. **Added `catalog.reorder`** for the ↑ ↓ buttons on products, packages and add-ons (one call sets the whole order). The new order shows immediately and is saved in the background; if saving fails, the real order is reloaded.
5. **Up/down buttons instead of drag to reorder.** Easier to tap accurately on a phone and works the same everywhere.
6. **Savings lines must be negative.** The package editor refuses a positive "Package savings" amount with a clear message instead of silently flipping the sign.
7. **New products get a "Custom" package automatically** (SPEC 4.4: every product has at least one).
8. **Patch numbers can be changed.** Edits identify the patch by its old number; duplicate numbers are refused. "+ Add" suggests the next free number. Patch photos wait for milestone 7 (photo upload).
9. **Hide instead of delete.** Products, packages, add-ons and patches have "Show in new orders" switches; customers can be archived and restored. Nothing is deleted from the UI.
10. **Phone and email clean-up.** 10-digit US numbers are saved as `623-521-6235` whatever the typing style; other formats are kept as typed. Emails are saved in lowercase.
11. **Duplicate check only when adding a customer.** Matches on the same phone digits (7+ digits, ignoring a leading 1) or the same email, including archived customers. Editing an existing customer never asks.
12. **Customer stats count issued invoices only** (not quotes, drafts, voided or cancelled orders). Total spent is the sum paid on those invoices; "Has unpaid" means one of them is paid less than its total. Repeat customer = 2 or more fully paid invoices.
13. **Customer list shows instantly from memory** and refreshes its badges in the background (`customers.list`).
14. **Order history rows are not tappable yet**; the order detail screen comes in milestone 6.
15. **Added `Customers.gs`** to the Apps Script project for the customer actions (not in the SPEC 3.4 file list).
16. **Text that starts with "=" is stored as text**, never as a Sheets formula (a hidden leading apostrophe). This matters most for anything customers type later (approval names, decline notes).
17. **Screens added:** `product-edit.js`, `package-edit.js`, `customer-edit.js` (besides the spec's `products.js`, `patches.js`, `customers.js`, `customer-detail.js`).
18. **Standard numbers in headings.** Cormorant Garamond draws old-style numbers by default (0 looks like o), so headings and amounts use standard numbers.

## Milestone 4: order editor

1. **New invoices start as "draft" with stage "awaiting payment".** They become "issued" when sent or marked sent (milestone 6). Quotes start as "draft". Numbers are given on the first save (SPEC 5.7), so a draft already has its TR- or Q- number.
2. **A customer and at least one item are required to save.** The order editor says so in plain words; the server checks the customer too.
3. **Items and lines are rewritten on each save.** The app gives every item and line an id that the server keeps, so checklists (milestone 6) and the link between an extra patch spot and its price line survive edits. Invalid or repeated ids from the app are replaced.
4. **The server recomputes all totals** from the lines and ignores any totals the app sends. `js/rules.js` and `apps-script/Rules.gs` hold the same rules; both are tested (browser test page and Node tests).
5. **"Standard package" for the tier warning means an item with no upgrade line.** So the warning goes away as soon as Terri changes to Premium or adds an upgrade line by hand, whatever the package is called.
6. **"Change package" swaps only the package lines** (normal fees, savings, upgrades). Add-ons and lines Terri added stay. The item title follows the package if Terri hadn't renamed it.
7. **Extra patch spots link to their price line.** Removing an extra spot removes the add-on line it created. Extra spot labels (Extra A, B, C...) follow the order of the spots. Picking "Your own patch" as the price ticks "Own patch" on that spot.
8. **Left sleeve:** switching the sleeve to Left adds the surcharge once; Right removes it. If Terri deletes the line by hand it stays deleted until the sleeve is switched again.
9. **Line amounts are kept as typed while editing** and checked on save ("Item 1, line 3 needs an amount"), so a half-typed number never jumps around.
10. **Local draft:** saved to the browser 0.4 s after each change, per order (or per new quote / new invoice). Opening the editor again offers "Restore them / Discard". When the order was saved again elsewhere since the draft, the message says so. The draft is deleted after a successful save.
11. **"Save & Send" waits for milestone 6**, when sending exists. The editor has one Save button for now.
12. **Order page is basic for now** (`order-detail.js`): status, customer, items, details summary, totals, notes and Edit. Sending, payments, checklist, activity and photos arrive in milestone 6 and 7.
13. **Orders list filters:** "Unpaid" includes draft and issued invoices that are not fully paid (not void or cancelled), so a just-made invoice is easy to find. "Quotes" hides quotes that became invoices.
14. **Patch spots without a patch, own-patch tick or notes are left out of the order summary**, to keep it short.
15. **Customer edits keep fields that are not sent** (found while testing: archiving with only the id would have blanked the phone). The app always sends every field, so this is a safety net.
16. **New Apps Script files:** `Rules.gs` (server copy of the rules) and `Documents.gs`. The milestone 2 "Coming soon" screen was removed.

## Milestone 5: customer page

1. **Approval email waits for milestone 7.** Emailing the business inbox needs a new Google permission (sending mail), which the owner has to grant once in the Apps Script editor. It comes with the other notifications in milestone 7, so this deploy needed no extra steps. Approval is still recorded in the order's activity and on the order page ("Approved by … on …").
2. **Added `docs.markSent` and a "Mark as sent" button now** (SPEC 7 lists it for milestone 6), plus **Copy link** and **Preview**, so Terri can already send links by text or email herself and so the customer page could be tested end to end. The share-menu "Send" flow is still milestone 6.
3. **Sending a quote sets its expiry** (30 days, from Settings). Sending again keeps the first sent date.
4. **Old quote links keep working.** After a quote becomes an invoice, its link opens the invoice, and the address bar switches to the invoice's own link.
5. **Terri can preview drafts.** Public links refuse drafts and void documents, except when the request carries a valid admin sign-in (Terri previewing from the app). Void links are refused even for Terri.
6. **Views:** the first customer view is written to the activity log once; every view updates "last viewed" and the count. Views with Terri's sign-in or `preview=1` are not counted. The "Preview" button opens a new tab with `preview=1`, so it also works where the browser keeps a separate sign-in (Safari vs Home Screen).
7. **Strict allow-list.** The customer page gets only: business contact, Zelle and terms; the document's number, dates, status, money, fulfillment and note to customer; the customer's name; item titles, lines and customer-facing details (patch names filled in); and payments (date, amount, method). Never ids, internal notes, phone or email, photos or other customers. A test checks this.
8. **Customer-facing status words:** quotes show "Ready for your review", "Expired" or "Declined"; invoices show "Awaiting payment", "Paid in full", "In progress", "Ready for pickup/delivery", "Completed" or "Cancelled". "Paid in full" shows whenever paid ≥ total until the order is ready.
9. **Amount panel wording:** "Total due" normally; "Due now" plus "Balance due when your order is ready" when the upfront percent is under 100; "Balance due" once something has been paid. With an upfront percent under 100 the policy line explains the split instead of saying "paid in full at the time of order", which would contradict the panel.
10. **The amount panel shows on invoices only.** A quote isn't payable; its approve box says payment details appear after approving.
11. **Copy buttons** try the modern clipboard first and fall back to the older method, then show "Copied!".
12. **The customer page is never cached by the service worker**, so customers and previews always see the latest version and data.
13. **Page weight** is about 400 KB (small logo copy, the provided Zelle QR as is so it keeps scanning, fonts, about 25 KB of script). Most of the wait is the Apps Script reply, which is usually 1 to 2 seconds.
14. **Print ("Save as PDF")** keeps a small dark band behind the gold logo (the logo needs a dark background), turns the amount panel into a bordered white box, opens the terms, and hides buttons and the approve box.
15. **New Apps Script file `Public.gs`** for the three public actions; quote-to-invoice conversion lives in `Documents.gs` so the admin "Convert to invoice" in milestone 6 can reuse it.
