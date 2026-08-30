import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export default tool({
  description: "Read-only diagnostics Unit Elite v1.5 Communication Gateway. Tidak mengirim, tidak approve, tidak mengubah task.",
  args: {},
  async execute(args, context) {
    const root=path.resolve(context.directory || context.worktree || process.cwd());
    const req=[
      ".opencode/agents/dispatcher-komunikasi.md",
      ".opencode/skills/communication-gateway/SKILL.md",
      ".opencode/tools/communication_prepare.js",
      ".opencode/tools/communication_approve.js",
      ".opencode/tools/communication_dispatch_guard.js",
      ".opencode/tools/whatsapp_bridge_dispatch.js",
      "artifact_engine/communication.js",
      "knowledge/contact-registry/nomor_ks.csv",
      "knowledge/contact-registry/internal/internal_contacts.csv",
      "integrations/whatsapp-mcp-pilot/README.md"
    ];
    const files=Object.fromEntries(req.map(r=>[r,fs.existsSync(path.join(root,r))]));
    let cfg={};
    try{cfg=JSON.parse(await fsp.readFile(path.join(root,"config/unit-elite.json"),"utf8"));}catch(e){cfg={error:String(e?.message||e)}}
    let bridge={status:"NOT_CHECKED",send_attempted:false};
    const base="http://127.0.0.1:8080/api";
    try{
      const r=await fetch(`${base}/send`,{method:"GET",signal:AbortSignal.timeout(1800)});
      bridge={status:[405,400].includes(r.status)?"BRIDGE_ONLINE":"BRIDGE_RESPONDED",http_status:r.status,send_attempted:false};
    }catch(e){bridge={status:"BRIDGE_OFFLINE",error:String(e?.message||e),send_attempted:false};}
    const localPass=Object.values(files).every(Boolean) && cfg.version==="1.5" && cfg.communication_gateway?.human_approval_required===true && cfg.communication_gateway?.auto_send_after_qc===false;
    return JSON.stringify({
      version:cfg.version||null,
      local_gateway:localPass?"PASS":"FAIL",
      files,
      human_approval_required:cfg.communication_gateway?.human_approval_required,
      auto_send_after_qc:cfg.communication_gateway?.auto_send_after_qc,
      live_backend_policy:cfg.communication_gateway?.live_backend,
      bridge,
      verdict:localPass?"PASS":"FAIL",
      note:"BRIDGE_OFFLINE does not fail local gateway diagnostics; live WhatsApp is optional and disabled by default."
    },null,2);
  }
});
