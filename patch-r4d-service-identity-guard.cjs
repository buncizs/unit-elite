const fs = require("fs");
const path = require("path");

const root = process.cwd();
const targets = [
  {
    file: path.join(root, ".opencode", "agents", "ketua-tim.md"),
    marker: "<!-- UNIT_ELITE_SERVICE_IDENTITY_GUARD_BEGIN -->",
    insertBefore: "<!-- UNIT_ELITE_RND_V16_BEGIN -->",
    block: `<!-- UNIT_ELITE_SERVICE_IDENTITY_GUARD_BEGIN -->

## Service Identity Invariant

Gunakan identitas layanan berikut secara kanonik dan jangan menafsirkan nama layanan berdasarkan kemiripan fungsi:

- \`Unit Elite Runtime Gateway\` = entry point inference lokal di \`127.0.0.1:20129\`.
- \`9Router AI Router\` = model/provider router lokal di \`127.0.0.1:20128\`.
- \`WhatsApp Communication Bridge\` = backend komunikasi opsional di \`127.0.0.1:8080/api\`.

Aturan:
1. Jika assignment menyebut \`9Router\` tanpa konteks komunikasi, tafsirkan sebagai \`9Router AI Router\` di port \`20128\`.
2. Jangan menyamakan \`9Router\` dengan WhatsApp Communication Bridge, \`BRIDGE_OFFLINE\`, atau port \`8080\`.
3. Status WhatsApp Communication Bridge tidak boleh dipakai sebagai indikator kesehatan inference/runtime.
4. Untuk pemeriksaan inference, bedakan secara eksplisit: Runtime \`:20129\` dan 9Router AI Router \`:20128\`.
5. Jangan mengubah port, service, credential, atau routing hanya untuk menyelesaikan ambiguitas penamaan.

<!-- UNIT_ELITE_SERVICE_IDENTITY_GUARD_END -->

`
  },
  {
    file: path.join(root, ".opencode", "agents", "pranata-komputer.md"),
    marker: "<!-- UNIT_ELITE_SERVICE_IDENTITY_GUARD_BEGIN -->",
    insertBefore: "## Diagnostic protocol",
    block: `<!-- UNIT_ELITE_SERVICE_IDENTITY_GUARD_BEGIN -->

## Service Identity Invariant

Gunakan identitas layanan berikut selama diagnosis:

- \`Unit Elite Runtime Gateway\` = \`127.0.0.1:20129\`; health inference/runtime.
- \`9Router AI Router\` = \`127.0.0.1:20128\`; model/provider router.
- \`WhatsApp Communication Bridge\` = \`127.0.0.1:8080/api\`; backend komunikasi opsional.

Aturan diagnostik:
1. Istilah \`9Router\` berarti \`9Router AI Router\` kecuali assignment secara eksplisit menyebut WhatsApp/communication bridge.
2. Dilarang menggunakan port \`8080\`, \`BRIDGE_OFFLINE\`, atau tool WhatsApp sebagai bukti status 9Router AI Router.
3. Status WhatsApp Communication Bridge tidak menentukan status Runtime atau inference.
4. Jika target ambigu, laporkan identitas/endpoint yang diperiksa sebelum menyimpulkan READY/NOT_READY.
5. Jangan mengubah service, port, credential, konfigurasi, atau proses untuk menyelesaikan ambiguitas identitas.

<!-- UNIT_ELITE_SERVICE_IDENTITY_GUARD_END -->

`
  }
];

let changed = 0;

for (const t of targets) {
  if (!fs.existsSync(t.file)) {
    console.error("ERROR: file not found: " + t.file);
    process.exit(2);
  }

  const src = fs.readFileSync(t.file, "utf8");

  if (src.includes(t.marker)) {
    console.log("ALREADY_PATCHED=" + t.file);
    continue;
  }

  const idx = src.indexOf(t.insertBefore);
  if (idx < 0) {
    console.error("ERROR: insertion anchor not found in: " + t.file);
    process.exit(3);
  }

  const backup = t.file + ".pre-service-identity-guard.bak";
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(t.file, backup);
  }

  const out = src.slice(0, idx) + t.block + src.slice(idx);
  fs.writeFileSync(t.file, out, "utf8");
  changed++;
  console.log("PATCHED=" + t.file);
  console.log("BACKUP=" + backup);
}

console.log("PATCH_OK changed=" + changed);
