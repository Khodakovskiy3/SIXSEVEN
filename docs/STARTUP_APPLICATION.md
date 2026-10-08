# Claude for Startups — application draft (Cluvyra)

> **Draft — not submitted.** The owner reviews and submits it personally at
> https://claude.com/programs/startups. Nothing here claims Anthropic support, funding, a registered
> company or customers.

## Program requirements (checked 2026-10-08 on the official page)

Requirements change — re-check the page right before applying.

| Requirement (official page) | Cluvyra status |
|---|---|
| Startup founded in the last 5 years or funded in the last 2 | ✅ Founded 2026 (product stage). *Owner: confirm founding date wording; no funding.* |
| Claude Console account | ⏳ To create (owner) |
| Company email **matching the website domain** | ⏳ Blocked: `cluvyra.com` and `hello@cluvyra.com` are not purchased yet |
| Website | ⏳ Deploy landing to Railway; ideally on `cluvyra.com` before applying |
| Short description of what you are building | ✅ Draft below |
| Compliance with Anthropic’s supportability policies | ✅ Fitness/wellness SaaS; no medical advice; *owner to read the policy* |

Benefits listed on the page at the time of checking: one year of Claude Team (up to 5 seats if new
to Team), $1,000 in Claude API credits, higher API rate limits, partner offers, office hours and
events; additional credits for founders backed by Anthropic partner VCs/accelerators (not
applicable). Credits expire six months after grant and apply only to the first-party Claude API.
Third-party articles mention other amounts — rely on the official page only.

**Recommended order:** buy domain → set up `hello@cluvyra.com` → deploy to Railway with the custom
domain → create the Claude Console account with the company email → apply.

---

## Application answers (draft)

**Company / product name:** Cluvyra

**Website:** https://cluvyra.com *(planned — use the Railway URL until the domain is live, if the form allows)*

**Company email:** hello@cluvyra.com *(planned)*

**Category:** B2B SaaS / Fitness & Wellness Technology

**Stage:** Early-stage MVP (pre-revenue, no institutional funding)

**Founding / funding:** *Owner to fill: founding date; “bootstrapped, no external funding”.*

**One-line description:**
Cluvyra is an AI-powered management platform for fitness and wellness businesses — bookings,
schedules, memberships, clients and communication in one place.

**What are you building? (short)**
Cluvyra is an AI-powered management platform for fitness and wellness businesses. It brings
customer management, class scheduling, memberships, bookings and communication into one system.

We are developing Claude-powered conversational workflows that help customers discover suitable
classes, check real availability and complete bookings through natural language.

**Why Claude?**
Claude powers natural-language assistance and booking intent understanding. We integrate Claude with
controlled backend tools so customer requests turn into real bookings while the server enforces
authentication, capacity and membership rules. Claude handles the conversation in Ukrainian and
English — understanding dates like “tomorrow after 6 pm”, asking only for missing details and
explaining options — while every action goes through validated, user-scoped tools and an explicit,
server-side confirmation step.

**How do you use Claude today? (factual)**
- Official `@anthropic-ai/sdk` on our Node.js backend, model configurable (default `claude-opus-5-5`).
- Manual tool-use loop with five read-only / prepare-only tools (search classes, check availability,
  my bookings, my membership, prepare booking). Booking creation requires the member to press
  “Confirm”; the confirmation token is never visible to the model.
- Cost and safety controls: per-user rate limits and daily caps, bounded tool rounds, timeouts,
  usage metrics without message content, refusal handling.
- Automated tests use a mock provider (no API spend in CI).

**Current traction:** *Owner to fill honestly.* Suggested: “Working MVP with a demo studio (synthetic
data); preparing first pilot conversations with local studios.” Do not list customers or revenue
that do not exist.

**Planned expansion (not yet built):**
- AI lead recovery (re-engaging people who asked but did not book)
- Customer follow-up after missed classes or expiring memberships
- Staff copilot for the front desk
- Personalised assistance based on attendance history
- AI business insights for studio owners

**How will credits be used?**
Production traffic of the booking assistant for pilot studios, evaluation runs to tune prompts and
effort settings, and prototyping the planned follow-up and staff-copilot workflows.

**Partner VC / accelerator referral:** None.

---

## Before submitting — checklist

- [ ] Domain `cluvyra.com` purchased; DNS configured
- [ ] Mailbox `hello@cluvyra.com` working (SPF/DKIM)
- [ ] Production deployment reachable over HTTPS; landing, `/privacy`, `/terms` reviewed by owner
- [ ] Privacy Policy “Owner to confirm” items completed
- [ ] Claude Console account created with the company email; API key stored only in Railway
- [ ] Answers above reviewed; traction statement accurate
- [ ] Application submitted by the owner (not automated)
