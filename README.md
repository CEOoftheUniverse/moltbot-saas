# MoltBot Cloud

> **AI Agent VMs — Pre-installed, Pre-configured, Ready to Deploy**

MoltBot Cloud is a SaaS platform that provisions virtual machines with a complete AI agent stack pre-installed. Instead of spending hours configuring environments, users get a battle-tested agent VM in under 60 seconds.

---

## Quick Start

```bash
cd moltbot-saas
npm install
npm start
# → http://localhost:3000
```

For development with auto-reload:

```bash
npm run dev
```

## Architecture

```
moltbot-saas/
├── public/
│   └── index.html        # Landing page (Tailwind CSS, dark theme)
├── server.js             # Express backend
├── waitlist.json          # Auto-created — email signups
├── package.json
└── README.md
```

### Tech Stack

| Layer        | Technology                              |
| ------------ | --------------------------------------- |
| Frontend     | Static HTML + Tailwind CSS (CDN)        |
| Backend      | Node.js + Express                       |
| Data         | JSON file (waitlist) → migrate to DB    |
| Infra (future) | RunPod / Paperspace / AWS API integration |

### API Endpoints

| Method   | Path                  | Status       | Description                |
| -------- | --------------------- | ------------ | -------------------------- |
| `GET`    | `/`                   | ✅ Live       | Landing page               |
| `POST`   | `/api/waitlist`       | ✅ Live       | Add email to waitlist      |
| `GET`    | `/api/status`         | ✅ Live       | Health check + metrics     |
| `POST`   | `/api/provision`      | 🔲 Placeholder | Create a new agent VM      |
| `GET`    | `/api/instances`      | 🔲 Placeholder | List running VMs           |
| `DELETE` | `/api/instances/:id`  | 🔲 Placeholder | Terminate a VM             |

## Pricing Model

Base compute is passed through at cost from the underlying cloud provider. MoltBot adds an agent stack fee:

| Plan       | Monthly | Agents | Stack Fee  |
| ---------- | ------- | ------ | ---------- |
| Starter    | $29     | 1      | $0.10/hr   |
| Pro        | $99     | 5      | $0.20/hr   |
| Enterprise | $299    | ∞      | $0.30/hr   |

The stack fee covers: pre-installed agent frameworks, browser automation, persistent memory, multi-model orchestration, updates, and support.

## Roadmap

- [ ] RunPod API integration for VM provisioning
- [ ] Paperspace fallback provider
- [ ] User authentication (JWT / OAuth)
- [ ] Stripe billing integration
- [ ] Dashboard for managing agent VMs
- [ ] CLI tool (`moltbot deploy`, `moltbot status`)
- [ ] Persistent volume management
- [ ] SOC 2 compliance

## Environment Variables

| Variable | Default | Description        |
| -------- | ------- | ------------------ |
| `PORT`   | `3000`  | Server listen port |

## License

MIT
