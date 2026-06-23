import postgres from "postgres";
import crypto from "node:crypto";

// Module-scoped client is reused across warm invocations.
const sql = postgres(process.env.POSTGRES_URL);

const SECRET = process.env.UNSUBSCRIBE_SECRET || "";

// Token = HMAC-SHA256(email, secret). Used in the List-Unsubscribe link so a
// recipient (or Gmail's one-click POST) can opt out without auth, but nobody
// can unsubscribe someone else without a valid signature.
export function unsubToken(email) {
  return crypto.createHmac("sha256", SECRET).update(email).digest("hex");
}

function valid(email, token) {
  if (!SECRET || !email || !token) return false;
  const expected = unsubToken(email);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const PAGE = (msg) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe — Three Weeks Ahead</title></head>
<body style="margin:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1F1A14;">
  <div style="max-width:480px;margin:80px auto;padding:0 24px;text-align:center;">
    <div style="width:40px;height:2px;background:#C4641A;margin:0 auto 24px;"></div>
    <p style="font-size:18px;line-height:1.6;">${msg}</p>
    <p style="font-size:13px;color:#5C5346;margin-top:32px;">threeweeksahead.com</p>
  </div>
</body></html>`;

export default async function handler(req, res) {
  // Email + token always come from the URL query (Gmail's one-click POST keeps
  // them there and puts only "List-Unsubscribe=One-Click" in the body).
  const q = req.query || {};
  const email = String(q.e || "").trim().toLowerCase();
  const token = String(q.t || "");

  if (!valid(email, token)) {
    // One-click POST expects a 2xx; humans get a readable page.
    if (req.method === "POST") return res.status(400).json({ error: "Invalid link" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(PAGE("This unsubscribe link is invalid or expired."));
  }

  try {
    await sql`UPDATE subscribers SET status = 'unsubscribed' WHERE email = ${email}`;
  } catch (err) {
    console.error("[unsubscribe] DB update failed:", err);
    if (req.method === "POST") return res.status(500).json({ error: "Could not unsubscribe" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(PAGE("Something went wrong. Please reply to the email and I'll remove you."));
  }

  console.log("[unsubscribe] Unsubscribed:", email);

  // Gmail/Apple one-click POST just needs a 2xx.
  if (req.method === "POST") return res.status(200).json({ success: true });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(
    PAGE("You're unsubscribed. You won't get any more emails from me.<br><br>Take care — Kyle")
  );
}
