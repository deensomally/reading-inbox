# Portable subscriptions on Windows

1. Stop the reader and service with **Ctrl+C**. Before the first Milestone 5 start, back up the stopped service data directory. Its default location is `%LOCALAPPDATA%\Reading Box\feeds`. Keep the backup private. Milestone 5 adds a table for OPML outlines and upgrades SQLite from schema 2 to 3. Milestone 4 requires a pre-upgrade copy for rollback. [Service backup instructions](FAITHFUL_ORIGINALS.md)
2. In PowerShell in your existing clone, use Node.js 24 and run the following.

   ```powershell
   git fetch origin
   git switch feature/phase-2-portable-subscriptions
   npm.cmd ci
   npm.cmd run reading-box
   ```

3. Open the printed reader address in your usual paired profile, with the same hostname, port and service data directory. Open **Manage subscriptions**. **Import OPML** opens the local file picker. The paired service checks new public feed addresses, including publisher discovery and redirects. The preview lists each result. Review the names, addresses, folders and counts, then choose **Confirm import** or **Cancel preview**.
4. Each confirmed entry commits independently. If a publisher fails during import, successful subscriptions stay in the library. **Retry remaining entries** retries unfinished work. If you close the window or restart the service, select the same file again. The next preview recognises completed entries and known aliases. Publisher availability and access can change between preview and confirmation.
5. Choose **Export OPML** and save `reading-box-subscriptions.opml`. Open it in another OPML-capable reader, or preview it again in Reading Box. An unchanged re-import reports zero new subscriptions. Check an existing saved or archived article and its reading position in your usual browser profile.

Import and export use the paired local service. Keep it running for scheduled feed polling even while the reader is closed. The fictional demo remains available separately.

## Example acceptance file

Save this as UTF-8 in Notepad with the filename `subscriptions.opml`. The two public feeds depend on their publishers being reachable. If you already subscribe to either, the preview will identify the duplicate.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My publications</title></head>
  <body>
    <outline text="Culture &amp; science">
      <outline text="Café">
        <outline type="rss" text="Creative Commons" xmlUrl="https://creativecommons.org/feed/" htmlUrl="https://creativecommons.org/"/>
        <outline type="rss" text="Bits from Debian" xmlUrl="https://bits.debian.org/feeds/atom.xml"/>
        <outline type="rss" text="Debian again" xmlUrl="https://bits.debian.org/feeds/atom.xml"/>
      </outline>
    </outline>
    <outline text="Missing address" type="rss"/>
    <outline text="Local address" xmlUrl="http://localhost/feed"/>
    <outline text="Bookmark" type="link" url="https://example.org/"/>
  </body>
</opml>
```

## What travels in the file

The export contains active feed URLs, publication labels, their folder paths and optional public website URLs. A manually added feed uses its publisher title. Imported outlines retain the first accepted label for each feed and folder. A feed listed in two folders has two exported outlines and one polling subscription. Empty folders and skipped outlines are omitted. Reading history, articles, saved flags and pairing material stay in their own stores.

The importer accepts OPML 2.0 up to 1 MiB, 2,048 XML elements and 16 folder levels. It rejects malformed XML and document type or entity declarations. Standard XML escapes such as `&amp;` are supported. The service applies its public URL, DNS, redirect, robots and response limits to publisher checks. Protected addresses are rejected. A legacy address that fails the public URL check blocks export until it is replaced or removed.

## Repeat the tests

```powershell
npm.cmd run test:unit
npx.cmd playwright install chromium
npx.cmd playwright test tests/e2e/opml.spec.ts
```

The browser regression selects a local fixture, cancels the first preview, confirms a second preview, retries a failed feed, downloads the file and compares the hierarchy and URLs using the browser’s independent XML parser. The Android emulator exercises the same import and validates the export response. The desktop test also verifies the downloaded file itself.
