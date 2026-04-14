/**
 * MoltBot Cloud Backend v0.2.0
 * 
 * Routes:
 *   GET  /api/status            — Health + GPU availability
 *   GET  /api/instances          — List provisioned VMs
 *   POST /api/deploy             — Provision a new agent VM
 *   POST /api/waitlist           — Join waitlist (email + tier)
 *   GET  /api/waitlist/count     — Public waitlist count
 *   POST /api/billing/checkout   — Create Stripe Checkout Session
 *   POST /api/billing/webhook    — Stripe webhook handler
 *   POST /api/billing/portal     — Stripe Customer Portal link
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://ceooftheuniverse.github.io';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Stripe price IDs (set after creating products in Stripe Dashboard)
const PRICE_IDS = {
  base:       process.env.STRIPE_BASE_PRICE_ID || '',       // $49/mo
  swarm:      process.env.STRIPE_SWARM_PRICE_ID || '',      // $149/mo
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || '', // $299/mo
};

// Shared Python API endpoint (Agent Cowork)
const PYTHON_API = process.env.PYTHON_API || 'http://127.0.0.1:8080';

// Lazy Stripe init
let stripe = null;
function getStripe() {
  if (!stripe && STRIPE_SECRET_KEY) stripe = require('stripe')(STRIPE_SECRET_KEY);
  return stripe;
}

// ---------------------------------------------------------------------------
// Persistence (JSON-file MVP)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJson(file, fallback = []) {
  const fp = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// In-memory instances (synced with Python backend)
let instances = loadJson('instances.json', []);
function persistInstances() { saveJson('instances.json', instances); }

// ---------------------------------------------------------------------------
// Metrics (in-memory counters)
// ---------------------------------------------------------------------------
const metrics = {
  requests: 0,
  errors: 0,
  deployments: 0,
  waitlistSignups: 0,
  emailSubscribers: 0,
  pageViews: 0,
  startedAt: new Date().toISOString(),
};

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// ---------------------------------------------------------------------------
// Stripe webhook needs raw body — must be registered BEFORE json middleware
// ---------------------------------------------------------------------------
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({ origin: [FRONTEND_ORIGIN, 'http://localhost:3000', 'http://localhost:5173'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Request counter
app.use((req, _res, next) => { metrics.requests++; next(); });

// ---------------------------------------------------------------------------
// Rate Limiters
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const deployLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 deploys per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Deploy rate limit reached.' },
});

const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signups from this IP.' },
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checkout attempts.' },
});

app.use('/api/', globalLimiter);

// Serve index.html for root
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===== HEALTH =====
app.get('/api/status', (_req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'ok',
    version: '0.3.0',
    activeInstances: instances.length,
    availableGpus: { rtx4090: 24, a100: 4, h100: 2 },
    stripeConfigured: !!STRIPE_SECRET_KEY,
    waitlistCount: loadJson('waitlist.json', []).length,
    metrics: {
      totalRequests: metrics.requests,
      totalErrors: metrics.errors,
      deployments: metrics.deployments,
      waitlistSignups: metrics.waitlistSignups,
      startedAt: metrics.startedAt,
    },
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
    },
    uptime: process.uptime(),
    node: process.version,
  });
});

// ===== INSTANCES =====
app.get('/api/instances', async (_req, res) => {
  for (let inst of instances) {
    if (inst.job_id && (inst.status === 'deploying' || inst.status === 'running')) {
      try {
        const response = await fetch(`${PYTHON_API}/jobs/${inst.job_id}`);
        if (response.ok) {
          const dbJob = await response.json();
          if (dbJob.status === 'completed' || dbJob.status === 'failed') inst.status = dbJob.status;
          else if (dbJob.status === 'running') inst.status = 'running';
        }
      } catch { /* Python backend offline — leave status as-is */ }
    }
  }
  persistInstances();
  res.json({ instances });
});

app.post('/api/deploy', deployLimiter, async (req, res) => {
  const { plan } = req.body;
  if (!plan) return res.status(400).json({ error: 'Missing plan type' });
  // Validate plan
  if (!['base', 'swarm', 'enterprise'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Must be: base, swarm, or enterprise' });
  }

  try {
    const response = await fetch(`${PYTHON_API}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: `Provision an agent node with plan: ${plan}. Setup environment, compile node, run tests.`,
        tenant_id: 'moltbot-cloud-ui'
      })
    });
    const result = await response.json();

    const newInstance = {
      id: `mb-${Math.random().toString(36).substr(2, 9)}`,
      job_id: result.job_id,
      plan,
      ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      status: 'deploying',
      createdAt: new Date().toISOString(),
      agentCount: plan === 'enterprise' ? 10 : plan === 'swarm' ? 3 : 1,
      costPerHour: plan === 'enterprise' ? '$1.24/hr' : plan === 'swarm' ? '$0.41/hr' : '$0.06/hr',
    };

    instances.push(newInstance);
    persistInstances();
    metrics.deployments++;
    res.json({ success: true, instance: newInstance });
  } catch (error) {
    console.error('FastAPI deployment failed:', error);
    res.status(500).json({ error: 'Failed to deploy to Python Orchestrator' });
  }
});

// ===== WAITLIST =====
app.post('/api/waitlist', waitlistLimiter, (req, res) => {
  const { email, tier, referral } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const waitlist = loadJson('waitlist.json', []);
  const normalized = email.toLowerCase().trim().slice(0, 254);
  const exists = waitlist.find(w => w.email === normalized);

  if (exists) {
    return res.json({ success: true, message: 'Already on the waitlist!', position: waitlist.indexOf(exists) + 1, total: waitlist.length });
  }

  // Sanitize inputs
  const cleanTier = ['base', 'swarm', 'enterprise'].includes(tier) ? tier : 'base';
  const cleanReferral = referral ? String(referral).slice(0, 100) : null;

  waitlist.push({
    email: normalized,
    tier: cleanTier,
    referral: cleanReferral,
    source: 'moltbot-saas',
    joinedAt: new Date().toISOString(),
    notified: false,
  });
  saveJson('waitlist.json', waitlist);
  metrics.waitlistSignups++;

  console.log(`[Waitlist] +1: ${normalized} (${cleanTier}) — total: ${waitlist.length}`);
  if (typeof fireWebhooks === 'function') fireWebhooks('waitlist.signup', { email: normalized, tier: cleanTier, referral: cleanReferral });
  res.json({ success: true, message: 'You\'re on the list!', position: waitlist.length, total: waitlist.length });
});

app.get('/api/waitlist/count', (_req, res) => {
  const count = loadJson('waitlist.json', []).length;
  res.json({ count });
});

// ===== ANALYTICS TRACKING =====
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Rate limited' },
});

app.post('/api/analytics/event', analyticsLimiter, (req, res) => {
  const { event, page, referrer, sessionId, meta } = req.body;
  if (!event) return res.status(400).json({ error: 'Event name required' });

  const events = loadJson('analytics.json', []);
  events.push({
    event: String(event).slice(0, 50),
    page: String(page || '').slice(0, 200),
    referrer: String(referrer || '').slice(0, 200),
    sessionId: String(sessionId || '').slice(0, 64),
    meta: typeof meta === 'object' ? JSON.stringify(meta).slice(0, 500) : null,
    ip: req.ip,
    ua: String(req.headers['user-agent'] || '').slice(0, 200),
    timestamp: new Date().toISOString(),
  });
  // Keep last 10,000 events only
  if (events.length > 10000) events.splice(0, events.length - 10000);
  saveJson('analytics.json', events);
  metrics.pageViews++;
  res.json({ ok: true });
});

app.get('/api/analytics/summary', (_req, res) => {
  const events = loadJson('analytics.json', []);
  const now = Date.now();
  const last24h = events.filter(e => now - new Date(e.timestamp).getTime() < 86400000);
  const pageViews = last24h.filter(e => e.event === 'page_view').length;
  const signupClicks = last24h.filter(e => e.event === 'signup_click').length;
  const checkoutStarts = last24h.filter(e => e.event === 'checkout_start').length;
  const topPages = {};
  last24h.forEach(e => { if (e.page) topPages[e.page] = (topPages[e.page] || 0) + 1; });
  res.json({ period: '24h', pageViews, signupClicks, checkoutStarts, topPages, totalEvents: events.length });
});

// ===== EMAIL SEQUENCES =====
const EMAIL_DRIP_SEQUENCE = [
  { day: 0, subject: 'Welcome to MoltBot Cloud! 🤖', template: 'welcome' },
  { day: 1, subject: 'Quick Start: Deploy your first AI agent in 60 seconds', template: 'quick_start' },
  { day: 3, subject: '3 ways MoltBot agents save developers 10hrs/week', template: 'value_prop' },
  { day: 5, subject: 'See how Company X ships 300 commits/day with MoltBot', template: 'case_study' },
  { day: 7, subject: 'Your 7-day trial is ending — lock in early access pricing', template: 'trial_ending' },
  { day: 14, subject: 'Last chance: 20% OFF your first 3 months', template: 'discount_offer' },
];

app.post('/api/email/subscribe', waitlistLimiter, (req, res) => {
  const { email, source, referral } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const subscribers = loadJson('email_subscribers.json', []);
  const normalized = email.toLowerCase().trim().slice(0, 254);
  const exists = subscribers.find(s => s.email === normalized);
  if (exists) return res.json({ success: true, message: 'Already subscribed!' });

  const now = new Date();
  const drip = EMAIL_DRIP_SEQUENCE.map(step => ({
    ...step,
    scheduledFor: new Date(now.getTime() + step.day * 86400000).toISOString(),
    sent: false,
  }));

  subscribers.push({
    email: normalized,
    source: String(source || 'website').slice(0, 50),
    referral: referral ? String(referral).slice(0, 100) : null,
    subscribedAt: now.toISOString(),
    drip,
    unsubscribed: false,
  });
  saveJson('email_subscribers.json', subscribers);
  metrics.emailSubscribers++;

  // Also add to waitlist if not there
  const waitlist = loadJson('waitlist.json', []);
  if (!waitlist.find(w => w.email === normalized)) {
    waitlist.push({ email: normalized, tier: 'base', referral: referral || null, source: 'email_subscribe', joinedAt: now.toISOString(), notified: false });
    saveJson('waitlist.json', waitlist);
  }

  console.log(`[Email] +1 subscriber: ${normalized} — drip scheduled (${drip.length} emails)`);
  res.json({ success: true, message: 'Subscribed! Check your inbox.', dripScheduled: drip.length });
});

app.get('/api/email/drip/:email', (req, res) => {
  const subscribers = loadJson('email_subscribers.json', []);
  const sub = subscribers.find(s => s.email === req.params.email.toLowerCase().trim());
  if (!sub) return res.status(404).json({ error: 'Not found' });
  res.json({ email: sub.email, subscribedAt: sub.subscribedAt, drip: sub.drip });
});

app.post('/api/email/unsubscribe', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const subscribers = loadJson('email_subscribers.json', []);
  const sub = subscribers.find(s => s.email === email.toLowerCase().trim());
  if (sub) { sub.unsubscribed = true; saveJson('email_subscribers.json', subscribers); }
  res.json({ success: true, message: 'Unsubscribed.' });
});

// ===== WEBHOOKS: Real-time notifications =====
app.post('/api/webhooks', (req, res) => {
  const { url, events, secret } = req.body;
  if (!url || !events?.length) {
    return res.status(400).json({ error: 'url and events[] required' });
  }
  const validEvents = ['waitlist.signup', 'email.subscribe', 'billing.checkout', 'alert.downtime'];
  const filtered = events.filter(e => validEvents.includes(e));
  if (!filtered.length) return res.status(400).json({ error: `Invalid events. Valid: ${validEvents.join(', ')}` });

  const hooks = loadJson('webhooks.json', []);
  hooks.push({
    id: Date.now().toString(36),
    url: String(url).slice(0, 500),
    events: filtered,
    secret: secret ? String(secret).slice(0, 128) : null,
    createdAt: new Date().toISOString(),
    active: true,
  });
  saveJson('webhooks.json', hooks);
  console.log(`[Webhook] Registered: ${url} for [${filtered.join(',')}]`);
  res.json({ success: true, id: hooks[hooks.length - 1].id, events: filtered });
});

app.get('/api/webhooks', (_req, res) => {
  const hooks = loadJson('webhooks.json', []);
  res.json({ webhooks: hooks.map(h => ({ id: h.id, url: h.url.slice(0, 40) + '...', events: h.events, active: h.active })) });
});

app.delete('/api/webhooks/:id', (req, res) => {
  const hooks = loadJson('webhooks.json', []);
  const idx = hooks.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Webhook not found' });
  hooks.splice(idx, 1);
  saveJson('webhooks.json', hooks);
  res.json({ success: true });
});

// Fire webhooks helper
async function fireWebhooks(event, payload) {
  const hooks = loadJson('webhooks.json', []);
  const targets = hooks.filter(h => h.active && h.events.includes(event));
  for (const hook of targets) {
    try {
      await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(hook.secret ? { 'X-Webhook-Secret': hook.secret } : {}),
        },
        body: JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload }),
        signal: AbortSignal.timeout(5000),
      });
      console.log(`[Webhook] Fired ${event} → ${hook.url.slice(0, 40)}`);
    } catch (e) {
      console.warn(`[Webhook] Failed ${event} → ${hook.url.slice(0, 40)}: ${e.message}`);
    }
  }
}

// ===== A/B TESTING FRAMEWORK =====
app.get('/api/ab/variant', (req, res) => {
  const { test } = req.query;
  if (!test) return res.status(400).json({ error: 'test name required' });

  const tests = loadJson('ab_tests.json', {});
  const config = tests[test] || { variants: ['control', 'variant_a'], weights: [50, 50] };

  // Deterministic assignment based on IP for consistency
  const ip = req.ip || 'unknown';
  const hash = ip.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  let cumulative = 0;
  let assigned = config.variants[0];
  const roll = hash % 100;
  for (let i = 0; i < config.variants.length; i++) {
    cumulative += config.weights[i];
    if (roll < cumulative) { assigned = config.variants[i]; break; }
  }

  res.json({ test, variant: assigned, sessionHash: hash });
});

app.post('/api/ab/convert', (req, res) => {
  const { test, variant, action } = req.body;
  if (!test || !variant) return res.status(400).json({ error: 'test and variant required' });

  const conversions = loadJson('ab_conversions.json', []);
  conversions.push({
    test: String(test).slice(0, 50),
    variant: String(variant).slice(0, 50),
    action: String(action || 'convert').slice(0, 50),
    ip: req.ip,
    timestamp: new Date().toISOString(),
  });
  if (conversions.length > 5000) conversions.splice(0, conversions.length - 5000);
  saveJson('ab_conversions.json', conversions);
  res.json({ ok: true });
});

app.get('/api/ab/results', (req, res) => {
  const { test } = req.query;
  const conversions = loadJson('ab_conversions.json', []);
  const filtered = test ? conversions.filter(c => c.test === test) : conversions;
  const summary = {};
  filtered.forEach(c => {
    if (!summary[c.test]) summary[c.test] = {};
    if (!summary[c.test][c.variant]) summary[c.test][c.variant] = 0;
    summary[c.test][c.variant]++;
  });
  res.json({ results: summary, total: filtered.length });
});

// ===== MONITORING ALERTS =====
const MONITOR_SERVICES = [
  { name: 'FastAPI', url: 'http://127.0.0.1:8080/health', port: 8080 },
  { name: 'Omnisphere', url: 'http://127.0.0.1:3005/api/status', port: 3005 },
];

app.get('/api/monitor/health', async (_req, res) => {
  const results = [];
  for (const svc of MONITOR_SERVICES) {
    try {
      const r = await fetch(svc.url, { signal: AbortSignal.timeout(5000) });
      results.push({ name: svc.name, port: svc.port, status: r.ok ? 'up' : 'degraded', httpCode: r.status });
    } catch (e) {
      results.push({ name: svc.name, port: svc.port, status: 'down', error: e.message.slice(0, 100) });
      // Fire downtime webhook
      fireWebhooks('alert.downtime', { service: svc.name, port: svc.port, error: e.message.slice(0, 100) });
    }
  }
  const allUp = results.every(r => r.status === 'up');
  res.json({ healthy: allUp, checkedAt: new Date().toISOString(), services: results });
});

app.post('/api/monitor/alert', (req, res) => {
  const { webhook_url, services } = req.body;
  if (!webhook_url) return res.status(400).json({ error: 'webhook_url required (Discord/Slack URL)' });

  const alerts = loadJson('monitor_alerts.json', []);
  alerts.push({
    webhook_url: String(webhook_url).slice(0, 500),
    services: services || MONITOR_SERVICES.map(s => s.name),
    createdAt: new Date().toISOString(),
    active: true,
  });
  saveJson('monitor_alerts.json', alerts);
  res.json({ success: true, message: 'Alert registered. Will fire on downtime detection.' });
});

// ===== IMPROVED EMAIL TEMPLATES =====
const EMAIL_TEMPLATES = {
  welcome: {
    subject: 'Welcome to MoltBot Cloud! 🤖',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h1 style="color:#6366f1">Welcome to MoltBot Cloud!</h1>
      <p>You've just joined the future of software development.</p>
      <p>Your AI agent swarm is ready to deploy. Here's what happens next:</p>
      <ol><li>Choose your plan (Base $49 / Swarm $149 / Enterprise $299)</li>
      <li>Deploy your VM — pre-loaded with 10+ specialist agents</li>
      <li>Watch them code, test, review, and ship — autonomously</li></ol>
      <a href="https://ceooftheuniverse.github.io/vmsaas-live/signup.html" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Start Free Trial →</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">You're receiving this because you signed up for MoltBot Cloud. <a href="https://ceooftheuniverse.github.io/vmsaas-live/api-docs.html" style="color:#6366f1">Unsubscribe</a></p>
    </div>`,
  },
  quick_start: {
    subject: 'Deploy your first AI agent in 60 seconds ⚡',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h1 style="color:#06b6d4">60-Second Quick Start</h1>
      <p>Yesterday you joined MoltBot Cloud. Today, let's deploy your first agent.</p>
      <h3>Step 1: Sign in</h3><p>Head to your <a href="https://ceooftheuniverse.github.io/vmsaas-live/dashboard.html" style="color:#6366f1">Dashboard</a></p>
      <h3>Step 2: Deploy</h3><p>Click "Deploy Node" — your VM comes pre-loaded with Claude, GPT-4o, and Gemini</p>
      <h3>Step 3: Ship</h3><p>Describe your project, and watch 5 agents tackle it in parallel</p>
      <a href="https://ceooftheuniverse.github.io/vmsaas-live/signup.html" style="display:inline-block;background:#06b6d4;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Deploy Now →</a>
    </div>`,
  },
  value_prop: {
    subject: '3 ways MoltBot agents save you 10hrs/week',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h1>Save 10 Hours Every Week</h1>
      <p>Developers using MoltBot Cloud report massive productivity gains:</p>
      <ul><li><strong>Parallel Code Generation</strong> — 5 agents write code simultaneously</li>
      <li><strong>Automated Testing</strong> — agents write and run tests before you review</li>
      <li><strong>Smart Model Routing</strong> — pay GPT-4o prices, get 12 models included</li></ul>
      <p>The result? 300+ commits/day with one developer.</p>
      <a href="https://ceooftheuniverse.github.io/vmsaas-live/blog-ai-agent-swarm-guide.html" style="display:inline-block;background:#22c55e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Read the Full Guide →</a>
    </div>`,
  },
  trial_ending: {
    subject: 'Your 7-day trial is ending — lock in early access pricing 🔒',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h1 style="color:#f59e0b">⏰ Your Trial Ends Tomorrow</h1>
      <p>You've been exploring MoltBot Cloud for 7 days. Here's what you'd lose:</p>
      <ul><li>5+ AI agents working 24/7 on your code</li>
      <li>12 LLM models with smart routing</li>
      <li>Persistent memory across sessions</li></ul>
      <p><strong>Lock in early access pricing before it's gone.</strong></p>
      <a href="https://ceooftheuniverse.github.io/vmsaas-live/signup.html" style="display:inline-block;background:#f59e0b;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Upgrade Now — From $49/mo →</a>
    </div>`,
  },
  discount_offer: {
    subject: 'Last chance: 20% OFF your first 3 months 🎉',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h1 style="color:#ef4444">🎉 20% OFF — Final Offer</h1>
      <p>We noticed you haven't upgraded yet. Here's our best deal:</p>
      <div style="background:#18181b;border:2px solid #6366f1;border-radius:12px;padding:24px;text-align:center;margin:16px 0">
        <div style="font-size:2rem;font-weight:bold;color:#6366f1">20% OFF</div>
        <div style="color:#94a3b8">Your first 3 months on any plan</div>
        <div style="color:#f4f4f5;margin-top:8px">Base: <s>$49</s> → <strong>$39/mo</strong> • Swarm: <s>$149</s> → <strong>$119/mo</strong></div>
      </div>
      <a href="https://ceooftheuniverse.github.io/vmsaas-live/signup.html?promo=EARLY20" style="display:inline-block;background:#ef4444;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Claim 20% Off →</a>
      <p style="color:#52525b;font-size:12px;margin-top:16px">Offer expires in 48 hours.</p>
    </div>`,
  },
};

app.get('/api/email/templates', (_req, res) => {
  res.json({ templates: Object.keys(EMAIL_TEMPLATES).map(k => ({ id: k, subject: EMAIL_TEMPLATES[k].subject })) });
});

app.get('/api/email/template/:id', (req, res) => {
  const tmpl = EMAIL_TEMPLATES[req.params.id];
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tmpl);
});

// ===== BILLING: Stripe =====
app.post('/api/billing/checkout', checkoutLimiter, async (req, res) => {
  const s = getStripe();
  if (!s) {
    return res.status(503).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY.', hint: 'stripe_not_configured' });
  }

  const { email, tier } = req.body; // tier: 'base' | 'swarm' | 'enterprise'
  if (!email) return res.status(400).json({ error: 'Email required for checkout' });

  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    return res.status(503).json({ error: `Price ID not configured for tier: ${tier}. Set STRIPE_${tier.toUpperCase()}_PRICE_ID.` });
  }

  try {
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_ORIGIN}/moltbot-saas/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_ORIGIN}/moltbot-saas/?checkout=cancel`,
      metadata: { tier, source: 'moltbot-saas' },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

async function handleStripeWebhook(req, res) {
  const s = getStripe();
  if (!s) return res.status(503).send('Stripe not configured');

  let event;
  if (STRIPE_WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    try {
      event = s.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook sig failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    event = JSON.parse(req.body.toString());
  }

  console.log(`[Stripe] Event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customers = loadJson('customers.json', []);
      customers.push({
        email: session.customer_email || session.customer_details?.email,
        tier: session.metadata?.tier || 'base',
        stripeCustomerId: session.customer,
        subscriptionId: session.subscription,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      saveJson('customers.json', customers);
      console.log(`[Stripe] New subscriber: ${session.customer_email} (${session.metadata?.tier})`);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customers = loadJson('customers.json', []);
      const customer = customers.find(c => c.subscriptionId === sub.id);
      if (customer) {
        customer.status = 'cancelled';
        customer.cancelledAt = new Date().toISOString();
        saveJson('customers.json', customers);
        console.log(`[Stripe] Subscription cancelled: ${customer.email}`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`[Stripe] Payment failed: customer ${invoice.customer}`);
      break;
    }
  }

  res.json({ received: true });
}

app.post('/api/billing/portal', async (req, res) => {
  const s = getStripe();
  if (!s) return res.status(503).json({ error: 'Stripe not configured' });

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const customers = loadJson('customers.json', []);
  const customer = customers.find(c => c.email === email.toLowerCase().trim());
  if (!customer?.stripeCustomerId) {
    return res.status(404).json({ error: 'No subscription found for this email' });
  }

  try {
    const portalSession = await s.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: `${FRONTEND_ORIGIN}/moltbot-saas/`,
    });
    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// ===== VAST.AI GPU MARKETPLACE =====
let vastai;
try { vastai = require('./lib/providers/vastai'); } catch { vastai = null; }

app.get('/api/gpu/search', async (req, res) => {
  if (!vastai || !process.env.VASTAI_API_KEY) {
    // Return realistic mock data when API key not set
    return res.json({ offers: [
      { id: 'mock-1', gpu: 'RTX 4090', gpu_ram: 24, cpu_cores: 16, ram: 64, disk: 100, price_hr: 0.29, price_mo: '211.70', location: 'US-East', reliability: 0.99 },
      { id: 'mock-2', gpu: 'RTX 3090', gpu_ram: 24, cpu_cores: 8, ram: 32, disk: 50, price_hr: 0.15, price_mo: '109.50', location: 'EU-West', reliability: 0.97 },
      { id: 'mock-3', gpu: 'A100 SXM', gpu_ram: 80, cpu_cores: 32, ram: 128, disk: 200, price_hr: 1.10, price_mo: '803.00', location: 'US-West', reliability: 0.99 },
    ], source: 'mock', hint: 'Set VASTAI_API_KEY for live marketplace data' });
  }
  try {
    const offers = await vastai.searchInstances({
      gpu: req.query.gpu || undefined,
      minRam: parseInt(req.query.minRam) || 16,
      maxPrice: parseFloat(req.query.maxPrice) || 2.0,
      type: req.query.type || 'on-demand',
    });
    res.json({ offers, source: 'live' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/gpu/cheapest/:tier', async (req, res) => {
  if (!vastai || !process.env.VASTAI_API_KEY) {
    const tierPrices = { base: 0.15, swarm: 0.42, enterprise: 1.10 };
    return res.json({ cheapest: { gpu: 'Mock GPU', price_hr: tierPrices[req.params.tier] || 0.15 }, source: 'mock' });
  }
  try {
    const cheapest = await vastai.getCheapestForTier(req.params.tier);
    res.json({ cheapest, source: 'live' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gpu/provision', deployLimiter, async (req, res) => {
  if (!vastai || !process.env.VASTAI_API_KEY) {
    return res.status(503).json({ error: 'GPU provisioning not configured. Set VASTAI_API_KEY.' });
  }
  const { offerId, tier, label } = req.body;
  if (!offerId) return res.status(400).json({ error: 'offerId required' });
  try {
    const result = await vastai.provisionInstance(offerId, { label: label || `moltbot-${tier || 'base'}` });
    instances.push({
      id: `vast-${result.new_contract}`,
      vastId: result.new_contract,
      plan: tier || 'base',
      status: 'provisioning',
      provider: 'vast.ai',
      createdAt: new Date().toISOString(),
    });
    persistInstances();
    metrics.deployments++;
    res.json({ success: true, instance: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== STRIPE ADMIN SETUP =====
app.post('/api/admin/stripe-setup', async (req, res) => {
  const { key } = req.body;
  if (!key || !key.startsWith('sk_')) return res.status(400).json({ error: 'Invalid Stripe key' });
  
  try {
    const s = require('stripe')(key);
    const products = [];
    
    const tiers = [
      { name: 'MoltBot Base', price: 4900, tier: 'base' },
      { name: 'MoltBot Swarm', price: 14900, tier: 'swarm' },
      { name: 'MoltBot Enterprise', price: 29900, tier: 'enterprise' },
      { name: 'Omnisphere API', price: 1000, tier: 'omnisphere' },
    ];
    
    for (const t of tiers) {
      const product = await s.products.create({ name: t.name, metadata: { tier: t.tier } });
      const price = await s.prices.create({
        product: product.id, unit_amount: t.price, currency: 'usd',
        recurring: { interval: 'month' }, metadata: { tier: t.tier },
      });
      products.push({ name: t.name, productId: product.id, priceId: price.id, amount: `$${(t.price/100).toFixed(0)}/mo` });
    }
    
    // Save price IDs
    saveJson('stripe_config.json', { key: key.slice(0,12) + '...', products, createdAt: new Date().toISOString() });
    
    // Update runtime config
    PRICE_IDS.base = products.find(p => p.name.includes('Base'))?.priceId || '';
    PRICE_IDS.swarm = products.find(p => p.name.includes('Swarm'))?.priceId || '';
    PRICE_IDS.enterprise = products.find(p => p.name.includes('Enterprise'))?.priceId || '';
    
    res.json({ success: true, products });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ERROR HANDLER =====
app.use((err, _req, res, _next) => {
  metrics.errors++;
  console.error(`[ERROR] ${new Date().toISOString()}:`, err.message);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ===== START =====
const server = app.listen(PORT, () => {
  console.log(`\n🤖 MoltBot Cloud Backend v0.3.0 on http://localhost:${PORT}`);
  console.log(`   Stripe:    ${STRIPE_SECRET_KEY ? '✅ configured' : '⚠️  not configured'}`);
  if (!STRIPE_SECRET_KEY) {
    console.log(`   → To enable payments: node scripts/stripe_setup.js`);
    console.log(`   → Or set: STRIPE_SECRET_KEY=sk_test_xxx`);
  }
  console.log(`   Vast.ai:   ${process.env.VASTAI_API_KEY ? '✅ live GPU provisioning' : '⚠️  mock mode'}`);
  console.log(`   Security:  ✅ helmet + rate limiting`);
  console.log(`   Waitlist:  ${loadJson('waitlist.json', []).length} subscribers`);
  console.log(`   GPU routes: /api/gpu/search, /api/gpu/cheapest/:tier`);
  console.log(`   Instances: ${instances.length} active\n`);
});

// ---------------------------------------------------------------------------
// Referral / Affiliate Tracking
// ---------------------------------------------------------------------------
const referrals = loadJson('referrals.json', []);

// Register a new affiliate
app.post('/api/referral/register', express.json(), (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const normalized = email.toLowerCase().trim();
  
  const existing = referrals.find(r => r.email === normalized);
  if (existing) return res.json({ success: true, code: existing.code, message: 'Already registered' });
  
  const code = 'MOLT-' + normalized.split('@')[0].toUpperCase().slice(0, 6) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const affiliate = {
    email: normalized,
    name: name || '',
    code,
    clicks: 0,
    signups: 0,
    conversions: 0,
    earnings: 0,
    registeredAt: new Date().toISOString(),
  };
  referrals.push(affiliate);
  saveJson('referrals.json', referrals);
  console.log(`[Referral] New affiliate: ${normalized} → ${code}`);
  res.json({ success: true, code, link: `https://ceooftheuniverse.github.io/vmsaas-live/signup.html?ref=${code}` });
});

// Track a referral click
app.post('/api/referral/click', express.json(), (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  const affiliate = referrals.find(r => r.code === code);
  if (affiliate) {
    affiliate.clicks++;
    saveJson('referrals.json', referrals);
  }
  res.json({ success: true });
});

// Get affiliate stats by code
app.get('/api/referral/stats/:code', (req, res) => {
  const affiliate = referrals.find(r => r.code === req.params.code);
  if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });
  res.json({
    code: affiliate.code,
    clicks: affiliate.clicks,
    signups: affiliate.signups,
    conversions: affiliate.conversions,
    earnings: affiliate.earnings,
    registeredAt: affiliate.registeredAt,
  });
});

// List top affiliates (admin)
app.get('/api/referral/leaderboard', (_req, res) => {
  const top = [...referrals]
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 20)
    .map(r => ({ name: r.name || r.email.split('@')[0], conversions: r.conversions, earnings: r.earnings }));
  res.json({ total: referrals.length, top });
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  setTimeout(() => { process.exit(1); }, 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Export for testing
module.exports = { app, server };
