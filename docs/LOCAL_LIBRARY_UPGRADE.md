# Test the local library upgrade on Windows

Milestone 1 keeps the existing reading interface. It upgrades the library on this device and indexes the inbox without loading every article body. The most useful check is to reopen an article you previously saved, revisit a cached depth and find your place in the Original.

## Run the review build

1. Install Git for Windows and Node.js 22.12 or newer. Open PowerShell in a folder where you want a new copy of the review build.
2. Download the branch and build it. This creates a separate source folder. Your reading library lives in your browser profile.

   ```powershell
   git clone --branch feature/phase-2-local-library https://github.com/deensomally/reading-inbox.git reading-box-m1
   cd reading-box-m1
   npm.cmd ci
   npm.cmd run build
   ```

3. If a previous preview is running, stop its terminal with **Ctrl+C**. Start the new preview on the same port.

   ```powershell
   npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
   ```

4. For a fresh trial, open `http://localhost:4173` in Edge or Chrome. **For an existing library, use the same browser profile, address and port as before.** If you used `http://localhost:5173`, substitute `5173` in step 3 and reopen that address. If you used `127.0.0.1`, reopen that hostname. A change of origin or browser profile opens a separate library.
5. Leave the terminal running for the first online load. An installed PWA may initially show the earlier build while it downloads the update. Close all Reading Box tabs and installed windows, then reopen the same address. If a library update is waiting for an older window, closing that window lets the update continue automatically. Keep your browser’s site data throughout.

To use the prebuilt review instead, download **reading-box-preview** from this PR’s Windows Chrome Actions job and extract it. From the folder containing `index.html`, run `py -m http.server 4173 --bind 127.0.0.1` if you have Python installed, then follow steps 4–5.

## Check your reading data

1. In your Phase 1 reader before upgrading, choose **Dark**, open **The night train that carries a library**, use **More detail** through Understanding, then **Read original**. Scroll down, save and archive the article. Return to **Saved**. Note the mock request count under **Fictional demo**.
2. After upgrading, look for the article in both **Saved** and **Archive**. Reopen its previous depth or bookmark URL. Check its Original position, cached summary text and the request count after revisiting the same depth. Confirm your appearance selection, the independent save/archive controls and the collapsed Reader discussion beneath the full article.
3. After one online load and a reload, disconnect the network and reopen the PWA. Try a complete Original, the excerpt in **Drawing a map that moves with the tide**, and the publisher-only handoff in **Listening for the shape of a room**. Reconnect when finished. A new browser profile starts with all eight fictional articles.

### Run the upgrade test in an isolated browser profile

From the review source folder, run the following commands. The test builds the actual merged Phase 1 reader from Git history, serves both releases on a temporary loopback port, and switches between them with the browser profile intact. A full Git clone includes the required revision. The test uses the Windows `tar.exe` included with current Windows installations.

```powershell
npx.cmd playwright install chromium
npm.cmd run test:unit
npm.cmd run test:e2e -- tests/e2e/upgrade.spec.ts --project=desktop
```

The upgrade test compares all five original IndexedDB stores, including all eight articles and the cached mock results. It exercises an old tab, a waiting service worker, independent per-stage positions, the appearance before React mounts, offline reopen and a rollback to the earlier reader. The database keeps its historical name, `reading-inbox`. Schema v2 adds a compact article list and a temporary checkpoint for batches of 64 articles. Each batch commits with its checkpoint, so closing the app mid-upgrade is recoverable. Existing article IDs, body hashes, routes and summary keys keep their original values.

## RSS service and device coverage

Milestone 1 runs entirely on your PC with fictional articles. The RSS/Atom service arrives in milestone 2, followed by subscription controls and a real-feed walkthrough in milestone 3. **Automatic polling will require the backend service to stay running on an awake, connected PC, even when every reading window is closed.** Both the reader and the planned service can be tested locally without purchasing hosting or using a paid AI account.

The PR checks run the upgrade in Windows Edge and Chrome, a phone-sized Chromium browser and Chrome on an Android 15 emulator. A physical Android phone, TalkBack, Narrator and physical-device app switching still need hands-on review. For a USB-connected Android phone, the [installation guide](../README.md#install-or-test-offline) explains how to use the same PC preview over device loopback.
