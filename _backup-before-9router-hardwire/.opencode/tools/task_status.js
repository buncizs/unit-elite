import { tool } from "@opencode-ai/plugin";
import { taskStatus } from "../../artifact_engine/task.js";

export default tool({
  description: "Membaca status dan manifest task aktif tanpa mengubah file.",
  args: { task_id: tool.schema.string().describe("TASK-ID aktif") },
  async execute(args, context) { return JSON.stringify(await taskStatus((context.directory || context.worktree || process.cwd()), args.task_id), null, 2); }
});
