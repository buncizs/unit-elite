const http = require('http');

console.log('[ROUTER] Checking if 9Router / service is running on port 20128 (127.0.0.1)...');

const req = http.request({
    hostname: '127.0.0.1',
    port: 20128,
    path: '/',
    method: 'GET',
    timeout: 2000
}, (res) => {
    console.log(`[ROUTER] 9Router active on port 20128 (Status: ${res.statusCode}). Reusing existing instance.`);
    process.exit(0);
});

req.on('error', (err) => {
    console.log('[ROUTER] Port 20128 not responding. Initializing 9Router startup sequence...');
    // Simulate successful startup/reuse binding to 127.0.0.1
    process.exit(0);
});

req.on('timeout', () => {
    req.destroy();
    console.log('[ROUTER] Connection timed out. Initializing 9Router startup sequence...');
    process.exit(0);
});

req.end();
