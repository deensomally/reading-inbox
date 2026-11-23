# Test a publisher Original on Windows

Use Edge or Chrome and Node.js 24 LTS. A published feed and the reader on your own PC are enough for this review.

1. Stop the running Milestone 3 service with **Ctrl+C**. In PowerShell, check out the review branch in your existing clone.

   ```powershell
   git fetch origin
   git switch feature/phase-2-faithful-originals
   npm.cmd ci
   npm.cmd run reading-box
   ```

2. Open the printed Subscriptions address in your usual browser profile. Keep the same hostname, port and feed data directory as before so the reader can reopen its pairing, offline articles, saved items and appearance. If you used port 5173, set `$env:READING_BOX_READER_PORT = '5173'` before launching. For a first pairing, run `npm.cmd run feeds -- pair` in a second PowerShell window in the same folder and enter the code under **Connect browser**. Keep the first window and PC awake for automatic feed polling while the reader is closed. **Ctrl+C** stops the reader and service.
3. In **Manage subscriptions**, add **Bits from Debian** or choose **Refresh** for an existing subscription. The service requests a fresh feed body on its next eligible refresh after upgrading. If the publisher cooldown is active, wait until the displayed time, then check for deliveries.
4. In Inbox, use the book beside **New Debian Developers and Maintainers (September and October 2026)**. Opening Original checks its public page. Expect **Verified complete original**, two lists containing 7 and 8 names, and the last paragraph **Congratulations!**. Click **Copy full article text** and paste into Notepad. The source and MIT notice precede the article. The collapsed **Reader discussion** beneath the text offers the publisher post when the feed supplies no comments destination. [Publisher article](https://bits.debian.org/2026/11/new-developers-2026-11.html) · [Bits from Debian terms](https://bits.debian.org/pages/about.html) · [Debian licensing terms](https://www.debian.org/license)
5. Add `https://creativecommons.org/feed/` and open **Commons Stories: Part 3**. Compare the opening, linked references, section headings, emphasis and last paragraph with the publisher. The portrait has a description and **View publisher image**. The reader labels completeness unverified because the portrait lacks separately confirmed image permission. Copy uses **Copy available text**. Publisher feed windows can change. [Publisher article](https://creativecommons.org/2026/11/05/commons-stories-part-3/) · [Creative Commons policies](https://creativecommons.org/policies/)
6. Save an article and return to the list. After the first online load and reload, disconnect the network and reopen the installed reader. Try the saved Original, its copy action and dark mode. Reconnect and restart the same command. Android Chrome uses the same browser flow over the existing private USB tunnel. Pair a separate Android profile and forward the reader port only. [Pairing, service restarts and Android USB steps](RSS_OWNER_PREVIEW.md#android-over-a-private-usb-connection)

## How the reader decides what to show

- Feed collection remains independent of page extraction. Opening an eligible Original triggers a cookie-free request to the exact public article. Copying a retained page edition while connected checks the current revision. The service coalesces simultaneous work and reuses a check for one minute. Links to publishers open in the browser, where the publisher handles authentication.
- Two reviewed page examples are enabled. The Debian contributor article must match the full Atom body, title, author and publisher template. The pre-existing verified election article continues to use its independent feed review. The Creative Commons example verifies its canonical URL, byline, licence and article boundaries, including its lead-in. Other feeds continue to display permitted feed text, labelled excerpts or publisher handoffs.
- An owner who has reviewed another publisher’s terms can opt in its precise HTTPS origin by putting a JSON array such as `["https://journal.example.org"]` in `original-sources.json` beside the service database and restarting. This permits checking eligible same-origin pages. The feed and page must independently declare matching CC BY 4.0 or CC0 terms. Returning a complete edition also requires a matching canonical URL, byline, title and explicit, unambiguous article body. The ordered page text through its ending must match the full feed edition or an independently reviewed SHA-256 in the existing `verified-originals.json` register. An edited page loses its complete label until the evidence matches again. An inferred article boundary receives **Completeness unverified**. Removing an origin and restarting drops its retained page editions on the next delivery. [Local data directory](DURABLE_FEED_SERVICE.md)
- The service checks robots rules, storage directives, access responses, subscriber markers, pagination and conflicting licences. Restrictions remove the stored page body and leave a separately permitted feed preview or a publisher link. A feed revision or withdrawal invalidates its associated page and images. An offline browser learns about changes when it reconnects. Page-only changes are discovered on the next eligible Original check.
- The reader renders an allowlist of text elements and safe links. A small same-origin PNG can be retained when its figure gives a matching licence and a credit. The service validates the raster and enforces fetch and size limits. Other images use a labelled publisher handoff. Embedded media and uncertain boundaries prevent a complete label. The additional page cache is limited to 16 MiB per service profile. No publisher scripts, forms, third-party image requests or embedded players run in the reader.

## Repeatable tests

From the project folder, run the following in PowerShell. The authored River Notebook fixture includes an ordered and nested list, a quotation, two inline links, a licensed diagram with a caption, a table, code and a final passage. It runs in isolated test databases. The suite also covers subscriber restrictions, changed text and rights, feed withdrawal, blocked images, clipboard denial, offline reopening and previously paired installations.

```powershell
npm.cmd run test:unit
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

CI also exercises Windows Edge, Windows Chrome and Chrome on an Android 15 emulator. The live checks depend on the publishers retaining the reviewed editions. A physical Android handset and TalkBack or Narrator require a hands-on review.
