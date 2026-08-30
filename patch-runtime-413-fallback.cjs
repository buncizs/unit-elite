const fs = require('fs');
const path = require('path');

const target = path.resolve(
  'integrations',
  '9router',
  'runtime',
  'runtime-gateway.cjs'
);

if (!fs.existsSync(target)) {
  console.error('RUNTIME_SOURCE_NOT_FOUND:', target);
  process.exit(1);
}

let text = fs.readFileSync(target, 'utf8');
const backup = target + '.pre-413-fallback.bak';

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

// 1) Remove the temporary PC-02 max_tokens clamp, if present.
const clampStart = '  // TEMP_PC02_MAX_TOKENS_CLAMP_4096';
const clampEnd = "  for (let i = 0; i < models.length; i++) {";
const clampIdx = text.indexOf(clampStart);

if (clampIdx >= 0) {
  const loopIdx = text.indexOf(clampEnd, clampIdx);
  if (loopIdx < 0) {
    console.error('TEMP_CLAMP_END_ANCHOR_NOT_FOUND');
    process.exit(1);
  }
  text = text.slice(0, clampIdx) + text.slice(loopIdx);
  console.log('TEMP_PC02_CLAMP_REMOVED');
} else {
  console.log('TEMP_PC02_CLAMP_NOT_PRESENT');
}

// 2) Make HTTP 413 a pre-stream fallback-eligible status.
//    Existing code already handles eligible failures by continuing
//    to the next model only if one exists.
if (/status\s*===\s*413\s*\|\|/.test(text)) {
  console.log('HTTP_413_FALLBACK_ALREADY_PRESENT');
} else {
  const anchor = /(\s*status\s*===\s*429\s*\|\|)/;
  if (!anchor.test(text)) {
    console.error('FALLBACK_ELIGIBILITY_ANCHOR_NOT_FOUND');
    process.exit(1);
  }
  text = text.replace(anchor, (m) => {
    const indent = (m.match(/^\s*/) || [''])[0];
    return `${indent}status === 413 ||\n${m}`;
  });
  console.log('HTTP_413_FALLBACK_PATCHED');
}

// 3) Sanity-check routing policy if detectable.
const primaryMatch = text.match(/primary:\s*['"]([^'"]+)['"]/);
const fallbackMatch = text.match(/fallback:\s*['"]([^'"]+)['"]/);

if (primaryMatch) console.log('DETECTED_PRIMARY=' + primaryMatch[1]);
if (fallbackMatch) console.log('DETECTED_FALLBACK=' + fallbackMatch[1]);

if (fallbackMatch && /gemini/i.test(fallbackMatch[1])) {
  console.error('REFUSING_GEMINI_FALLBACK:', fallbackMatch[1]);
  process.exit(1);
}

fs.writeFileSync(target, text, 'utf8');

console.log('PATCH_COMPLETE');
console.log('BACKUP=' + backup);
console.log('NEXT=node --check integrations\\9router\\runtime\\runtime-gateway.cjs');
