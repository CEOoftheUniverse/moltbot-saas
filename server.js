const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Shared python API endpoint
const PYTHON_API = 'http://127.0.0.1:8080';

// In-memory array mapping UI deployments to Python jobs
let instances = [];

// API: Health & Status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0-mvp',
    activeInstances: instances.length,
    availableGpus: {
      rtx4090: 24,
      a100: 4,
      h100: 2
    }
  });
});

// API: List Instances
app.get('/api/instances', async (req, res) => {
  // Sync the statuses from the Python backend
  for (let inst of instances) {
    if (inst.job_id && (inst.status === 'deploying' || inst.status === 'running')) {
      try {
        const response = await fetch(`${PYTHON_API}/jobs/${inst.job_id}`);
        if (response.ok) {
          const dbJob = await response.json();
          // Map Python job status back to front-end instance status
          if (dbJob.status === 'completed' || dbJob.status === 'failed') {
             inst.status = dbJob.status;
          } else if (dbJob.status === 'running') {
             inst.status = 'running';
          }
        }
      } catch (err) {
        console.error('Failed to sync job status:', err);
      }
    }
  }
  res.json({ instances });
});

// API: Provision VM / Job
app.post('/api/deploy', async (req, res) => {
  const { plan } = req.body;
  if (!plan) {
    return res.status(400).json({ error: 'Missing plan type' });
  }

  // Create a real task on the Python backend!
  try {
    const response = await fetch(`${PYTHON_API}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: `Provision an agent node with plan: ${plan}. Make sure to setup the environment, compile the node, and run internal tests.`,
        tenant_id: 'moltbot-cloud-ui'
      })
    });
    const result = await response.json();

    const newInstance = {
      id: `mb-${Math.random().toString(36).substr(2, 9)}`,
      job_id: result.job_id,
      plan: plan,
      ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      status: 'deploying',
      createdAt: new Date().toISOString(),
      agentCount: plan === 'swarm' ? 10 : 1,
      costPerHour: plan === 'swarm' ? '$0.41/hr' : '$0.06/hr'
    };

    instances.push(newInstance);
    res.json({ success: true, instance: newInstance });
  } catch (error) {
    console.error('FastAPI deployment failed:', error);
    res.status(500).json({ error: 'Failed to deploy to Python Orchestrator' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n🤖 MoltBot Cloud Backend running on http://localhost:${PORT}\n`);
});
