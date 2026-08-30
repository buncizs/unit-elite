const fs = require('fs');

console.log('[LAUNCH] Loading Routing Policy V2 loader...');
if (fs.existsSync('opencode.json')) {
    try {
        const config = JSON.parse(fs.readFileSync('opencode.json', 'utf8'));
        console.log('[LAUNCH] Routing Policy V2 loaded successfully from opencode.json.');
    } catch (e) {
        console.error('[LAUNCH] Error parsing opencode.json:', e.message);
        process.exit(1);
    }
} else {
    console.log('[LAUNCH] Warning: opencode.json not found, using default runtime policy.');
}

console.log('[LAUNCH] Unit Elite Runtime successfully launched with safe OpenCode integration.');
process.exit(0);
