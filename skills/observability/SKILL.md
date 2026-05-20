---
name: observability
description: Use when adding logs, metrics, or traces — or when reviewing whether code can be debugged in production at 3am. Covers structured logging, the three signals, correlation, cardinality, and alerting philosophy.
---

# Observability

The 3am test: a paged on-call engineer must be able to figure out what happened from logs/metrics/traces
alone, without re-deploying with extra `printf`s. If they can't, observability is missing.

## The three signals

- **Logs** — discrete events with context. "What happened?"
- **Metrics** — aggregated numbers over time. "How often / how fast / how many?"
- **Traces** — causality across services. "What called what, and where did the time go?"

Each is the wrong tool for the others' job:

- Don't aggregate logs into metrics — too expensive, too noisy.
- Don't put per-request detail into metric labels — cardinality explodes.
- Don't reconstruct call chains from logs — that's what traces are for.

## Logging

### Format

- **Structured** (JSON or key=value), never `printf` soup.
- **One event per record**, no multi-line concatenation.
- **Stable keys**: don't shuffle `user_id` / `userId` / `user`.
- **UTC ISO-8601 timestamps**, server-side. Don't trust client clocks.

### Levels

| Level   | When                                                                       |
|---------|----------------------------------------------------------------------------|
| ERROR   | Something requires human attention (paging, ticketing, retry exhausted)    |
| WARN    | Anomaly that didn't fail, but you'd want to know if it became common       |
| INFO    | Notable lifecycle events (start, stop, deploys, scheduled jobs)            |
| DEBUG   | High-volume detail, gated, off in prod by default                          |

Don't log INFO for every request — that's a metric, not a log.

### Required context

Every log line in a request path carries:

- `request_id` / `trace_id` — correlation across services.
- `user_id` or `principal_id` — *when not in a credential endpoint and not leaking PII*.
- `service` / `environment` — for multi-service log aggregators.
- `error` (when applicable) — full stack/chain, not `e.message`.

### Never log

- Passwords, tokens, API keys, session IDs.
- Full PII for credential / payment endpoints (mask: `user@****.com`).
- Raw request body when it might contain the above.
- Cookies, authorization headers.

### Error logging

- **Capture the cause chain.** Re-raise with original cause; don't drop the stack.
- **Log at the boundary that decides what to do**, not every layer that re-raises. Many duplicate logs
  for one event is noise.

## Metrics

### Cardinality discipline

A metric `http_requests{status="500", path="/api/orders", user_id="<id>"}` will blow up your storage when
user IDs proliferate. Rule of thumb:

- **Labels with bounded cardinality only**: `status`, `method`, `route` (template, not raw path),
  `service`.
- **Never**: user IDs, request IDs, timestamps, query strings, free-text fields.

### RED / USE

Two standard frames:

- **RED** (request-driven services): **R**ate, **E**rrors, **D**uration. Track per route/handler.
- **USE** (resources): **U**tilization, **S**aturation, **E**rrors. Track for CPU, memory, disk, queue
  depth.

### Histograms over averages

Latency averages lie. Use histograms (Prometheus, OpenTelemetry). Watch p50, p95, p99.

## Traces

- **Propagate the trace context** across every RPC, queue, and async hop. Without propagation, traces
  are isolated spans, not a story.
- **Add spans for non-trivial work**: external calls, slow algorithms, batched operations.
- **Attach attributes** to spans (small, bounded): the entity ID, the operation outcome, the size of the
  batch.

## Correlation

The single most useful thing for debugging is **one ID that ties everything together**.

- **`request_id`** generated at the edge; propagated to every log, metric exemplar, and trace span.
- **Pass it across service boundaries** via a header (e.g. `X-Request-Id`).
- **Log it on every error**, every external call, every business event.

## Alerting

- **Alert on symptoms**, not causes. "Error rate > 1%" beats "disk usage > 90%."
- **Page on impact, not anomaly.** Disk filling up is a ticket; user-facing error rate is a page.
- **Every alert needs a runbook.** If you can't write the runbook, the alert isn't ready.
- **Alert noise is a bug.** Repeated false positives train on-call to ignore alerts. Fix or remove.

## What to add per change

For a non-trivial change, ask:

1. **Log lines** — what new events should be loggable? What context do they need?
2. **Metrics** — what new aggregates? RED for new endpoints; USE for new resources.
3. **Traces** — what new spans? Any new RPC/queue hops to propagate context across?
4. **Alerts** — does this new code path warrant a new alert? (Often no; sometimes critical.)
5. **Dashboards** — is there a dashboard panel that should be updated?

## Anti-patterns

- **Log-and-rethrow chains** — every layer logs, dashboards drown.
- **`printf("here")` debugging shipped to prod.**
- **Metrics with per-user labels.**
- **Alerts with no runbook, no owner, or no removal condition.**
- **Sampling traces away the rare cases** that are the only ones worth investigating.
- **Counting "we have logs" as observability.** Volume isn't signal.
