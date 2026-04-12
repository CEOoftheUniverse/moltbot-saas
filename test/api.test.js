/**
 * MoltBot Cloud Backend API Tests
 * Uses Node.js built-in test runner (node --test)
 * Tests all endpoints in demo mode (no external services needed)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const BASE = 'http://localhost:3111'; // Test port
let server;

before(async () => {
  process.env.PORT = '3111';
  process.env.NODE_ENV = 'test';
  const mod = require('../server.js');
  server = mod.server;
  await new Promise(resolve => {
    if (server.listening) return resolve();
    server.on('listening', resolve);
  });
});

after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
});

// ===== STATUS/HEALTH =====
describe('GET /api/status', () => {
  it('returns 200 with status ok', async () => {
    const res = await fetch(`${BASE}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '0.3.0');
    assert.ok(body.uptime >= 0);
    assert.ok(body.metrics);
    assert.ok(body.memory);
    assert.ok(body.node);
  });

  it('reports GPU availability', async () => {
    const res = await fetch(`${BASE}/api/status`);
    const body = await res.json();
    assert.ok(body.availableGpus);
    assert.equal(typeof body.availableGpus.rtx4090, 'number');
    assert.equal(typeof body.availableGpus.a100, 'number');
    assert.equal(typeof body.availableGpus.h100, 'number');
  });

  it('reports metrics', async () => {
    const res = await fetch(`${BASE}/api/status`);
    const body = await res.json();
    assert.ok(body.metrics.startedAt);
    assert.equal(typeof body.metrics.totalRequests, 'number');
    assert.equal(typeof body.metrics.deployments, 'number');
    assert.equal(typeof body.metrics.waitlistSignups, 'number');
  });
});

// ===== INSTANCES =====
describe('GET /api/instances', () => {
  it('returns instances array', async () => {
    const res = await fetch(`${BASE}/api/instances`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.instances));
  });
});

describe('POST /api/deploy', () => {
  it('returns 400 without plan', async () => {
    const res = await fetch(`${BASE}/api/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('returns 400 for invalid plan', async () => {
    const res = await fetch(`${BASE}/api/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'evil-plan' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Invalid plan'));
  });
});

// ===== WAITLIST =====
describe('POST /api/waitlist', () => {
  it('returns 400 for invalid email', async () => {
    const res = await fetch(`${BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'notanemail' }),
    });
    assert.equal(res.status, 400);
  });

  it('adds valid email', async () => {
    const email = `test-${Date.now()}@example.com`;
    const res = await fetch(`${BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tier: 'swarm' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.position > 0);
    assert.ok(body.total > 0);
  });

  it('deduplicates emails', async () => {
    const email = `dedup-mb-${Date.now()}@example.com`;
    await fetch(`${BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const res = await fetch(`${BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json();
    assert.ok(body.message.includes('Already'));
  });

  it('sanitizes tier to allowed values', async () => {
    const email = `sanitize-mb-${Date.now()}@example.com`;
    const res = await fetch(`${BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tier: '<script>alert(1)</script>' }),
    });
    assert.equal(res.status, 200);
  });
});

describe('GET /api/waitlist/count', () => {
  it('returns count', async () => {
    const res = await fetch(`${BASE}/api/waitlist/count`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.count, 'number');
    assert.ok(body.count >= 0);
  });
});

// ===== BILLING =====
describe('POST /api/billing/checkout', () => {
  it('returns 503 when Stripe not configured', async () => {
    const res = await fetch(`${BASE}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', tier: 'base' }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.ok(body.hint === 'stripe_not_configured');
  });
});

describe('POST /api/billing/portal', () => {
  it('returns 503 when Stripe not configured', async () => {
    const res = await fetch(`${BASE}/api/billing/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    assert.equal(res.status, 503);
  });
});

// ===== 404 =====
describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${BASE}/api/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Not found');
  });
});

// ===== SECURITY =====
describe('Security headers', () => {
  it('includes helmet headers', async () => {
    const res = await fetch(`${BASE}/api/status`);
    assert.ok(res.headers.get('x-content-type-options'));
    assert.ok(res.headers.get('x-frame-options'));
  });
});
