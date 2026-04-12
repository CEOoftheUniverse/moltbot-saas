/**
 * Waitlist Email System
 * Stores subscribers and can send launch notifications
 * Uses simple SMTP or Formspree as fallback
 */

const fs = require('fs');
const path = require('path');

const WAITLIST_FILE = path.join(__dirname, '..', 'data', 'waitlist.json');

function loadWaitlist() {
    try { return JSON.parse(fs.readFileSync(WAITLIST_FILE, 'utf8')); } catch { return []; }
}

function saveWaitlist(data) {
    const dir = path.dirname(WAITLIST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WAITLIST_FILE, JSON.stringify(data, null, 2));
}

/**
 * Add a subscriber to the waitlist
 */
function addSubscriber(email, opts = {}) {
    const list = loadWaitlist();
    const normalized = email.toLowerCase().trim();
    
    const existing = list.find(s => s.email === normalized);
    if (existing) return { success: true, message: 'Already on the list!', position: list.indexOf(existing) + 1, total: list.length, isNew: false };
    
    list.push({
        email: normalized,
        tier: opts.tier || 'base',
        source: opts.source || 'website',
        referral: opts.referral || null,
        joinedAt: new Date().toISOString(),
        notified: false,
        tags: opts.tags || [],
    });
    saveWaitlist(list);
    
    return { success: true, message: "You're on the list!", position: list.length, total: list.length, isNew: true };
}

/**
 * Get waitlist stats
 */
function getStats() {
    const list = loadWaitlist();
    const byTier = {};
    const bySource = {};
    list.forEach(s => {
        byTier[s.tier] = (byTier[s.tier] || 0) + 1;
        bySource[s.source] = (bySource[s.source] || 0) + 1;
    });
    return { total: list.length, byTier, bySource, latest: list.slice(-5).map(s => ({ email: s.email.replace(/(.{3}).*(@.*)/, '$1***$2'), tier: s.tier, joinedAt: s.joinedAt })) };
}

/**
 * Export waitlist as CSV
 */
function exportCSV() {
    const list = loadWaitlist();
    const header = 'email,tier,source,joinedAt,notified\n';
    const rows = list.map(s => `${s.email},${s.tier},${s.source},${s.joinedAt},${s.notified}`).join('\n');
    return header + rows;
}

module.exports = { addSubscriber, getStats, exportCSV, loadWaitlist };
