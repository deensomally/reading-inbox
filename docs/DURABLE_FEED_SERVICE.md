# Run the durable feed service on Windows

Milestone 2 lets you subscribe to public feeds, inspect the articles Reading Box has collected, and stop and restart collection on your own PC. Use the PowerShell commands below. The reading interface still shows your fictional library. For the milestone 3 browser interface, follow the [owner preview walkthrough](RSS_OWNER_PREVIEW.md).

## Start the service

1. Install Git for Windows and Node.js 24 LTS. Open PowerShell in a folder where you keep projects.
2. Download the review branch and install its locked dependencies.

   ```powershell
   git clone --branch feature/phase-2-durable-feed-service https://github.com/deensomally/reading-inbox.git reading-box-feeds
   cd reading-box-feeds
   npm.cmd ci
   ```

3. In this window, start the collector.

   ```powershell
   npm.cmd run feeds:start
   ```

4. Look for `Reading Box feed service is running at http://127.0.0.1:4318` and the database location. **Leave this PowerShell window running and your PC awake and online for automatic polling.** You can close every Reading Box window and browser tab. Sleep, shutdown or stopping the service interrupts collection. On restart it checks overdue feeds. It can recover only entries the publisher still lists.

## Subscribe and read the results

1. Open a **second PowerShell window in the same source folder**. Subscribe to any of these publications. The first request imports the publisher’s current feed window. Using the same address again reuses the subscription.

   ```powershell
   npm.cmd run feeds -- subscribe "https://creativecommons.org/feed/"
   npm.cmd run feeds -- subscribe "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom"
   npm.cmd run feeds -- subscribe "https://www.oneusefulthing.org/feed"
   npm.cmd run feeds -- list
   ```

   For a newsletter hosted on a Substack subdomain, you can enter its publication hostname or home URL. Reading Box resolves the public `/feed` address. On a custom domain it can also follow an RSS or Atom alternate advertised by the home page. Use the direct feed address when discovery is unavailable. Each successful result includes the subscription ID, publication title, resolved URL and next check. A rejected first import reports its reason and you can retry the same address later.

2. Browse the newest deliveries. These commands select an article from the first page and show its available text.

   ```powershell
   $page = npm.cmd --silent run feeds -- articles | ConvertFrom-Json
   $page.items | Select-Object title, publication, published, coverage
   if ($page.items.Count -gt 0) { npm.cmd run feeds -- article $page.items[0].id }
   if ($page.nextCursor) { npm.cmd run feeds -- articles $page.nextCursor }
   ```

   The article includes a publisher link when supplied, a stable ID, dates, coverage, permission flags and an explanation if text is unavailable. A quiet USGS feed may have zero significant earthquakes in the past week. Actual counts, editions and publisher availability change.

3. Try a manual refresh. Use the ID returned by `list`. The saved cursor from step 2 also shows subsequent edits and arrivals.

   ```powershell
   $feeds = npm.cmd --silent run feeds -- list | ConvertFrom-Json
   $feedId = ($feeds.items | Where-Object active | Select-Object -First 1).id
   npm.cmd run feeds -- refresh $feedId
   npm.cmd run feeds -- changes $page.changesCursor
   ```

   `updated` means the publisher supplied a feed. `not_modified` means its validators still match. `cooldown` means Reading Box is waiting for the next permitted request. `failed` includes the reason, last success and retry time. The normal interval is 30 minutes plus up to 90 seconds of jitter. HTTP freshness, RSS time-to-live or a publisher’s retry instruction can lengthen it. Times on subscriptions are Unix milliseconds in UTC. To display the next scheduled check in your time zone, use `[DateTimeOffset]::FromUnixTimeMilliseconds([long]$feeds.items[0].nextPoll).LocalDateTime` for an active, unpaused subscription.

4. To stop collecting one feed, run `npm.cmd run feeds -- unsubscribe $feedId`. Its catalogued articles remain available through `articles` and `article`. Subscribing again reuses its identity and checks the current window when allowed. A publisher’s explicit withdrawal removes retained text and appears in the changes list.

5. To stop the **whole service**, press **Ctrl+C** in the first window. Restart with `npm.cmd run feeds:start` from the same source folder. Run `list` and `articles` in the second window to see your previous subscriptions and history. The automated restart test below also demonstrates a new delivery without waiting for a real publisher to post.

## Test the milestone

Run the following in the source folder. The automated tests use a disposable HTTP publisher and temporary SQLite databases. They can run alongside your personal service.

```powershell
npm.cmd run test:feeds
npm.cmd run test:unit
```

The feed fixtures record public metadata and feed structure sampled from the three example publications on 22 November 2026. The tests use short authored passages for copyrighted article bodies. They cover duplicate and anonymous entries, article edits, feed rollover, conditional requests, pagination during new arrivals, malformed and oversized feeds, rate limits, withdrawals, scope isolation and failures during writes. One test forcibly terminates a separate process with an edition still uncommitted. It restarts from the previous validator, collects a delivery on the background timer and checks for duplicates. Another launches the shipped service and CLI twice against the same directory.

For a live check using temporary storage, run the following with internet access. It reports each source, observation count and coverage, or the publisher or connection error. It never touches your personal catalog. The same optional check runs in the Windows Chrome CI job on PRs whose description contains `[public-feed-smoke]`. The required tests use controlled responses so a publisher outage does not block the reader checks.

```powershell
npm.cmd run test:feeds:live
```

To check your existing library, build and run the PWA separately. Reopen the **same browser profile, hostname and port** as your previous preview to see your saved articles, reading positions, theme and cached demo summaries. For example, if you used port 4173, run the following.

```powershell
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

The Windows CI jobs exercise the service and CLI on Windows and the reading interface in Edge and Chrome. CI also runs a phone viewport and the reading interface in Chrome on an Android 15 emulator. Physical Android use, Narrator and TalkBack need hands-on review. For USB testing, follow the device-loopback instructions. [Android setup](../README.md#install-or-test-offline) · [Library migration walkthrough](LOCAL_LIBRARY_UPGRADE.md)

## Storage, access and delivery

- SQLite lives at `%LOCALAPPDATA%\Reading Box\feeds\feeds.sqlite`. It is separate from the browser’s IndexedDB. For a backup, stop the service and copy its entire data directory to a private location. To test a backup, point a separate local service at a **copy** of that directory on another port. Keep the directory private because it contains the installation signing key. Browser reading state remains in the browser profile.
- The default port is `4318`. To choose another, set `$env:READING_BOX_PORT = '4320'` in both PowerShell windows before starting the commands. `READING_BOX_DATA_DIR` selects another private data directory outside the project. `READING_BOX_PROFILE` selects the CLI installation scope and defaults to `local`. These scopes protect API access per installation. A Windows account that can read the database can administer all of its scopes.
- The service binds to IPv4 loopback. The CLI proves local access by reading the on-disk signing key and sends a scoped bearer to the service. Every API route checks it. Service responses specify `Cache-Control: no-store`. Vite forwards same-origin `/api` requests locally, and the PWA excludes this path from the offline shell. A static demo needs only its built assets.
- Subscription commands use `GET/POST /api/subscriptions`, `DELETE /api/subscriptions/:id` and `POST /api/subscriptions/:id/refresh`. Read `GET /api/articles` for a fixed snapshot, `GET /api/articles/:id` for the current body and `GET /api/changes` for ordered upserts and withdrawals. Pages accept `limit` (1–100, default 50) and an opaque `cursor`. Follow the snapshot’s `nextCursor` until empty, then use its `changesCursor`. Keep the last change page’s `nextCursor` for the next check. All cursors belong to the issuing installation and collection.
- Stable publisher IDs and unambiguous permalinks are scoped to their feed. With neither, an identical observation is recognised by its fingerprint. An edited, unidentifiable item can appear separately. Publication date controls ordering with first receipt as the fallback. Rollover, unsubscribe and outages preserve observed articles. `possibleGapSince` marks a known break in observation. The service cannot reconstruct entries that came and went before a successful check.
- The poller has a bounded queue, one outbound request at a time and an expiring database lease. A successful transaction commits article revisions, journal entries, validators and the next due time together. A failed refresh keeps the last good edition. Persistent 404s, removal, denied access or a robots restriction pause automatic checks. After the displayed retry time, `refresh` can resume a repaired feed. If a publisher supplies an unrelated replacement URL, subscribe to it and unsubscribe the retired source. Permanent redirects keep the existing identity.

## Publisher text and network limits

Reading Box requests the public syndication endpoint anonymously, honours robots rules and checks public IP addresses on each outbound connection and redirect. It keeps TLS hostname verification and restricts requests to standard HTTP/HTTPS ports. The connection uses direct outbound DNS and HTTP(S). A network that requires a mandatory outbound proxy can report `unreachable`. Each fetch has a 15-second deadline, at most five redirects and a 4 MiB limit on both compressed and decoded feed bytes. DTDs are rejected. The parser reads markup inertly and stores only plain paragraphs of permitted text.

Unknown reuse rights result in metadata and a publisher handoff. Explicit CC BY 4.0 or CC0 licence metadata can permit basic text. USGS significant-earthquake summaries use the narrowly scoped public USGS feed policy. Images and other embeds are excluded. A preview is labelled `excerpt`. Uncertain completeness is `unverified`, and missing text is `missing`. The `reason` and `permissions` accompany the coverage. A Substack content field alone does not establish reuse permission or a complete article. [USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) · [Substack public feeds](https://support.substack.com/hc/en-us/articles/360038239391-Is-there-an-RSS-feed-for-my-publication)

A complete basic Original requires a licence and an exact, reviewed match to the plain-text original, including its final passage. An optional private `verified-originals.json` in the service data directory contains an array of objects with `feed`, `article` and `sha256` fields. The digest covers UTF-8 paragraphs joined by two newlines. Use it only after comparing the entire licensed original. Removing a review downgrades the stored completeness on restart. Automated tests include an authored original and its edited edition. The service caps an individual text at 65,536 characters and retained text at 64 MiB per installation. It preserves metadata and explains when the text cache is full. The basic service does not fetch linked article pages or generate live summaries.

The service uses Node’s built-in SQLite driver. Fastify, parse5, ipaddr.js and robots-parser use the MIT licence. The saxes XML parser uses ISC. Publisher uptime, Windows sleep and available local disk space affect collection. No hosting, account or AI subscription is needed for this milestone.
