# Try the real RSS reader on Windows

Reading Box collects public feeds on your PC. The Subscriptions inbox opens its local library immediately and checks the running service for new deliveries. Saved, Archive and reading positions belong to this browser. Use **Fictional demo** to return to the eight authored articles and their cached summary depths.

## Start and pair

1. Install Git for Windows and Node.js 24 LTS. In PowerShell, download the review branch and start both the production reader and the feed service.

   ```powershell
   git clone --branch feature/phase-2-real-rss-preview https://github.com/deensomally/reading-inbox.git reading-box-preview
   cd reading-box-preview
   npm.cmd ci
   npm.cmd run reading-box
   ```

2. Open `http://localhost:4173/#/subscriptions/inbox` in Edge or Chrome. If you previously used port 5173, set `$env:READING_BOX_READER_PORT = '5173'` before starting and use 5173 in the address. **Keep your original browser profile, hostname and port to retain access to your existing demo and appearance.**
3. In a second PowerShell window in the same folder, run the following command.

   ```powershell
   npm.cmd run feeds -- pair
   ```

4. Choose **Connect browser**, enter the one-time code and confirm. The default profile opens your existing Milestone 2 subscriptions. Pairing another browser to that same profile replaces the previous browser’s service access. Use a separate profile name for another installation, such as `npm.cmd run feeds -- pair android`. Treat the code as private. It expires in five minutes.
5. Leave the first window running. **Automatic polling requires the backend on an awake, connected PC, even when every browser or installed reader window is closed.** The normal interval is about 30 minutes. Publisher freshness and retry instructions can extend it. Press **Ctrl+C** to stop both processes. Run `npm.cmd run reading-box` again to resume.

## Read a verified original

1. Open **Manage subscriptions → Try Bits from Debian**. Once it has imported, choose **Open reviewed Debian article**. The article reports the 2026 Debian Project Leader election. The label **Verified complete original** identifies the reviewed edition.
2. Check the five paragraphs, the two inline links and the final sentence ending “expire on April 20, 2027.” Use **Copy full article text** and paste into Notepad. The copy includes the attribution and MIT permission notice, followed by the text through that final sentence. **Source and licence** gives the reuse terms. **Reader discussion** remains below the Original.
3. Save and archive the article, then reopen it from **Saved**. Switch to **Fictional demo** to check your previous reading progress, dark mode and cached demo summaries. Use **Subscriptions** to switch back.

The publisher credits Jean-Pierre Giraud. Bits from Debian applies the Debian website licensing policy to its articles. The reviewed 2026 piece qualifies for the MIT (Expat) option. On 22 November 2026 we compared the entire Atom content with the independent article body on the publisher’s website. All five paragraphs, both link targets, their labels and the closing passage matched. The service recognises this specific feed, URL, attribution and edition by digest. Changed markup, a changed final sentence, conflicting rights or a storage restriction removes its verified treatment. Other articles in the feed receive their own coverage decisions. The live verification fetches the publisher page in the test harness. [Publication policy](https://bits.debian.org/pages/about.html) · [Debian licensing terms](https://www.debian.org/license) · [MIT permission notice](https://www.debian.org/legal/licenses/mit) · [Atom feed](https://bits.debian.org/feeds/atom.xml) · [Reviewed article](https://bits.debian.org/2026/04/dpl-elections-2026.html)

## Add and manage your own feeds

- Enter a direct RSS or Atom address, a public Substack publication hostname, or a publication page with an advertised feed. Try `https://creativecommons.org/feed/`, `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom`, or `https://www.oneusefulthing.org/feed`.
- **Refresh** asks the service to check that publisher, subject to its cooldown. **Check for deliveries** retrieves observations already collected by the service. Returning to the reader, reconnecting, and leaving it open also check for deliveries. Use **Show more articles** for older entries.
- **Remove** stops future polling after confirmation. Already observed articles, including ones that have fallen out of the publisher’s feed, are still available. Re-adding the same publication reuses its identity. Changes made with the service stopped show as **Pending** until acknowledged. Failed adds give a reason and a retry action.
- An ordinary open starts at Essence and explains that live AI summaries are off. Use **Read original** or the book beside a headline. A **Publisher excerpt** is author-supplied partial text. **Completeness unverified** identifies retained text whose boundaries have not been confirmed. **Publisher only** provides the available handoff and explains why Reading Box cannot show the body. Only verified, permitted text gets the full-article copy action.

## Check service restart and offline reopening

To stop the collector independently, stop the combined command first. From the project folder use one PowerShell window for each command below. Keep the same hostname, port and service data directory used for pairing.

```powershell
# Window 1
npm.cmd run feeds:start
```

```powershell
# Window 2, after the production build from step 1
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

1. Open the paired reader, check for deliveries and reload once to activate the installed service worker.
2. Press **Ctrl+C** in window 1. Reopen the verified article. Its permitted text, reading position and saved state are available locally. Try removing a subscription and look for **Pending**. For a browser-offline check, disconnect the network and reload the installed reader.
3. Reconnect, restart `npm.cmd run feeds:start` in window 1, then use **Check for deliveries**. The pending operation is acknowledged and the browser signs in again with its device key. Previously observed articles remain available. The service can recover only entries still present in a feed when polling resumes.
4. Run `npm.cmd run test:unit` and, after `npx.cmd playwright install chromium`, `npm.cmd run test:e2e` for the repeatable closed-window, restart, offline and migration checks. Routine tests use isolated databases and a controlled publisher.

## Android over a private USB connection

Enable USB debugging on a trusted Android phone, connect it to the PC, and approve that PC on the phone. With Android SDK Platform Tools installed, run the following in PowerShell while the reader is running.

```powershell
adb devices
adb reverse tcp:4173 tcp:4173
npm.cmd run feeds -- pair android
```

Open `http://localhost:4173/#/subscriptions/inbox` in **Chrome on the phone** and enter the Android profile’s code. The USB tunnel forwards only the reader port. The reader proxies authenticated API requests to the feed service on PC loopback. Both servers bind to `127.0.0.1`. There is no LAN listener or firewall opening needed. Chrome can install the PWA from device loopback. Remove the tunnel afterward with `adb reverse --remove tcp:4173`. The phone can read retained data offline, and catches up the next time its tunnel and collector are available. Physical phone, Narrator and TalkBack checks remain hands-on tests.

## Browser security and local storage

- The service’s SQLite signing key stays in its private data directory. The Windows CLI uses local file access to issue a random, single-use pairing code with 60 bits of entropy. A new code invalidates the previous code for that profile. Sign-in endpoints limit attempts. Codes travel in request bodies and are excluded from URLs, browser storage and application logs.
- The browser creates a non-extractable P-256 signing key using Web Crypto. IndexedDB stores that key with the public device and library IDs. The service pins its public key to the exact loopback reader origin and profile for 30 days. At sign-in the browser signs an origin- and device-bound, single-use challenge valid for one minute. A successful proof gives the tab a ten-minute access token held in memory. Service restarts discard tokens and challenges. Enrolled keys survive restart.
- Browser requests require an explicit client header and the configured reader host and port. Mutations require the matching Origin. The service rejects cross-origin browser requests and keeps CLI administration separate from browser sessions. Every delivery and subscription query uses the authenticated profile. API responses specify `no-store`, and the service worker excludes API routes. Publisher content is rendered as text and safe links.
- Run `npm.cmd run feeds -- revoke-browsers` for the default profile or `npm.cmd run feeds -- revoke-browsers android` for the named profile. Revoke or re-pair after losing a device. Revocation stops future service access. An offline copy already delivered to a trusted device remains readable there. New withdrawals or rights changes apply on the next successful collection.
- Each library has a separate browser database for its permitted articles, independent flags, positions, subscription mirror, pending commands and delivery cursor. A delivery page and its cursor commit together. The historical demo database and appearance key keep their original names. The security boundary assumes a trusted OS account, browser profile and reader origin. Code executing on that origin can act as the reader while it is open. Protect the SQLite directory and its backups. [Collector storage and recovery](DURABLE_FEED_SERVICE.md)

This preview runs locally with no paid hosting or AI account. For the Milestone 4 reader and its reviewed publisher-page examples, follow the [faithful originals walkthrough](FAITHFUL_ORIGINALS.md).
