import { tool } from "@opencode-ai/plugin";
import { dispatchGuard, recordDispatch } from "../../artifact_engine/communication.js";

async function postSend(base, payload){
  const r=await fetch(`${base}/send`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
  const text=await r.text();
  let data; try{data=JSON.parse(text)}catch{data={message:text}}
  return {ok:r.ok && data?.success!==false,http_status:r.status,data};
}

export default tool({
  description: "LIVE outbound WhatsApp adapter to local Go bridge. Requires APPROVED Delivery Package and dispatch guard. This tool can send real external messages/files and therefore should remain permission=ask.",
  args: {
    task_id: tool.schema.string(),
    package_id: tool.schema.string(),
    recipient_index: tool.schema.number(),
    bridge_url: tool.schema.string().describe("Default http://127.0.0.1:8080/api"),
  },
  async execute(args, context) {
    const root=(context.directory || context.worktree || process.cwd());
    const guard=await dispatchGuard(root,{taskId:args.task_id,packageId:args.package_id,recipientIndex:args.recipient_index});

    // v1.5.1 pilot safety: real dispatch is restricted to an explicit local allowlist.
    let pilot={pilot_mode:true,allowed_numbers:[],max_dispatch_per_approval:3};
    try{
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      pilot=JSON.parse(await readFile(join(root,"integrations","whatsapp-mcp-pilot","pilot_config.json"),"utf8"));
    }catch(_){ }
    const normalizedRecipient=String(guard.recipient||"").replace(/\D/g,"");
    if(pilot?.pilot_mode!==false){
      const allowed=(Array.isArray(pilot?.allowed_numbers)?pilot.allowed_numbers:[]).map(x=>String(x).replace(/\D/g,""));
      if(!allowed.includes(normalizedRecipient)){
        return JSON.stringify({status:"PILOT_RECIPIENT_NOT_ALLOWED",recipient_index:args.recipient_index,recipient:guard.recipient,reason:"Pilot mode aktif. Tambahkan hanya nomor milik tim/penguji ke integrations/whatsapp-mcp-pilot/pilot_config.json sebelum dispatch."},null,2);
      }
    }
    const base=(args.bridge_url || "http://127.0.0.1:8080/api").replace(/\/$/,"");
    const filesSent=[];
    let messageSent=false;
    try{
      if(guard.attachments.length){
        for(let i=0;i<guard.attachments.length;i++){
          const a=guard.attachments[i];
          const payload={recipient:guard.recipient,media_path:a.absolute_path};
          if(i===0 && guard.message) payload.message=guard.message;
          const res=await postSend(base,payload);
          if(!res.ok){
            await recordDispatch(root,{taskId:args.task_id,packageId:args.package_id,recipientIndex:args.recipient_index,outcome:"FAILED",backend:"WHATSAPP_GO_BRIDGE",backendMessage:`HTTP ${res.http_status}: ${res.data?.message||JSON.stringify(res.data)}`,messageSent:i===0&&Boolean(guard.message),filesSent});
            return JSON.stringify({status:"FAILED",recipient_index:args.recipient_index,http_status:res.http_status,backend_response:res.data,files_sent:filesSent},null,2);
          }
          filesSent.push(a.filename);
          if(i===0 && guard.message) messageSent=true;
        }
      } else {
        const res=await postSend(base,{recipient:guard.recipient,message:guard.message});
        if(!res.ok){
          await recordDispatch(root,{taskId:args.task_id,packageId:args.package_id,recipientIndex:args.recipient_index,outcome:"FAILED",backend:"WHATSAPP_GO_BRIDGE",backendMessage:`HTTP ${res.http_status}: ${res.data?.message||JSON.stringify(res.data)}`,messageSent:false,filesSent:[]});
          return JSON.stringify({status:"FAILED",recipient_index:args.recipient_index,http_status:res.http_status,backend_response:res.data},null,2);
        }
        messageSent=true;
      }
      const rec=await recordDispatch(root,{taskId:args.task_id,packageId:args.package_id,recipientIndex:args.recipient_index,outcome:"SENT",backend:"WHATSAPP_GO_BRIDGE",backendMessage:"Bridge accepted send request. Delivery/read status not proven by this result.",messageSent,filesSent});
      return JSON.stringify({status:"SENT",recipient_index:args.recipient_index,recipient:guard.recipient,files_sent:filesSent,message_sent:messageSent,delivery_status:"UNVERIFIED",package_state:rec.package_state},null,2);
    }catch(e){
      const msg=String(e?.message||e);
      try{await recordDispatch(root,{taskId:args.task_id,packageId:args.package_id,recipientIndex:args.recipient_index,outcome:"FAILED",backend:"WHATSAPP_GO_BRIDGE",backendMessage:`BACKEND_NOT_CONNECTED/ERROR: ${msg}`,messageSent:false,filesSent});}catch(_){}
      return JSON.stringify({status:"BACKEND_NOT_CONNECTED",recipient_index:args.recipient_index,error:msg,files_sent:filesSent},null,2);
    }
  }
});
