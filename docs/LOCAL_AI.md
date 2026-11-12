# Local Qwen evidence review

RewardLoop can review text evidence with a real, self-hosted language model without Anthropic credentials or per-call billing. The result is recorded as `local_llama` with the configured model alias. It never masquerades as `anthropic` or as the deterministic `fixture` reviewer. A permission pins the exact reviewer provider and model at approval time. For the **bounded database-index content rubric implemented here**, accepted evidence from that same reviewer and current rubric can qualify a PayPal Sandbox goal. Unfamiliar rubrics and duration claims are withheld for human review. The model never makes the purchase decision or widens the approved item, amount, or time window; deterministic server checks enforce those limits before any Sandbox order or capture.

## Model and license

- Model: [Qwen3-1.7B-GGUF](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF), official Qwen release under Apache-2.0. Use `Qwen3-1.7B-Q4_K_M.gguf` at revision `cd3d34a469f89b12676edce7d272750201959466`.
- File size: 1,107,408,544 bytes. Pinned LFS SHA-256: `228fb5627f7510b8b3516cdb6435e4b0d2a2bf330fe5b0ab19284a3570a8bb1f` from the [Hugging Face file API](https://huggingface.co/api/models/Qwen/Qwen3-1.7B-GGUF/tree/cd3d34a469f89b12676edce7d272750201959466?recursive=true&expand=true). The download script verifies both before activating the file.
- Server: [llama.cpp HTTP server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), using its schema-constrained `/v1/chat/completions` endpoint. Install `llama.cpp` using its official instructions, or use a compatible local build. No model file is committed to this repository.

## Start the reviewer

From the repository root:

```powershell
python scripts/download-local-model.py
llama-server -m .local-models/Qwen3-1.7B-Q4_K_M.gguf --alias Qwen3-1.7B-Q4_K_M --host 127.0.0.1 --port 8082 --ctx-size 4096 --n-gpu-layers 0 --threads 8 --parallel 1
```

Set the following in ignored `.env.local`, then restart the Next app and worker:

```dotenv
LOCAL_EVIDENCE_URL=http://127.0.0.1:8082/v1/chat/completions
LOCAL_EVIDENCE_MODEL=Qwen3-1.7B-Q4_K_M
```

`npm run provider:local-ai:smoke` makes three bounded local calls: a substantive note, an incomplete note, and a duration claim with no independent proof. The smoke output includes verdict, model identity, and token counts without printing the full notes or secrets. The runtime caps each local response at 250 generated tokens and 75 seconds. The URL must be an HTTP loopback endpoint; it cannot point to a remote or live payment host. If both Anthropic settings are configured, the Anthropic reviewer takes precedence. A Sandbox test must set `ALLOW_FIXTURE_PROVIDERS=false` and approve the exact `local_llama` provider/model shown in the app; an existing permission does not silently switch reviewers when environment settings change.

The model returns a suggested decision about the **text actually submitted**. It cannot verify that someone studied for a claimed duration or did work outside the application. Invalid, truncated, or low-confidence responses do not count. A local model can still make mistakes; demonstrate its limits honestly and use a rubric that asks for observable content. The deterministic domain service, not the model, counts distinct days and enforces the approved purchase terms.

This path lets a judge reproduce genuine AI review on their own machine. It does not make an unhosted local app publicly reachable, and a model verdict alone is not evidence of a PayPal Sandbox transaction, Anthropic, Kernel, or Channel3 checkout access.

## Observed local runs, 23–24 October 2026

The pinned 1.7B file passed SHA-256 verification. llama.cpp server build `b8994-aab68217b` loaded the model on `127.0.0.1:8082`. The three-case smoke passed: a note explaining both index lookup and write/storage trade-off was **accepted** with `local_llama` provenance; a note missing the trade-off and an unsupported duration claim were withheld. All three were actual local inference calls; none called PayPal or an external AI API.

On 24 October, the signed-in browser flow used a separate Render-backed synthetic account. The pinned Qwen reviewer accepted a substantive one-day database-index note against the owner's content-based rubric, and the app showed **1 of 1** qualifying day. The exact synthetic notebook cart was linked to that account's approved permission. The purchase reached `BUYER_APPROVAL_REQUIRED`. Those observations establish model-reviewed qualification and the server gate; they do **not** establish a PayPal order, buyer approval, or capture. The small model can still err, so the rubric should ask for checkable content and invalid, truncated, or low-certainty responses must fail closed.
