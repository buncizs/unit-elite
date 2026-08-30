import { tool } from "@opencode-ai/plugin";
import { closeTask } from "../../artifact_engine/task.js";

export default tool({
  description: "Menutup task secara transaksional dengan preflight file-lock dan atomic rename. HANYA setelah user mengatakan TASK SELESAI, QC PASS/PASS WITH NOTES, dan artifact valid. Membuat task_done/{tanggal_jam}/input/output/support/qc/working, executive-summary.pdf, manifest.json; kemudian membersihkan inbox yang checksum-nya aman.",
  args: {
    task_id: tool.schema.string(),
    confirmation_phrase: tool.schema.string().describe("Harus persis TASK SELESAI"),
    executive_summary: tool.schema.string().describe("Ringkasan eksekutif final untuk PDF penutupan"),
    cleanup_inbox: tool.schema.boolean().describe("true untuk memindahkan logis input dari inbox setelah arsip terverifikasi")
  },
  async execute(args, context) {
    return JSON.stringify(await closeTask((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, confirmationPhrase: args.confirmation_phrase, executiveSummary: args.executive_summary, cleanupInbox: args.cleanup_inbox }), null, 2);
  }
});
