# TR Orders: Product and Build Spec

Invoicing and order app for **Terri Renee Evolvé**, a handmade custom clothing line (custom patched bomber jackets, hats, purses, more later).

This document is the single source of truth for building the app. Build it in the milestone order in section 15. When something here is ambiguous, choose the simplest option that keeps the app easy for a non-technical iPhone user, and note the choice in `DECISIONS.md`.

---

## 1. Goals and users

### 1.1 What the app does
- Lets the owner (Terri) create **quotes** and **invoices** on her iPhone with itemized line items (product, labor, setup, patches, add-ons).
- Sends them to customers as a **link** through the iPhone share menu (Messages, email, WhatsApp).
- Shows customers a branded page with **Zelle (QR code) and cash** payment instructions. The app does **not** collect payments.
- Tracks: sent or not sent, viewed, approved, paid or unpaid, overdue, order progress, repeat customers.
- Costs **$0** to run.

### 1.2 Users
| User | Device | Access |
|---|---|---|
| Terri (owner) | iPhone, installed to Home Screen from Safari | Full admin, passcode |
| Autumn (daughter, helper) | Any phone or computer | Full admin, same passcode |
| Customers | Any phone or browser | Read-only view of one quote or invoice via private link. Can approve quotes. No account |

### 1.3 Design principles
- **Easy for Terri:** large text (18px base), big tap targets (min 48px), few steps, plain words, no jargon. Every main action reachable in 2 taps from Home.
- **Easy for customers:** one link, no login, no app, loads fast on a phone.
- **Data she owns:** everything lives in a Google Sheet in the business Google account, readable by a human.

### 1.4 Out of scope
Sales tax, online card payments, shipping fees, inventory, accounting, multiple businesses, push notifications.

---

## 2. Business settings (initial values)

| Setting | Value |
|---|---|
| Business name | Terri Renee Evolvé |
| App name (Home Screen label) | TR Orders |
| Phone | 623-521-6235 |
| Email | terrireneedesigns@gmail.com (business Gmail; owns the Sheet, Apps Script, Drive folders and GitHub account; also `notify_email`) |
| Website | TerriReneedesigns.com |
| Time zone | America/Phoenix (no daylight saving) |
| Currency | USD |
| Payment methods | Zelle, Cash |
| Zelle contact | 623-523-7472 (note: this is a **different number** from the business phone 623-521-6235; show only this one in the Zelle panel) |
| Zelle display name | THERESA ODOM (shown as "Zelle will show the name THERESA ODOM" so customers know they have the right person) |
| Zelle QR image | `assets/zelle-qr.png` (provided, verified to scan) |
| Never show | Bank account numbers or last digits on any page |
| Payment policy | **Paid in full at the time of order. Work begins once payment is received.** |
| Upfront percent default | 100 (editable per order, see 5.6) |
| Unpaid invoice flag | 7 days after sent |
| Ready-but-not-handed-off flag | 3 days after marked Ready |
| Quote expiry | 30 days after sent |
| Fulfillment options | Pickup or Delivery, no fee for either |
| Quote number format | `Q-1001`, `Q-1002`, ... |
| Order/invoice number format | `TR-1001`, `TR-1002`, ... |

---

## 3. Architecture

```
iPhone (Safari, Home Screen PWA)          Customer phone/browser
        │  TR Orders admin app                    │  view.html?id=<publicId>
        └──────────────┬──────────────────────────┘
                       │ HTTPS POST (JSON as text/plain)
                       ▼
        Google Apps Script Web App (JSON API)
                       │
        ┌──────────────┼───────────────────┐
        ▼              ▼                   ▼
   Google Sheet   Google Drive          Gmail (MailApp)
   (database)     (photos, backups)     (notify business inbox)
```

### 3.1 Front end
- **Static site on GitHub Pages** (free), repo owned by a GitHub account created with the business Gmail. Default URL `https://<user>.github.io/tr-orders/`. No custom domain for now; keep the base path configurable in one constant so a domain can be added later.
- **Vanilla HTML, CSS and JavaScript (ES modules). No build step, no framework, no npm dependencies at runtime.** This keeps it maintainable by a non-developer and deployable by just pushing files.
- Two entry pages:
  - `index.html`: admin app (passcode protected), hash routing (`#/home`, `#/orders/TR-1001`, ...).
  - `view.html`: customer page for one quote or invoice (`view.html?id=<publicId>`).
- PWA: `manifest.webmanifest`, `apple-touch-icon` (180×180), `display: standalone`, theme color `#201C19`, a service worker that caches the app shell (HTML, CSS, JS, fonts, logo) so it opens instantly. Data always comes from the API (no offline editing).
- Fonts: Cormorant Garamond (headings) and Jost (body) from Google Fonts, with system fallbacks.

### 3.2 Back end
- **Google Apps Script** project bound to the Google Sheet, owned by the business Gmail.
- Deployed as a **Web App**: Execute as **Me** (business account), Who has access **Anyone**. Security is enforced in code (section 10).
- One endpoint: `doPost(e)` receives `{ action, token, payload }` and returns JSON via `ContentService`.
- **CORS gotcha:** the front end must call `fetch(API_URL, { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'text/plain;charset=utf-8' } })` to avoid a CORS preflight, which Apps Script does not support. Do not send `application/json`. Follow redirects (default).
- **Deployment gotcha:** after code changes, update the **existing** deployment with a new version (Manage deployments > Edit > New version) so the URL never changes. Document this in `README.md`.
- Set the Apps Script project time zone to `America/Phoenix`.
- Use `LockService` around number assignment and any write that reads then writes.
- Read sheets in bulk with `getValues()` and write in bulk. Use `CacheService` for catalog data (products, add-ons, patches, settings) with invalidation on edit.

### 3.3 Storage
- **Google Sheet** "TR Orders Data" with one tab per table (section 4).
- **Google Drive** folder "TR Orders" containing:
  - `Order Photos/<order number>/` for reference photos (private, never shared publicly).
  - `Backups/` for nightly copies of the Sheet.
- **Static assets in the repo** `/assets/`: logo, monogram, app icons, Zelle QR. Changing them means replacing the file and pushing.

### 3.4 Repo structure
```
/index.html              admin app shell
/view.html               customer quote/invoice page
/manifest.webmanifest
/sw.js                   service worker (app shell cache, versioned)
/css/
  base.css               tokens, typography, components
  admin.css
  view.css               customer page + print styles
/js/
  config.js              API_URL, BASE_PATH, APP_VERSION
  api.js                 fetch wrapper, token handling, error display
  router.js              hash router
  money.js               cents helpers and formatting
  rules.js               totals, statuses, flags (pure functions, unit tested)
  share.js               Web Share + fallbacks + "Did you send it?" flow
  screens/
    home.js  orders.js  order-edit.js  order-detail.js
    customers.js  customer-detail.js
    products.js  patches.js  settings.js  login.js
  view/
    view.js              customer page logic
/assets/
  logo-full.png          provided: gold full logo, transparent background, trimmed (916×765)
  logo-monogram.png      provided: gold TR monogram, transparent background, trimmed (834×646)
  icon-180.png  icon-192.png  icon-512.png  icon-maskable-512.png   provided: monogram on #201C19
  zelle-qr.png           provided: Zelle QR, white background (510×510)
/apps-script/
  Code.gs                router (doPost), auth
  Data.gs                sheet read/write helpers
  Documents.gs           quotes, invoices, numbering, conversion
  Payments.gs
  Catalog.gs             products, packages, add-ons, patches
  Photos.gs
  Notify.gs              MailApp emails
  Backup.gs              nightly backup trigger
  Setup.gs               setup(): create tabs, headers, seed data, triggers
  appsscript.json
/tests/
  rules.test.html        browser-run unit tests for js/rules.js and money.js
README.md                setup, deploy, update steps
INSTALL-IPHONE.md        one-page guide for Terri with screenshots
DECISIONS.md             choices made during build
```

The logo files are gold on a transparent background. **Always place them on `--ink` (#201C19)** (header bands, login screen, icons), never directly on cream, where the gold loses contrast. Use `logo-full.png` on the login screen and customer page header, and `logo-monogram.png` in the admin header. Serve them with explicit width/height and consider generating smaller copies (for example 2× display size) to keep the customer page fast. Replacing a PNG must require no code changes.

---

## 4. Data model (Google Sheet tabs)

All money is stored as **integer cents**. All timestamps are ISO 8601 strings in America/Phoenix. IDs are generated server side. Row 1 of each tab is the header. Never delete rows from the UI; use `archived`/`active`/`void` flags.

### 4.1 `Settings`
`key | value`. Keys: `business_name, app_name, phone, email, website, zelle_contact, zelle_display_name, upfront_percent_default, unpaid_flag_days, ready_flag_days, quote_expiry_days, next_quote_no, next_order_no, notify_email, msg_quote, msg_invoice, msg_receipt, msg_ready, terms_title, terms_json`.

The passcode hash and salt live in **Script Properties**, not in the Sheet.

### 4.2 `Customers`
`customer_id | name | phone | email | notes | created_at | updated_at | archived`

`notes` holds sizes, preferences and anything Terri wants to remember. Derived (computed, not stored): order count, paid order count, total spent, last order date, repeat customer badge.

### 4.3 `Products`
`product_id | name | detail_form | active | sort | description`

`detail_form` is `jacket` or `simple` (section 6.4).

### 4.4 `Packages`
`package_id | product_id | name | price_note | sort | active`

Every product has at least one package. Products without real packages get a single package named `Custom`.

### 4.5 `TemplateLines`
`template_line_id | package_id | label | amount_cents | kind | sort`

`kind`: `base` (normal fee line), `savings` (negative package discount), `upgrade` (package upgrade line). Selecting a package on an order copies these lines into the order item, where they can be edited.

### 4.6 `AddOns`
`addon_id | product_id | label | amount_cents | price_editable | rule | sort | active`

`rule`: empty, `left_sleeve` (auto-added when a sleeve spot is set to Left, see 5.8), or `extra_patch` (counts toward the 3-extra-patch limit).

### 4.7 `Patches`
`patch_no | name | size | tier | group | active | photo_file_id`

`tier`: `standard` or `premium`. `group`: `Small and medium`, `Large and custom-ordered`, `Back-size (9 in and up)`.

### 4.8 `Documents` (quotes and invoices)
| Column | Notes |
|---|---|
| doc_id | internal ID |
| public_id | 24+ char random URL-safe ID for the customer link |
| type | `quote` or `invoice` |
| number | `Q-1001` or `TR-1001` |
| customer_id | |
| status | quote: `draft, sent, approved, declined, expired, converted`; invoice: `draft, issued, void` |
| stage | invoice only: `awaiting_payment, in_progress, ready, completed, cancelled` |
| fulfillment | `pickup` or `delivery` |
| created_at, updated_at | |
| sent_at, sent_method | set when Terri confirms sending (section 7) |
| first_viewed_at, last_viewed_at, view_count | set by customer page loads |
| expires_at | quotes: sent_at + quote_expiry_days |
| approved_at, approved_name, terms_accepted | quotes |
| declined_at, decline_note | quotes |
| from_quote_id | invoice created from a quote |
| converted_invoice_id | quote that became an invoice |
| est_ready_date | estimated completion date (shown as an estimate) |
| ready_at, completed_at | |
| upfront_percent | default 100 |
| discount_cents, discount_label | optional order-level discount |
| subtotal_cents, total_cents, paid_cents | cached, recomputed on every save |
| customer_note | shown to customer |
| internal_notes | never shown to customer |
| void_reason | |

### 4.9 `DocItems` (one per product on an order)
`item_id | doc_id | product_id | package_id | title | qty | sort | details_json`

`details_json` holds the custom details form (section 6.4).

### 4.10 `DocLines` (fee lines inside an item)
`line_id | item_id | doc_id | label | amount_cents | kind | addon_id | sort`

`kind`: `base, savings, upgrade, addon, custom`.

### 4.11 `Payments`
`payment_id | doc_id | amount_cents | method | paid_on | note | created_at | voided`

`method`: `zelle` or `cash`.

### 4.12 `Checklist`
`doc_id | item_id | step_no | label | done_at`

### 4.13 `Photos`
`photo_id | doc_id | item_id | drive_file_id | caption | created_at`

### 4.14 `Sessions`
`token_hash | created_at | expires_at | label | revoked`

### 4.15 `Log`
`ts | action | doc_id | detail` (audit trail: created, sent, viewed, approved, payment recorded, stage changes, voids).

---

## 5. Business rules

Implement all calculations in `js/rules.js` as pure functions and mirror the critical ones server side (totals and flags are recomputed on the server on save; the server is authoritative).

### 5.1 Totals
- `item_unit_cents = sum(line.amount_cents)` for the item's lines.
- `item_total_cents = item_unit_cents × qty`.
- `subtotal_cents = sum(item_total_cents)`.
- `total_cents = subtotal_cents - discount_cents` (never below 0).
- No tax, no shipping, no delivery fee.

### 5.2 Upfront and balance (supports the paid-in-full policy)
- `upfront_cents = ceil(total_cents × upfront_percent / 100)` rounded **up** to the cent.
- Default `upfront_percent` is 100, so normally `upfront_cents = total_cents` and there is no balance.
- `amount_due_now`:
  - if `paid_cents < upfront_cents`: `upfront_cents - paid_cents`
  - else if stage is `ready` or `completed`: `total_cents - paid_cents`
  - else: 0 (balance not yet due).
- If `upfront_percent < 100`, the customer page shows "Due now" and "Balance due when your order is ready". When it is 100 (the normal case), show only **Total due**. The UI to change it lives under "More options" on the order editor so it does not clutter normal use.

### 5.3 Payment status (derived)
`unpaid` (paid 0), `partial` (0 < paid < total), `paid` (paid ≥ total). Overpayment shows a warning but is allowed.

### 5.4 Quote lifecycle
```
draft ──Send──▶ sent ──customer Approve──▶ approved ──auto──▶ converted (+ new invoice)
                  │──customer Decline──▶ declined
                  └──expires_at passes──▶ expired (computed on read)
```
- Terri can also tap **Mark approved** (for verbal approvals) or **Convert to invoice** directly.
- **On approval, automatically create the invoice** (copy items, lines, details, customer, fulfillment, notes; `from_quote_id` set; `sent_at` set to approval time with `sent_method = customer_approved`, since the customer is already looking at it). The customer page immediately shows the new invoice with payment instructions. Email the business inbox (section 9).
- Expired quotes can be **Renewed** (new expires_at, back to sent) or duplicated.
- Editing a sent quote is allowed; show a banner "Customer may have seen the old version" and offer to re-send.

### 5.5 Invoice lifecycle (stage)
```
awaiting_payment ──paid ≥ upfront──▶ in_progress ──Mark Ready / all items at Final check──▶ ready ──Picked up / Delivered (and fully paid)──▶ completed
```
- `cancelled` and `void` are manual, with a reason, from a menu.
- Recording a payment that reaches `upfront_cents` moves the stage to `in_progress` and checks step 1 on every item.
- `ready` sets `ready_at`. `completed` sets `completed_at`. Moving to `completed` with a remaining balance asks for confirmation.
- Terri may move stages manually forward or back (with confirmation) to fix mistakes.

### 5.6 Flags (derived on every read, never stored)
| Flag | Condition |
|---|---|
| **Not sent** | status is not draft-only (it has items), `sent_at` empty, not void/converted |
| **Viewed** | `first_viewed_at` set (show "Viewed Nov 22, 3:14 PM") |
| **Unpaid, overdue** | invoice issued, `sent_at` + `unpaid_flag_days` (7) < now, `paid_cents < upfront_cents` |
| **Ready, not handed off** | stage `ready`, `ready_at` + `ready_flag_days` (3) < now. Label "Ready 3+ days" and, if a balance remains, "Balance overdue" |
| **Quote waiting** | quote sent, not approved/declined/expired |
| **Quote expiring soon** | quote sent, expires within 5 days |

### 5.7 Numbering
- Assigned when the document is first saved (not when sent), under a lock, from `next_quote_no` / `next_order_no`.
- Invoices created from a quote get a new `TR-` number and show "From quote Q-1004".
- Numbers are never reused, even if voided.

### 5.8 Jacket-specific rules
- Every jacket package includes **4 patch spots**: 1 Back (main), 2 Left chest, 3 Right chest, 4 Sleeve (Left or Right). Left and right are the wearer's.
- **Left sleeve auto add-on:** when spot 4 is set to Left, automatically add the `Left sleeve surcharge +$10` line to that item (once). Switching to Right removes it. Terri can still delete it manually.
- **Extra patches:** up to 3 extras (spots Extra A, B, C), 7 patches total. Adding an extra spot prompts Terri to pick its add-on price (Extra small $28, Small or medium $35, Large or premium $45, Own patch from $20). Trying to add a 4th extra shows: "More than 7 patches needs a custom quote. Add anyway?" (allowed, not blocked).
- **Tier warning (soft):** if a Premium-tier patch is placed in an included spot on a Standard package, show a gentle note: "No. 30 is a Premium patch. Change to Premium package or add an upgrade?" Do not block.
- **Own patch:** marking a spot "Own patch" records it in details. Pricing for own patches on included spots is left to Terri (no automatic change).

### 5.9 Customers
- Repeat customer: 2 or more **paid** invoices.
- Match existing customers by phone or email when adding, and offer "Use existing customer?" to avoid duplicates.

---

## 6. Admin app screens

Bottom tab bar (5 tabs): **Home, Orders, Customers, Catalog, Settings**. Header shows the gold monogram. All lists support pull-to-refresh.

### 6.1 Login
- Monogram, "TR Orders", passcode field (numeric keypad, 6+ digits), Unlock button.
- On success, store the session token in `localStorage`; sessions last 180 days.
- Settings has **Sign out** and **Sign out all devices**.

### 6.2 Home
1. Two big buttons: **+ New Order** (invoice) and **+ New Quote**.
2. **Needs attention** (each row taps into the document): Not sent; Unpaid, overdue; Ready 3+ days; Quotes waiting; Quotes expiring soon. Show a friendly empty state ("All caught up") when none.
3. **Snapshot cards:** Unpaid total (sum of amount due on issued invoices), Collected this month, Orders in progress (count), Ready for pickup/delivery (count).

### 6.3 Orders list
- Segmented filter: **All, Quotes, Unpaid, In progress, Ready, Completed**.
- Search by customer name, phone, or number.
- Each row: number, customer name, total, colored status badge, and small flag chips (Not sent, Viewed, Overdue).

### 6.4 Order editor (create/edit quote or invoice)
Single scrolling form, sections:
1. **Customer:** search existing or **+ New customer** inline (name required; phone and email optional but one is recommended).
2. **Items:** **+ Add item** opens the product list, then the package list (for jackets: Standard, Premium, Collector's). The item card shows:
   - Title (editable), quantity stepper.
   - Fee lines copied from the package template, each with editable label and amount, delete button, and **+ Add line** (free text) and **+ Add-on** (pick from the product's add-ons).
   - Item total.
   - **Details** section:
     - `jacket` form: Style (Men's / Women's), Size, Color, Order type (Freemason / OES / Other), Airbrushed (Yes / No) and Design text, Regalia or emblem details (text), **Patch spots table**: Back, Left chest, Right chest, Sleeve (L/R toggle), Extra A/B/C (spot text), each with Patch No. (picker searching the patch catalog by number or name, showing tier) and "Own patch" checkbox and notes. Plus Notes and Photos.
     - `simple` form: Notes (multi-line) and Photos.
3. **Fulfillment:** Pickup or Delivery (no fee). Estimated ready date (optional, labeled "estimate").
4. **Totals:** Subtotal, optional Discount (label + amount), **Total**.
5. **Note to customer** (shown on their page) and **Internal notes** (private).
6. **More options** (collapsed): Upfront percent (default 100).
7. Sticky footer: **Save** and **Save & Send**.

Autosave a local draft in `localStorage` while editing so nothing is lost if the app is closed.

### 6.5 Order detail
- Header: number, customer, status badge, flags, total, amount due.
- Action buttons depending on state: **Send** / **Resend**, **Record payment**, **Mark ready**, **Picked up** / **Delivered**, **Convert to invoice** (quotes), **Preview as customer**, overflow menu (Edit, Duplicate, Mark sent, Mark approved, Void / Cancel, Copy link).
- **Progress checklist** per item (section 6.8), with tap-to-check (records date).
- Payments list with add and void.
- Activity timeline from `Log` (Created, Sent, Viewed, Approved, Paid, Ready, Completed).
- Photos grid (tap to view full size).

### 6.6 Record payment (bottom sheet)
Amount (prefilled with amount due now), Method (**Zelle** / **Cash**, big toggle), Date (default today), Note. On save, offer **Send receipt** (shares the same link, which now shows Paid).

### 6.7 Customers
- List with search; badges: Repeat customer, Has unpaid.
- Detail: contact info with tap-to-call/text/email, notes, stats (orders, total spent, last order), order history list, **+ New order for this customer**.

### 6.8 Checklists (shop steps)
Created per item when an invoice is created.
- **Jacket items:** 1 Patches and placement approved, paid in full · 2 Jacket and patches in · 3 Lining opened · 4 Patches sewn on · 5 Lining closed, checked · 6 Pressed · 7 Final check · 8 Picked up or delivered.
- **Simple items:** 1 Details approved, paid in full · 2 Materials in · 3 Work done · 4 Final check · 5 Picked up or delivered.
- When every item reaches **Final check**, prompt "Mark order Ready?" When the final step is checked on all items, prompt "Mark order Completed?"

### 6.9 Catalog
Three sub-tabs:
- **Products:** list, add/edit product (name, details form type, active), packages and their template lines (drag to reorder or up/down buttons), add-ons.
- **Patches:** list grouped by tier/group with search; add/edit (number, name, size, tier, group, active, optional photo).
- Changes affect **new** orders only; existing orders keep their copied lines.

### 6.10 Settings
Business info, Zelle contact and display name, rule days (unpaid, ready, quote expiry), upfront percent default, message templates (with placeholders), terms (edit each True Value Statement item), change passcode, sign out, sign out all devices, **Back up now**, link to open the Google Sheet, app version.

---

## 7. Sending and "sent" tracking

- **Send** uses the Web Share API: `navigator.share({ title, text, url })`. `text` is built from the template:
  - Quote: `Hi {first_name}, here is your quote {number} from Terri Renee Evolvé. Review and approve here: {link}`
  - Invoice: `Hi {first_name}, here is your invoice {number} from Terri Renee Evolvé for {total}. Payment details are on the page: {link}`
  - Receipt: `Thank you, {first_name}! Your payment for {number} is received: {link}`
  - Ready: `Hi {first_name}, your order {number} is ready! {fulfillment_text}`
- After the share sheet closes (promise resolves), show a modal **"Did you send it?"** with **Yes, sent** / **Not yet**. Yes sets `sent_at`, `sent_method = share`. If `navigator.share` rejects with `AbortError`, do not ask.
- Fallbacks when Web Share is unavailable (desktop): **Copy link**, **Text** (`sms:{phone}&body=...`), **Email** (`mailto:` with subject and body).
- **Mark as sent** in the overflow menu for sends done outside the app (`sent_method = manual`).
- Customer link format: `{BASE_URL}/view.html?id={public_id}`.

---

## 8. Customer page (`view.html`)

Mobile-first, loads in under 2 seconds on 4G, styled like the look-book. Never shows internal notes, other customers, or admin controls.

### 8.1 Layout (top to bottom)
1. Logo on warm black header band.
2. Document title ("Quote Q-1004" / "Invoice TR-1012"), date, customer name, status pill (Awaiting payment, Paid in full, In progress, Ready for pickup / Ready for delivery, Completed, Expired, Declined).
3. **Items:** each item with its fee lines, quantity, item total; jacket details summary (style, size, color, and the patch spots table with patch numbers and names). Simple items show their customer-facing notes.
4. Totals: Subtotal, Discount (if any), **Total**.
5. **Amount due** panel (dark background, gold amount), only when amount due now > 0:
   - **Pay with Zelle:** QR image, "Send to: 623-523-7472", "Zelle will show the name THERESA ODOM", "Put **{number}** in the memo", a **Copy** button for the Zelle number and for the amount. Pull these values from Settings (`zelle_contact`, `zelle_display_name`), not hard-coded.
   - **Pay with cash:** "Pay in person when you place your order."
   - Policy line: "Paid in full at the time of order. Work begins once payment is received."
6. **Payment history** (date, amount, method).
7. Fulfillment line: "Pickup" or "Delivery", and estimated ready date with "(estimate)".
8. **True Value Statement** (collapsible, expanded on quotes).
9. Quote actions (quotes in `sent` status only):
   - Checkbox: "I have read and agree to the True Value Statement."
   - Text field: "Type your full name."
   - **Approve quote** button (enabled when both are filled) and a secondary **Decline** link (optional note).
   - After approval: thank-you message, then show the new invoice in place (fetch it by its public ID and update the URL with `history.replaceState`).
10. **Save as PDF** button (calls `window.print()`; print CSS gives a clean white single-column page with logo).
11. Footer: business name, phone (tap to call), email, website.

### 8.2 View tracking
Each load calls `public.getDocument`, which records `first_viewed_at` (once), `last_viewed_at`, and increments `view_count`. Skip counting when the request carries a valid admin token (so Terri's previews do not count) or when `?preview=1` is set by the admin app.

### 8.3 States
- Unknown or voided ID: friendly "This link is no longer active. Please contact Terri Renee Evolvé at 623-521-6235."
- Expired quote: show the quote with "This quote has expired. Contact us to renew it." and no Approve button.

---

## 9. Notifications (MailApp, free)

Send to `notify_email` (the business Gmail) using `MailApp.sendEmail`:
- **Quote approved:** subject `✅ Q-1004 approved by {name}`, body with total, link to open the order in the admin app, and the new invoice number.
- **Quote declined:** subject `Q-1004 declined`, include the note.
- Optional daily digest at 8:00 AM (time-driven trigger, Settings toggle, default off): overdue and ready-3+-days items.

Consumer Gmail quota is about 100 emails/day; volume here is far below it.

---

## 10. Security

- **Passcode:** set during setup. Store `SHA-256(salt + passcode)` and the salt in Script Properties. Changing it in Settings requires the current passcode.
- **Login throttling:** after 10 failed attempts in 15 minutes, reject logins for 15 minutes (track in Script Properties or CacheService).
- **Sessions:** on login, generate a random 32-byte token, store only its SHA-256 hash in `Sessions` with expiry (180 days). The client sends the raw token with each admin request. "Sign out all devices" revokes all rows.
- **Authorization:** every action except `auth.login`, `public.getDocument`, `public.approveQuote`, `public.declineQuote` requires a valid session.
- **Public actions** look up by `public_id` only (24+ random URL-safe characters from `Utilities.getUuid()` ×2, stripped and base64url encoded), return only customer-safe fields (explicit allow-list serializer, never the raw row), and refuse drafts and voided documents.
- **Input validation** server side: types, lengths (names 100, notes 5000), amounts as integers within ±$100,000, enums checked. Escape all user text when rendering (use `textContent`, never `innerHTML` with user data).
- **Photos** stay private in Drive; the admin app fetches them through an authenticated action that returns a resized base64 image. Customer page never shows photos.
- **Account hygiene (document in README):** turn on 2-step verification for the business Gmail; add both Terri's and Autumn's phones as recovery; the GitHub account uses the same Gmail with 2FA.
- No secrets in the repo. `config.js` contains only the public Web App URL.

---

## 11. Backups and recovery

- `Backup.gs`: nightly time-driven trigger (2:00 AM Phoenix) copies the spreadsheet into `TR Orders/Backups/TR Orders Data YYYY-MM-DD`, then deletes backups older than 30 days.
- **Back up now** button in Settings calls the same function.
- README section "How to restore": open a backup copy, copy tabs back, or point the script at the copy.
- Google Sheets version history covers same-day mistakes.

---

## 12. API actions

Request `{ action, token?, payload }`. Response `{ ok: true, data }` or `{ ok: false, error: { code, message } }` with friendly messages the UI can show directly.

| Action | Auth | Purpose |
|---|---|---|
| `auth.login` | no | passcode → token |
| `auth.logout`, `auth.logoutAll`, `auth.changePasscode` | yes | |
| `bootstrap` | yes | settings, products, packages, template lines, add-ons, patches, customers (one call on app start) |
| `dashboard.get` | yes | needs-attention lists and snapshot numbers |
| `docs.list` | yes | filters, search, paging |
| `docs.get` | yes | full document with items, lines, details, payments, checklist, photos meta, log |
| `docs.save` | yes | create/update (server recomputes totals, assigns number) |
| `docs.markSent`, `docs.markApproved`, `docs.convertToInvoice`, `docs.renewQuote`, `docs.duplicate`, `docs.setStage`, `docs.void` | yes | |
| `checklist.toggle` | yes | |
| `payments.add`, `payments.void` | yes | |
| `customers.save`, `customers.get`, `customers.list` | yes | |
| `catalog.saveProduct`, `catalog.savePackage`, `catalog.saveTemplateLines`, `catalog.saveAddOn`, `catalog.savePatch` | yes | |
| `settings.save` | yes | |
| `photos.upload`, `photos.get`, `photos.delete` | yes | client resizes to max 1600px JPEG (~0.8 quality) before upload |
| `backup.run` | yes | |
| `public.getDocument` | no | by public_id, records view |
| `public.approveQuote` | no | public_id, typed name, terms accepted → creates invoice, notifies |
| `public.declineQuote` | no | public_id, optional note, notifies |

---

## 13. Visual design system

### 13.1 Colors
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#201C19` | primary dark (headers, primary buttons, dark panels), body text |
| `--gold` | `#D4AF5A` | accent on dark backgrounds only (logo color, amounts on dark panels, active tab on dark) |
| `--gold-text` | `#8A6A1E` | gold labels and links on light backgrounds (meets contrast) |
| `--cream` | `#F9F6F0` | page background |
| `--panel` | `#F0ECE2` | cards, sections |
| `--line` | `#DDD6C8` | dividers, input borders |
| `--muted` | `#6B6359` | secondary text |
| `--oxblood` | `#6E1A1E` | overdue and destructive states |
| `--ok` | `#2F6B3A` | paid, completed |

Status badge colors: Draft (panel/muted), Sent/Awaiting payment (gold-text outline), Viewed (muted chip), Overdue (oxblood), In progress (ink), Ready (gold on ink), Paid/Completed (ok), Declined/Expired/Void (muted, struck).

Check every text/background pair for WCAG AA (4.5:1 body, 3:1 large). Never put `--gold` text on `--cream`.

### 13.2 Typography
- Headings: Cormorant Garamond 600, generous size (h1 32px, h2 24px).
- Body and UI: Jost 400/500, 18px base on admin, 16px on customer page, line-height 1.5.
- Small caps style labels: Jost 600, 12-13px, letter-spacing 0.15em, uppercase, `--gold-text` (like the look-book's section labels).

### 13.3 Components
Cards with 8px radius, `--panel` background; primary button `--ink` background with cream text, 52px tall, full width on mobile; secondary button outline `--ink`; inputs 52px tall with 16px+ font (prevents iOS zoom); bottom sheet modals; toasts for confirmations ("Payment recorded"); respect iPhone safe areas (`env(safe-area-inset-*)`).

### 13.4 Icons
App icons (provided in `/assets`) use the gold TR monogram centered on `--ink`, with extra padding in the maskable variant.

---

## 14. Seed data (`Setup.gs` creates these)

### 14.1 Products, packages and template lines

**Custom Bomber Jacket** (`detail_form: jacket`)

Package **Standard** ($275):
| Label | Amount | Kind |
|---|---|---|
| Bomber jacket (men's or women's) | 85.00 | base |
| Large back patch | 18.00 | base |
| Chest and sleeve patches (3 × $10) | 30.00 | base |
| Setup: open the lining, close it so it looks untouched | 40.00 | base |
| Sew on main back patch | 45.00 | base |
| Sew on chest left, chest right and sleeve (3 × $20) | 60.00 | base |
| Package savings | -3.00 | savings |

Package **Premium** ($335): all Standard lines plus
| Premium package: upgraded patches (chenille, larger embroidered or custom-made) | 60.00 | upgrade |

Package **Collector's** ($405): all Standard lines plus
| Premium package: upgraded patches (chenille, larger embroidered or custom-made) | 60.00 | upgrade |
| Collector's package: gift packaging, priority turnaround | 70.00 | upgrade |

**Custom Hat** (`detail_form: simple`): package **Custom** with no template lines (Terri adds lines per order until she has a price breakdown).

**Custom Purse** (`detail_form: simple`): package **Custom** with no template lines.

### 14.2 Add-ons (Custom Bomber Jacket)
| Label | Amount | Editable | Rule |
|---|---|---|---|
| Extra small patch (patch, sewing) | 28.00 | no | extra_patch |
| Extra small or medium patch (patch, sewing) | 35.00 | no | extra_patch |
| Extra large or premium patch (patch, sewing) | 45.00 | no | extra_patch |
| Your own patch (sewing only) | 20.00 | yes ("from $20") | extra_patch |
| Left sleeve surcharge (zip pocket side) | 10.00 | no | left_sleeve |
| Rush turnaround | 35.00 | no | |

### 14.3 Patch catalog
| No. | Name | Size | Tier | Group |
|---|---|---|---|---|
| 01 | I Miss Obama | 2.5 × 4 in | standard | Small and medium |
| 02 | Angela Davis quote | 3 × 4 in | standard | Small and medium |
| 03 | OES star | 3.5 × 3.5 in | standard | Small and medium |
| 04 | Maricopa Chapter No. 1 OES | about 4 in | standard | Small and medium |
| 05 | Prince Hall Free & Accepted Masons | | standard | Small and medium |
| 06 | Locs in Progress | 3.5 × 2.5 in | standard | Small and medium |
| 07 | It Is What It Is | | standard | Small and medium |
| 08 | Faith Over Fear | | standard | Small and medium |
| 09 | They Not Like Us | about 4 × 3.5 in | standard | Small and medium |
| 10 | Black Girl Magic (script) | | standard | Small and medium |
| 11 | Black Yesterday, Today, Everyday | | standard | Small and medium |
| 12 | Black Girl Magic (pink) | | standard | Small and medium |
| 13 | Queen cap | | standard | Small and medium |
| 14 | Crowned queen | | standard | Small and medium |
| 15 | 1913 cap | | standard | Small and medium |
| 16 | Well-behaved women | | standard | Small and medium |
| 17 | Black Queen nutrition facts | | standard | Small and medium |
| 18 | Minding my Black owned business | | standard | Small and medium |
| 19 | Black Girls Been Magic | | standard | Small and medium |
| 20 | Black, no sugar, no cream | | standard | Small and medium |
| 21 | Afro glam | | standard | Small and medium |
| 22 | Lips and tongue | | standard | Small and medium |
| 23 | Blue sun hat | | standard | Small and medium |
| 24 | Bubblegum afro | | standard | Small and medium |
| 25 | Leopard headwrap | | standard | Small and medium |
| 26 | Red, black and green chevron | | standard | Small and medium |
| 27 | Red, black and green wings | | standard | Small and medium |
| 28 | Gye Nyame symbol | | standard | Small and medium |
| 29 | Initiated, Passed, Raised | 6 × 4 in | premium | Large and custom-ordered |
| 30 | OES chenille letters | about 6 × 3 in | premium | Large and custom-ordered |
| 31 | OES For Life | about 6.5 in wide | premium | Large and custom-ordered |
| 32 | OES star banner | about 6 × 5.5 in | premium | Large and custom-ordered |
| 33 | OES Sisterhood | about 7 in tall | premium | Large and custom-ordered |
| 34 | Masonic square and compass with G | 5 × 5 in | premium | Large and custom-ordered |
| 35 | OES, Order of the Eastern Star | 9 × 5 in | premium | Back-size (9 in and up) |
| 36 | Relief, Brotherly Love, Truth | 10 × 10 in | premium | Back-size (9 in and up) |
| 37 | Mason: Look to the East | 11 × 9.75 in | premium | Back-size (9 in and up) |
| 38 | Grand Lodge officer | 3 × 3 in | standard | Small and medium |
| 39 | Masonic past master | 3 × 3 in | standard | Small and medium |
| 40 | Masonic past master (flat) | 3 × 3 in | standard | Small and medium |
| 41 | OES star with square and compass | 3 × 3 in | standard | Small and medium |
| 42 | Masonic square and compass with G | 3 × 3 in | standard | Small and medium |
| 43 | Initiated, Passed, Raised (small) | 3.5 × 2.75 in | standard | Small and medium |
| 44 | Black and white square and compass with G | 3¾ × 3⅞ in | standard | Small and medium |
| 45 | OES lady | 4 in | premium | Large and custom-ordered |

Suggested patch sizes (show as helper text on the spots table): Back up to about 10 in wide · Chest up to about 3.5 in · Sleeve up to about 3 in.

### 14.4 Terms: True Value Statement (`terms_json`)
1. **Payment:** The full amount is due at the time of order.
2. **When work begins:** Work does not begin until payment is received.
3. **Work and timeline:** The work and the timeline are estimated. Completion dates are estimates, not guarantees, and run from the day payment is received. Delays in jacket, patch or shipping deliveries are outside our control.
4. **Cancellation:** You may cancel within 24 hours of payment, before your jacket and patches are purchased, for a full refund.
5. **After that:** Once your jacket and patches are purchased or work has begun, the order cannot be cancelled and the payment is non-refundable, because each jacket is made to your order.
6. **Returns:** Custom jackets cannot be returned or exchanged. The patches, placement and sizes you confirm on your order are final.
7. **If something is wrong:** Tell us within 7 days of pickup or delivery, with your order number and photos. If our sewing or lining work is at fault, we will repair or redo it at no charge.
8. **Ownership:** All prices and descriptions belong to Terri Renee Evolvé.

### 14.5 Message templates
Seed settings with the values in section 2 (email, Zelle contact and display name included). Seed `msg_quote`, `msg_invoice`, `msg_receipt`, `msg_ready` with the texts in section 7. Placeholders: `{first_name}, {name}, {number}, {total}, {amount_due}, {link}, {fulfillment_text}`. `fulfillment_text` = "It's ready for pickup." or "We'll be in touch to arrange delivery."

---

## 15. Build milestones (do in order, each ends with something testable)

1. **Google setup and back end skeleton.** README steps for: creating the business Gmail, the Sheet, the Apps Script project, Drive folders, deployment. `Setup.gs` `setup()` creates all tabs, headers, seed data, settings, passcode prompt, nightly backup trigger. `doPost` router, `auth.login`, `bootstrap`. Test with a simple HTML page.
2. **Front end shell.** Repo, GitHub Pages, `config.js`, design tokens and base components, login screen, router, tab bar, manifest, icons (placeholders), service worker. Verify "Add to Home Screen" on an iPhone opens full screen.
3. **Catalog and customers.** Products/packages/lines/add-ons/patches CRUD, customers list/detail/CRUD with duplicate detection.
4. **Order editor.** Quotes and invoices with package templates, add-ons, editable lines, jacket details form with patch picker, left-sleeve rule, extra-patch warning, tier warning, totals, local draft autosave, save with numbering.
5. **Customer page.** `view.html` with all sections, Zelle/cash panel, terms, print CSS, view tracking, quote approve/decline with auto-conversion to invoice.
6. **Sending, payments and progress.** Web Share flow with "Did you send it?", fallbacks, record/void payments, receipts, stages, checklists, flags, order detail screen, activity log.
7. **Home dashboard, notifications, photos, backups.** Needs-attention lists, snapshot cards, MailApp emails, photo upload/view, Back up now.
8. **Polish and handoff.** Accessibility and contrast pass, iPhone testing (Safari and Home Screen mode), empty states, error messages, `INSTALL-IPHONE.md`, final README.

---

## 16. Acceptance tests

Put the money and rules tests in `tests/rules.test.html`; run the rest by hand on an iPhone.

| # | Scenario | Expected |
|---|---|---|
| 1 | Jacket, Standard package | Lines sum to $278.00, savings -$3.00, item total **$275.00** |
| 2 | Jacket, Premium | **$335.00** |
| 3 | Jacket, Collector's | Standard lines + Premium package $60.00 + Collector's package $70.00 = **$405.00** |
| 4 | Standard + 2 Extra small patches + Left sleeve (look-book example) | **$341.00** |
| 5 | Set sleeve spot to Left | Left sleeve surcharge line added once; switching to Right removes it |
| 6 | Add 4th extra patch | Warning shown, still allowed |
| 7 | Premium patch No. 30 in Back spot on Standard | Soft tier warning |
| 8 | Qty 2 Standard jackets | Item total $550.00 |
| 9 | Upfront 100%, total $341 | Customer page shows Total due $341.00, no balance wording |
| 10 | Upfront 50%, total $341.01 | Due now **$170.51** (rounded up) |
| 11 | Record $341 Zelle payment | Status Paid in full, stage In progress, step 1 checked, receipt offered |
| 12 | Invoice sent 8 days ago, unpaid | Appears under Unpaid, overdue |
| 13 | Order Ready 4 days ago, not handed off | Appears under Ready 3+ days |
| 14 | Share sheet then "Not yet" | Still flagged Not sent |
| 15 | Customer opens link | Viewed flag with time; Terri's preview does not count |
| 16 | Customer approves quote with name and terms box | Quote converted, new TR- invoice shown in place, business Gmail receives email |
| 17 | Quote older than 30 days | Shows expired, no Approve button |
| 18 | Public request for a draft or bad ID | "Link no longer active" message, no data leaked |
| 19 | 11 wrong passcodes | Login locked for 15 minutes |
| 20 | Customer page response | Contains no internal_notes, no other customers, no photos |
| 21 | Run backup | Dated copy in Backups folder; copies older than 30 days removed |

---

## 17. Open items (fill in when available)

- [x] Logo files: provided in `/assets` (full logo, monogram, app icons).
- [x] Business Gmail: terrireneedesigns@gmail.com → `email` and `notify_email`.
- [x] Zelle: 623-523-7472, display name THERESA ODOM, QR in `assets/zelle-qr.png`.
- [ ] Price breakdowns for hats and purses → add packages and template lines in Catalog.
- [ ] Patch photos (optional): crop from the look-book or photograph, upload in Catalog.
- [ ] Custom domain (deferred): `invoices.terrireneedesigns.com` later; only `BASE_PATH`/`BASE_URL` in `config.js` and the GitHub Pages setting should need to change.
