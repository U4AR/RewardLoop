# Cost and resource record

Observed 7 October 2026. This is a planning record, not a claim that credits have funded a deployment. No paid cloud resource or real PayPal payment has been created for RewardLoop.

| Resource | Current state | Cost boundary |
| --- | --- | --- |
| Local development | Native embedded PostgreSQL, Next app and worker run on this computer | No provider charge observed. |
| PayPal Sandbox | Credentials and capability unverified | Sandbox transactions use mock money; never configure live credentials. |
| Channel3 | Signed-in free account; 1,000 monthly credits and 20,000 one-time promotional credits visible after redemption; bounded live searches and one detail/lookup probe were run | No payment method was added. Search and lookup cost one credit each; product detail is listed free. The post-probe credit balance was not rechecked, so do not claim a remaining balance. Do not enable paid overage. |
| Kernel | No account balance observed | [Kernel pricing](https://www.kernel.sh/docs/info/pricing) advertises Developer with $5 included monthly usage credit; headful time consumes it. Run a short bounded two-session test only after confirming the account. |
| Anthropic | No credit or budget observed | Model calls may cost money. Set a strict test bound and approve any required spend before a live call. |
| Render | Owner created the free Google-backed Hobby account. Its dashboard showed no services, no payment card, no pending charges or invoices, $0.00 credits, and 750 included monthly free instance hours. No Blueprint was synced. | The draft Blueprint selects a web service, worker, and database that may bill. A continuously available judge build likely needs paid worker and database resources. [Render plans](https://render.com/docs/compute-plans) and [Blueprint fields](https://render.com/docs/blueprint-spec) change; inspect the exact dashboard quote before deployment. |

The event advertises sponsor credits, but eligibility, receipt, expiry, and billing behavior must be checked in each account. If a Render build uses approximately $7/month each for a small web service and worker plus $6/month for a small database, the rough baseline is **$20/month before storage, transfer, taxes, and any provider usage**. That is an estimate from the supplied brief and [Render's published small-stack example](https://render.com/articles/production-rails-hosting-guide); it is not a selected plan or payment authorization. A free database may expire before judging ends. Prepare a concrete plan and quote for the intended retention period before creating resources.

For any AI or browser run, record request count, time, and estimated cost without storing secrets. Stop automatically at configured limits. `MAX_BROWSER_CONCURRENCY`, `MAX_BROWSER_RUN_SECONDS`, `MAX_AGENT_TOOL_STEPS`, and `MAX_LLM_COST_USD_PER_PURCHASE` in `.env.example` are intended safety budgets; enforcement must be verified before a paid provider run.
