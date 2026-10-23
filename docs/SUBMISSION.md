# Devpost submission draft and release status

Updated 23 October 2026. A [temporary public repository](https://github.com/U4AR/RewardLoop) and a Devpost draft exist. A 99-second prototype video is playable but **unlisted** while the owner reviews it; its link and source assets are held out of this public repository. Devpost shows **3/5 steps saved**, with no final submission receipt. Its private management URL is held outside this public repository. The video and current receipt show a fixture simulation; a real PayPal Sandbox capture and provider-backed AI decision are still unverified. Participant eligibility and personal declarations remain with the owner. Revise the entry only after the provider-backed scenario is genuinely observed.

## Official submission rules and deadline

The [PayPal AI Hackathon rules](https://paypalaihackathon.devpost.com/rules) set the deadline at **12 November 2026, 12:00 p.m. Pacific Standard Time** (**13 November 2026, 1:30 a.m. India Standard Time**). The submission window is open as of this update. A draft may be saved before the deadline; the hackathon entry cannot be substantively changed afterward. The owner must join the hackathon and complete any personal eligibility, ownership, and rules declarations.

The [official overview](https://paypalaihackathon.devpost.com/) and rules require:

1. A functioning project that meaningfully integrates the **PayPal developer platform in its free Sandbox** and an **AI tool, model, or platform**. Stage-one judging checks reasonable use of the required APIs or SDKs. A fixture reviewer plus fixture receipt alone does not establish this requirement.
2. A description of what the project does, plus the names of the AI tools used and how they are used.
3. A functional demo judges can run: either a hosted URL or complete build and run instructions in the repository. Access must remain free and unrestricted through **15 December 2026, 8:00 a.m. Pacific Time**, the end of judging. If special access is needed, the instructions must explain how judges obtain it without exposing private production credentials.
4. A **public GitHub, GitLab, or Bitbucket repository** with all required source, assets, instructions, and an open-source license visible at the top of the repository page.
5. A **public YouTube video under three minutes**, linked on the entry, showing the project functioning on its intended device. It must omit unlicensed third-party trademarks, music, and other protected material. Submission materials must be in English or have English translations.

The [Devpost submission guide](https://help.devpost.com/article/126-know-your-submission-steps) describes a typical project name, tagline, optional 3:2 thumbnail and gallery, project story, built-with tags, video link, repository and testing details, and final terms acceptance. The actual PayPal form has now been inspected and a draft saved; its remaining Additional Info step asks for personal submitter type, country and eligibility assertions, subjective ratings, a technical-requirement answer, and a demo URL. The owner must answer personal declarations. The official judging criteria weight technological implementation, design, impact, innovation, and presentation equally. A final video should show the actual end-to-end run and the payment and AI evidence, with clear fixture labels where relevant.

**Release gap as of this update:** A real PayPal Sandbox call and payment has not been observed. A provider-backed AI decision is under local implementation and test, without an observed Sandbox-authorizing path. The repository exists but source publication is pending in this status snapshot; the judge route has not been independently reproduced, the YouTube video remains unlisted, and Devpost is a draft rather than a final entry. The local controlled-store flow can be shown honestly as a work in progress, but the final entry should demonstrate actual provider-backed results or candidly disclose any remaining limits.

## Devpost form map

| Likely field | Prepared content or required evidence |
| --- | --- |
| Project name | **RewardLoop** |
| Tagline | **Earn an approved reward with evidence and a bounded PayPal Sandbox checkout.** Use this only after the checkout and evidence-model path have actually worked; until then say **A bounded reward-purchase prototype with a fixture demo.** |
| Project story | Adapt the inspiration, current build, implementation, challenges, and limitations sections below. Keep each provider's verified result and unverified path separate. |
| Built with | Next.js, TypeScript, PostgreSQL, and the actually used provider APIs. Add PayPal Sandbox and an AI model only after a recorded successful run. Channel3 search is already verified. |
| Demo / Try it out | Insert either a hosted judge URL or a public repository with verified, complete setup and testing instructions. Localhost alone is not reachable by judges. The current public repo and local run instructions have not yet been independently reproduced by a judge. |
| Code repository | [Temporary public GitHub repository](https://github.com/U4AR/RewardLoop), entered in the Devpost draft; verify its source tree and visible MIT license after upload. |
| Video | A 99-second prototype video is entered in the Devpost draft but still unlisted for owner review. Its link is held privately. It explicitly labels the simulated checkout. A final entry requires public visibility. |
| Team and declarations | Owner supplies real submitter type, location, eligibility, ownership, and acceptance of terms. Do not infer or auto-complete personal declarations. |

The exact form may add hackathon-specific questions. Inspect them in the signed-in Devpost project before final submission.

## Project name and short description

**RewardLoop**

RewardLoop is a PayPal AI Hackathon prototype that turns an approved reward into a goal-based purchase. A person chooses a reward, defines observable proof, and sets a specific item, time window, and total-price cap. A server-side gate checks the goal and purchase permission before any payment. The controlled storefront is synthetic: no retailer receives an order and nothing ships. Every completed real demo payment must use PayPal Sandbox.

## Inspiration and problem

It is easy to promise ourselves a reward after a streak and much harder to preserve the exact promise weeks later. A simple “buy it when I finish” automation could spend too much, choose an unwanted substitute, or treat uncertain evidence as success. RewardLoop makes the terms visible when the person authorizes them and checks those terms again when the goal qualifies.

## What the current build does

A signed-in local user can select an app-owned demo reward, save a versioned goal and bounded permission, submit text evidence, and see a worker process distinct-day progress. The server calculates a synthetic store quote, enforces the approved limits, and shows an explicitly labelled fixture receipt. The permission can be revoked before a new commit. A separate local mock-store hostname accepts a one-time code, keeps a synthetic cart after reload, and cannot access the main app routes. An authenticated app action links the exact owner-controlled cart session to the purchase intent; that binding passed a local database smoke check.

The app also searches the real Channel3 catalog through a server-side API key. A bounded live search returned six products and product detail succeeded. These are discovery references with indicative offers; the current working fixture purchase uses an app-owned demo SKU and does not create a Channel3 or retailer order. One sampled URL lookup returned `unsupported`.

**Current limitation:** The observed purchase receipt is a fixture simulation with no PayPal order/capture ID. The local evidence review is a fixture rule, and the mock-store persistence test ran in a local browser rather than Kernel. PayPal Sandbox, a real AI-model decision, and Kernel two-session restoration remain required before this can be described as the full hackathon scenario.

## How it was built

The prototype uses a Next.js TypeScript web app, PostgreSQL with migrations, a separate worker and transactional outbox, and owner-scoped sign-in. A deterministic backend purchase gate checks the immutable goal cycle, permission, item, destination, time window, quote, listing version and availability, and total cap. Demo SKUs have unlimited synthetic units. Provider adapters keep catalog, evidence, browser, and payment provenance separate.

- **PayPal:** Sandbox-only saved-wallet and fresh buyer-approval Checkout paths are implemented, with local mocked tests and no live-mode REST route. New Sandbox permissions require a fresh buyer approval until Vault capability is proven. Both provider-backed paths require a bound synthetic cart and model-reviewed evidence. Genuine Sandbox credentials, buyer approval, and capture are not yet configured or observed.
- **AI evidence:** An Anthropic adapter, fixture reviewer, and optional loopback-only local Qwen reviewer are present. Three genuine local model calls were observed on 23 October with `local_llama` provenance: substantive notes were accepted, and incomplete/unsupported-duration notes were withheld. The local model may support only a fixture-payment demonstration; the Sandbox gate still requires a separately verified Anthropic decision.
- **Channel3:** Real server-side search and product detail have succeeded. The checkout early-access email was sent on 23 October after explicit owner approval; no reply has been observed and checkout is not enabled.
- **Kernel:** The app now has a queued two-session profile save/delete/restore cart action and a separate controlled store, plus a standalone diagnostic probe. Mocked tests pass, but no Kernel cloud browser or saved profile has run yet.
- **Render:** The owner created a free Hobby account with no services or payment card and a $0.00 credit balance. A draft Blueprint describes a web process, worker, and database; it has not been synced and no hosted service has been created.

## Challenges, resolutions, and learning

The core design challenge is keeping a delayed financial decision within the original human authorization. The app treats a catalog offer as discovery data, a synthetic store quote as a candidate, and an exact persisted operation as the point where a Sandbox call may begin. Worker retries and ambiguous PayPal responses must reconcile the same operation rather than create a second charge. A browser session or model suggestion cannot widen the allowed item or amount.

During local setup, the distinct store hostname exposed a development-origin check issue. The origin check was corrected and the synthetic login/cart persisted across reload on `127.0.0.1`, while cross-host routes stayed inaccessible. That local result does not establish Kernel profile persistence. The Channel3 sample lookup also showed that an offer source URL can be unsupported, so the app reports that result directly instead of treating it as a product match.

## What is next

Finish the PayPal Developer Sandbox account and Vault capability probe, then verify an actual Sandbox capture with the implemented fresh buyer-approval route or a proven saved-wallet path. Run a bounded real evidence-model review, then prove Kernel save/delete/restore across two distinct cloud-browser sessions against a reachable HTTPS mock store. Await any Channel3 early-access reply before considering its checkout. Rehearse the approved-alternative and over-cap cases, finish judge access, verify the release package, and record a provider-backed final video if those tests succeed.

## Links and judging access

| Required destination | Observed state |
| --- | --- |
| Public open-source repository and license | [Temporary public GitHub repository](https://github.com/U4AR/RewardLoop) created; source upload and remote license verification pending in this snapshot. |
| Working hosted demo or reproducible judge route | Local commands in [README.md](../README.md); no hosted judge URL and no verified external judge route. |
| Public YouTube video under three minutes | Prototype walkthrough uploaded and playable at 1:39, but visibility is **unlisted** pending review. The review link is not in this public repository. It is a fixture demo and cannot prove real PayPal or AI calls. |
| Devpost project/submission | RewardLoop draft exists with 3/5 steps saved. Remaining personal/technical questions and finalization are incomplete; no submission confirmation. The private management URL is held outside this public repository. |

The current text is suitable as an honest project-progress draft. It is **not** a final entry claiming the required PayPal Sandbox and AI demonstration. Before submission, replace the current-limitation wording with only observed provider results, add actual links and redacted transaction evidence, confirm the real Devpost form fields and eligibility declarations, and verify judge access through the official judging period.
