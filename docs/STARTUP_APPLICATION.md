# Claude for Startups — application draft (Cluvyra)

> **Draft — not submitted.** The owner reviews and submits it personally at
> https://claude.com/programs/startups. Nothing here claims Anthropic support, funding, a registered
> company or customers.

## Program requirements (re-checked 2026-10-13 on the official page)

Requirements change — re-check the page right before applying.

| Requirement (official page) | Cluvyra status |
|---|---|
| Startup founded in the last 5 years or funded in the last 2 | ✅ Founded 2026 (product stage). *Owner: confirm founding date wording; no funding.* |
| Claude Console account | ⏳ To create (owner) |
| Company email **matching the website domain** | ✅ `hello@cluvyra.pro` on `cluvyra.pro` (forwarding) |
| Website | ✅ https://cluvyra.pro (Railway, HTTPS) |
| Short description of what you are building | ✅ Draft below |
| Compliance with Anthropic’s supportability policies | ✅ Fitness/wellness SaaS; no medical advice; *owner to read the policy* |

Current page (2026-10-13), summarised: open to bootstrapped, pre-seed and venture-backed startups;
apply by signing in to the Claude Console; Anthropic aims to review within about a week and emails a
decision. Benefits named: higher API rate limits for members who receive program credits, "Startup
Stack" partner offers (third-party discounts, not from Anthropic), bi-weekly applied-AI office hours.
**The page states Anthropic is currently over capacity on the Claude Team and $1,000 API credit
offers and is re-reviewing applications — do not assume these benefits will be granted.** Credits (if
granted) apply only to the first-party Claude API via Console, not Bedrock/Vertex. Earlier notes
about "one year of Claude Team" and "$1,000 credits" may be outdated — rely on the live page.

---

## Application answers (ready to paste)

**Company / product name:** Cluvyra

**Website:** https://cluvyra.pro

**Company email:** hello@cluvyra.pro (receive-only forwarding to the founder; use a personal address on the same domain for the Console account if one is created)

**Category:** B2B SaaS — fitness & wellness technology

**Stage:** Early-stage MVP. Pre-revenue, bootstrapped, no external funding, no registered legal entity yet (sole founder).

**Founded:** 2026 (product development as Cluvyra began in October 2026; it evolved from an earlier course project, see below).

**One-line description:**
Cluvyra is an AI-powered management platform for fitness and wellness studios — bookings, schedules, memberships, clients and communication in one place, with a Claude-powered booking assistant.

**What are you building? (short)**
Cluvyra helps small fitness and wellness studios run their business: customer and membership management, class scheduling, online booking, staff tools, notifications and analytics. Its core AI feature is a conversational booking assistant powered by Claude: a member writes “I want a group class tomorrow after 6 pm”, Claude calls our backend tools to search the real schedule, proposes concrete classes with free spots, and a booking is created only after the member confirms and the server re-checks every rule.

**What are you building? (detailed)**
Studios today answer the same scheduling questions all day by phone and chat, and members drop off when booking is inconvenient. Cluvyra puts a studio’s schedule, memberships and clients in one system with role-based cabinets (member, trainer, admin, manager) and a PWA front end, and adds a Claude assistant that handles natural-language booking in Ukrainian and English. Claude never touches the database: it can only call a small set of validated, user-scoped tools (search classes, check availability, my bookings, my membership, prepare booking). Creating the booking is a separate server-side step that needs the member’s explicit confirmation (single-use, user-bound, expiring token that the model never sees). The backend enforces capacity, membership validity, duplicates and timezone (Europe/Kyiv) rules, with row locks so two people cannot take the last seat.

**Problem:** Small studios lack affordable, modern tooling; scheduling and booking is manual and error-prone, and generic chatbots cannot be trusted to make real bookings.

**Target audience:** Independent yoga, pilates, fitness and personal-training studios and small gyms (starting in Ukraine/Eastern Europe).

**Differentiation:** Natural-language booking that is safe by design (tool use + server-side confirmation + authorization), built for small studios rather than enterprise gym chains.

**Why Claude?**
Claude’s tool use and instruction following let us turn free-form requests (“tomorrow after 6”, in Ukrainian or English) into precise tool calls and clear answers, while our backend keeps full control of authorization and business rules. Cost-conscious model choice (Claude Sonnet 5.5 by default, configurable) keeps short booking dialogs affordable for a small-studio product.

**How do you use Claude today? (verified facts)**
- Official `@anthropic-ai/sdk` on a Node.js backend; model set via `ANTHROPIC_MODEL` (currently `claude-sonnet-5-5`).
- Manual tool-use loop, five read-only/prepare-only tools, bounded rounds, timeouts, refusal handling, per-user rate limits and daily caps, usage metrics without message content.
- **Live check on 2026-10-13 (production environment, synthetic demo data):** the model answered; a request for “tomorrow after 18:00” triggered one tool call and returned the two real classes after 18:00 from PostgreSQL (≈4.2 s, ≈4.8k input / 0.2k output tokens); preparing and confirming created a real booking row, which the test then cancelled. Total test spend well under $0.05.
- Automated tests (79 unit, 53 integration against real PostgreSQL) use a mock provider.

**Current traction:** None yet — no customers, revenue, pilots or partnerships. A working MVP and a public demo exist; the next step is finding the first pilot studios.

**Planned (not built yet):** AI lead recovery, follow-ups after missed classes or expiring memberships, staff copilot, attendance-based personalisation, AI business insights, multi-tenant data model, payment provider integration.

**How will credits/benefits be used?**
Production traffic for the booking assistant in pilot studios, evaluation runs to tune prompts and effort settings, and prototyping the planned follow-up and staff-copilot workflows. We do not expect or assume that Team seats or $1,000 credits will be granted.

**Partner VC / accelerator referral:** None.

**Founder:** *Fill in your name, role and links in the form — not stored in this repository.*

---

## Before submitting — checklist (status 2026-10-13)

- [x] Domain `cluvyra.pro` registered, verified, HTTPS valid, attached to the Railway service
- [x] `hello@cluvyra.pro` forwarding to founder’s inbox (receive-only)
- [x] Production deployment on Railway (service live; live Claude booking flow verified)
- [x] Privacy Policy and Terms completed (operator = individual founder; no entity)
- [ ] Open https://cluvyra.pro in a browser: landing, `/privacy`, `/terms`, demo-request form
- [ ] Browser walk-through of the demo script on the live URL (see `docs/DEMO_SCRIPT.md`)
- [ ] Claude Console account created with an email on `cluvyra.pro`
- [ ] Rotate the Gmail app password that was pasted into a chat; rotate demo account passwords
- [ ] Re-read the live program page right before submitting
- [ ] Application submitted by the founder (not automated)

## Product origin (state plainly if asked)

Cluvyra evolved from a working sports-club management application first built as a university course
project. It is being developed into an independent AI-powered SaaS product for fitness and wellness
businesses.

## Status separation (do not blur in the form)

| Item | State |
|---|---|
| Booking, schedules, memberships, roles, PWA, landing, demo-request form | **Implemented**; verified locally (79 unit + 53 integration tests, real PostgreSQL) |
| Claude tool-use booking flow | **Implemented**; verified with a mock provider only |
| Live Claude API call, live Railway deployment, SMTP, custom domain | **Pending external verification** (needs owner's Railway/Anthropic access) |
| Lead recovery, follow-ups, staff copilot, insights, multi-tenancy | **Planned** |

## 3-month roadmap (plan, not commitment)

1. Month 1 — live deployment + domain/mailbox, run the demo script live, 2–3 pilot conversations with local studios.
2. Month 2 — English cabinet UI, HttpOnly-cookie sessions, payment provider integration.
3. Month 3 — AI follow-up for missed classes / expiring memberships; multi-tenant data model.

## First-users plan

Direct outreach to small local studios (yoga, pilates, personal training) with a free pilot; the
landing "Request a Demo" form stores leads; no testimonials or metrics are published until real.
