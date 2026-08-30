import { tool } from "@opencode-ai/plugin";
import { cancelTask } from "../../artifact_engine/task.js";

export default tool({
  description: "Membatalkan task tanpa menghapus input inbox. HANYA setelah user mengatakan BATALKAN TASK.",
  args: {
    task_id: tool.schema.string(),
    confirmation_phrase: tool.schema.string().describe("Harus persis BATALKAN TASK"),
    reason: tool.schema.string()
  },
  async execute(args, context) { return JSON.stringify(await cancelTask((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, confirmationPhrase: args.confirmation_phrase, reason: args.reason }), null, 2); }
});
