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

function pptText(v) {
  // a:t supports literal newlines poorly across viewers; encode line breaks as spaces/newlines.
  return xmlEscape(String(v ?? "").replace(/\r\n/g, "\n"));
}

function slideBody(spec = {}) {
  if (spec.table && Array.isArray(spec.table.rows)) {
    const lines = [];
    if (Array.isArray(spec.table.headers) && spec.table.headers.length) lines.push(spec.table.headers.map((x) => String(x ?? "")).join(" | "));
    for (const row of spec.table.rows) lines.push((Array.isArray(row) ? row : [row]).map((x) => String(x ?? "")).join(" | "));
    return lines.join("\n");
  }
  if (Array.isArray(spec.bullets) && spec.bullets.length) return spec.bullets.map((x) => `• ${String(x ?? "")}`).join("\n");
  return String(spec.body ?? "");
}

function replaceAllPlaceholders(xml, replacements) {
  let out = xml;
  for (const [key, value] of Object.entries(replacements)) out = out.split(`{{${key}}}`).join(pptText(value));
  // Any remaining known-style placeholder remains visible instead of silently disappearing.
  out = out.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => `&lt;&lt;BELUM DIISI:${k}&gt;&gt;`);
  return out;
}

export async function generatePptx(root, { taskId, filename, title = "Paparan", subtitle = "", slides = [] }) {
  await ensureDependencies(root);
  const { taskDir } = await getTask(root, taskId);
  if (!Array.isArray(slides)) throw new Error("slides must be an array");
  if (slides.length > 14) throw new Error("Embedded PPTX master supports maximum 14 content slides plus 1 cover slide");

  const templatePath = resolveInside(root, "knowledge/templates/pptx/Master_Paparan_Dindik_Jatim_15slide.pptx");
  const entries = await readZipFile(templatePath);
  const usedSlides = slides.length + 1; // cover + content

  // Replace cover.
  const cover = entries.get("ppt/slides/slide1.xml");
  cover.data = Buffer.from(replaceAllPlaceholders(cover.data.toString("utf8"), {
    DECK_TITLE: title,
    DECK_SUBTITLE: subtitle,
    TASK_ID: taskId,
  }), "utf8");

  for (let i = 0; i < slides.length; i++) {
    const spec = slides[i] || {};
    const n = i + 1; // placeholder index; actual slide file n+1
    const entry = entries.get(`ppt/slides/slide${n + 1}.xml`);
    if (!entry) throw new Error(`PPTX template slide missing: ${n + 1}`);
    entry.data = Buffer.from(replaceAllPlaceholders(entry.data.toString("utf8"), {
      [`S_${n}_SECTION`]: spec.section || `SLIDE ${n + 1}`,
      [`S_${n}_TITLE`]: spec.title || `Slide ${n + 1}`,
      [`S_${n}_BODY`]: slideBody(spec),
      [`S_${n}_CALLOUT`]: spec.callout || "",
      TASK_ID: taskId,
    }), "utf8");
  }

  // Remove unused slide references from presentation.xml and its relationships.
  const pres = entries.get("ppt/presentation.xml");
  let presXml = pres.data.toString("utf8");
  presXml = presXml.replace(/<p:sldId\b[^>]*r:id="rId(\d+)"\s*\/>/g, (m, rid) => {
    const slideNo = Number(rid) - 6; // generated template: rId7 = slide1
    return slideNo >= 1 && slideNo <= usedSlides ? m : "";
  });
  pres.data = Buffer.from(presXml, "utf8");

  const rels = entries.get("ppt/_rels/presentation.xml.rels");
  let relXml = rels.data.toString("utf8");
  relXml = relXml.replace(/<Relationship\b[^>]*Type="[^"]*\/slide"[^>]*Target="slides\/slide(\d+)\.xml"\s*\/>/g, (m, n) => Number(n) <= usedSlides ? m : "");
  rels.data = Buffer.from(relXml, "utf8");

  const ct = entries.get("[Content_Types].xml");
  let ctXml = ct.data.toString("utf8");
  ctXml = ctXml.replace(/<Override\b[^>]*PartName="\/ppt\/slides\/slide(\d+)\.xml"[^>]*\/>/g, (m, n) => Number(n) <= usedSlides ? m : "");
  ct.data = Buffer.from(ctXml, "utf8");

  // Remove unreferenced slide XML and slide relation files. Other shared master/layout assets remain intact.
  for (let n = usedSlides + 1; n <= 15; n++) {
    entries.delete(`ppt/slides/slide${n}.xml`);
    entries.delete(`ppt/slides/_rels/slide${n}.xml.rels`);
  }

  const safe = sanitizeFilename(filename || `Paparan-${taskId}.pptx`);
  const finalName = safe.toLowerCase().endsWith(".pptx") ? safe : `${safe}.pptx`;
  const outPath = path.join(taskDir, "output", finalName);
  await writeZipFile(outPath, entries);
  const validation = await validateArtifactFile(outPath);
  if (!validation.valid) throw new Error(`Generated PPTX failed validation: ${validation.reason}`);
  const rel = path.relative(root, outPath).replaceAll(path.sep, "/");
  await registerOutput(root, taskId, { type: "PPTX", path: rel, validation: "PASS", sha256: await sha256File(outPath) });
  return { path: rel, slide_count: usedSlides, validation, engine: "embedded-no-spawn" };
}
