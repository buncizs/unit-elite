import { tool } from "@opencode-ai/plugin";
import { deliveryStatus } from "../../artifact_engine/communication.js";

export default tool({
  description: "Membaca status dan isi Delivery Package. Read-only.",
  args: {
    task_id: tool.schema.string(),
    package_id: tool.schema.string(),
  },
  async execute(args, context) {
    return JSON.stringify(await deliveryStatus((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, packageId: args.package_id }), null, 2);
  }
});
