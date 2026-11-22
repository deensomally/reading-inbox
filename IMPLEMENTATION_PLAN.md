# Reading Box development plan

**Phase 0 · 19 November 2026 · Phased approach agreed. Phase 1 awaits document review and separate authorisation.**

The four-stage reader is the first delivery priority on Android and Windows. A reader should be able to move through all four stages, recognise whose words they are reading, copy the original, reach its publisher’s discussion, and return to the same inbox position. Use labelled fictitious content and a deterministic summary provider. The demo requires no account, paid API or public deployment. [Architecture and feasibility](ARCHITECTURE.md) · [Agreed product scope](PRODUCT_SPEC.md)

## Proposed mobile and desktop layouts

On a phone, selecting a row opens a reader with its own Back action. The two columns below represent consecutive screens.

```text
Inbox     Unread     Saved     Archive     →     Back to inbox          Save
Search                  Sort and filter          Original headline
                                                 Author · Publication · Date
Article headline                                 Essence · AI summary
Publication · Byline · Date · Unread             One sentence
                                                 More detail    Read original
Article headline                                 Copy summary         Archive
Publication · Byline · Date · Skimmed
```

A wide Windows window keeps the list beside the reader. A narrow window uses the phone layout.

```text
Collections    Inbox                         Original
Inbox          Search      Sort and filter   Original headline · Byline
Unread         Headline · Date · Status      Publication · Date
                                             Formatted article, links, figures
Saved          Headline · Date · Status      Final paragraph
Archive                                      Copy full article text
                                             ▸ Reader discussion
```

Both layouts keep the source headline, byline and publication visible at every depth. Show **AI summary** beside each generated stage’s name and **Original** above the publisher’s text. Use a readable line length on wide screens and let controls wrap on narrow ones. Share and Open on publisher site use the original URL when supplied. Back restores focus and scroll to the originating row. Deeper summaries offer Less detail. The complete Original ends with a collapsed Reader discussion. Search and filters arrive in Phase 2. Recommended rows gain a label, rationale and feedback in Phase 3.

## Phase 1 — a complete local reading journey

| Build order | Acceptance at the milestone review |
| --- | --- |
| 1. Seed the inbox through the article model | Use labelled fictitious deliveries from multiple publications. Include an RSS-style entry with a GUID, byline, formatted body and publisher links, and a plain-text newsletter with a Message-ID and no public URL. Exercise a complete body, a preview and missing content. Both delivery formats use the same reader and versioned local store. Every subscribed article appears newest first in a text row without a thumbnail. Inbox, Unread, Saved and Archive work after reload. |
| 2. Connect reader depth to the mock provider | First ordinary open displays exactly one sentence. More detail gives one paragraph, then three substantive paragraphs, then the formatted Original. The reader can go back, start again or skip from any summary to Original. A request counter stays at zero during inbox refresh and direct entry to Original, and advances only for a newly requested, uncached summary. Selecting text, following an inline link or scrolling never advances depth. |
| 3. Make copying and state observable | One user action copies the complete permitted body, including its final paragraph, independently of the visible summary. Copy summary returns only that depth. Preview copy is labelled accurately. Viewing a summary sets Skimmed. Viewing a full original sets Original opened. Save and archive are independent local writes. Updating a fixture’s body keeps its article ID and both flags while invalidating the old summary. Restore last stage and scroll on reopen and restore inbox scroll on Back. |
| 4. Open the publisher’s discussion | Only the complete Original contains Reader discussion after the final paragraph. Verify it starts collapsed and expands by touch or keyboard to reveal View original comments. Check the external destination against a real post/discussion URL pair. Fictional articles use matching, labelled demo destinations for offline tests. Exercise the same-post fallback, disabled comments and an email with no web destination. |
| 5. Review the reader on both platforms | Demonstrate all four stages with touch and keyboard, including a cached reopen and direct Original. Check that the byline stays attached to the article, AI labels are visible and announced, the stage controls remain reachable at 200% text size, and the reading order survives reflow. Exercise loading, empty and offline states, missing text, clipboard denial and summary failure. Deliver an installable shell, unit and end-to-end tests and local setup instructions. Record the device checks below. |

## Subsequent milestones

| Phase | Deliverable | Acceptance at review |
| --- | --- | --- |
| **2 — Live subscriptions and reliable reading** | Add/manage public RSS/Atom subscriptions, incremental polling, deduplication, permitted parsing and honest partial-content fallbacks. Add OPML import/export, saved-state export, search over collected titles/metadata and available local text, oldest/newest and known-length sorting, publication/topic/unread filters, publication grouping, bulk archive and archive by age. | Replaying or reordering a feed never duplicates an entry. Editing its body preserves flags and invalidates its old summary. Polling ingests every observed subscribed entry, survives a failed refresh and retains entries that roll off the feed. Round-trip OPML and exported state. Compare a permitted full source against the rendered and copied body. A teaser remains an excerpt even if long. Verify a real discussion handoff and the same-article fallback. |
| **2 — Optional live AI** | After separate provider and budget approval, connect the server-side provider to Essence, Brief and Understanding. Explain precisely what leaves the device and offer the mock/local mode. | Source, stage, model and prompt changes produce the appropriate cache miss. Repeated or concurrent identical requests share a result. Assess the three depths against the source for accuracy, increasing detail, uncertainty and valid passage links. Simulate rate limits, timeouts and spend exhaustion without blocking Original. |
| **3a — Optional recommendations** | Insert related articles with a visible reason, More like this, Less like this and Follow author/publication. Keep subscription chronology intact. Unsaved suggestions may expire. | On a long, eligible list, measure the approximate 20% default by visible placements. Exercise 0%, 50%, sparse candidates and the proposed daily cap. Turning suggestions off restores the same subscription sequence. Suggestions never inflate unread totals, remove subscription rows or expire a saved item. |
| **3b — Opt-in sync** | Implement only after choosing hosting, identity and retention. Sync subscriptions, save/archive flags, reading progress and eligible cached summaries while preserving per-device positions. Local-only reading stays available. | An Android save and an offline Windows archive of the same item both survive reconnect. Retry operations and confirm one result, preserve deletions, isolate two users’ records, and verify export and deletion. |
| **4 — Optional AI insights from comments** | In the Original’s Reader discussion section, accept legitimately supplied comments, disclose the selected text sent for processing, and offer Summarise discussion. A future authorised source adapter can supply the same input. | With only a publisher link, no insights action is offered. With an authorised sample, show the count and coverage, cite supplied comments by link or input number, and surface substantive corrections, counterarguments, evidence, author replies, resources and questions where present. No findings are attributed to unseen comments. |

## Verification

Phase 1 should supply a lockfile and the following verification scripts. Use `npm run dev` for the interactive demo after dependency installation. The end-to-end suite should start the production preview itself.

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest checks both delivery formats against the [article data model](ARCHITECTURE.md#article-data-model), including missing bylines, optional URLs, changed source revisions, cache invalidation and independent save/archive flags. Playwright checks the four stages, source and AI attribution, clipboard contents including the final paragraph, return position, offline persistence and discussion placement. Use local fixtures in CI so publisher outages and API costs cannot change the result. If a change adapts third-party code, review the upstream revision, applicable licence and required notices along with that change.

Run the built app on current **Android Chrome** and **Windows Edge and Chrome** using trusted HTTPS or device loopback. Record OS/browser versions. Install, relaunch, copy and paste into another app, share or copy a link, open the publisher in the normal browser, and verify Back and offline reopen after one online load. Also check touch selection, narrow-window reflow, 200% text scaling, visible keyboard focus, contrast, and reading order with Android TalkBack and Windows Narrator. Report any unavailable device or failed check explicitly. Viewport emulation alone establishes layout coverage.

## Decisions and approval boundary

| When | Decision requested |
| --- | --- |
| **After this document review** | Give a separate go-ahead to implement the fixture-backed four-stage reader. The local-first PWA direction and phased approach are agreed. |
| **Before live ingestion or model use** | Confirm permitted sources and uses, criteria for a complete body and passage citations, and whether a self-hosted service can poll while devices are closed. Separately choose the model, billing owner, retention terms and hard spending limit before paid calls. |
| **Before discovery or sync** | Approve the recommendation catalogue, trial ratio and cap. Choose self-hosted or managed sync/auth after reviewing operations, privacy and cost. Local-only plus export remains available with either choice. |
| **If pursuing paid mail or native discussions** | Validate rights, completeness and consent for a user-selected email or mailbox integration. Native discussion access requires a stable authorised source with documented coverage. The publisher handoff and reader-supplied comment path work independently of those decisions. |

The specification also leaves alternate summary modes, relevance sorting, archive-on-completion, text-to-speech, annotations, offline article caches and source comparisons for later product decisions.
