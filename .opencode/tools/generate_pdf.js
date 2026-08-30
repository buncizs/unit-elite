import { tool } from "@opencode-ai/plugin";
import { generatePdf } from "../../artifact_engine/pdf.js";

export default tool({
  description: "Menghasilkan PDF ringkas nyata dari section JSON; bukan pengganti master naskah dinas DOCX.",
  args: {
    task_id: tool.schema.string(),
    filename: tool.schema.string(),
    title: tool.schema.string(),
    sections_json: tool.schema.string().describe("JSON array: [{heading,body}]")
  },
  async execute(args, context) {
    let sections;
    try { sections = JSON.parse(args.sections_json); } catch (e) { throw new Error(`sections_json tidak valid: ${e.message}`); }
    if (!Array.isArray(sections)) throw new Error("sections_json harus JSON array");
    return JSON.stringify(await generatePdf((context.directory || context.worktree || process.cwd()), { taskId: args.task_id, filename: args.filename, title: args.title, sections }), null, 2);
  }
});
