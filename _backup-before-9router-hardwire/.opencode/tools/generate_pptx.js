import { tool } from "@opencode-ai/plugin";
import { generatePptx } from "../../artifact_engine/pptx.js";

export default tool({
  description: "Menghasilkan file PPTX 16:9 dengan identitas Unit Elite/Dinas Pendidikan dari spesifikasi slide JSON.",
  args: {
    task_id: tool.schema.string(),
    filename: tool.schema.string(),
    title: tool.schema.string(),
    subtitle: tool.schema.string(),
    slides_json: tool.schema.string().describe("JSON array slide: {title, section?, bullets?, body?, callout?, table?:{headers,rows}}")
  },
  async execute(args, context) {
    let slides;
    try { slides = JSON.parse(args.slides_json); } catch (e) { throw new Error(`slides_json tidak valid: ${e.message}`); }
    if (!Array.isArray(slides)) throw new Error("slides_json harus JSON array");
    return JSON.stringify(await generatePptx((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, filename: args.filename, title: args.title, subtitle: args.subtitle, slides }), null, 2);
  }
});
