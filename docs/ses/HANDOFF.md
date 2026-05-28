# SES Migration — Handoff

**Last updated:** 2026-05-28
**Owner:** Kyle Sweezey
**Context:** Migrating transactional + newsletter email across the `/Users/kylesweezey/cc/` project portfolio off Mailgun ($50/mo plan) onto Amazon SES. Driver was Mailgun's per-tier domain cap forcing the expensive plan despite ~2–3k emails/month total volume.

This is the source of truth for picking up where the previous agent left off. Read it end-to-end before touching anything.

---

## 1. Companion files

- **`./ses-playbook.html`** — Open in a browser. Per-site setup checklist for verifying domains, adding DNS records, creating IAM credentials, configuring Vercel env vars, and adding optional event tracking. Has a live `{{domain}}` input that fills placeholders. **Use it for any repeatable SES setup task. Update it when patterns evolve, instead of just answering inline.**
- **Memory files** at `/Users/kylesweezey/.claude/projects/-Users-kylesweezey-cc-threeweeksahead/memory/`:
  - `MEMORY.md` — index
  - `ses-migration.md` — project status (this doc supersedes it on detail)
  - `ses-reputation-separation.md` — newsletter vs transactional reasoning
  - `ses-playbook-location.md` — points to the playbook

---

## 2. AWS account state

- **Account:** Kyle's personal AWS account (NOT a client account). Sign-up plan: **Paid** (gets $200 credit, no auto-close).
- **Region:** `us-east-1` (everything stays here).
- **Sandbox:** **OUT**. Production access granted 2026-05-27 → **50,000 emails/day quota**, **14 emails/sec**. New domains added under this account skip the wait — production access is account-wide.
- **IAM user:** `rpl-ses-sender` with `AmazonSESFullAccess`. **Reuse this user's access keys across every site** — do not create per-site IAM users.
- **Virtual Deliverability Manager (VDM):** Enabled by default in newer SES accounts. Adds a small per-message surcharge for open/click metrics. Can be disabled in SES → VDM if pure $0.10/1k pricing is wanted.

### ⚠ Security item still open
The current `rpl-ses-sender` access key/secret leaked into a previous chat transcript. **Rotate when convenient:** IAM → Users → `rpl-ses-sender` → Security credentials → deactivate + delete current key → create fresh → update Vercel env on BOTH the `rpl` and `threeweeksahead` projects + redeploy + update local `.env.local` files. ~5 min total. Not urgent if Kyle is the only one with access to the transcript.

---

## 3. Per-site status

| Site | Repo | Status | What's done | What's left |
|---|---|---|---|---|
| **RPL / publicseek.org** | `/Users/kylesweezey/cc/rpl` (master) | ✅ **FULLY ON SES** | Provider switch (`EMAIL_PROVIDER=ses\|mailgun`, defaults mailgun for rollback), `ses.ts` (SESv2, raw MIME for PDFs), `/api/webhooks/ses` SNS handler, `email_events` Drizzle table (migration 0009 pushed), Config Set `rpl-transactional` + SNS topic `rpl-ses-events` + confirmed HTTPS subscription, 7 env vars set in Vercel prod, production-tested. Send → Delivery events flowing into DB. | Watch real customer traffic for a week, then cancel Mailgun. |
| **threeweeksahead.com** | `/Users/kylesweezey/cc/threeweeksahead` (main) | ✅ **Signup → SES welcome wired** | Static HTML one-pager + single Vercel function (`api/subscribe.js`): validates email, inserts into Neon `subscribers` table (idempotent on email), sends branded welcome via SES, sends plain-text admin notification to `ADMIN_NOTIFY_EMAIL` (defaults to `kyle@threeweeksahead.com`). Cloudflare Email Routing forwards `kyle@threeweeksahead.com` → `kyle@freddybeach.com`. Domain verified in SES with custom MAIL FROM (`bounce.threeweeksahead.com`) + DMARC `p=none`. **Newsletter side not yet built** — see §5. | Newsletter/broadcast capability (see §5). |
| **painclinics.com** | `/Users/kylesweezey/cc/painclinics` | ⏳ **Still on Mailgun** | Has a substantial admin UI for broadcasts (`/admin/broadcasts`, `/admin/emails`, 9 API routes, `lib/broadcast/*`, `lib/newsletter/*`, schema tables `emailLogs`/`emailBroadcasts`/`emailUnsubscribes`/`newsletterBroadcasts`). Uses Mailgun. Kyle likes the UX. | Move transactional + newsletter sending off Mailgun (see §5 — leading candidate for "use this admin as the temp hub"). |
| **freddybeach** | `/Users/kylesweezey/cc/freddybeach` | ⏳ **Still on Mailgun** | Transactional emails: verify-email, review-collector/send, claims, admin notifications. | Drop in the RPL `ses.ts` pattern + provider switch + domain verify. ~1 hour. |
| **newsletter-pro** | `/Users/kylesweezey/cc/newsletter-pro` | ⏸ **Out of scope (handed off to client)** | Built for a client; client runs it on his own Mailgun account. Not Kyle's to migrate. | None — leave alone. Mentioned here only so future agents don't try to migrate it. |

### Production domain detail

- RPL prod URL: `https://www.publicseek.org` (apex 307-redirects to www — SNS HTTPS subscription must use `www`)
- Threeweeksahead prod URL: `https://threeweeksahead.com` (Vercel-hosted)

---

## 4. Established code pattern (for any new transactional integration)

This is what was built for RPL and is the template for painclinics, freddybeach, and any future site:

### Files to create/copy

- **`src/lib/ses.ts`** — `sendSesEmail({to, subject, html, from?, pdfBase64?, pdfFilename?})`. Uses `@aws-sdk/client-sesv2`. `SendEmailCommand` with `Content.Simple` for HTML-only, `Content.Raw` with manually-built multipart/mixed MIME for PDF attachments. Attaches `ConfigurationSetName` if set. Lazy SES client init at module scope.
- **`src/lib/email-provider.ts`** — A `sendEmail()` dispatcher that picks SES or Mailgun based on `EMAIL_PROVIDER`. **Defaults to `mailgun` for safe rollback.**
- **`email.ts` (or equivalent existing file)** — Change the import to alias: `import { sendEmail as sendMailgunEmail } from "@/lib/email-provider"`. **Don't touch the call sites.** This is the surgical minimum.
- **`src/app/api/webhooks/ses/route.ts`** (optional — only if event logging is desired) — Handles SNS `SubscriptionConfirmation` (auto-fetches `SubscribeURL`) and `Notification` (parses event, inserts into `email_events` table). Validates `TopicArn` against `SES_SNS_TOPIC_ARN` if set.
- **`email_events` table** (Drizzle, only if webhook used) — `id, message_id, event_type, recipient, subject, bounce_type, diagnostic, raw (json), created_at` + indexes on message_id, event_type, recipient, created_at.

### Env vars (per project, in Vercel + local `.env.local`)

Minimal (transactional, no event tracking):
```
EMAIL_PROVIDER          = ses
AWS_REGION              = us-east-1
AWS_ACCESS_KEY_ID       = (rpl-ses-sender's key)
AWS_SECRET_ACCESS_KEY   = (rpl-ses-sender's secret)
SES_FROM_EMAIL          = <something>@<verified-domain>
```

With event tracking:
```
SES_CONFIGURATION_SET   = <site>-transactional
SES_SNS_TOPIC_ARN       = arn:aws:sns:us-east-1:...:<topic>
```

### Order of cutover for a new site

1. Verify the domain in SES with Easy DKIM + custom MAIL FROM (`bounce.<domain>`) + DMARC `p=none`. **See `ses-playbook.html` Step 1–2 for exact clicks and DNS records.**
2. Drop in `ses.ts`, `email-provider.ts`, and the aliased import.
3. Add env vars to Vercel. **Set `EMAIL_PROVIDER=mailgun` initially** (or omit) — code is live but still using Mailgun.
4. Redeploy.
5. Test by flipping `EMAIL_PROVIDER=ses` on a Preview deployment first, fire one real send, verify delivery.
6. Flip Production once Preview is happy.
7. (Optional) Add Config Set + SNS topic + subscription + webhook handler + `email_events` table if event logging is wanted.

---

## 5. The open architectural decision: newsletter / broadcast hub

This is **where the previous agent stopped and where the next agent enters.**

### Background

Kyle wants to send weekly newsletters (his voice, his unique content — NOT AI-generated like newsletter-pro produces). He looked at three approaches and rejected newsletter-pro because it researches/synthesizes content from the web, which is wrong for a personal cardiac-recovery channel where the value IS Kyle's voice.

He explicitly named **painclinics' admin pattern (`/admin/broadcasts` + `/admin/emails` + the composer in `/admin/broadcasts/new`)** as what he wants. That pattern has:

- Broadcasts list with status filters (draft/sent), counts
- Composer page
- Per-broadcast detail/edit/send page
- 9 API routes (CRUD + send + test + duplicate + recipients + preview)
- ~7-file `lib/broadcast/*` (queries, service, targeting, merge tags)
- Schema tables (`emailLogs`, `emailBroadcasts`, `emailUnsubscribes`, `newsletterBroadcasts`)
- Still on Mailgun

### Three paths debated, no decision yet

| Path | Description | Effort | Note |
|---|---|---|---|
| **A — Build "Kyle's Mailer" hub** as a new standalone Next.js app modeled on painclinics' broadcast system, generic from day one (multi-site, shared Neon) | New repo + Vercel deploy | **1–2 weeks** | The right long-term answer. Real work. |
| **B — Add `/admin/broadcasts` directly into threeweeksahead** (convert from static HTML to Next.js, copy painclinics' broadcast code, simplify) | Per-site admin | ~4–5 days | Faster than A, but you re-do it per site (and per-site admin auth is more surface). |
| **C — Migrate painclinics to SES first, then *use painclinics' admin as the temp hub*** by feeding it threeweeksahead subscribers (separate list, separate sending subdomain) | No new app | ~2–3 days | Pragmatic interim. Couples threeweeksahead's sends to painclinics. Refactor to A later when usage data informs it. |

### Kyle's leaning as of 2026-05-28

He decided **NOT to rush** because if the first 3-pack of videos drops and the channel "tanks or barely gets clicks" (his words), the urgency is lower than initially framed. Subscribers still land in Neon either way. He wants to **move painclinics off Mailgun first** (the broader Mailgun-decoupling effort), then revisit the hub decision once we have real signal.

So the immediate next step is **painclinics SES migration**, NOT building a hub app yet.

### What the next agent should do

1. **Confirm with Kyle** that the order is: (a) painclinics transactional + newsletter onto SES first, (b) decide hub direction afterward based on what we learn from doing painclinics.
2. **Plan painclinics' migration** treating it as the dual-stream blueprint:
   - Verify `painclinics.com` + a separate **`news.painclinics.com`** subdomain (per reputation-separation rule)
   - Two configuration sets: `painclinics-transactional` and `painclinics-newsletter`
   - Replace the Mailgun calls in `src/lib/email.ts` and `src/lib/broadcast/broadcast-service.ts` (and anywhere else they live — confirm with grep) using the same `email-provider.ts` switch pattern
   - The painclinics broadcast/newsletter system manages its own subscriber lists in `emailBroadcasts`/`newsletterBroadcasts` tables — no change to that, just swap the *send* call
   - Shared webhook OK (same `/api/webhooks/ses`); use the config set to distinguish which stream an event came from
3. **Build the unsubscribe + List-Unsubscribe header path** in painclinics if it isn't fully there (Gmail/Yahoo require this since Feb 2024 for any bulk sender).
4. **Only after painclinics is on SES and Kyle has sent a few real broadcasts**, revisit the hub decision (Path A/B/C). Likely outcome: Path A becomes more attractive once Kyle has real workflow data, OR Path C is "good enough" indefinitely and the hub stays virtual.

### Things that must NOT happen

- **Do not start building a brand-new hub app before painclinics is migrated.** Wasted work — the hub's shape depends on what painclinics teaches us.
- **Do not couple the hub to painclinics' clinic-targeting code.** That code (`lib/broadcast/clinic-targeting.ts`, `contact-targeting.ts`) is domain-specific and should stay in painclinics. Any hub extraction strips those.
- **Do not auto-deploy any code that flips `EMAIL_PROVIDER=ses` in production** without Kyle's explicit go on the per-site basis. The pattern is: code lands with `EMAIL_PROVIDER` defaulting/staying at mailgun, then flipped via env var when ready.

---

## 6. Common gotchas (also in the playbook, but bears repeating)

- **Cloudflare DNS double-append:** name field is `_dmarc`, not `_dmarc.<domain>`. Cloudflare appends the zone automatically.
- **Cloudflare DKIM proxy:** DKIM CNAMEs **must** be grey-clouded (DNS only). Orange = broken.
- **Apex 307 redirects:** SNS HTTPS subscriptions don't handle redirects well. Always subscribe to the `www.` URL if the apex 307s.
- **Vercel env changes need a redeploy** — they don't apply to existing deployments.
- **MAIL FROM subdomain conflict:** never reuse a subdomain that has another mail system on it (e.g., `mail.<domain>` if Mailgun is set up there). Always use `bounce.<domain>` for SES MAIL FROM.
- **SES production access is account-wide and one-time.** New domains skip the wait.
- **Bounce/complaint rate is account-level in SES** — newsletter complaints can suspend the whole account, including transactional. Separation by subdomain protects inbox placement at Gmail/Outlook, NOT against AWS suspension. So **list hygiene on newsletters is the real protection**: opt-in only, one-click List-Unsubscribe, suppress fast.

---

## 7. Glossary of file references for fast orientation

| Concept | Where |
|---|---|
| SES sender pattern (template) | `/Users/kylesweezey/cc/rpl/src/lib/ses.ts` |
| Provider switch (template) | `/Users/kylesweezey/cc/rpl/src/lib/email-provider.ts` |
| Webhook handler (template) | `/Users/kylesweezey/cc/rpl/src/app/api/webhooks/ses/route.ts` |
| `email_events` schema (template) | `/Users/kylesweezey/cc/rpl/src/lib/schema.ts` (lines ~240–260 area) |
| Diagnostic — query email_events | `/Users/kylesweezey/cc/rpl/scripts/check_events.mjs` |
| Diagnostic — query subscribers | `/Users/kylesweezey/cc/threeweeksahead/scripts/check_db.mjs` |
| Diagnostic — direct SES send test | `/Users/kylesweezey/cc/threeweeksahead/scripts/check_ses.mjs` |
| Simple Vercel function (signup form pattern) | `/Users/kylesweezey/cc/threeweeksahead/api/subscribe.js` |
| Subscribers table schema (canonical for one-pagers) | `/Users/kylesweezey/cc/threeweeksahead/scripts/check_db.mjs` ← used; SQL is in playbook Step 4 |
| Painclinics broadcast admin | `/Users/kylesweezey/cc/painclinics/src/app/admin/broadcasts/` |
| Painclinics broadcast service | `/Users/kylesweezey/cc/painclinics/src/lib/broadcast/broadcast-service.ts` |
| Setup playbook | `./ses-playbook.html` (this folder) |

---

## 8. What to read first if you're a fresh agent

1. This file, top to bottom.
2. `ses-playbook.html` — open in a browser, scan all sections.
3. `/Users/kylesweezey/cc/rpl/src/lib/ses.ts` + `email-provider.ts` — the concrete pattern.
4. Then ask Kyle which site is next.

Do not start work without confirming the current priority with Kyle. The state captured here is current as of 2026-05-28; he may have changed direction.
