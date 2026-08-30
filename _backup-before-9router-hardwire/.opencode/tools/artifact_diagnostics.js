import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";
import { dependencyStatus, ensureDependencies, resolveInside } from "../../artifact_engine/runtime.js";
import { validateArtifactFile } from "../../artifact_engine/validate.js";

export default tool({
  description: "Diagnostik artifact engine v1.3.3 tanpa spawn/npm/Bun install. Memeriksa root proyek, embedded engine, master DOCX/PPTX, dan kesiapan output.",
  args: {},
  async execute(args, context) {
    const root = context.directory || context.worktree || process.cwd();
    const status = await dependencyStatus(root);
    const action = await ensureDependencies(root);
    const docx = resolveInside(root, "knowledge/templates/tata-naskah-dinas/Master_Nota_Dinas_Dindik_Jatim.docx");
    const pptx = resolveInside(root, "knowledge/templates/pptx/Master_Paparan_Dindik_Jatim_15slide.pptx");
    const result = {
      directory: context.directory ?? null,
      worktree: context.worktree ?? null,
      effective_root: root,
      platform: process.platform,
      runtime: process.release?.name ?? "unknown",
      bun_version: process.versions?.bun ?? null,
      node_version: process.versions?.node ?? null,
      engine: status,
      action,
      templates: {
        nota_dinas_exists: fs.existsSync(docx),
        paparan_pptx_exists: fs.existsSync(pptx),
        nota_dinas_validation: fs.existsSync(docx) ? await validateArtifactFile(docx) : null,
        paparan_pptx_validation: fs.existsSync(pptx) ? await validateArtifactFile(pptx) : null,
      },
      spawn_attempted: false,
      external_dependencies_required: false,
      verdict: status.embedded_engine && fs.existsSync(docx) && fs.existsSync(pptx) ? "PASS" : "FAIL",
      note: "v1.3.3 intentionally does not spawn npm, npm.cmd, Bun, PowerShell, or cmd.exe. This avoids Windows Desktop spawn EINVAL." 
    };
    return JSON.stringify(result, null, 2);
  }
});
