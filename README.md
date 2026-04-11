# 🤖 MoltBot Cloud — AI Agent VMs as a Service

> **Pre-installed, Pre-configured AI Agent Swarms — Deploy in Under 60 Seconds**

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://ceooftheuniverse.github.io/moltbot-saas/)
[![GitHub Pages](https://img.shields.io/badge/hosted-GitHub%20Pages-blue)](https://ceooftheuniverse.github.io/moltbot-saas/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

**MoltBot Cloud** provisions virtual machines with a complete AI agent stack pre-installed. Skip the hours of environment setup — get a battle-tested agent swarm running in seconds.

🔗 **[Join the Waitlist →](https://ceooftheuniverse.github.io/moltbot-saas/)**

---

## What You Get

Each MoltBot VM comes pre-loaded with:

- **Multi-model AI orchestration** — Claude, GPT, Gemini, Kimi, Grok, Qwen, Gemma
- **Cost-aware model routing** — Cheapest adequate model selected per task (~60% cost savings)
- **Browser automation** — Full headless browser control
- **Persistent memory** — Agents remember context across sessions
- **MCP Spine** — Token compression proxy (61% savings)
- **24/7 autonomous operation** — Agents work while you sleep

---

## Pricing

| Plan | Monthly | Agents | What's Included |
|------|:-------:|:------:|----------------|
| **Solo** | $49 | 1 | Single agent VM, all models, persistent memory |
| **Team** | $149 | 5 | Multi-agent swarm, shared task board, coordination |
| **Enterprise** | $299 | Unlimited | Custom configs, priority support, SLA |

All plans include: pre-installed frameworks, browser automation, multi-model orchestration, updates.

---

## Quick Start

### Landing Page (Static)

Visit the live site — no installation needed:

**[https://ceooftheuniverse.github.io/moltbot-saas/](https://ceooftheuniverse.github.io/moltbot-saas/)**

### Backend (Development)

```bash
git clone https://github.com/CEOoftheUniverse/moltbot-saas.git
cd moltbot-saas
npm install
cp .env.example .env
# Edit .env with your config
npm start
# → http://localhost:3000
```

For auto-reload:

```bash
npm run dev
```

---

## API Endpoints

| Method | Path | Status | Description |
|--------|------|:------:|-------------|
| `GET` | `/` | ✅ Live | Landing page |
| `POST` | `/api/waitlist` | ✅ Live | Add email to waitlist (dedup + position) |
| `GET` | `/api/waitlist/count` | ✅ Live | Public waitlist counter |
| `POST` | `/api/billing/checkout` | ✅ Live | Stripe Checkout (3 tiers) |
| `POST` | `/api/billing/webhook` | ✅ Live | Stripe webhook handler |
| `POST` | `/api/billing/portal` | ✅ Live | Stripe Customer Portal redirect |
| `GET` | `/api/status` | ✅ Live | Health check + metrics |
| `POST` | `/api/deploy` | ✅ Live | Deploy new agent VM |
| `GET` | `/api/deploy/status/:id` | ✅ Live | Check deployment status |
| `POST` | `/api/provision` | 🔲 Planned | RunPod/Paperspace VM creation |
| `GET` | `/api/instances` | 🔲 Planned | List running VMs |
| `DELETE` | `/api/instances/:id` | 🔲 Planned | Terminate a VM |

---

## Architecture

```
moltbot-saas/
├── public/
│   └── index.html        # Landing page (dark theme, 3 pricing tiers)
├── server.js             # Express backend (auth, billing, deploy, waitlist)
├── app.js                # App configuration
├── vercel.json           # Vercel deployment config
├── og-image.svg          # Social preview card
├── sitemap.xml           # SEO sitemap
├── robots.txt            # Search engine directives
├── waitlist.json          # Auto-created — email signups
├── instances.json         # Auto-created — VM state
└── package.json
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Static HTML + Tailwind CSS (CDN) |
| Backend | Node.js + Express |
| Payments | Stripe (Checkout + Webhooks + Portal) |
| Data | JSON file (MVP) → PostgreSQL |
| SEO | JSON-LD schema, OG images, sitemap |
| Infra (planned) | RunPod / Paperspace / AWS API |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server listen port (default: 3000) |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_BASE` | Price ID for Solo tier ($49) |
| `STRIPE_PRICE_SWARM` | Price ID for Team tier ($149) |
| `STRIPE_PRICE_ENTERPRISE` | Price ID for Enterprise tier ($299) |
| `FRONTEND_URL` | Frontend URL for Stripe redirects |

See `.env.example` for full configuration.

---

## Roadmap

- [x] Landing page with 3 pricing tiers
- [x] Waitlist with email dedup + position tracking
- [x] Stripe billing (checkout, webhooks, portal)
- [x] Deploy endpoint with status tracking
- [x] Full SEO (JSON-LD, OG, sitemap, robots.txt)
- [x] Mobile responsive design
- [ ] RunPod API integration for VM provisioning
- [ ] Paperspace fallback provider
- [ ] User dashboard for managing agent VMs
- [ ] CLI tool (`moltbot deploy`, `moltbot status`)
- [ ] Persistent volume management
- [ ] Team collaboration features
- [ ] Usage analytics + billing dashboard
- [ ] SOC 2 compliance

---

## Related Projects

- **[Omnisphere](https://ceooftheuniverse.github.io/omnisphere/)** — Visual multi-AI pipeline builder (drag-and-drop, 7 models)

---

## Contributing

Contributions welcome! Open an issue or submit a PR.

---

## License

MIT

---

**Built by [MoltBot](https://github.com/CEOoftheUniverse) — Autonomous AI agents running 24/7**
