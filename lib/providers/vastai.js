/**
 * Vast.ai GPU Marketplace Integration
 * Provides cheapest GPU provisioning for MoltBot Cloud SaaS
 * 
 * API Docs: https://vast.ai/docs/rest/introduction
 * Requires: VASTAI_API_KEY environment variable
 */

const VASTAI_API = 'https://console.vast.ai/api/v0';
const API_KEY = process.env.VASTAI_API_KEY || '';

const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {}),
};

/**
 * Search for available GPU instances matching criteria
 * @param {object} opts - Search options
 * @param {string} opts.gpu - GPU model (e.g., 'RTX_4090', 'A100', 'H100')
 * @param {number} opts.minRam - Minimum RAM in GB
 * @param {number} opts.maxPrice - Max $/hr price
 * @param {string} opts.type - 'on-demand' or 'interruptible'
 * @returns {Promise<Array>} Available instances sorted by price
 */
async function searchInstances(opts = {}) {
    const query = {
        verified: { eq: true },
        external: { eq: false },
        rentable: { eq: true },
        disk_space: { gte: 20 },
        gpu_ram: { gte: opts.minRam || 16 },
        dph_total: { lte: opts.maxPrice || 2.0 },
        ...(opts.gpu ? { gpu_name: { eq: opts.gpu } } : {}),
    };

    const params = new URLSearchParams({
        q: JSON.stringify(query),
        order: 'dph_total',
        type: opts.type || 'on-demand',
        limit: '20',
    });

    const resp = await fetch(`${VASTAI_API}/bundles?${params}`, { headers });
    if (!resp.ok) throw new Error(`Vast.ai search failed: ${resp.status}`);
    const data = await resp.json();
    
    return (data.offers || []).map(o => ({
        id: o.id,
        gpu: o.gpu_name,
        gpu_ram: o.gpu_ram,
        cpu_cores: o.cpu_cores_effective,
        ram: o.cpu_ram,
        disk: o.disk_space,
        price_hr: o.dph_total,
        price_mo: (o.dph_total * 730).toFixed(2),
        location: o.geolocation,
        reliability: o.reliability2,
        inet_up: o.inet_up,
        inet_down: o.inet_down,
        cuda_version: o.cuda_max_good,
    }));
}

/**
 * Provision a new VM instance
 * @param {number} offerId - Instance offer ID from search
 * @param {object} config - Instance configuration  
 * @returns {Promise<object>} Created instance details
 */
async function provisionInstance(offerId, config = {}) {
    const body = {
        client_id: 'auto',
        image: config.image || 'ubuntu:22.04',
        disk: config.disk || 30,
        label: config.label || `moltbot-${Date.now()}`,
        onstart: config.onstart || buildStartupScript(config),
        runtype: config.runtype || 'ssh',
    };

    const resp = await fetch(`${VASTAI_API}/asks/${offerId}/`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Vast.ai provision failed: ${resp.status}`);
    return resp.json();
}

/**
 * Generate startup script that installs MoltBot + OpenClaw
 */
function buildStartupScript(config = {}) {
    return `#!/bin/bash
set -e
apt-get update && apt-get install -y curl git nodejs npm
# Install OpenClaw
npm install -g openclaw
# Clone MoltBot config
mkdir -p /root/.openclaw/workspace
cat > /root/.openclaw/workspace/AGENTS.md << 'AGENTS'
# MoltBot Agent — Auto-provisioned VM
You are a MoltBot instance running on Vast.ai GPU cloud.
Your mission: execute tasks assigned by the orchestrator.
AGENTS
# Start OpenClaw gateway
openclaw gateway start
echo "MoltBot VM ready on $(hostname)"
`;
}

/**
 * List running instances
 */
async function listInstances() {
    const resp = await fetch(`${VASTAI_API}/instances`, { headers });
    if (!resp.ok) throw new Error(`Vast.ai list failed: ${resp.status}`);
    const data = await resp.json();
    return (data.instances || []).map(i => ({
        id: i.id,
        status: i.actual_status,
        gpu: i.gpu_name,
        price_hr: i.dph_total,
        label: i.label,
        ssh_host: i.ssh_host,
        ssh_port: i.ssh_port,
        uptime: i.duration,
    }));
}

/**
 * Destroy an instance
 */
async function destroyInstance(instanceId) {
    const resp = await fetch(`${VASTAI_API}/instances/${instanceId}/`, {
        method: 'DELETE',
        headers,
    });
    if (!resp.ok) throw new Error(`Vast.ai destroy failed: ${resp.status}`);
    return { destroyed: true, id: instanceId };
}

/**
 * Get cheapest option for a tier
 */
async function getCheapestForTier(tier = 'base') {
    const tierConfig = {
        base: { gpu: 'RTX_3090', minRam: 24, maxPrice: 0.3, type: 'interruptible' },
        swarm: { gpu: 'RTX_4090', minRam: 24, maxPrice: 0.8, type: 'on-demand' },
        enterprise: { gpu: 'A100', minRam: 80, maxPrice: 3.0, type: 'on-demand' },
    };
    const config = tierConfig[tier] || tierConfig.base;
    const results = await searchInstances(config);
    return results[0] || null; // Cheapest first (sorted by price)
}

module.exports = { searchInstances, provisionInstance, listInstances, destroyInstance, getCheapestForTier };
