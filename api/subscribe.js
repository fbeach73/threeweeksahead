import postgres from "postgres";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

// Module-scoped clients are reused across warm invocations.
const sql = postgres(process.env.POSTGRES_URL);
const ses = new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" });

const FROM = process.env.SES_FROM_EMAIL || "kyle@threeweeksahead.com";

const WELCOME_SUBJECT = "Thanks — you're on the list";

const WELCOME_HTML = `<!DOCTYPE html>
<html><body style="margin:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1F1A14;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FAF7F2;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E8E1D5;border-radius:12px;padding:40px;">
        <tr><td>
          <div style="width:40px;height:2px;background:#C4641A;margin-bottom:24px;"></div>
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;line-height:1.3;margin:0 0 20px;color:#1F1A14;">Thanks — you're on the list.</h1>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;color:#1F1A14;">This is a peer-to-peer cardiac recovery channel — someone a few weeks ahead, turning around to light the path.</p>
          <p style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#1F1A14;">I'll only email when there's something worth saying: a new video, a question that helped someone else, something I wish I'd known.</p>
          <p style="font-size:16px;line-height:1.6;margin:0;color:#1F1A14;">— Kyle</p>
        </td></tr>
      </table>
      <p style="font-size:12px;color:#5C5346;margin:16px 0 0;">threeweeksahead.com</p>
    </td></tr>
  </table>
</body></html>`;

const WELCOME_TEXT = `Thanks — you're on the list.

This is a peer-to-peer cardiac recovery channel — someone a few weeks
ahead, turning around to light the path.

I'll only email when there's something worth saying: a new video, a
question that helped someone else, something I wish I'd known.

— Kyle
threeweeksahead.com`;

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
    try {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: FROM,
          Destination: { ToAddresses: [email] },
          Content: {
            Simple: {
              Subject: { Data: WELCOME_SUBJECT, Charset: "UTF-8" },
              Body: {
                Html: { Data: WELCOME_HTML, Charset: "UTF-8" },
                Text: { Data: WELCOME_TEXT, Charset: "UTF-8" },
              },
            },
          },
        })
      );
      console.log("[subscribe] Welcome sent to:", email);
    } catch (err) {
      // Best-effort: subscriber is captured even if SES has a hiccup.
      console.error("[subscribe] SES send failed:", err);
    }
  }

  return res.status(200).json({ success: true });
}
