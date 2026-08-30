import { tool } from "@opencode-ai/plugin";
import { addTaskInput } from "../../artifact_engine/task.js";

export default tool({
  description: "Menambahkan file inbox baru ke TASK aktif. File disalin dan diregistrasi agar ikut task_done/cleanup saat closure.",
  args: {
    task_id: tool.schema.string(),
    input_path: tool.schema.string().describe("Nama file atau path workspace/inbox/... yang baru dibutuhkan task")
  },
  async execute(args, context) { return JSON.stringify(await addTaskInput((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, inputPath: args.input_path }), null, 2); }
});
