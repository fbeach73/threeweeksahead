import crypto from "node:crypto";

// Same-domain download link for the lead-magnet PDF. The welcome email points
// here instead of at the raw Vercel Blob URL so every link in the email shares
// the sender's domain (a Gmail reputation signal). The blob URL stays gated:
// this route only redirects when the signed token for the recipient's email is
// valid. No DB access, so it never wakes Neon.
const SECRET = process.env.UNSUBSCRIBE_SECRET || "";
const GUIDE_URL = process.env.GUIDE_PDF_URL || "";

export function guideToken(email) {
  return crypto.createHmac("sha256", SECRET).update(`guide:${email}`).digest("hex");
}

function valid(email, token) {
  if (!SECRET || !email || !token) return false;
  const a = Buffer.from(guideToken(email));
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const PAGE = (msg) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your guide — Three Weeks Ahead</title></head>
<body style="margin:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1F1A14;">
  <div style="max-width:480px;margin:80px auto;padding:0 24px;text-align:center;">
    <div style="width:40px;height:2px;background:#C4641A;margin:0 auto 24px;"></div>
    <p style="font-size:18px;line-height:1.6;">${msg}</p>
    <p style="font-size:13px;color:#5C5346;margin-top:32px;"><a href="https://threeweeksahead.com/#guide" style="color:#9A4A12;">threeweeksahead.com</a></p>
  </div>
</body></html>`;

export default async function handler(req, res) {
  const q = req.query || {};
  const email = String(q.e || "").trim().toLowerCase();
  const token = String(q.t || "");

  if (!GUIDE_URL || !valid(email, token)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(PAGE("This download link is invalid. Sign up again at threeweeksahead.com and a fresh one will be emailed to you."));
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", GUIDE_URL);
  return res.status(302).end();
}
