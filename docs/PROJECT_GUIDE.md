# CommerceFlow: A-to-Z project guide

## Problem and scope

Support staff repeatedly read tickets, decide what they concern, identify urgent issues and write initial replies. CommerceFlow automates an initial triage pass. It assists a reviewer; it has no tools to send a reply, change an order or execute a refund. This is a personal learning project built with AI assistance, not a client deployment.

## Technology choices

| Component | Why it is included |
|---|---|
| n8n | Visual webhook intake, API calls and conditional branches |
| JavaScript / Node.js 24 | Small HTTP service with built-in fetch and test runner |
| SQLite via node:sqlite | Local saved results and unique ticket identifiers |
| OpenAI Responses API | Optional classification and reply drafting with structured output |
| Docker Compose | Runs the service and n8n on the same local network |
| GitHub Actions | Repeats tests on pushes and pull requests |
| Render Blueprint | Describes the free API hosting configuration |

## File inventory

| Path | Responsibility |
|---|---|
| `src/server.js` | Public API information, health endpoint, API-key check, JSON body handling, request limit, error responses and shutdown |
| `src/triage.js` | Input validation, redaction, output schema, deterministic classification and review policy |
| `src/provider.js` | Chooses rules or OpenAI mode; configures prompts, schema, timeout, retries and output parsing |
| `src/store.js` | Opens SQLite; stores results and hashes; rejects conflicting IDs and in-flight duplicates |
| `workflows/commerceflow.json` | Seven-node n8n workflow; inactive until configured |
| `examples/shipping.json` | Synthetic shipping ticket |
| `examples/refund.json` | Synthetic refund ticket |
| `examples/priority.json` | Synthetic safety-related ticket |
| `tests/triage.test.js` | Business logic, SQLite persistence and simulated provider tests |
| `tests/server.test.js` | Real local HTTP tests, including authentication and error statuses |
| `tests/workflow.test.js` | Exported workflow graph validation |
| `package.json` | Node version, project metadata and start/test/check scripts |
| `.env.example` | Configuration names and safe placeholders |
| `.gitignore` | Excludes secrets, databases, local tools and logs |
| `Dockerfile` | Runs the API as a non-root container user |
| `.dockerignore` | Limits build context to application source and metadata |
| `compose.yaml` | Local API/n8n services and persistent Docker volumes |
| `render.yaml` | Free API service, health check, rules mode and generated API secret |
| `.github/workflows/ci.yml` | Node 24 syntax checks and tests on GitHub |
| `README.md` | Overview, setup, usage, workflow import and hosting limits |
| `docs/PROJECT_GUIDE.md` | This detailed explanation |

`tmp/` contains local publishing tools and authentication state during setup. It is ignored by Git and must never be uploaded. `.env` is also private and ignored.

## End-to-end request lifecycle

1. Caller POSTs JSON to the authenticated n8n webhook.
2. n8n forwards only its request-body object to the API with a separate API credential.
3. The API checks authentication, content type and body size.
4. Validation permits exactly `ticket_id`, `subject` and `message`. All must be nonempty strings. Limits are 80, 200 and 5000 characters respectively.
5. The service normalizes whitespace at the edges and hashes the normalized ticket with SHA-256.
6. If the ID exists with the same hash, it returns the saved result without another provider request. A different hash produces HTTP 409.
7. A process-local in-flight set prevents concurrent processing of the same ID within one running service instance.
8. The configured provider generates an analysis. Rules mode uses keywords and a fixed template; OpenAI mode uses the actual API.
9. Runtime validation checks allowed categories, priorities, required strings and output size limits.
10. A local safety-keyword rule may raise priority to high.
11. The review-routing policy assigns a queue and `awaiting_review` status.
12. SQLite stores the ID, hash, generated result and timestamp, but not the original subject/message.
13. n8n checks the HTTP status, branches on the review queue and returns JSON. It adds `workflow_route` on successful responses.

## Review-routing policy

| Condition, evaluated in order | Queue |
|---|---|
| High priority from the model or local rule | `priority-review` |
| Rules provider, or category refund/damaged_item/other | `specialist-review` |
| Remaining OpenAI shipping/product-question cases | `standard-review` |

Every queue has `human_review_required: true`. These are routing labels; there is no worker consuming them or review application in this version.

## Database design

The `tickets` table has four columns: primary-key `ticket_id`, `fingerprint`, serialized `result`, and `created_at`. The hash detects ID reuse with changed content. WAL journal mode supports the lightweight local workload. The in-flight protection is process-local, so this design is intended for one service instance. There is no distributed lock or automated retention job.

## Error contract

| HTTP status | Meaning |
|---|---|
| 400 | Malformed JSON or invalid ticket |
| 401 | Missing or incorrect API key |
| 404 | Unsupported route or method |
| 409 | Changed content under an existing ID, or an in-flight duplicate |
| 413 | Body exceeds 16 KiB |
| 415 | Content-Type is not application/json |
| 502 | OpenAI unavailable, refusal, incomplete response or invalid analysis |
| 500 | Unexpected internal failure; private exception details are not returned |

Errors are returned as `{ "error": { "code": "...", "message": "..." } }`, with messages on application-processing errors. A provider failure does not save a completed ticket; retrying later is possible.

## What the AI integration demonstrates

The prompt separates application instructions from untrusted ticket content. The API requests an explicit JSON schema containing category, priority, summary and draft_reply. The code validates the result again, handles refusals/incomplete output and bounds the number of attempts. This is a constrained LLM pipeline, not an autonomous agent.

The 12-second timeout applies to each attempt. Temporary failures have short exponential backoff, up to three attempts total. n8n's HTTP timeout is 45 seconds. Failed API requests can still incur provider charges; duplicate-result caching is not a guarantee against every repeated charge.

## Test interpretation

Fourteen automated tests pass locally, including one test group that sends real HTTP requests to a temporary local server. OpenAI responses are mocked. The graph test checks JSON connectivity; it does not run n8n. No statement about production accuracy, time saved or customer outcomes is supported by these tests.

## Hosting boundaries

The free Render configuration hosts the API only, in rules mode. It exposes read-only API information at `/` and health at `/health`, while `/triage` remains authenticated. Configure a separate n8n installation to call the hosted API. Free Render storage is ephemeral; SQLite deduplication resets when that storage is lost. Use synthetic tickets and do not present this free instance as a durable customer-support system.

## Interview preparation

Be able to explain webhooks, JSON, HTTP status codes, authentication headers, schema validation, idempotency, timeout/retry behavior and human review. Walk through one shipping ticket, one refund ticket, a safety-related ticket, a duplicate and a changed payload with the same ID. Identify which behavior comes from n8n and which comes from JavaScript.

An accurate description after studying and running it: "I built an AI-assisted personal project using n8n and a JavaScript API for eCommerce support triage. It validates tickets, prevents duplicate processing with SQLite, supports structured OpenAI output and routes drafts for human review." Explain separately which live integrations you personally tested.

## Possible next improvements

Durable managed storage, a real reviewer task queue, a narrowly scoped Shopify order lookup with verified webhook signatures, a Slack notification node, labeled classification evaluations, rate limiting, and monitoring. These are future work and are not implemented.
