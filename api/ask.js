import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

// Module-scoped client is reused across warm invocations.
const ses = new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" });

const FROM = process.env.SES_FROM_EMAIL || "kyle@threeweeksahead.com";
const TO = process.env.ADMIN_NOTIFY_EMAIL || "kyle@threeweeksahead.com";

const esc = (s = "") =>
  String(s).replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body =
    typeof req.body === "object" && req.body !== null ? req.body : {};
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const stage = String(body.stage || "").trim();
  const question = String(body.question || "").trim();

  if (!question || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Email and question required" });
  }

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1F1A14;">
  <h2 style="margin:0 0 16px;">New question — Three Weeks Ahead</h2>
  <p style="margin:0 0 8px;"><strong>Name:</strong> ${esc(name) || "(none)"}</p>
  <p style="margin:0 0 8px;"><strong>Email:</strong> ${esc(email)}</p>
  <p style="margin:0 0 8px;"><strong>Stage:</strong> ${esc(stage) || "(none)"}</p>
  <p style="margin:16px 0 8px;"><strong>Question:</strong></p>
  <p style="margin:0;white-space:pre-wrap;">${esc(question)}</p>
</body></html>`;

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [TO] },
        ReplyToAddresses: [email],
        Content: {
          Simple: {
            Subject: {
              Data: `New question from ${name || email}`,
              Charset: "UTF-8",
            },
            Body: { Html: { Data: html, Charset: "UTF-8" } },
          },
        },
      })
    );
  } catch (err) {
    console.error("[ask] SES send failed:", err);
    return res.status(500).json({ error: "Could not send question" });
  }

  return res.status(200).json({ success: true });
}
