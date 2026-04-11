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
// Stripe webhook needs raw body — must be registered BEFORE json middleware
// ---------------------------------------------------------------------------
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({ origin: [FRONTEND_ORIGIN, 'http://localhost:3000', 'http://localhost:5173'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for root
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===== HEALTH =====
app.get('/api/status', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.2.0',
    activeInstances: instances.length,
    availableGpus: { rtx4090: 24, a100: 4, h100: 2 },
    stripeConfigured: !!STRIPE_SECRET_KEY,
    waitlistCount: loadJson('waitlist.json', []).length,
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

app.post('/api/deploy', async (req, res) => {
  const { plan } = req.body;
  if (!plan) return res.status(400).json({ error: 'Missing plan type' });

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
    res.json({ success: true, instance: newInstance });
  } catch (error) {
    console.error('FastAPI deployment failed:', error);
    res.status(500).json({ error: 'Failed to deploy to Python Orchestrator' });
  }
});

// ===== WAITLIST =====
app.post('/api/waitlist', (req, res) => {
  const { email, tier, referral } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const waitlist = loadJson('waitlist.json', []);
  const normalized = email.toLowerCase().trim();
  const exists = waitlist.find(w => w.email === normalized);

  if (exists) {
    return res.json({ success: true, message: 'Already on the waitlist!', position: waitlist.indexOf(exists) + 1, total: waitlist.length });
  }

  waitlist.push({
    email: normalized,
    tier: tier || 'base',
    referral: referral || null,
    source: 'moltbot-saas',
    joinedAt: new Date().toISOString(),
    notified: false,
  });
  saveJson('waitlist.json', waitlist);

  console.log(`[Waitlist] +1: ${normalized} (${tier || 'base'}) — total: ${waitlist.length}`);
  res.json({ success: true, message: 'You\'re on the list!', position: waitlist.length, total: waitlist.length });
});

app.get('/api/waitlist/count', (_req, res) => {
  const count = loadJson('waitlist.json', []).length;
  res.json({ count });
});

// ===== BILLING: Stripe =====
app.post('/api/billing/checkout', async (req, res) => {
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

// ===== START =====
app.listen(PORT, () => {
  console.log(`\n🤖 MoltBot Cloud Backend v0.2.0 on http://localhost:${PORT}`);
  console.log(`   Stripe:    ${STRIPE_SECRET_KEY ? '✅ configured' : '⚠️  not configured (waitlist-only mode)'}`);
  console.log(`   Waitlist:  ${loadJson('waitlist.json', []).length} subscribers`);
  console.log(`   Instances: ${instances.length} active\n`);
});
