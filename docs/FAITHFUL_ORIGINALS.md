# Test a publisher Original on Windows

Use Edge or Chrome and Node.js 24 LTS. A published feed and the reader on your own PC are enough for this review.

1. **Back up the service directory before starting Milestone 4.** Exit every running Reading Box service with **Ctrl+C** and wait for the PowerShell prompt. The first Milestone 4 start upgrades SQLite from schema 1 to 2 in place. On an existing installation, run this in the same PowerShell environment you use to start Reading Box. A first-time installation can skip the backup.

   ```powershell
   $feedDir = if ($env:READING_BOX_DATA_DIR) { $env:READING_BOX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Reading Box\feeds' }
   $feedDir = (Get-Item -LiteralPath $feedDir -ErrorAction Stop).FullName
   if (!(Test-Path -LiteralPath (Join-Path $feedDir 'feeds.sqlite') -PathType Leaf)) { throw 'Locate the existing service data directory before continuing.' }
   $backup = "$feedDir.pre-m4-$(Get-Date -Format yyyyMMdd-HHmmss-fff)"
   if (Test-Path -LiteralPath $backup) { throw 'Choose a new backup folder.' }
   Copy-Item -LiteralPath $feedDir -Destination $backup -Recurse -Force -ErrorAction Stop
   Get-Item -LiteralPath (Join-Path $backup 'feeds.sqlite') -ErrorAction Stop
   $backup
   ```

   Keep the printed backup path private. The directory includes the database with its signing key and pairings, SQLite sidecar files if present, and any publisher review files. Keep this copy untouched.

2. In your existing clone, check out and update the review branch, then launch the reader.

   ```powershell
   git fetch origin
   git switch feature/phase-2-faithful-originals
   git pull --ff-only origin feature/phase-2-faithful-originals
   npm.cmd ci
   npm.cmd run reading-box
   ```

3. Open the printed Subscriptions address in your usual browser profile. Keep the same hostname, port and feed data directory as before so the reader can reopen its pairing, offline articles, saved items and appearance. If you used port 5173, set `$env:READING_BOX_READER_PORT = '5173'` before launching. For a first pairing, run `npm.cmd run feeds -- pair` in a second PowerShell window in the same folder and enter the code under **Connect browser**. Keep the first window and PC awake for automatic feed polling while the reader is closed. **Ctrl+C** stops the reader and service.
4. In **Manage subscriptions**, add **Bits from Debian** or choose **Refresh** for an existing subscription. The service requests a fresh feed body on its next eligible refresh after upgrading. If the publisher cooldown is active, wait until the displayed time, then check for deliveries.
5. In Inbox, use the book beside **New Debian Developers and Maintainers (September and October 2026)**. Opening Original checks its public page. Expect **Verified complete original**, two lists containing 7 and 8 names, and the last paragraph **Congratulations!**. Click **Copy full article text** and paste into Notepad. The source and MIT notice precede the article. The collapsed **Reader discussion** beneath the text offers the publisher post when the feed supplies no comments destination. [Publisher article](https://bits.debian.org/2026/11/new-developers-2026-11.html) · [Bits from Debian terms](https://bits.debian.org/pages/about.html) · [Debian licensing terms](https://www.debian.org/license)
6. Add `https://creativecommons.org/feed/` and open **Commons Stories: Part 3**. Compare the opening, linked references, section headings, emphasis and last paragraph with the publisher. The portrait has a description and **View publisher image**. The reader labels completeness unverified because the portrait lacks separately confirmed image permission. Copy uses **Copy available text**. Publisher feed windows can change. [Publisher article](https://creativecommons.org/2026/11/05/commons-stories-part-3/) · [Creative Commons policies](https://creativecommons.org/policies/)
7. Save an article and return to the list. After the first online load and reload, disconnect the network and reopen the installed reader. Try the saved Original, its copy action and dark mode. Reconnect and restart the same command. Android Chrome uses the same browser flow over the existing private USB tunnel. Pair a separate Android profile and forward the reader port only. [Pairing, service restarts and Android USB steps](RSS_OWNER_PREVIEW.md#android-over-a-private-usb-connection)

## Rolling back to Milestone 3

Milestone 3 can open schema 1 only. Switching the code back leaves an upgraded database at schema 2. To test rollback, stop the service, make a fresh working copy of the **pre-upgrade** backup, and point the Milestone 3 service at that copy. Keep both the backup and the upgraded directory for recovery. In PowerShell, set `$backup` to the path printed above if you opened another window.

```powershell
$restore = "$backup.restore-$(Get-Date -Format yyyyMMdd-HHmmss-fff)"
if (Test-Path -LiteralPath $restore) { throw 'Choose a new restore folder.' }
Copy-Item -LiteralPath $backup -Destination $restore -Recurse -Force -ErrorAction Stop
$env:READING_BOX_DATA_DIR = $restore
git switch --detach 978e644
npm.cmd ci
npm.cmd run reading-box
```

This starts the reviewed Milestone 3 build from PR #7. The copy reflects the backup date. Later subscriptions, articles, pairings and permission withdrawals are outside that snapshot. Reapply later revocations and refresh publisher permissions before using restored material. Browser-local saved, archived and reading positions, appearance and delivery cursors belong to the browser profile. Use a separate browser profile and pair it with the restored service for a rollback test so the original profile keeps its library and cursor. To resume Milestone 4, stop the test service, return to the review branch and select the original service directory. An installation already upgraded without a schema 1 backup has no supported in-place downgrade. A backup taken at schema 2 supports restoration with Milestone 4.

## How the reader decides what to show

- Feed collection remains independent of page extraction. Opening an eligible Original triggers a cookie-free request to the exact public article. Copying a retained page edition while connected checks the current revision. The service coalesces simultaneous work and reuses a completed check for one minute. Links to publishers open in the browser, where the publisher handles authentication.
- Two reviewed page examples are enabled. The Debian contributor article must match the full Atom body, title, author and publisher template. The pre-existing verified election article continues to use its independent feed review. The Creative Commons example verifies its canonical URL, byline, licence and article boundaries, including its lead-in. Other feeds continue to display permitted feed text, labelled excerpts or publisher handoffs.
- An owner who has reviewed another publisher’s terms can opt in its precise HTTPS origin by putting a JSON array such as `["https://journal.example.org"]` in `original-sources.json` beside the service database and restarting. This permits checking eligible same-origin pages. The feed and page must independently declare matching CC BY 4.0 or CC0 terms. Returning a complete edition also requires a matching canonical URL, byline, title and explicit, unambiguous article body. The ordered page text through its ending must match the full feed edition or an independently reviewed SHA-256 in the existing `verified-originals.json` register. An edited page loses its complete label until the evidence matches again. An inferred article boundary receives **Completeness unverified**. Removing an origin and restarting drops its retained page editions on the next delivery. [Local data directory](DURABLE_FEED_SERVICE.md)
- A publisher timeout, connection failure, rate limit or temporary server error leaves the last permitted edition available, including its figures, closing passage and copy action. The Original shows the failed check and a **Retry publisher check** button. A publisher-supplied retry time appears when available. If the first check fails, the existing feed preview or publisher link remains. A later successful check applies the current text and terms.
- The service checks robots rules, storage directives, access responses, subscriber markers, pagination and conflicting licences. Restrictions remove the stored page body and leave a separately permitted feed preview or a publisher link. A feed revision or withdrawal invalidates its associated page and images. An offline browser learns about changes when it reconnects. Page-only changes are discovered on the next eligible Original check.
- The reader renders an allowlist of text elements and safe links. A small same-origin PNG can be retained when its figure gives a matching licence and a credit. The service validates the raster and enforces fetch and size limits. Other images use a labelled publisher handoff. Embedded media and uncertain boundaries prevent a complete label. The additional page cache is limited to 16 MiB per service profile. No publisher scripts, forms, third-party image requests or embedded players run in the reader.

## Repeatable tests

From the project folder, run the following in PowerShell. The authored River Notebook fixture includes an ordered and nested list, a quotation, two inline links, a licensed diagram with a caption, a table, code and a final passage. It runs in isolated test databases. The outage regression returns HTTP 503 after verification, restarts the service with the same SQLite directory, reopens the reader and checks the complete attributed copy through the last line. It then retries successfully and tests a subsequent access restriction. You can run just this browser scenario with `npx.cmd playwright test tests/e2e/originals.spec.ts --grep "publisher outage"` after installing Chromium. The suite also covers subscriber restrictions, changed text and rights, feed withdrawal, blocked images, clipboard denial, offline reopening and previously paired installations.

```powershell
npm.cmd run test:unit
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

CI also exercises Windows Edge, Windows Chrome and Chrome on an Android 15 emulator. The live checks depend on the publishers retaining the reviewed editions. A physical Android handset and TalkBack or Narrator require a hands-on review.
