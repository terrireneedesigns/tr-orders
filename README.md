# TR Orders

Quote, invoice and order app for **Terri Renee Evolvé**. The full plan is in [SPEC.md](SPEC.md); choices made while building are in [DECISIONS.md](DECISIONS.md).

- **Front end:** plain HTML/CSS/JS on GitHub Pages (milestone 2 onward).
- **Back end:** Google Apps Script Web App, attached to the Google Sheet "TR Orders Data".
- **Data:** the Google Sheet (one tab per table). Photos and backups in the Google Drive folder "TR Orders".
- **Cost:** $0.

**Status:**
- Milestone 1 (Google setup and back end skeleton) is done: `setup()`, the `doPost` router, `auth.login` and `bootstrap`, with a test page.
- Milestone 2 (front end shell) is done: sign-in screen, Home and the five tabs, Home Screen app setup, offline app shell.
- Milestone 3 (catalog and customers) is done: add and edit products, packages and their price lines, add-ons and patches; customers list, detail, add and edit, with a duplicate check.
- Milestone 4 (order editor) is done: create and edit quotes and invoices with package lines, add-ons, the jacket details form and patch picker, the left-sleeve, extra-patch and tier rules, totals, a local draft that survives closing the app, and numbering (Q-1001, TR-1001). Orders list with filters and search.
- Milestone 5 (customer page) is done: `view.html` shows the quote or invoice with the Zelle QR and cash panel, payment history, the True Value Statement, Save as PDF, and quote Approve / Decline (approving turns the quote into an invoice on the spot). Views are tracked; Terri's previews don't count. The order page has Preview, Copy link and Mark as sent.
- Milestone 6 (sending, payments and progress) is done: Send through the iPhone share menu with "Did you send it?" (Copy / Text / Email on computers), Save & Send, record and void payments with a receipt offer, stages (In progress, Ready, Picked up / Delivered, Cancelled), shop checklists per item with "Mark order Ready?" and "Completed?" prompts, Convert to invoice, Mark approved, Renew, Duplicate, Void, and the activity timeline. The Home dashboard, emails, photos and Back up now come next.

---

## Part 1: One-time Google setup

Do all of this signed in as the **business Gmail** (terrireneedesigns@gmail.com). It owns the Sheet, the script, the Drive folders and the GitHub account.

### 1.1 Business Gmail and account safety
1. If the business Gmail does not exist yet, create it at <https://accounts.google.com/signup>.
2. Turn on **2-Step Verification**: <https://myaccount.google.com/security> > 2-Step Verification.
3. Add **both Terri's and Autumn's phones** as recovery options (Security > Recovery phone, and as 2-Step backup phones).
4. Later, the GitHub account is created with this same Gmail and also gets two-factor authentication.

### 1.2 Create the Sheet
1. Go to <https://sheets.google.com> and create a blank spreadsheet.
2. Name it **TR Orders Data**.
3. Leave it empty. Setup creates every tab for you.

### 1.3 Add the Apps Script code
1. In the Sheet, choose **Extensions > Apps Script**. A new tab opens with the script editor.
2. Rename the project (top left, "Untitled project") to **TR Orders API**.
3. Click the gear (**Project Settings**):
   - Tick **Show "appsscript.json" manifest file in editor**.
   - Set **Time zone** to **(GMT-07:00) Phoenix** (America/Phoenix).
4. Back in the **Editor** (`< >` icon), create one script file per `.gs` file in this repo's [`apps-script/`](apps-script/) folder, with the same names:
   `Code`, `Data`, `Rules`, `Documents`, `Payments`, `Public`, `Catalog`, `Customers`, `Backup`, `Setup`. (Click **+** > **Script**, type the name without `.gs`, then paste the file's contents. Replace the starter code in `Code.gs`.)
5. Open `appsscript.json` in the editor and replace its contents with [`apps-script/appsscript.json`](apps-script/appsscript.json).
6. Click **Save** (disk icon).

> **Faster option for Autumn (clasp):** see "Updating with clasp" in Part 2. After the first setup, clasp pushes every `.gs` file for you.

### 1.4 Run setup
1. In the editor, open **Setup.gs**, pick **setup** in the function dropdown at the top, and click **Run**.
2. Google asks for permission the first time: **Review permissions** > choose the business account > **Advanced** > **Go to TR Orders API (unsafe)** > **Allow**. ("Unsafe" only means Google hasn't reviewed this private script.)
3. **Switch to the Sheet's browser tab.** Setup shows its questions there:
   - Type a **passcode** of 6 or more digits, then type it again. Terri and Autumn both use this passcode to open the app.
4. When it finishes you see a summary. Setup has:
   - created all tabs with headers (Settings, Customers, Products, Packages, TemplateLines, AddOns, Patches, Documents, DocItems, DocLines, Payments, Checklist, Photos, Sessions, Log),
   - filled in business settings, message templates and the True Value Statement,
   - added the jacket, hat and purse products, jacket packages ($275 / $335 / $405), add-ons and all 45 patches,
   - created Drive folders **TR Orders / Order Photos** and **TR Orders / Backups**,
   - scheduled a nightly backup at about 2:00 AM Phoenix time,
   - saved the passcode (as a secure hash in Script Properties, never in the Sheet).

Running `setup()` again is safe. It only adds what is missing, asks before changing the passcode, and never deletes data.

### 1.5 Deploy the Web App
1. In the editor, click **Deploy > New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Description: `TR Orders API`. **Execute as: Me** (the business account). **Who has access: Anyone**.
4. Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`). Keep it handy: it goes into `js/config.js` in milestone 2.
5. Check it: open the URL in a browser. You should see `TR Orders API is running (version 0.1.0).`

"Anyone" is required so customers can open their links without signing in. Security is enforced in the code: every admin action needs a valid session from the passcode.

### 1.6 Test it (milestone 1 check)
1. Open [`tests/api-test.html`](tests/api-test.html) in a browser (double-click the file, or open it from GitHub Pages later).
2. Paste the Web App URL.
3. **Ping** should say OK.
4. Type the passcode and tap **Sign in**. It should say OK and show a token.
5. Tap **Bootstrap**. It should list 3 products, 5 packages, 24 lines, 6 add-ons, 45 patches, 0 customers.
6. Wrong passcode should say "That passcode is not right." After 10 wrong tries in 15 minutes, sign-in is locked for 15 minutes.

---

## Part 1B: Put the app online (GitHub Pages)

### 1B.1 GitHub account
1. Go to <https://github.com/signup> and create an account **with the business Gmail**. Pick a short username (it becomes part of the web address, for example `terrireneedesigns`).
2. Turn on two-factor authentication: profile picture > **Settings** > **Password and authentication** > **Enable two-factor authentication**. Save the recovery codes somewhere safe.

### 1B.2 Create the repository
1. Click **+** (top right) > **New repository**.
2. Name: `tr-orders`. Choose **Public** (GitHub Pages is free for public repositories). Click **Create repository**.
3. Nothing secret is in these files. The Web App URL is meant to be public, and the passcode lives only in Google.

### 1B.3 Upload the files
- **Easiest:** on the new repository page click **uploading an existing file**, drag in everything inside the project folder (`index.html`, `manifest.webmanifest`, `sw.js`, and the `css`, `js`, `assets`, `apps-script` and `tests` folders, plus the `.md` files), then click **Commit changes**.
- **With git (Autumn):** `git init`, `git add -A`, `git commit -m "TR Orders"`, `git branch -M main`, `git remote add origin https://github.com/<user>/tr-orders.git`, `git push -u origin main`.

### 1B.4 Turn on GitHub Pages
1. In the repository: **Settings** > **Pages**.
2. **Source:** Deploy from a branch. **Branch:** `main`, folder `/ (root)`. Click **Save**.
3. After a minute or two the page shows the address: `https://<user>.github.io/tr-orders/`.

### 1B.5 Connect the app to the back end
1. In the repository, open `js/config.js` and click the pencil (**Edit**).
2. Paste the Web App URL from step 1.5 between the quotes: `export const API_URL = 'https://script.google.com/macros/s/.../exec';`
3. Click **Commit changes**. Wait a minute for GitHub Pages to update.
4. Open `https://<user>.github.io/tr-orders/` on a computer, sign in with the passcode, and check that Home and all five tabs open. Settings should show the business details.

### 1B.6 Check it on the iPhone (milestone 2 check)
1. On the iPhone, open **Safari** (it must be Safari) and go to `https://<user>.github.io/tr-orders/`.
2. Tap the **Share** button (square with an arrow), scroll down and tap **Add to Home Screen**. The name should already say **TR Orders**. Tap **Add**.
3. Open **TR Orders** from the Home Screen. It should open **full screen** (no Safari address bar or buttons), with the gold TR icon and a dark band behind the clock and battery.
4. Sign in. Close the app and open it again: it should go straight to Home without asking for the passcode.

### 1B.7 Updating the front end
1. Change the files. **Raise the version number** in both `js/config.js` (`APP_VERSION`) and `sw.js` (`VERSION`), keeping them the same. Add any new or renamed files to the list in `sw.js`.
2. Upload or push them.
3. The app checks for a new version each time it is opened or brought back on screen. When it finds one, it downloads it and reloads itself within a few seconds. If Terri is editing an order at that moment, it shows "A new version of TR Orders is ready" with a **Refresh** button instead, so nothing typed is lost.
4. To check which version a phone has: Settings, bottom line ("TR Orders app 0.6.1").
5. If a phone ever seems stuck on an old version: swipe up from the bottom, swipe TR Orders away to close it fully, and open it again (twice if needed).

---

## Part 2: Updating the back end (important)

After changing any Apps Script code:

1. Paste each changed `.gs` file from [`apps-script/`](apps-script/) over the one in the editor, and add any new file (for example `Customers.gs` in milestone 3) with **+** > **Script**. Save (or `clasp push`).
2. **Deploy > Manage deployments**, select the existing **TR Orders API** deployment, click the **pencil (Edit)**.
3. Under **Version**, choose **New version**, then **Deploy**.

**Do not use "New deployment" for updates.** That creates a new URL, and the app and every customer link would still point at the old one. Editing the existing deployment keeps the URL the same forever.

### Updating with clasp (Autumn's computer)

One-time setup:
1. Install clasp: `npm install -g @google/clasp` (needs Node.js).
2. Signed in as the business account, turn on **Google Apps Script API** at <https://script.google.com/home/usersettings>.
3. `clasp login --user business` and pick **terrireneedesigns@gmail.com** in the browser. (`--user business` keeps any other Google sign-in clasp already has.)
4. Create `apps-script/.clasp.json` with the script ID (Apps Script > Project Settings > IDs). It is listed in `.gitignore`, so it never goes to GitHub:
   ```json
   { "scriptId": "<script ID>", "rootDir": "." }
   ```

Each update, from the `apps-script` folder:
1. `clasp --user business push`: uploads every file in the folder, adding new ones. It replaces the whole project, so make any change here, not in the online editor (or run `clasp --user business pull` first).
2. `clasp --user business list-deployments`: find the **TR Orders API** deployment ID (the one in `js/config.js`), not the `@HEAD` one.
3. `clasp --user business update-deployment <deployment ID> -d "TR Orders API"`: makes a new version of that same deployment, so the URL stays the same.
4. Check: open the Web App URL in a browser; it shows the new version number.

**Order matters:** update the back end first, then upload the front end. A newer app talking to an older back end shows "Unknown action." To check which back end version is live, open Settings in the app (it shows "server 0.3.0") or open the Web App URL in a browser.

---

## Part 3: Backups and how to restore

- Every night around 2:00 AM, a copy of the Sheet is saved as **TR Orders/Backups/TR Orders Data YYYY-MM-DD**. Copies older than 30 days are moved to the Drive trash (Google empties the trash after 30 more days).
- "Back up now" in the app's Settings (milestone 7) does the same thing; a second backup on the same day replaces that day's copy.
- Each backup copy also contains a copy of the script. That is normal; it is never deployed and does nothing.
- For same-day mistakes, use the Sheet's own **File > Version history**, which is often easiest.

**To restore from a backup:**
1. Open the backup copy in Drive.
2. For the tab you need, right-click the tab > **Copy to > Existing spreadsheet** > choose **TR Orders Data**.
3. In TR Orders Data, delete (or rename) the damaged tab and rename the copied tab to the exact original name (for example `Documents`).
4. In Apps Script, run `setup()` once (it re-checks columns and clears cached data). Answer "No" when asked to change the passcode.

---

## Part 4: Where things live

| Thing | Where |
|---|---|
| Data | Google Sheet "TR Orders Data" (business Drive) |
| Passcode hash, folder IDs, login lockout | Apps Script > Project Settings > Script Properties |
| Order photos | Drive: TR Orders / Order Photos (private) |
| Backups | Drive: TR Orders / Backups |
| Back end code | [`apps-script/`](apps-script/) in this repo, pasted into the Apps Script project |
| Front end | this repo, served by GitHub Pages (milestone 2) |

Editing the Sheet by hand is fine (for example fixing a typo in a patch name). The app picks up the change right away. Do not rename tabs or header cells; the code finds columns by their header names.

---

## For developers

- Back end tests (no npm packages needed): `node tests/backend.test.js`. They run the real `.gs` files against small fakes of the Google services.
- Local app with a fake back end: `node tests/dev-server.js`, then open <http://localhost:8080/tr-orders/> (fake passcode `123456`, data resets on restart). It serves `js/config.js` pointed at the fake without changing the file. On localhost the service worker loads from the network first, so edits show on reload.
- Replacing a logo: the app shell uses smaller copies, `assets/logo-full-sm.png` (480 px wide) and `assets/logo-monogram-sm.png` (160 px wide). After replacing `logo-full.png` or `logo-monogram.png`, make new small copies (macOS: `sips -Z 480 logo-full.png --out logo-full-sm.png` and `sips -Z 160 logo-monogram.png --out logo-monogram-sm.png`), or just copy the new file over the `-sm` name. No code changes needed either way.
- API: POST `{ action, token, payload }` as `text/plain;charset=utf-8` (not `application/json`, which triggers a CORS preflight that Apps Script cannot answer). Responses are `{ ok: true, data }` or `{ ok: false, error: { code, message } }`, where `message` is safe to show as is.
- Actions so far: `ping`, `auth.login`, `auth.logout`, `auth.logoutAll`, `auth.changePasscode`, `bootstrap`, `backup.run`, `customers.save` / `get` / `list`, `catalog.saveProduct` / `savePackage` / `saveTemplateLines` / `saveAddOn` / `savePatch` / `reorder`, `docs.save` / `get` / `list` / `markSent` / `setStage` / `void` / `markApproved` / `convertToInvoice` / `renewQuote` / `duplicate`, `checklist.toggle`, `payments.add` / `void`, and the public (no sign-in) `public.getDocument` / `approveQuote` / `declineQuote`.
- Money and rules tests: open `tests/rules.test.html` in a browser (from the dev server or GitHub Pages).
