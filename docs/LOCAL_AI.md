# Optional local AI evidence review

RewardLoop can review text evidence with a real, self-hosted language model without Anthropic credentials or per-call billing. This is intended for a reproducible **local fixture-payment demonstration**. The result is recorded as `local_llama` with the configured model alias. It never masquerades as `anthropic` or as the deterministic `fixture` reviewer. PayPal Sandbox qualification still requires the separately verified Anthropic path; the local model cannot authorize a Sandbox financial call.

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

`npm run provider:local-ai:smoke` makes three bounded local calls: a substantive note, an incomplete note, and a duration claim with no independent proof. The smoke output includes verdict, model identity, and token counts without printing the full notes or secrets. The runtime caps each response at 280 generated tokens and 75 seconds. The URL must be an HTTP loopback endpoint; it cannot point to a remote or live payment host. If both Anthropic settings are configured, the Anthropic reviewer takes precedence.

The model returns a suggested decision about the **text actually submitted**. It cannot verify that someone studied for a claimed duration or did work outside the application. Invalid, truncated, or low-confidence responses do not count. A local model can still make mistakes; demonstrate its limits honestly and use a rubric that asks for observable content. The deterministic domain service, not the model, counts distinct days and enforces the approved purchase terms.

This path lets a judge reproduce genuine AI review on their own machine. It does not make an unhosted local app publicly reachable, does not include a PayPal Sandbox transaction, and is not evidence of Anthropic, Kernel, or Channel3 checkout access.

## Observed local run, 23 October 2026

The pinned 1.7B file passed SHA-256 verification. llama.cpp server build `b8994-aab68217b` loaded the model on `127.0.0.1:8082`. The three-case smoke passed: a note explaining both index lookup and write/storage trade-off was **accepted** with `local_llama` provenance, a note missing the trade-off returned **needs_review**, and an unsupported duration claim also returned **needs_review** after its model output failed schema validation. All three were actual local inference calls; none called PayPal or an external AI API. The missing-tradeoff response also inaccurately said the lookup explanation was absent, which illustrates why this small model is suitable only as an optional fixture-demo reviewer under the current Sandbox gate.
