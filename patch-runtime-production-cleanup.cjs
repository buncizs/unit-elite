const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "integrations",
  "9router",
  "runtime",
  "runtime-gateway.cjs"
);

if (!fs.existsSync(target)) {
  console.error("ERROR: runtime-gateway.cjs not found from current project root:");
  console.error(target);
  process.exit(2);
}

const src = fs.readFileSync(target, "utf8");

const blockRe =
  /  \/\/ Safe request-shape diagnostics: keys\/counts only; never message\/tool content\.\r?\n[\s\S]*?      ' req=' \+ requestId\);\r?\n  }\r?\n/;

const matches = src.match(new RegExp(blockRe.source, "g")) || [];
if (matches.length !== 1) {
  console.error(`ERROR: expected exactly 1 temporary diagnostic block, found ${matches.length}.`);
  console.error("No changes made.");
  process.exit(3);
}

const diagnosticTokens = [
  "stream shape keys=",
  "payload_bytes=",
  "message_bytes=",
  "tool_bytes=",
  "largest_message_bytes=",
  "[runtime-gateway] message shape",
  "content_len=",
  "part_types="
];

const beforeCounts = Object.fromEntries(
  diagnosticTokens.map((t) => [t, src.split(t).length - 1])
);

const cleaned = src.replace(blockRe, "");

for (const token of diagnosticTokens) {
  if (cleaned.includes(token)) {
    console.error(`ERROR: diagnostic token still remains after patch: ${token}`);
    console.error("No changes made.");
    process.exit(4);
  }
}

const requiredProductionAnchors = [
  "status === 413",
  "SSE canonicalized upstream_done_count=",
  "forwarded_data_lines="
];

for (const anchor of requiredProductionAnchors) {
  if (!src.includes(anchor)) {
    console.error(`ERROR: expected production anchor missing before patch: ${anchor}`);
    console.error("No changes made.");
    process.exit(5);
  }
  if (!cleaned.includes(anchor)) {
    console.error(`ERROR: production anchor would be removed by patch: ${anchor}`);
    console.error("No changes made.");
    process.exit(6);
  }
}

const backup = target + ".pre-production-cleanup.bak";
if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

fs.writeFileSync(target, cleaned, "utf8");

console.log("PATCH_OK");
console.log("TARGET=" + target);
console.log("BACKUP=" + backup);
console.log("REMOVED_DIAGNOSTICS=" + JSON.stringify(beforeCounts));
console.log("PRESERVED=status_413_fallback,unified_sse_canonicalizer");
