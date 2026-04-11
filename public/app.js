// MoltBot Cloud - Frontend Logic

const API_BASE = 'http://localhost:3000/api';

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
    fetchStatus();
    fetchInstances();

    // Auto-poll instances every 3 seconds to catch status changes (Deploying -> Running)
    setInterval(fetchInstances, 3000);
});

// Fetch Global Availability
async function fetchStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();

        document.getElementById('gpu-4090').textContent = data.availableGpus.rtx4090;
        document.getElementById('gpu-a100').textContent = data.availableGpus.a100;
        document.getElementById('gpu-h100').textContent = data.availableGpus.h100;
    } catch (error) {
        console.error("Failed to fetch status:", error);
    }
}

// Fetch and Render Active Deployments
async function fetchInstances() {
    try {
        const response = await fetch(`${API_BASE}/instances`);
        const data = await response.json();
        renderInstances(data.instances);
    } catch (error) {
        console.error("Failed to fetch instances:", error);
    }
}

// Render Instance Cards
function renderInstances(instances) {
    const container = document.getElementById('instances-container');

    if (instances.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No active OpenClaw swarms running.</p>`;
        return;
    }

    container.innerHTML = instances.map(inst => `
        <div class="instance-card">
            <div class="instance-header">
                <span class="instance-id">${inst.id}</span>
                <span class="badge ${inst.status}">${inst.status}</span>
            </div>
            <div class="instance-details">
                <div class="detail-row">
                    <span>IP Gateway</span>
                    <span style="color: #38bdf8; font-family: monospace;">${inst.status === 'running' ? inst.ip : 'Provisioning...'}</span>
                </div>
                <div class="detail-row">
                    <span>Plan Tier</span>
                    <span style="text-transform: capitalize;">${inst.plan}</span>
                </div>
                <div class="detail-row">
                    <span>Burn Rate</span>
                    <span>${inst.costPerHour}</span>
                </div>
                <div class="detail-row">
                    <span>Active Agents</span>
                    <span>${inst.agentCount}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Deploy New Agent VM
async function deployAgent(planType) {
    const buttons = document.querySelectorAll('.deploy-btn');
    buttons.forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.5';
    });

    try {
        const response = await fetch(`${API_BASE}/deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: planType })
        });

        const result = await response.json();

        if (result.success) {
            fetchInstances(); // Immediate refresh to show 'Deploying'
            fetchStatus();    // Update globals
        } else {
            alert('Deployment failed: ' + result.error);
        }
    } catch (error) {
        alert('Server error during deployment.');
        console.error(error);
    } finally {
        buttons.forEach(b => {
            b.disabled = false;
            b.style.opacity = '1';
        });
    }
}
