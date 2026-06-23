import postgres from "postgres";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import crypto from "node:crypto";

// Module-scoped clients are reused across warm invocations.
const sql = postgres(process.env.POSTGRES_URL);
const ses = new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" });

const FROM = process.env.SES_FROM_EMAIL || "kyle@threeweeksahead.com";
const ADMIN_NOTIFY = process.env.ADMIN_NOTIFY_EMAIL || "kyle@threeweeksahead.com";

// Unguessable Vercel Blob URL of the lead-magnet PDF (see scripts/upload-guide.mjs).
// Delivered only to opt-ins — never linked from the public site or socials.
const GUIDE_URL = process.env.GUIDE_PDF_URL || "";

const SITE_URL = process.env.SITE_URL || "https://threeweeksahead.com";
const UNSUB_SECRET = process.env.UNSUBSCRIBE_SECRET || "";

// Signed one-click unsubscribe link (verified by api/unsubscribe.js). Drives
// both the visible footer link and the List-Unsubscribe headers Gmail rewards.
const unsubUrl = (email) => {
  const t = crypto.createHmac("sha256", UNSUB_SECRET).update(email).digest("hex");
  return `${SITE_URL}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${t}`;
};

// Hybrid newsletter: Neon is the system of record, beehiiv is the broadcast
// tool. We mirror new subscribers into beehiiv but tell it NOT to send its own
// welcome — the SES welcome above is the only welcome. Best-effort; a beehiiv
// hiccup never blocks the Neon insert.
async function syncToBeehiiv(email) {
  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !pubId) return; // beehiiv not configured yet — skip silently
  try {
    const r = await fetch(
      `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: false,
          utm_source: "threeweeksahead.com",
          referring_site: "threeweeksahead.com",
        }),
      }
    );
    if (!r.ok) {
      console.error("[subscribe] beehiiv sync failed:", r.status, await r.text());
    }
  } catch (err) {
    console.error("[subscribe] beehiiv sync error:", err);
  }
}

const WELCOME_SUBJECT = "Your guide: The First 30 Days After Bypass";

// Email-client-safe download button (table-based). Only rendered when the
// guide URL is configured, so the welcome still sends if it isn't.
const downloadButton = (url) => `
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 28px;">
            <tr><td align="center" bgcolor="#C4641A" style="border-radius:8px;">
              <a href="${url}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">Download your guide (PDF) →</a>
            </td></tr>
          </table>`;

const welcomeHtml = (guideUrl, unsub) => `<!DOCTYPE html>
<html><body style="margin:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1F1A14;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FAF7F2;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E8E1D5;border-radius:12px;padding:40px;">
        <tr><td>
          <div style="width:40px;height:2px;background:#C4641A;margin-bottom:24px;"></div>
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;line-height:1.3;margin:0 0 20px;color:#1F1A14;">Your guide is ready.</h1>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;color:#1F1A14;">Here's <em>The First 30 Days After Bypass</em> — a short, honest guide to what the first month actually looks like. No medical advice; just what's normal, what surprised me, and what to watch for.</p>
          ${guideUrl ? downloadButton(guideUrl) : ""}
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;color:#1F1A14;">This is a peer-to-peer cardiac recovery channel — someone a few weeks ahead, turning around to light the path.</p>
          <p style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#1F1A14;">I'll only email when there's something worth saying: a new video, a question that helped someone else, something I wish I'd known.</p>
          <p style="font-size:16px;line-height:1.6;margin:0;color:#1F1A14;">— Kyle</p>
        </td></tr>
      </table>
      <p style="font-size:12px;color:#5C5346;line-height:1.5;margin:16px 0 0;">Three Weeks Ahead &middot; 828 Route 636, Harvey, NB, Canada E6K 3G4<br>threeweeksahead.com${unsub ? ` &middot; <a href="${unsub}" style="color:#5C5346;text-decoration:underline;">Unsubscribe</a>` : ""}</p>
    </td></tr>
  </table>
</body></html>`;

const welcomeText = (guideUrl, unsub) => `Your guide is ready.

Here's The First 30 Days After Bypass — a short, honest guide to what the
first month actually looks like. No medical advice; just what's normal,
what surprised me, and what to watch for.
${guideUrl ? `\nDownload your guide (PDF):\n${guideUrl}\n` : ""}
This is a peer-to-peer cardiac recovery channel — someone a few weeks
ahead, turning around to light the path.

I'll only email when there's something worth saying: a new video, a
question that helped someone else, something I wish I'd known.

— Kyle
threeweeksahead.com

Three Weeks Ahead · 828 Route 636, Harvey, NB, Canada E6K 3G4
${unsub ? `\nUnsubscribe: ${unsub}` : ""}`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email =
    typeof req.body === "object" && req.body !== null
      ? String(req.body.email || "").trim().toLowerCase()
      : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  let isNew = false;
  try {
    // Idempotent insert — returns the row only when it was actually inserted.
    const inserted = await sql`
      INSERT INTO subscribers (email, source, status)
      VALUES (${email}, 'threeweeksahead-landing', 'active')
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `;
    isNew = inserted.length > 0;
  } catch (err) {
    console.error("[subscribe] DB insert failed:", err);
    return res.status(500).json({ error: "Could not save subscription" });
  }

  // Only send the welcome to brand-new subscribers, to avoid re-mailing
  // someone who resubmits the form.
  if (isNew) {
    const unsub = UNSUB_SECRET ? unsubUrl(email) : "";
    // One-click unsubscribe (RFC 8058) — strong inboxing signal for Gmail/Apple.
    const headers = unsub
      ? [
          {
            Name: "List-Unsubscribe",
            Value: `<${unsub}>, <mailto:${ADMIN_NOTIFY}?subject=unsubscribe>`,
          },
          { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
        ]
      : undefined;

    try {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: FROM,
          Destination: { ToAddresses: [email] },
          Content: {
            Simple: {
              Subject: { Data: WELCOME_SUBJECT, Charset: "UTF-8" },
              Body: {
                Html: { Data: welcomeHtml(GUIDE_URL, unsub), Charset: "UTF-8" },
                Text: { Data: welcomeText(GUIDE_URL, unsub), Charset: "UTF-8" },
              },
              ...(headers ? { Headers: headers } : {}),
            },
          },
        })
      );
      console.log("[subscribe] Welcome sent to:", email);
    } catch (err) {
      // Best-effort: subscriber is captured even if SES has a hiccup.
      console.error("[subscribe] SES send failed:", err);
    }

    // Admin notification — fire-and-forget.
    try {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: FROM,
          Destination: { ToAddresses: [ADMIN_NOTIFY] },
          Content: {
            Simple: {
              Subject: { Data: `New subscriber: ${email}`, Charset: "UTF-8" },
              Body: {
                Text: {
                  Data: `${email} just subscribed at threeweeksahead.com\n\nTime: ${new Date().toISOString()}`,
                  Charset: "UTF-8",
                },
              },
            },
          },
        })
      );
    } catch (err) {
      console.error("[subscribe] Admin notification failed:", err);
    }

    // Mirror into beehiiv for broadcasting (no-op until env vars are set).
    await syncToBeehiiv(email);
  }

  return res.status(200).json({ success: true });
}
