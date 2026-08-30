import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { readZipFile } from "./zip.js";

export async function validateArtifactFile(filePath) {
  if (!fs.existsSync(filePath)) return { valid: false, reason: "file-not-found" };
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size === 0) return { valid: false, reason: "empty-or-not-file" };
  const ext = path.extname(filePath).toLowerCase();
  const head = Buffer.alloc(Math.min(8, stat.size));
  const fd = await fsp.open(filePath, "r");
  await fd.read(head, 0, head.length, 0);
  await fd.close();

  if (ext === ".pdf") {
    const ok = head.toString("ascii", 0, 5) === "%PDF-";
    return { valid: ok, reason: ok ? "pdf-signature-ok" : "invalid-pdf-signature", size: stat.size, engine: "embedded-no-spawn" };
  }

  if ([".docx", ".pptx", ".xlsx"].includes(ext)) {
    if (!(head[0] === 0x50 && head[1] === 0x4b)) return { valid: false, reason: "office-file-not-zip", size: stat.size };
    let zip;
    try { zip = await readZipFile(filePath); }
    catch (e) { return { valid: false, reason: `zip-open-failed: ${e.message}`, size: stat.size }; }
    const required = {
      ".docx": ["[Content_Types].xml", "word/document.xml"],
      ".pptx": ["[Content_Types].xml", "ppt/presentation.xml"],
      ".xlsx": ["[Content_Types].xml", "xl/workbook.xml"],
    }[ext];
    const missing = required.filter((r) => !zip.has(r));
    return { valid: missing.length === 0, reason: missing.length ? `missing-zip-parts:${missing.join(",")}` : "office-structure-ok", size: stat.size, engine: "embedded-no-spawn" };
  }
  return { valid: false, reason: `unsupported-extension:${ext || "none"}`, size: stat.size };
}
