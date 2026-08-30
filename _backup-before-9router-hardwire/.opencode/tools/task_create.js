import { tool } from "@opencode-ai/plugin";
import { createTask } from "../../artifact_engine/task.js";

export default tool({
  description: "Membuat TASK-ID dan workspace aktif. Input dari workspace/inbox disalin, tidak dipindahkan atau dihapus.",
  args: {
    title: tool.schema.string().describe("Judul singkat task"),
    disposition: tool.schema.string().describe("Disposisi pengguna yang menjadi tujuan task"),
    input_paths: tool.schema.array(tool.schema.string()).describe("Daftar file input dari workspace/inbox; boleh nama file saja atau path workspace/inbox/...")
  },
  async execute(args, context) {
    const task = await createTask((context.directory || context.worktree || process.cwd()), { title: args.title, disposition: args.disposition, inputPaths: args.input_paths });
    return JSON.stringify({ task_id: task.task_id, status: task.status, inputs: task.inputs, rule: "Inbox originals remain untouched until TASK SELESAI and closure succeeds." }, null, 2);
  }
});
