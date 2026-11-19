# Starting this project with Codex

## Recommended setup (Windows PC)
1. Download this project package and extract it into a new folder such as `Documents/reading-inbox`.
2. Open the ChatGPT desktop app and select **Codex**. Start a local project from this folder. (Or use Codex CLI in the folder; another option is Codex Cloud with a GitHub repository containing these files.)
3. Open a new Codex conversation and paste the **Initial Codex prompt** below.
4. Review the Phase 0 findings before approving substantial application implementation.
5. Keep product decisions in `PRODUCT_SPEC.md` and coding agreements in `AGENTS.md`; let Codex record technical choices and a milestone plan in new project files.

## Initial Codex prompt (copy/paste)

> I want you to start a new open-source app called **Reading Inbox** (working title). The user-approved requirements are in `PRODUCT_SPEC.md`, and the working instructions are in `AGENTS.md`.
>
> **Begin with Phase 0 — technical feasibility and implementation plan.** Read both documents in full. Evaluate the quickest maintainable way to make a polished Android + Windows PC experience, with a strong preference for an installable responsive PWA. Research and verify current Substack RSS article extraction, paid-content boundaries and reader-discussion limitations rather than assuming unrestricted access. Assess AI summary costs, caching, API key security, data storage, and sync choices. Take inspiration from the open-source Feeder and re:ink projects without presuming that either needs to be forked.
>
> Create a concise `ARCHITECTURE.md` and `IMPLEMENTATION_PLAN.md` with technology recommendation, trade-offs, milestone acceptance criteria, verification commands, risks and unresolved decisions. Include a proposed low-fidelity mobile/desktop UI structure. Give me a recommendation and a clear Phase 1 vertical slice. **Do not start major implementation until I approve that plan.** You may create minimal illustrative mock-ups when useful, using sample data clearly labelled as fictitious.
>
> Non-negotiables: a chronological subscription inbox with optional ~20% labelled recommendations; no social feed; progressive summaries (one sentence → one paragraph → three paragraphs → full article); full-text copy; reading/save/archive state; Reader discussion only below the original article, initially linked to the publisher's original comments; on-demand comment AI insights only when the comment text is legitimately available. **Do not implement or schedule 'Ask your library'.**
>
> Explain your findings and flag anything in the specification that is infeasible or needs an explicit product decision.

## Suggested next prompt after approving the plan

> I approve the Phase 0 plan with the decisions noted here: [insert decisions]. Implement only the agreed Phase 1 vertical slice from `IMPLEMENTATION_PLAN.md`. Make it runnable locally with fixture articles and a deterministic AI mock, show working mobile and desktop layouts, and add tests for core behaviours. Do not use paid APIs, deploy, push code or connect real accounts without my approval. Demonstrate the four reading stages, direct original access, copy full text, bookmark/archive and the Reader discussion link. When done, run validation and report the exact commands and outcomes.

## Keep the original conversation?
The short answer is: not required. This package is the stable reference. Codex does not automatically inherit every detail of a separate ChatGPT conversation. Keep this chat for discussion and update the project files as product decisions change.
