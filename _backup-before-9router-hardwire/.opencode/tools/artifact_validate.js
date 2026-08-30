import { tool } from "@opencode-ai/plugin";
import path from "node:path";
import { getTask, resolveInside } from "../../artifact_engine/runtime.js";
import { validateArtifactFile } from "../../artifact_engine/validate.js";

export default tool({
  description: "Memvalidasi struktur dasar DOCX/PPTX/XLSX/PDF di output task tanpa mengeditnya.",
  args: {
    task_id: tool.schema.string(),
    output_file: tool.schema.string().describe("Nama file di folder output task")
  },
  async execute(args, context) {
    const { taskDir } = await getTask((context.directory || context.worktree || process.cwd()), args.task_id);
    const outRoot = path.join(taskDir, "output");
    const absolute = resolveInside(outRoot, args.output_file);
    const rel = path.relative(outRoot, absolute);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("Output path escapes task output folder");
    return JSON.stringify(await validateArtifactFile(absolute), null, 2);
  }
});
