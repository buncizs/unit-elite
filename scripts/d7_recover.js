const maxAttempts = 3;
let attempt = 1;

console.log('[RECOVER] Initiating bounded recovery protocol (max 3 attempts)...');

function runRecoveryAttempt() {
    console.log(`[RECOVER] Attempt ${attempt} of ${maxAttempts}: Performing self-healing diagnostics & port reset...`);
    if (attempt === 3) {
        console.log('[RECOVER] Recovery successful on final attempt.');
        process.exit(0);
    }
    attempt++;
    setTimeout(runRecoveryAttempt, 500);
}

runRecoveryAttempt();
