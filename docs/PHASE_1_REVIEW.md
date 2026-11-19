# Phase 1 review

## What to try

The demo starts with eight unread articles. On desktop, the reading desk previews the first headline without opening it or requesting a summary. On a phone, tap a row to start with Essence. The book shortcut on a row opens its Original directly.

| Fixture                                | What it exercises                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| The night train that carries a library | All three mock depths, long formatted Original, inline link, final paragraph, resume position and a dedicated discussion destination |
| A bench for the long way home          | Same-post fallback when the publisher supplied only an article URL                                                                   |
| A field guide to the blue hour         | Accessible figure, caption, list and explicitly disabled comments                                                                    |
| The paper that remembers a garden      | Plain-text newsletter, received date, Message-ID and no web destination                                                              |
| Drawing a map that moves with the tide | Excerpt-only summary and copying, explicit explanation when deeper detail is unsupported                                             |
| Inside the Saturday repair room        | A second complete publication with a dedicated discussion                                                                            |
| Listening for the shape of a room      | Missing body, publisher handoff and unavailable summary                                                                              |
| An index for the words we inherit      | Publication attribution when the byline is missing                                                                                   |

## Acceptance coverage

| Milestone            | Evidence                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed and navigate    | Unit tests check source identity, metadata and coverage. Browser tests check all eight rows in date order, the first-open state and all four collections after reload.                                                                                                                                                                            |
| Read progressively   | Unit tests verify the one-sentence, one-paragraph and three-paragraph fixtures against their body hashes. Browser tests exercise all depths, attribution, keyboard and touch, shortcuts, text selection, inline links, retry, cached reopening and the visible request counter.                                                                   |
| Copy and resume      | Browser tests compare clipboard text with the complete source and the visible summary. They exercise selected-text fallback, excerpt labelling, independent save/archive, list focus and scroll, article scroll and restored depth. Unit tests exercise concurrent updates, source edits, stale requests and permission rechecks.                 |
| Visit the discussion | Browser tests locate the collapsed disclosure after the final paragraph, expand with keyboard and touch, follow the matching demo post/discussion links and exercise the three fallback cases.                                                                                                                                                    |
| Use the PWA          | Browser tests exercise production service-worker precaching, offline reload, an uncached mock stage while offline, Web App Manifest installability, local storage failure, share fallback, visible keyboard focus, reflow at 200% text and accessible names and reading order. Automated accessibility scans cover the inbox and all four depths. |

On 19 November 2026 the real post and its publisher-provided discussion URL both returned HTTP 200 with their respective URLs intact. This was a destination check. Demo articles use their own fictional counterparts. [Post](https://newsletter.pragmaticengineer.com/p/how-software-engineering-is-changing) · [Discussion](https://newsletter.pragmaticengineer.com/p/how-software-engineering-is-changing/comments)

## Device checks

Local verification used Linux with Playwright Chromium 159.0.8154.6, a 1366 × 830 desktop viewport and a touch-enabled 412 × 839 Pixel 7 viewport. The shared browser also opened the running demo. Automated accessibility checks cover semantics, labels, contrast and document order. Physical Android and Windows assistive-technology sessions were unavailable in the workspace.

For a device review, record the OS and browser versions alongside each result.

| Device check            | Remaining hands-on verification                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android Chrome          | Install over trusted HTTPS or USB loopback, relaunch offline, long-press to select text, paste into another app, open the share sheet and publisher destination, then return with Back. Use TalkBack to read the byline, selected depth, summary/source label and discussion disclosure. |
| Windows Edge and Chrome | Install and launch from the Start menu, paste into another application, open the publisher page in the normal browser and return, then reopen offline. Use Narrator to check focus, depth changes and the disclosure at 200% text size.                                                  |

The local demo has no live subscription service, paid AI or cross-device sync. Its copy and publisher controls reflect the content and links supplied for each fixture. [Setup and deferred features](../README.md) · [Milestone plan](../IMPLEMENTATION_PLAN.md)
