import { tool } from "@opencode-ai/plugin";
import { repairPartialClose } from "../../artifact_engine/task.js";

export default tool({
  description: "Memperbaiki sisa active task akibat bug copy-then-delete v1.3.2. Hanya menghapus residue jika sudah ada archive CLOSED yang cocok dan checksum seluruh residue identik. Jika file masih terbuka, STOP dan beri warning.",
  args: { task_id: tool.schema.string().describe("TASK-ID yang meninggalkan residue di workspace/active") },
  async execute(args, context) {
    return JSON.stringify(await repairPartialClose((context.directory || context.worktree || process.cwd()), { taskId: args.task_id }), null, 2);
  }
});
