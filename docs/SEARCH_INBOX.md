# Search and organise the inbox

## Try it on Windows

1. Stop a running reader with **Ctrl+C**. In PowerShell, from your existing clone with Node.js 24, run:

   ```powershell
   git fetch origin
   git switch feature/phase-2-search-inbox
   git pull --ff-only origin feature/phase-2-search-inbox
   npm.cmd ci
   npm.cmd run reading-box
   ```

2. Open the **new address printed by the terminal** in your usual Brave, Chrome or Edge profile. At the default port this is `http://localhost:4173/api/open.html`. Use the same hostname and port as your existing library. You can leave an Original open in another tab. The launch page checks the worker and takes you to the subscriptions inbox when the downloaded edition is ready. Your pairing, subscriptions, saved items, positions and appearance belong to that profile. The first open indexes the articles already on this device. On reconnection, an older subscription library fetches publisher topics in a one-time paged replay.
3. In **Subscriptions → Inbox**, check the default newest-first list. Search for a headline, author, publication, publisher topic or distinctive word from a retained article. A search or filter in Inbox includes archived matches and shows **Across your library**. Unread, Saved and Archive narrow searches to their respective collections. Search matches every word entered as a word prefix and ignores case and Latin accents.
4. Open **Filters**. Choose a publication, topic (including **Untagged**), and reading status. Combine **Saved only** and **Archived only** to see their overlap. Publication and topic options show prospective counts with the other filters applied. **Show articles** returns to the matching rows. You can also change the sort directly above **Filters**. Try **Longest first** there, reopen Filters and check the selection. With grouping off, both length sorts put **Verified · N words** before **Length unknown**. The fictional demo includes several verified lengths, an excerpt and a missing Original for a repeatable check.
5. Enable **Group by publication**. Every matching publication has a heading and a total. The first group opens with up to 40 results. Collapse it and the next heading moves up immediately. Use the chevron or press **Space** or **Enter** on a heading. Each open group has its own **Show more** button. Open an article in a smaller group, then use Back and check the disclosures and focused article.
6. Open a result from farther down the list. Use **Back to list**, the browser Back button or **Alt+Left**. Check the focused row, scroll position, search, filters and sorting. If opening an unread result makes it leave the current view, focus returns to the collection heading. **Clear all filters** restores the chronological unarchived Inbox.
7. Load the production reader once, stop the service with **Ctrl+C**, then reopen the reader in the same browser profile. Search for retained text and repeat the filter checks. Start the service again with `npm.cmd run reading-box`. The service must remain running to poll feeds while the reader is closed. The fictional demo has its own searchable library.

## Updating an installed reader

Milestone 5 cached the production shell and registered a prompt-mode worker without an update action. An ordinary reload could still be served by the previous active worker while the newly downloaded worker waited for open tabs. The printed launch address uses a path the older worker handed to the network. Open it once after starting the updated local service. It activates the downloaded edition and opens the inbox on the same origin. Existing tabs stay on their current article. Reopen or reload those tabs when ready. If an older tab writes an article during the transition, Reading Box rebuilds that article’s local search record. It excludes obsolete text matches until the repair completes.

The updated reader checks on launch, on return to the foreground, on reconnection and hourly while visible. **Update Reading Box** appears in the list when a new edition is ready. Choose it when convenient. The reader does not reload an open Original. If the service is stopped, the installed reader and its locally retained data still open offline at the usual reader address. The first transition from the old worker using the printed link needs the running service.

## Why article length can be unknown

A verified count uses the words in a complete Original retained with publisher permission. An entry can have a searchable headline, or even a searchable excerpt, while its full length remains unknown. Open **Original** for the per-article reason and publisher link. Opening an eligible page while connected asks the service to check that edition; a verified result updates its count automatically.

The captured Debian election edition matches all five reviewed paragraphs. The USGS Atom fixture supplies a permitted summary. The Creative Commons RSS and Substack fixtures include supplied text without a reviewed feed reuse grant, so Reading Box retains their metadata. A separately reviewed publisher page may qualify under its own terms. Other entries supply no readable body or explicitly limit storage or access. A temporary eligible-page retrieval failure keeps the last permitted edition and offers a retry.

## Local index and updates

The browser keeps a compact list projection and a multi-entry IndexedDB index of distinct word tokens per article. A delivery replaces both in the transaction that commits the article and its checkpoint. The index uses publisher metadata and text permitted for display and retention. A withdrawal or permission loss removes body terms and the known length on receipt. Retained metadata still identifies the article. An offline device receives rights changes when it next connects.

The browser reads metadata and reading-state membership into memory when the library opens or changes. Each text query asks the local token index for matching IDs. Filters reuse the current postings. The browser intersects the smallest sets first and uses the chosen order to fill the requested page. Search input stays on the device. Length sorting counts words in the retained, verified complete Original. Excerpts, unverified text and missing bodies have unknown length. Dates use the publication instant or the first-received instant. Ties use the stable article ID.

IndexedDB schema 4 builds the search projection in transactions of 64 articles. Each batch commits its progress with its index entries. Closing the reader during a rebuild resumes from the last committed batch. The service SQLite schema is unchanged.

## Repeat the performance check

```powershell
npx.cmd playwright install chromium
$env:READER_BROWSER_CHANNEL = 'msedge'
npx.cmd playwright test tests/e2e/search.spec.ts --project=desktop --workers=1
```

Use `chrome` for the Chrome run. The test seeds an isolated browser profile with 10,000 synthetic articles, then opens it offline and waits for the production index build. Each of 11 input events is timed through the rendered result count and the following paint opportunity. Queries range from 0 to 10,000 matches and include title, body and multi-word prefixes. The test also advances an 80-row list by 36 pixels per animation frame and reports the 95th-percentile frame interval and frames over 50 ms. Look for `INBOX_BENCHMARK` in the test output.

The 300 ms target applies to a warm first page. Index construction, publisher polling and tab startup are outside this measurement. Synthetic articles have short, repetitive bodies. Longer originals, larger vocabularies, other browser workloads and physical Android devices can produce different results. The Android job runs Chrome in an emulator. [Milestone 6 test results](https://github.com/deensomally/reading-inbox/pull/10)
