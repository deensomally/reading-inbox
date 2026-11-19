# Codex repository guidance — Reading Inbox

Read `PRODUCT_SPEC.md` before planning or making code changes. It is the current product source of truth. Read `CODEX_START_HERE.md` for the initial task and development sequence.

## Working agreement
- Build the product described in `PRODUCT_SPEC.md`; do not invent user requirements or silently replace agreed features.
- **Explicitly exclude 'Ask your library'** from the initial project and roadmap. Do not add cross-article AI chat or generic social-feed features.
- Prioritise one working, polished vertical slice over a large set of incomplete screens.
- Use plan-first development: document proposed stack, architecture, risks, milestones and validation strategy. Distinguish confirmed facts from assumptions. Get owner approval before major architectural commitments, public deployments or paid services.
- Prefer a cross-device, responsive PWA for Android and Windows unless a documented feasibility finding supports a different approach.
- Respect publisher permissions and law. No paywall bypass or dependency on undocumented Substack APIs. Do not scrape protected comments or paid content.
- Do not call an article 'full' unless all accessible source content has been retrieved. Display honest fallbacks.
- Keep AI summarisation on demand and cache per article/version, model and stage. Never put real API keys into frontend bundles, sample files, Git, logs or test fixtures.
- Make the no-credentials demo usable with deterministic mocked summaries and seeded local content. Clearly label demo content.
- Add tests for important logic and end-to-end user flows. Run applicable formatter, lint, typecheck, unit and UI tests; report what ran and what could not run.
- Preserve accessibility and keyboard navigation, responsive layout, loading/empty/error states and privacy.
- Prefer small, reviewable changes. Explain trade-offs and deviations. Do not commit, push, publish, deploy, buy services or create external accounts without an explicit user request.
- Keep README and technical decisions updated as architecture evolves. Ask for user approval of material scope changes.

## Immediate priority
Conduct Phase 0 feasibility and architecture work, then propose a concrete Phase 1 plan and seek approval before implementing the full app. A small throwaway UI prototype is acceptable if it clarifies a technical decision, but do not spend substantial effort on infrastructure before agreement.
