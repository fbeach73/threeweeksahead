# Three Weeks Ahead

Landing page for the **Three Weeks Ahead** YouTube channel — a peer-to-peer cardiac recovery channel.

Live domain: **threeweeksahead.com**

## Stack

Pure static site. One HTML file, one image, no build step, no dependencies.

```
threeweeksahead/
├── index.html   # full page, all CSS inline, placeholder JS form handlers
├── hero.jpg     # Lake George winter hero background
└── README.md
```

## Local preview

Open `index.html` in a browser, or:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy

Hosted on Vercel. Pushes to `main` auto-deploy.

1. Push the repo to GitHub.
2. Import into Vercel — it auto-detects as static, no config needed.
3. Add `threeweeksahead.com` as a custom domain in Vercel project settings, then point Cloudflare DNS at Vercel per their instructions.

## ⚠️ Next step before launching: wire the forms

Both forms (`#guide` signup + `#ask` question form) currently just `console.log` the submission and show a success message. **They do not send email yet.**

Before going live, replace the placeholder `handleSignup` and `handleAsk` functions at the bottom of `index.html` with real submissions to an email provider:

- **Signup form** → ConvertKit (Kit) or MailerLite. Both have free tiers and built-in PDF delivery automations.
- **Ask form** → a separate endpoint (Vercel serverless function that emails Kyle, or a second provider list).

API keys will be added in a later session.

## Design system

See `site-handoff/HANDOFF.md` for tokens, fonts, voice, and roadmap.
