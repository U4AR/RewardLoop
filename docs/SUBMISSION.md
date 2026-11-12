# Devpost submission draft and release status

> **12 November release:** See [the current release record](RELEASE_2026-11-12.md) and [private Render deployment](PRIVATE_DEPLOYMENT.md). The final v2 demo is https://youtu.be/HjQBsC4a5kI. The current flow uses hosted AI, restricted delivery autofill, and verified PayPal Sandbox payment; no retailer order is placed. Earlier prototype/testing notes below are historical where they differ.

Updated 24 October 2026. A [temporary public repository](https://github.com/U4AR/RewardLoop) and a Devpost draft exist. A 99-second fixture prototype is playable but **unlisted** while its replacement is prepared; its link and source assets are held out of this public repository. Devpost shows **4/5 steps saved**, with no final submission receipt. Its private management URL is held outside this public repository. A real Qwen decision on a Render-backed synthetic account qualified one day, linked an exact Notebook set cart, and led to a **verified $22.68 PayPal Sandbox capture** under a $25.00 permission cap. Participant eligibility answers were provided by the owner; final rules and terms acceptance requires action-time owner confirmation. Update the entry with the captured run and replacement video before finalizing.

## Official submission rules and deadline

The [PayPal AI Hackathon rules](https://paypalaihackathon.devpost.com/rules) set the deadline at **12 November 2026, 12:00 p.m. Pacific Standard Time** (**13 November 2026, 1:30 a.m. India Standard Time**). The submission window is open as of this update. A draft may be saved before the deadline; the hackathon entry cannot be substantively changed afterward. The owner must join the hackathon and complete any personal eligibility, ownership, and rules declarations.

The [official overview](https://paypalaihackathon.devpost.com/) and rules require:

1. A functioning project that meaningfully integrates the **PayPal developer platform in its free Sandbox** and an **AI tool, model, or platform**. Stage-one judging checks reasonable use of the required APIs or SDKs. A fixture reviewer plus fixture receipt alone does not establish this requirement.
2. A description of what the project does, plus the names of the AI tools used and how they are used.
3. A functional demo judges can run: either a hosted URL or complete build and run instructions in the repository. Access must remain free and unrestricted through **15 December 2026, 8:00 a.m. Pacific Time**, the end of judging. If special access is needed, the instructions must explain how judges obtain it without exposing private production credentials.
4. A **public GitHub, GitLab, or Bitbucket repository** with all required source, assets, instructions, and an open-source license visible at the top of the repository page.
5. A **public YouTube video under three minutes**, linked on the entry, showing the project functioning on its intended device. It must omit unlicensed third-party trademarks, music, and other protected material. Submission materials must be in English or have English translations.

The [Devpost submission guide](https://help.devpost.com/article/126-know-your-submission-steps) describes a typical project name, tagline, optional 3:2 thumbnail and gallery, project story, built-with tags, video link, repository and testing details, and final terms acceptance. The actual PayPal form was inspected and a draft saved. The owner selected Individual and India, confirmed the three eligibility statements, and supplied a 7/10 PayPal-feedback answer with no follow-up contact. The official judging criteria weight technological implementation, design, impact, innovation, and presentation equally. A final video should show the actual end-to-end run and the payment and AI evidence.

**Release gap as of this update:** The exact pinned Qwen reviewer accepted the note and qualified one day, and a US Sandbox buyer approved an order whose capture was independently verified through PayPal REST and Render database records. The public repository still needs the current source changes, the judge route has not been independently reproduced, the YouTube video remains unlisted and fixture-only, and Devpost is a draft rather than a final entry. The Render Free PostgreSQL database used by the run expires before judging and needs a retention plan.

## Devpost form map

| Likely field | Prepared content or required evidence |
| --- | --- |
| Project name | **RewardLoop** |
| Tagline | **Earn an approved reward with AI-reviewed progress and a bounded PayPal Sandbox checkout.** |
| Project story | Adapt the inspiration, current build, implementation, challenges, and limitations sections below. Keep each provider's verified result and unverified path separate. |
| Built with | Next.js, TypeScript, Render PostgreSQL, the pinned local Qwen model, Channel3 search/detail, and PayPal Sandbox Orders v2 fresh buyer approval and capture were observed. |
| Demo / Try it out | Insert either a hosted judge URL or a public repository with verified, complete setup and testing instructions. Localhost alone is not reachable by judges. The current public repo and local run instructions have not yet been independently reproduced by a judge. |
| Code repository | [Temporary public GitHub repository](https://github.com/U4AR/RewardLoop), entered in the Devpost draft; an earlier reviewed source release and MIT license are public. Publish the current tested changes before final submission. |
| Video | A 99-second prototype video is entered in the Devpost draft but still unlisted for owner review. Its link is held privately. It explicitly labels the simulated checkout. A final entry requires public visibility. |
| Team and declarations | Owner answered Individual, India, and the three eligibility statements. Final rules and Devpost terms acceptance still requires action-time owner confirmation. |

The exact form may add hackathon-specific questions. Inspect them in the signed-in Devpost project before final submission.

## Project name and short description

**RewardLoop**

RewardLoop is a PayPal AI Hackathon project that turns an approved reward into a goal-based purchase. A person chooses a reward, defines observable proof, and sets a specific item, time window, and total-price cap. A server-side gate checks the goal and purchase permission before any payment. The controlled storefront is synthetic: no retailer receives an order and nothing ships. Every completed demo payment must use PayPal Sandbox.

## Inspiration and problem

It is easy to promise ourselves a reward after a streak and much harder to preserve the exact promise weeks later. A simple “buy it when I finish” automation could spend too much, choose an unwanted substitute, or treat uncertain evidence as success. RewardLoop makes the terms visible when the person authorizes them and checks those terms again when the goal qualifies.

## What the current build does

A signed-in user can select a controlled synthetic reward, save a versioned goal and bounded permission pinned to an exact reviewer, submit text evidence, and see a worker process distinct-day progress. On 24 October, the pinned Qwen model accepted a substantive database-index note; the Render-backed app showed **1 of 1** qualifying day. The server calculated the synthetic quote and enforced the **$25.00** cap. A separate local mock-store hostname accepted a one-time code and saved the exact Notebook set cart, which the app bound to the user's purchase intent. A US Sandbox test buyer then approved the order through PayPal's Sandbox page; the app captured **$22.68** and displayed a confirmed Sandbox receipt. PayPal REST GET order and capture responses independently confirmed `COMPLETED` status, amount, merchant, and reference. The permission can be revoked before a new commit. The older fixture receipt belongs to a separate simulated flow and is not this PayPal result.

The app also searches the real Channel3 catalog through a server-side API key. A bounded live search returned six products and product detail succeeded. These are discovery references with indicative offers; the controlled purchase uses an app-owned synthetic SKU and does not create a Channel3 or retailer order. One sampled URL lookup returned `unsupported`.

**Current limitation:** The successful run used a server-created Sandbox approval redirect because the official SDK popup was blank in this browser. The store persistence test ran in a local browser rather than Kernel. Kernel two-session restoration, Vault-based unattended payment, and hosted judge access remain unverified. No retailer order, shipment, live PayPal transaction, or real-money charge occurred.

## How it was built

The prototype uses a Next.js TypeScript web app, PostgreSQL with migrations, a separate worker and transactional outbox, and owner-scoped sign-in. A deterministic backend purchase gate checks the immutable goal cycle, permission, item, destination, time window, quote, listing version and availability, and total cap. Demo SKUs have unlimited synthetic units. Provider adapters keep catalog, evidence, browser, and payment provenance separate.

- **PayPal:** Sandbox-only saved-wallet and fresh buyer-approval Checkout paths are implemented, with local mocked tests and no live-mode REST route. New Sandbox permissions require fresh buyer approval until Vault capability is proven. Both provider-backed paths require a bound synthetic cart and evidence from the exact reviewer pinned to the permission. Sandbox OAuth passed. The observed fresh-approval path completed order `1AD52467A58843710` and capture `65X65580W2293373U` for USD 22.68; separate PayPal REST reads and the Render database agreed on the completed result. The saved-wallet path remains unverified.
- **AI evidence:** An Anthropic adapter, fixture reviewer, and loopback-only local Qwen reviewer are present. Three genuine local Qwen model calls were observed: substantive notes were accepted, and incomplete/unsupported-duration notes were withheld. The exact Qwen provider/model can qualify a Sandbox permission and did qualify the observed one-day goal. The model cannot authorize a purchase; trusted server code checks the permission and quote. Anthropic remains untested.
- **Channel3:** Real server-side search and product detail have succeeded. The checkout early-access email was sent on 23 October after explicit owner approval; no reply has been observed and checkout is not enabled.
- **Kernel:** The app now has a queued two-session profile save/delete/restore cart action and a separate controlled store, plus a standalone diagnostic probe. A restricted project key is in ignored local configuration and the dashboard showed $4.99 free credits with $0 due; a live Kernel browser/profile run still requires a separate reachable HTTPS store. Free-plan entitlement for the second project remains unverified.
- **Render:** The owner redeemed $50 in hackathon credits with no payment card and created one Free PostgreSQL instance in Singapore. Domain and Better Auth migrations and synthetic product seed ran; the signed-in Qwen/goal/cart/confirmed Sandbox capture flow used that database. No Render web service or worker is deployed. The free database expires 23 November, before judging, and the draft paid Blueprint has not been synced.

## Challenges, resolutions, and learning

The core design challenge is keeping a delayed financial decision within the original human authorization. The app treats a catalog offer as discovery data, a synthetic store quote as a candidate, and an exact persisted operation as the point where a Sandbox call may begin. Worker retries and ambiguous PayPal responses must reconcile the same operation rather than create a second charge. A browser session or model suggestion cannot widen the allowed item or amount.

During local setup, the distinct store hostname exposed a development-origin check issue. The origin check was corrected and the synthetic login/cart persisted across reload on `127.0.0.1`, while cross-host routes stayed inaccessible. That local result does not establish Kernel profile persistence. The Channel3 sample lookup also showed that an offer source URL can be unsupported, so the app reports that result directly instead of treating it as a product match.

## What is next

Publish the tested Qwen-to-Sandbox source, record and review a replacement video from the completed run, update the Devpost entry, and secure a reproducible judge route past the Render free-database expiration. Separately investigate Vault capability if unattended use is desired, prove Kernel save/delete/restore across two distinct cloud-browser sessions against a reachable HTTPS mock store, and await any Channel3 early-access reply before considering its checkout. Rehearse the approved-alternative and over-cap cases as separate tests. The verified one-day path already includes real Qwen review, exact cart binding, buyer approval, and a PayPal Sandbox capture.

## Links and judging access

| Required destination | Observed state |
| --- | --- |
| Public open-source repository and license | [Temporary public GitHub repository](https://github.com/U4AR/RewardLoop) contains an earlier source release and MIT license; current tested changes still need publication. |
| Working hosted demo or reproducible judge route | Local commands in [README.md](../README.md); no hosted judge URL and no verified external judge route. |
| Public YouTube video under three minutes | Prototype walkthrough uploaded and playable at 1:39, but visibility is **unlisted** pending replacement. The review link is not in this public repository. It is a fixture demo and cannot prove the new Qwen-qualified flow or PayPal capture. |
| Devpost project/submission | RewardLoop draft exists with **4/5** steps saved. Finalization is incomplete; no submission confirmation. The private management URL is held outside this public repository. |

The current text is a project-progress draft and accurately records a completed **PayPal Sandbox** payment. Before submission, publish the tested source, add the actual capture video and redacted transaction evidence, confirm the final Devpost declarations with the owner, and verify judge access through the official judging period.
