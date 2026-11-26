# Archive and portable library data

Open **Library actions** above the article list. **Archive articles** uses the current collection, search and filters. **Library backup** covers the entire active library, including archived and unsaved records. The fictional demo and Subscriptions each have their own file. **Manage subscriptions → OPML** remains the place to transfer feed subscriptions and folders.

## Run the review edition on Windows

1. Use your existing clone and Node.js 24. Stop Reading Box with **Ctrl+C**. For an existing installation, copy the stopped service directory before the first launch. Run these commands in PowerShell in the repository directory.

   ```powershell
   $feedDir = if ($env:READING_BOX_DATA_DIR) { $env:READING_BOX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Reading Box\feeds' }
   if (Test-Path -LiteralPath $feedDir) {
     $snapshot = "$feedDir.pre-m7-$(Get-Date -Format yyyyMMdd-HHmmss-fff)"
     Copy-Item -LiteralPath $feedDir -Destination $snapshot -Recurse -ErrorAction Stop
     Get-Item -LiteralPath (Join-Path $snapshot 'feeds.sqlite') -ErrorAction Stop
   }
   git fetch origin
   git switch feature/phase-2-archive-portability
   git pull --ff-only origin feature/phase-2-archive-portability
   npm.cmd ci
   npm.cmd run reading-box
   ```

2. Open the printed launch address, usually `http://localhost:4173/api/open.html`, in your usual Brave, Edge or Chrome profile. Keep your existing hostname, port and service directory. Wait for **Check for deliveries** in Subscriptions to finish before making a portable backup of an upgraded library. A resumable, one-time delivery replay supplies stable publisher identifiers. An upgraded library opened entirely offline can still read, search and archive immediately. Its first subscriptions export needs that replay to finish. Later exports work offline.
3. **Keep the backend running on an awake PC for automatic polling**, even when the reader is closed. Stop with **Ctrl+C**. Restart with `npm.cmd run reading-box`. Offline reading, search and archiving work in the installed, previously loaded reader.
4. For a fresh service profile, issue `npm.cmd run feeds -- pair m7-review` in a second terminal. In a fresh browser profile choose **Connect browser** and enter its code. A separate named service profile keeps the primary browser paired. Add the same feeds with OPML when testing identity across service profiles. [Pairing and USB setup](RSS_OWNER_PREVIEW.md)

The service upgrade from SQLite schema 3 to 4 records stable source references. IndexedDB upgrades from schema 4 to 5 in the existing profile. Keep the service directory snapshot private because it contains signing and pairing material. To test an older build, use a separate browser profile and a working copy of the **pre-upgrade** service snapshot. An older service cannot use the upgraded database. A rollback snapshot reflects the date it was taken. Recheck any later publisher withdrawals. Browser-only progress lives in IndexedDB independently of that directory.

## Windows acceptance walkthrough

1. In **Inbox**, search for a publication with more than one page of results and apply a topic or reading-status filter. Open **Library actions → Archive articles**. Select individual matches, choose **Show more matches**, and check that the total retains your earlier selections. Then try **Select all … matching articles**. The count includes every eligible match, including items past the visible page. Already archived items are excluded.
2. Choose **Review archive**. Verify the count and scope, then choose **Edit selection** to cancel the confirmation. Review again and, if available, let a new article arrive in another tab. Confirm. Only the IDs in the displayed review move. A competing archive of part of that set asks for a fresh review. Check the **Archive** list and search. A previously saved item should appear in both **Saved** and **Archive**, at the same reading depth and position.
3. Reload. Choose **Library actions → Undo last bulk archive**. The most recent batch can be undone after reopening. Articles manually restored or rearchived since that batch retain the later choice. Repeat the exercise using **Older than a date**. The dialog displays the device time zone. An article at midnight on that date stays in place. A missing publication date uses first receipt. A record without either usable date is left out.
4. In **Fictional demo**, save **The night train that carries a library**, read its Essence and Original, scroll and archive it. Open another article without saving, and save the tide excerpt. Select **Library backup → Export library JSON**. Inspect the file locally in a text editor. Check the train’s two flags, position, cached Essence and final passage. The unsaved article has reading state. The restricted excerpt has an omission reason.
5. In a fresh browser profile, open the fictional demo. Choose the JSON under **Library file → Preview restore**. Review changes and omissions. Close the preview to check that the records stayed unchanged. Preview again and **Confirm restore**. Check **Saved**, **Archive**, the unsaved article’s depth and the Original’s position. Import again and verify that the list counts stay the same. In a populated profile, change a saved flag or reading position after export, then verify that the preview identifies and keeps the newer local value.
6. Repeat in **Subscriptions** with the subscriptions JSON. Pair the destination first to restore into its service library. An unpaired offline profile has a separate local library. You can restore there immediately and use the same file again in the paired library. With the service stopped, restore reading state and search a retained article. Restart the service, check for deliveries, open its Original and verify its current rights label. Revisit a grouped result with Back and check disclosure, scroll and focus. Check the existing appearance preference and OPML controls.

## What travels in JSON

Version 1 includes stable article and source references, title, author and publication, dates, edition coverage and revision, available licence information, independent flags, reading depth and per-stage positions. For current subscriptions the cross-profile references hash the observed source and item identity. The service’s article UUID also allows the same collector to recognise older rows. Conflicting identities are skipped for review. Subscription URLs, publisher links, pairing keys, session identifiers and service credentials stay outside this format. The file contains personal reading history. Keep it somewhere private.

Saved text needs an explicit text export grant for the edition. Each cached summary also needs its own export grant. Six project-authored complete demo editions allow both. The tide excerpt demonstrates a restricted edition. Current live publisher rules grant no JSON text or summary export, even for reviewed articles that allow reading and copying. Each record explains omitted content. Keep using OPML to move feeds and the running collector to retrieve currently permitted originals.

Restore validates the version, library and record shapes, identifies matches and shows proposed changes before writing. Saved, archived, reading progress and individual positions are compared separately. Newer local choices survive. Conflicting local edits with equal or unknown times also survive. The reader checks the paired collector on preview and confirmation when reachable, and checks the local edition and withdrawals again inside the write transaction. The file cannot grant itself content rights. An unverified edition can restore metadata and state only. If the reviewed data changes during confirmation, the transaction rolls back and requests another preview. Version 1 accepts up to 100,000 records and 128 MiB per file.

## RSS-only release acceptance checklist

**Owner sign-off pending for Milestone 7.** The CI jobs exercise Windows Chrome and Edge, installed Windows Brave upgrading a populated profile, a phone-sized Chromium browser, and Chrome on an Android 15 emulator. Automated accessibility scans cover both themes, the archive and backup dialogs and the reader. The emulator inspects the exported file contents. Physical file-picking, perceived scrolling and assistive speech require hands-on review.

Record the device, browser version, OS, date and outcome next to each item. For a physical Android using a trusted USB connection, run `adb reverse tcp:4173 tcp:4173` and open the printed localhost address in Chrome. Use a separate pairing profile. Remove the tunnel afterward with `adb reverse --remove tcp:4173`.

| Physical check                                                                                                                                                       | Windows with Narrator and keyboard | Android Chrome with TalkBack and touch |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| Install and relaunch the PWA, update from the printed launcher while an Original is open, and reopen offline with pairing and progress intact                        | Pending                            | Pending                                |
| Switch System, Light and Dark, set 200% text or zoom and narrow the window. Read all labels, counts and confirmation actions without horizontal scrolling            | Pending                            | Pending                                |
| Navigate selection, date input, file picker, preview, confirmation, cancel and Undo. Verify accessible names, announced counts, focus order and return focus         | Pending                            | Pending                                |
| Filter and group results, open a long Original, return with Back and check focus and scroll. Scroll a large library and note visible stalls, device and refresh rate | Pending                            | Pending                                |
| Paste a permitted Original through its final passage with attribution, open the publisher or discussion handoff, and exercise the share sheet or copy fallback       | Pending                            | Pending                                |
| Save a JSON file, pick it again, restore in a second profile and inspect the independent flags and omissions. Repeat offline after stopping the service              | Pending                            | Pending                                |

**Two open release questions**

- **Physical Android scrolling.** Record a trace on a handset with a representative large library alongside the automated 10,000-article warm search and scrolling measurements. Emulator frame timings cannot establish handset smoothness. [Benchmark method](SEARCH_INBOX.md#repeat-the-performance-check)
- **Availability of permitted text.** Review the proportion of collected entries with a retained Original, excerpt and publisher-only handoff across the intended subscriptions before introducing live summaries. Display, copying, export and processing each require their respective permissions. A verified page can supply an Original even when its feed lacks a reuse grant. Record the coverage distribution by source and edition and include publisher-only articles in the denominator. [Publisher coverage examples](SEARCH_INBOX.md#why-article-length-can-be-unknown)
