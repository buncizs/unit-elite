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

const marker = '// TEMP_PC02_MAX_TOKENS_CLAMP_4096';
if (text.includes(marker)) {
  console.log('CLAMP_ALREADY_PRESENT');
  process.exit(0);
}

const shapeIndex = text.indexOf("safeLog('[runtime-gateway] stream shape");
if (shapeIndex < 0) {
  console.error('STREAM_SHAPE_ANCHOR_NOT_FOUND');
  process.exit(1);
}

const loopAnchor = '  for (let i = 0; i < models.length; i++) {';
const loopIndex = text.indexOf(loopAnchor, shapeIndex);
if (loopIndex < 0) {
  console.error('STREAM_MODEL_LOOP_ANCHOR_NOT_FOUND');
  process.exit(1);
}

const clamp = `  ${marker}
  if (Number.isFinite(Number(parsedPayload.max_tokens)) &&
      Number(parsedPayload.max_tokens) > 4096) {
    const originalMaxTokens = Number(parsedPayload.max_tokens);
    parsedPayload.max_tokens = 4096;
    safeLog('[runtime-gateway] PC02 token clamp original=' +
      originalMaxTokens +
      ' effective=4096 req=' +
      requestId);
  }

`;

const backup = target + '.pre-pc02-clamp.bak';
if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

text = text.slice(0, loopIndex) + clamp + text.slice(loopIndex);
fs.writeFileSync(target, text, 'utf8');

console.log('PC02_MAX_TOKENS_CLAMP_PATCHED');
console.log('BACKUP=' + backup);
