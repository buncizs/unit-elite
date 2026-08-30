import { tool } from "@opencode-ai/plugin";
import { recordQc } from "../../artifact_engine/task.js";

export default tool({
  description: "Mencatat hasil QC ke folder qc task dan memperbarui status QC task. Tidak mengedit substansi.",
  args: {
    task_id: tool.schema.string(),
    status: tool.schema.string().describe("PASS, PASS WITH NOTES, atau FAIL"),
    report: tool.schema.string().describe("Laporan QC lengkap")
  },
  async execute(args, context) { return JSON.stringify(await recordQc((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, status: args.status, report: args.report }), null, 2); }
});
