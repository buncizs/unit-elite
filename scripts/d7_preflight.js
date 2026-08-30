const fs = require('fs');
const os = require('os');

console.log('[PREFLIGHT] Running Preflight Checks for Unit Elite Runtime D7...');

// 1. Check Node version
const nodeVersion = process.version;
console.log(`[PREFLIGHT] Node version detected: ${nodeVersion}`);

// 2. Check Security: Ensure loopback policy and no 0.0.0.0 bindings in config
if (fs.existsSync('opencode.json')) {
    const configContent = fs.readFileSync('opencode.json', 'utf8');
    if (configContent.includes('"0.0.0.0"') || configContent.includes('host: "0.0.0.0"')) {
        console.error('[FATAL_SECURITY_BLOCK] Detected 0.0.0.0 binding in opencode.json! Loopback 127.0.0.1 only mandated.');
        process.exit(1);
    }
}

console.log('[PREFLIGHT] Preflight checks passed successfully.');
process.exit(0);
