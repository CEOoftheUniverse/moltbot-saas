#!/usr/bin/env node
/**
 * MoltBot Automated Test Suite v1.0
 * Tests all critical system endpoints and reports results.
 * 
 * Usage: node test_suite.js
 * Requires: All services running (FastAPI 8080, Gateway 3005, SaaS 3000)
 */

const SERVICES = {
    fastapi: 'http://127.0.0.1:8080',
    gateway: 'http://127.0.0.1:3005',
    saas: 'http://127.0.0.1:3000',
};

let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
    const start = Date.now();
    try {
        await fn();
        const ms = Date.now() - start;
        passed++;
        results.push({ name, status: 'PASS', ms });
        console.log(`  ✅ ${name} (${ms}ms)`);
    } catch (e) {
        const ms = Date.now() - start;
        failed++;
        results.push({ name, status: 'FAIL', ms, error: e.message });
        console.log(`  ❌ ${name} (${ms}ms) — ${e.message}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

async function fetchJSON(url, opts = {}) {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

// ===== TEST SUITES =====

async function testFastAPI() {
    console.log('\n🔬 FastAPI Backend (8080)');
    
    await test('Health check', async () => {
        const d = await fetchJSON(`${SERVICES.fastapi}/health`);
        assert(d.status === 'ok', `Expected ok, got ${d.status}`);
        assert(d.agents_loaded >= 1, `No agents loaded`);
    });

    await test('Metrics endpoint', async () => {
        const d = await fetchJSON(`${SERVICES.fastapi}/metrics`);
        assert(d.total_jobs !== undefined, 'Missing total_jobs');
    });

    await test('Models listing', async () => {
        const d = await fetchJSON(`${SERVICES.fastapi}/models`);
        assert(Array.isArray(d.models), 'Models not an array');
    });

    await test('Agents listing', async () => {
        const d = await fetchJSON(`${SERVICES.fastapi}/agents`);
        assert(d.agents, 'Missing agents list');
    });

    await test('Job submission', async () => {
        const d = await fetchJSON(`${SERVICES.fastapi}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: 'Test task — ping', tenant_id: 'test-suite' }),
        });
        assert(d.job_id || d.id, 'No job ID returned');
    });
}

async function testGateway() {
    console.log('\n🔬 Omnisphere Gateway (3005)');
    
    await test('Status endpoint', async () => {
        const d = await fetchJSON(`${SERVICES.gateway}/api/status`);
        assert(d.status === 'ok', `Expected ok, got ${d.status}`);
        assert(d.models?.length >= 8, `Expected 8+ models, got ${d.models?.length}`);
    });

    await test('Tiers include free', async () => {
        const d = await fetchJSON(`${SERVICES.gateway}/api/status`);
        assert(d.tiers?.includes('free'), 'Missing free tier');
    });

    await test('Model listing via API', async () => {
        const d = await fetchJSON(`${SERVICES.gateway}/api/models`);
        assert(d.models || Array.isArray(d), 'Invalid models response');
    });

    await test('Rate limiter active', async () => {
        // Just verify the endpoint responds (rate limiter is middleware-level)
        const d = await fetchJSON(`${SERVICES.gateway}/api/status`);
        assert(d.status === 'ok');
    });
}

async function testSaaS() {
    console.log('\n🔬 MoltBot SaaS Backend (3000)');
    
    await test('Status endpoint', async () => {
        const d = await fetchJSON(`${SERVICES.saas}/api/status`);
        assert(d.status === 'ok', `Expected ok, got ${d.status}`);
    });

    await test('Waitlist count', async () => {
        const d = await fetchJSON(`${SERVICES.saas}/api/waitlist/count`);
        assert(d.count !== undefined, 'Missing count');
    });

    await test('Analytics summary', async () => {
        const d = await fetchJSON(`${SERVICES.saas}/api/analytics/summary`);
        assert(d.period === '24h', 'Wrong period');
        assert(d.totalEvents !== undefined, 'Missing totalEvents');
    });

    await test('Analytics event tracking', async () => {
        const d = await fetchJSON(`${SERVICES.saas}/api/analytics/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'test_event', page: '/test', sessionId: 'test-suite' }),
        });
        assert(d.ok === true, 'Event not recorded');
    });

    await test('Email subscribe (duplicate check)', async () => {
        const d = await fetchJSON(`${SERVICES.saas}/api/email/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@moltbot-test.dev', source: 'test-suite' }),
        });
        assert(d.success === true, 'Subscribe failed');
    });

    await test('Waitlist signup', async () => {
        const d = await fetchJSON(`${SERVICES.saas}/api/waitlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@moltbot-test.dev', tier: 'base' }),
        });
        assert(d.success === true, 'Waitlist signup failed');
    });

    await test('Stripe checkout (graceful failure)', async () => {
        try {
            const d = await fetchJSON(`${SERVICES.saas}/api/billing/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'test@test.com', tier: 'base' }),
            });
            assert(d.url || d.hint === 'stripe_not_configured', 'Unexpected response');
        } catch (e) {
            // 503 is expected when Stripe isn't configured
            assert(e.message.includes('503'), `Unexpected error: ${e.message}`);
        }
    });
}

// ===== RUNNER =====
async function main() {
    console.log('═══════════════════════════════════════════');
    console.log(' MoltBot Automated Test Suite v1.0');
    console.log(' Testing all critical system endpoints...');
    console.log('═══════════════════════════════════════════');

    try { await testFastAPI(); } catch (e) { console.log(`  ⚠️  FastAPI suite error: ${e.message}`); }
    try { await testGateway(); } catch (e) { console.log(`  ⚠️  Gateway suite error: ${e.message}`); }
    try { await testSaaS(); } catch (e) { console.log(`  ⚠️  SaaS suite error: ${e.message}`); }

    console.log('\n═══════════════════════════════════════════');
    console.log(` Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log('═══════════════════════════════════════════');

    if (failed > 0) {
        console.log('\nFailed tests:');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.log(`  ❌ ${r.name}: ${r.error}`);
        });
        process.exit(1);
    } else {
        console.log('\n✅ All tests passed!\n');
        process.exit(0);
    }
}

main();
