# MoltBot Cloud — AI Agent VMs in 60 Seconds

Pre-configured AI agent VMs with Claude, GPT, Gemini, and 5 more models pre-installed. Smart model routing, persistent memory, 15+ skills, 24/7 uptime.

🌐 **Live:** [ceooftheuniverse.github.io/vmsaas-live](https://ceooftheuniverse.github.io/vmsaas-live/)  
💰 **Pricing:** [ceooftheuniverse.github.io/vmsaas-live/pricing.html](https://ceooftheuniverse.github.io/vmsaas-live/pricing.html)  
⚡ **API (Omnisphere):** [github.com/CEOoftheUniverse/omnisphere](https://github.com/CEOoftheUniverse/omnisphere)

## Plans

| Plan | Price | GPUs | Agents | Features |
|------|-------|------|--------|----------|
| **Base** | $49/mo | RTX 3090 | 1 | Smart routing, persistent memory, 15+ skills |
| **Swarm** | $149/mo | RTX 4090 | 3 | Mission Control, multi-model consensus |
| **Enterprise** | $299/mo | A100 | 10 | 99.99% SLA, dedicated resources, custom routing |

## Tech Stack

- **Backend:** Node.js + Express, Stripe billing, Vast.ai GPU provisioning
- **Multi-LLM:** [Omnisphere](https://github.com/CEOoftheUniverse/omnisphere) — 8 models, smart routing
- **Agent Runtime:** OpenClaw with persistent memory, cron scheduling, tool access
- **Hosting:** Vast.ai (cheapest), RunPod (reliable), auto-provisioning

## Quick Start

```bash
npm install
node server.js

# With Stripe payments:
STRIPE_SECRET_KEY=sk_test_... node server.js

# With GPU provisioning:
VASTAI_API_KEY=... node server.js
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/status` | GET | Health check |
| `/api/waitlist` | POST | Join waitlist |
| `/api/deploy` | POST | Provision agent VM |
| `/api/gpu/search` | GET | Search GPU marketplace |
| `/api/gpu/cheapest/:tier` | GET | Find cheapest GPU for tier |
| `/api/billing/checkout` | POST | Stripe checkout |
| `/api/admin/stripe-setup` | POST | Auto-create Stripe products |

## Part of the MoltBot Ecosystem

- **MoltBot Cloud** — This repo (VM SaaS platform)
- **Omnisphere** — [Multi-LLM router](https://github.com/CEOoftheUniverse/omnisphere) (8 models, 70% cheaper)
- **AI-Trader** — Autonomous trading signals on [ai4trade.ai](https://ai4trade.ai)

## License

MIT
