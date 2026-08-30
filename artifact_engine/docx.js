import fsp from "node:fs/promises";
import path from "node:path";
import { ensureDependencies, getTask, resolveInside, sanitizeFilename, sha256File } from "./runtime.js";
import { registerOutput } from "./task.js";
import { validateArtifactFile } from "./validate.js";
import { readZipFile, writeZipFile } from "./zip.js";

function xmlEscape(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function docxText(v) {
  return xmlEscape(String(v ?? "")).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
}

async function loadManifest(root) {
  const p = resolveInside(root, "knowledge/templates/tata-naskah-dinas/template_manifest.json");
  return JSON.parse(await fsp.readFile(p, "utf8"));
}

function replaceInXml(xml, fields = {}) {
  let out = xml;
  for (const [key, value] of Object.entries(fields || {})) out = out.split(`{{${key}}}`).join(docxText(value));
  // Keep missing placeholders explicit, which preserves the v1.2 anti-fabrication rule.
  out = out.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => `&lt;&lt;BELUM DIISI:${key}&gt;&gt;`);
  return out;
}

export async function generateDocx(root, { taskId, templateKey, filename, fields = {} }) {
  await ensureDependencies(root);
  const { taskDir } = await getTask(root, taskId);
  const manifest = await loadManifest(root);
  const normativeName = manifest.templates?.[templateKey];
  const artifactName = manifest.artifact_templates?.[templateKey];
  const templateName = normativeName || artifactName;
  if (!templateName) throw new Error(`Unknown template key: ${templateKey}`);
  const templatePath = normativeName
    ? resolveInside(root, `knowledge/templates/tata-naskah-dinas/${templateName}`)
    : resolveInside(root, `knowledge/templates/${templateName}`);

  const entries = await readZipFile(templatePath);
  for (const [name, entry] of entries) {
    if (!name.endsWith(".xml")) continue;
    // Placeholders may also appear in headers/footers and properties, so process all XML parts.
    const xml = entry.data.toString("utf8");
    if (!xml.includes("{{")) continue;
    entry.data = Buffer.from(replaceInXml(xml, fields), "utf8");
  }

  const safe = sanitizeFilename(filename || `${templateKey}-${taskId}.docx`);
  const finalName = safe.toLowerCase().endsWith(".docx") ? safe : `${safe}.docx`;
  const outPath = path.join(taskDir, "output", finalName);
  await writeZipFile(outPath, entries);
  const validation = await validateArtifactFile(outPath);
  if (!validation.valid) throw new Error(`Generated DOCX failed validation: ${validation.reason}`);
  const rel = path.relative(root, outPath).replaceAll(path.sep, "/");
  await registerOutput(root, taskId, { type: "DOCX", path: rel, validation: "PASS", sha256: await sha256File(outPath) });
  return { path: rel, template: templateKey, validation, engine: "embedded-no-spawn" };
}
