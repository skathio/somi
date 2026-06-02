---
name: market-research
description: Use when researching a software idea before specifying it — scanning competitors, mining real user complaints and churn reasons, finding recurring failure modes to design away from, and turning that evidence into requirements, non-goals, and risks. Covers where to look, signal-vs-noise, citation discipline, and how to avoid fabrication and confirmation bias.
---

# Market & competitive research

This skill powers the research half of the discovery phase. The owning agent is
[`discovery-analyst`](../../agents/discovery-analyst.md); the output of this research feeds directly
into [`requirements-engineering`](../requirements-engineering/SKILL.md) — every finding should become
a requirement, a non-goal, or a risk, or it was wasted effort.

The honesty floor is in [`rules/00-priorities.md`](../../rules/00-priorities.md) ("identify
uncertainty; verify before claiming; don't invent facts to sound confident"). This skill is the
operational version of that rule applied to research: **cite or qualify everything, fabricate
nothing.**

## Why research before requirements

Most products fail at problems someone already solved badly, in ways that are publicly documented.
The competition has already run the experiment and the users have already written down what hurts.
Reading that record is the cheapest risk reduction available — and skipping it means re-discovering
known failure modes with your own users' patience.

The goal is not a generic industry summary. It is a **specific, cited map** of: who else does this,
where they fall down, what users leave over, and what gap is open.

## Where to look

| Source | What it tells you |
|--------|-------------------|
| Competitor **marketing pages** | Claimed value, target persona, positioning |
| Competitor **pricing pages** | Where the money and the pain are; packaging friction |
| Competitor **changelogs / roadmaps** | What they're racing to fix (their known weaknesses) |
| Competitor **docs / help center** | What's hard enough to need explaining (complexity tax) |
| **Review platforms** (G2, Capterra, Trustpilot, app stores) | Structured praise *and* complaints at volume |
| **Community threads** (Reddit, Hacker News, Stack Overflow, niche forums) | Unfiltered pain, workarounds, "why we left X" |
| **Public issue trackers** (GitHub issues, support forums) | Concrete bugs, long-standing unmet requests |
| **Shutdown / migration posts** | What made incumbents lose users — the strongest signal |

## What to extract (organize the report around these)

- **Recurring complaints** — the same pain from many independent users. Your must-avoid list; rich
  source of requirements and non-goals.
- **Churn / abandonment reasons** — what made people *leave*. Designing away from these usually beats
  any new feature.
- **Unmet demand** — features repeatedly requested and never delivered. Candidate differentiators.
- **Reliability / performance / security / UX friction** — the non-functional reasons trust erodes.
  These become NFRs with numbers.
- **Pricing / packaging pain** — where the commercial model frustrates users; informs scope even when
  out of code scope.

## Jobs-to-be-done framing

Don't catalogue features — find the **job** the user hires the product to do. "People don't want a
quarter-inch drill; they want a quarter-inch hole." When you frame around the job, you see substitutes
the feature list misses (a spreadsheet, a manual process, a competitor in an adjacent category) and
you avoid building a slightly-different version of a tool people already resent.

## Signal vs noise — the discipline that makes research trustworthy

- **One angry review is noise.** The *same* complaint across many independent sources is **signal**.
  Always say which you have ("cited across 30+ reports" vs "one user mentioned").
- **Recency matters** — a complaint about a bug fixed last year is stale. Date your findings and
  check whether the changelog already addressed them.
- **Beware survivorship & selection bias** — review sites skew to extremes (delighted or furious);
  forums skew technical. Triangulate across source *types*, not just count.
- **Separate fact from inference** — "users report X" (fact, cited) vs "this suggests Y" (your
  inference, labeled).

## Citation discipline (non-negotiable)

- **Cite every non-obvious claim** with a URL or a clearly named source. A complaint without a source
  is an opinion.
- **Never fabricate** a competitor, a statistic, a review quote, or a citation. This is the cardinal
  sin of this phase: an invented competitor weakness can steer the entire project wrong, and it looks
  exactly as authoritative as a real one.
- **"No evidence found" is a valid, valuable result.** It tells the team a claim is an assumption to
  validate, not a fact to build on. Say it plainly.
- **Quote sparingly and attribute** — a short representative quote is fine; don't paste walls of
  copyrighted text.

## From research to requirements (the whole point)

Every finding must land somewhere downstream, or cut it:

```
Recurring complaint   → FR / NFR (build the thing they're missing, correctly)
Churn reason          → NFR or non-goal (design away from the abandonment driver)
Unmet demand          → differentiator FR (Should/Could) or explicit "Won't, because…"
Known failure mode    → Risk + mitigation (verify our approach doesn't inherit it)
Pricing/UX friction   → scope/non-goal in the BRD
```

See the worked trace in [`discovery-analyst`](../../agents/discovery-analyst.md) ("Example of a good
research-to-requirement trace").

## Anti-patterns to call out

- **Fabrication** — inventing competitors, numbers, or quotes. Disqualifying.
- **Hollow authority** — confident prose, zero citations. Cite or qualify.
- **Confirmation bias** — researching only what supports the idea you already like. Actively look for
  why the idea might be redundant or wrong; record the strongest counter-case.
- **Feature-listing** — cataloguing competitor features instead of finding the *job* and the *pain*.
- **Research theatre** — gathering complaints and never converting them to requirements/risks. If a
  finding doesn't change a document, it didn't matter.
- **Stale-as-fresh** — citing old complaints a changelog already fixed.
- **Single-source confidence** — treating one thread as a market truth.

## When *not* to over-apply

- For an **internal tool with no external competition**, the "research" is interviewing the actual
  users/stakeholders, not scanning G2 — adapt the method, keep the discipline (cite who said what).
- For a **well-understood incremental feature**, deep market research is overkill — a quick check of
  how the current product and one or two peers handle it is enough.
- Don't let research become an excuse to delay; **time-box** it and note what you'd still validate.

## When to escalate / hand off

- **To the user (verification protocol)** — when the research surfaces a strategic fork (which
  competitor weakness to attack, which persona to serve). Present options grounded in the findings.
- **To [`requirements-engineering`](../requirements-engineering/SKILL.md)** — to convert findings into
  testable, traceable requirements.
- **To [`threat-modeling`](../threat-modeling/SKILL.md)** — when competitor *security* failures are a
  recurring complaint; they become security NFRs and trust-boundary requirements.
