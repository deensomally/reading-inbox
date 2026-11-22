# Reading Box — Product Specification (V1)

**Status:** Agreed product direction; technical implementation to be designed with Codex.  
**Target:** Open-source, cross-device reading application, initially optimised for Android and Windows PC.  
**Product name:** Reading Box.
**Source of requirements:** Product discussion with project owner, November 2026.

## 1. Product vision

A calm, text-first reading inbox for publications the user follows, with a small, optional allocation for relevant article recommendations and AI-powered progressive article summaries. It exists to help the reader decide how much attention to give an article, rather than maximise engagement or time in the app.

The home screen **is a reading inbox**, not a conventional social-media feed. Show all newly published articles from subscribed authors/publications, in chronological order by default. Occasional recommendations may be inserted, clearly distinguished from subscribed content. There is no Twitter-like stream, Notes, social posting surface, trending panel or infinite recommendation feed.

This is **not intended to recreate Substack**. Initial sources are public publication/article RSS feeds; the architecture may accommodate other sources later.

## 2. Agreed user experience

### 2.1 Home screen: unified inbox
- Text-first rows: original article headline, author/publication, publication date, reading status. No thumbnails by default.
- Display all incoming articles from the user's subscriptions. Do not silently discard some because an algorithm thinks they are uninteresting.
- Default sort: newest first. Offer sort/filter controls for oldest, length (where known), publication, topic, unread and optionally relevance.
- Provide tabs or equivalent clear navigation for **Inbox**, **Unread**, **Archive**, and a **Saved** collection (Saved may be separate from the main tab bar).
- Allow bulk archive, archive older items and grouping multiple articles from the same publication.
- Remember inbox position when returning from an article.
- No social metrics (like counts, follower counts, engagement scores), social posts, streaks or attention-maximising notifications.

### 2.2 Recommendations
- Target default mix: roughly **80% subscribed articles / 20% recommended articles**, measured in visible inbox placements, not a rigid requirement to insert two suggestions into every block of ten.
- Recommended articles are **optional**, prominently labelled and can be disabled entirely. The user can configure their proportion (initial proposed control: 0–50%, default 20%).
- Possible default insertion rate: approximately one recommendation for every four subscription articles, capped at about three new suggestions per day. Treat these numbers as *proposals for testing*, not proven optimums.
- Recommendations should relate to subject matter and publications the reader follows, not engagement maximisation.
- Display a human-readable rationale (e.g. 'Suggested because you follow [publication]'). Allow 'More like this', 'Less like this', and 'Follow author/publication'.
- Recommended items **do not count as unread inbox obligations**, and may expire if not saved. They should not displace or hide subscribed articles.
- No separate endless recommendation/social stream.

### 2.3 Article reading: progressive disclosure
On first opening an article, show a **one-sentence AI summary** (generated on demand, then cached). Provide explicit controls for advancing to these levels:
1. **Essence:** one accurate sentence capturing the central idea.
2. **Brief:** one paragraph describing the principal argument.
3. **Understanding:** three substantive paragraphs on the argument, supporting reasoning/evidence and important caveats or uncertainty.
4. **Original:** the complete original article, with formatting, links and visual content wherever legitimately available.

- A visible **More detail** button advances from one level to the next; swipe/tap shortcuts can be explored, but ordinary tapping, scrolling, selecting text, or opening links **must not unintentionally advance** the stage.
- **Read original** is accessible from any summary stage, without requiring three previous expansions.
- Provide a way to go back to less detail or start again.
- Remember last reading stage and scroll position per article, per device, with sync if available.
- Summaries at each level should add meaningful detail, not pad or restate the shorter summary.
- Preserve the original headline and attribute its author. Distinguish AI output from author text.
- Where feasible, enable **summary claim → original passage** navigation and mark uncertainty. Summaries should be faithful, avoid fabricated evidence, and disclose when only a partial source was available.
- Do **not** pre-generate summaries for every received article. Generate when requested and cache, to control costs.
- Future optional modes (not MVP): neutral, critical, practical. V1 default is faithful/neutral.

### 2.4 Reader controls
- **Copy full article text** in one action where content access permits. This addresses the original Substack app limitation that only a paragraph can conveniently be copied at a time.
- **Copy summary** at the current depth.
- Save/bookmark for later; archive; share original URL; open original on publisher site.
- Search article titles/known metadata and previously collected articles; fuller semantic search is not required in V1.
- Optional later: text-to-speech, highlights/annotations, offline caches and source comparisons.

### 2.5 Reading state
Track these distinctly:
- **Unread:** never opened.
- **Skimmed:** one or more AI summary levels viewed.
- **Original opened:** full article opened. Do not claim it was completely read simply because opened.
- **Saved:** bookmarked, independent of read/archived state.
- **Archived:** removed from active inbox but retrievable.

Prefer automatic tracking of depth reached and a deliberate Archive action. Offer an optional later setting for archive-on-completion. Avoid making the reader manually maintain numerous statuses.

### 2.6 Reader Discussion (full-article view only)
- Beneath the **original article**, include a **collapsed** section titled **Reader discussion**. Do not place comments or a comment stream in the inbox or any summary stage.
- **V1:** provide a **View original comments** link that opens the correct Substack article/discussion in the browser and respects the existing logged-in session and subscription entitlements.
- Where the user explicitly supplies comment text (or a properly authorised integration provides it), offer an **on-demand Summarise discussion** action. Never claim to have reviewed comments not accessible to the app.
- When comment data is genuinely available, extract substantive **corrections, counterarguments, evidence, author replies, useful resources, and open questions**, rather than simply ranking most-liked reactions. Attribute or link to source comments and state any sampling/coverage limitation.
- **No native comments ingestion via undocumented Substack endpoints as a launch dependency**. Do not bypass comment permissions, paywalls, authentication or terms of service.
- Native inline comment display and comment-level citations are **later possibilities conditional on a stable, permitted data-access method**. Do not promise automatic full-discussion analysis for Substack in V1.

## 3. Data sources and integration constraints

### 3.1 Public publications
- Use publication RSS/Atom feeds and linked article URLs where available and permitted.
- On article demand, attempt to retrieve full public text using a readability-style extractor and preserve visual structure where possible.
- If complete text is not available (paywall, blocked request, missing HTML, access limitation), show an honest explanation, available excerpt, and an **Open on publisher site** button. Do not present a short teaser as a complete article.

### 3.2 Paid and subscriber-only material
- Must respect authorised access. Do not bypass paywalls or access controls.
- An eventual email-newsletter import path is possible for complete emails that subscribed users legitimately receive. Research authentication, supported email providers, privacy and consent before implementing.
- Paid Substack integration is not required for initial public-feed MVP; document gaps and options.

### 3.3 Comments and API reliability
- Substack public RSS access does not guarantee a permitted comments API or subscriber-article API.
- Treat undocumented endpoints as unsuitable for a foundational production dependency. Do not automate scraping that violates access conditions.
- Use a **source adapter abstraction** so additional permitted providers can be supported without redesigning the app.
- Clearly label API/product feasibility conclusions and cite current documentation in the technical assessment.

## 4. Platforms, architecture and operational requirements
- Android and Windows PC are equally important. Initial preferred delivery is a responsive **progressive web app (PWA)**, installable on both, subject to a technical validation by Codex. Do not assume a native Android app is needed on day one.
- Open-source repository with a clear licence recommendation; retain attribution and satisfy licences for reused dependencies. Do not copy Feeder/re:ink code without verifying licence compatibility.
- Privacy first: minimal collection, no invasive tracking or engagement analytics; clearly explain what leaves the device when requesting AI summaries.
- Support subscription import/export (OPML is a sensible starting point), and useful export of saved state/notes where permitted.
- Consider a local-first design for reading and a deliberate, secure sync mechanism for subscriptions, bookmarks, archive state, reading progress, and cached AI summaries across devices. Present sync trade-offs before selecting backend architecture.
- Avoid shipping secrets in browser JavaScript, checked-in files or logs. If supporting user-owned AI API keys in a PWA, design a secure server-side credential handling strategy or a clearly documented safer alternative; don't claim client-side local storage provides adequate secret protection.
- Model/provider should be configurable if practical; the initial candidate is an OpenAI-compatible model API. Usage may incur separate API fees. Cache summaries by article version, summary stage, model and prompt version.
- Support accessibility (keyboard navigation, screen readers, scalable text, contrast) and graceful loading/error states.
- No account should be required simply to explore a local demo; synchronisation may require sign-in later.

## 5. Explicit non-goals (initial stage)
- **Do NOT build 'Ask your library'.** The project owner expressly excluded cross-article conversational research from this stage. Do not put it in MVP scope or the planned roadmap without new approval.
- Do not build a general chat interface in the initial reader.
- Do not recreate Substack Notes, comments posting, social profiles, follower graphs, trending posts, streaks or infinite discovery.
- Do not guarantee full paid content or native Substack comment integration without authorised mechanisms.
- Do not build mobile apps separately before assessing a cross-platform PWA.
- Do not implement every possible future nice-to-have before the reading flow works.

## 6. Suggested implementation order (needs technical validation)

**Phase 0 — Discovery and architecture:** verify RSS article extraction, current Substack constraints, feasible PWA stack, AI summary integration, cost/security approach and sync options. Produce an architecture decision record and milestone plan. No large implementation before owner approval.

**Phase 1 — Usable vertical slice:** responsive inbox seeded from local fixtures and/or one public RSS source; text-first list; 4-stage reading; deterministic demo summaries then provider-backed AI behind configuration; original article route; copy full text; archive/save; basic unit/e2e tests. Good mobile and desktop presentation.

**Phase 2 — Actual subscriptions and reliability:** add/manage RSS subscriptions, incremental polling, deduplication, OPML import/export, article parsing/caching and transparent partial-content fallback; states/filter/search; accessible keyboard controls.

**Phase 3 — Optional discovery + sync:** labelled recommendations with opt-out, explain-why and feedback; appropriate cross-device synchronisation after agreed design.

**Phase 4 — Reader discussion:** original comments link in the full-article view (this minimal V1 requirement can ship earlier in phase 1); optional user-supplied comment summarisation; explore authorised native data access only if viable.

The exact phase placement can change following feasibility work, but do not remove the agreed core features.

## 7. Acceptance criteria for a working MVP
1. Open the app on a phone-sized browser and PC browser and see a clean inbox with article titles/authors, clear subscribed versus recommended distinctions, and no social posts.
2. Subscribe to a public RSS source and receive its entries without losing items to recommendation ranking.
3. Open an article and view one sentence, then one paragraph, then three paragraphs, then the original; skip directly to the original at any point.
4. The AI summary process is initiated on demand, cached, and reports unavailability/errors accurately. No requirement to insert an actual API key to run the local demo.
5. Copy all accessible article text with a single control; independently copy a summary.
6. Save, archive, revisit and filter unread items, retaining reading-depth state.
7. Toggle recommendations off; recommended items are labelled and not counted in unread totals.
8. Reach the Reader discussion section only after opening the full article, then open the original publisher's comments; summarisation is offered only when comment text is legitimately available.
9. Relevant tests pass, and the README explains configuration, data boundaries, third-party access limitations and local setup.
10. 'Ask your library' is absent.

## 8. Decisions still to make (do not guess silently)
- Technology stack and architecture, chosen following a short comparison.
- Whether local-only mode is a first-class mode, and the cloud sync/auth provider for multi-device sync.
- Exact recommendation algorithm and limits; initial figures are design defaults to validate.
- Whether recommended items are computed on-device, via a service, or initially rules-based.
- API provider(s) and billing/key-management strategy.
- Further visual refinements following reader feedback.
- How to store/cite article passages so AI summaries are traceable without reproducing restricted text beyond permitted access.
- Article-email import design and Substack discussion data access permissions.

## 9. Implementation guidance and precedent
- **Feeder** (open-source Android RSS reader): useful design precedent for full-text article parsing, content selection and user-triggered OpenAI summary action. Reference: https://github.com/spacecowboy/Feeder
- **re:ink** (open-source Android Substack/newsletter reader): useful precedent for newsletter import/reading and email parsing. Reference: https://github.com/christi4nity/re-ink
- Study them for technical feasibility only; this is a new cross-device product, not automatically a fork of either.

## 10. Design values
- Reader controls their attention.
- No engagement-driven feed.
- AI is a reading aid, not an authority.
- Distinguish source text from model output.
- Honest about content access and model limitations.
- Minimal, calm, accessible interface with Light, Dark and System appearance. Default to System and remember the reader’s selection on this device.
- Open source, inspectable and respectful of user data.
