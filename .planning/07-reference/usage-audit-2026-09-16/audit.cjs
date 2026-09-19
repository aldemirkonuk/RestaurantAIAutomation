const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const assert = require('node:assert/strict');
const root = '/Users/aldemirkonuk/.codex/sessions';
const cutoff = process.argv[2] || '2026-09-16T13:33:00.000Z';
assert(Number.isFinite(Date.parse(cutoff)), 'Provide an ISO timestamp cutoff');
const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : e.name.endsWith('.jsonl') ? [path.join(dir,e.name)] : []);
const project = s => /Mudavym|restaurant-ai-automation|RestaurantAIAutomation/i.test(s || '');
const requests = new Map(), files = [], rateEvents = [];
let duplicates = 0, badLines = 0;
async function main() {
  for (const file of walk(root).sort()) {
    const stat = {file, models:{}, efforts:{}, tools:{}, calls:0, outputChars:0, largeOutputs:0, compactions:0, turns:0, mentionsProject:false, records:0, eventCounts:0, largestOutputs:[], settings:[]};
    let model='unknown', effort='unknown', previous=null, context={};
    const fallback=[];
    for await (const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})) {
      if (!line) continue;
      let e; try {e=JSON.parse(line);} catch {badLines++;continue;}
      if (e.timestamp > cutoff) continue;
      const p=e.payload || {};
      if(e.type==='session_meta') {
        stat.id=p.id;stat.cwd=p.cwd;stat.source=p.source;stat.threadSource=p.thread_source;
        stat.created=e.timestamp;stat.sessionId=p.session_id;
      }
      if(e.type==='turn_context') {
        model=p.model || model;effort=p.effort || effort;context=p;
        stat.models[model]=(stat.models[model]||0)+1;stat.efforts[effort]=(stat.efforts[effort]||0)+1;stat.turns++;
        if(project(p.cwd)) stat.projectCwd=true;
      }
      if(e.type==='compacted') stat.compactions++;
      if(e.type==='response_item') {
        if(project(JSON.stringify(p))) stat.mentionsProject=true;
        if(['function_call','custom_tool_call'].includes(p.type)) {
          stat.calls++;stat.tools[p.name]=(stat.tools[p.name]||0)+1;
        }
        if(['function_call_output','custom_tool_call_output'].includes(p.type)) {
          const chars=typeof p.output==='string'?p.output.length:JSON.stringify(p.output||'').length;
          stat.outputChars+=chars;if(chars>20000)stat.largeOutputs++;
          stat.largestOutputs.push({timestamp:e.timestamp,chars});
        }
      }
      if(e.type==='event_msg' && p.type==='thread_settings_applied') {
        const s=p.thread_settings || {};
        stat.settings.push({timestamp:e.timestamp,model:s.model,effort:s.reasoning_effort,serviceTier:s.service_tier});
      }
      if(e.type==='token_usage_record') {
        stat.records++;
        const key=p.response_id || [p.thread_id,p.turn_id,e.timestamp,JSON.stringify(p.usage)].join(':');
        const row={timestamp:e.timestamp,model,effort,thread:p.thread_id || stat.id,session:p.session_id || stat.sessionId,file,cwd:context.cwd || stat.cwd,usage:p.usage,source:'record'};
        if(requests.has(key))duplicates++;else requests.set(key,row);
      }
      if(e.type==='event_msg' && p.type==='token_count') {
        stat.eventCounts++;
        if(p.rate_limits)rateEvents.push({timestamp:e.timestamp,limit:p.rate_limits.limit_id,plan:p.rate_limits.plan_type,primary:p.rate_limits.primary,secondary:p.rate_limits.secondary});
        const total=p.info?.total_token_usage,last=p.info?.last_token_usage;
        if(total) {
          const delta=Object.fromEntries(fields.map(k=>[k,(total[k]||0)-(previous?.[k]||0)]));
          if(delta.total_tokens>0 && last && last.input_tokens>0)fallback.push({timestamp:e.timestamp,model,effort,thread:stat.id,session:stat.sessionId,file,cwd:context.cwd||stat.cwd,usage:last,source:'last_usage_fallback'});
          previous=total;
        }
      }
    }
    // Older logs lack per-response records. Last usage avoids billing inherited cumulative history.
    if(!stat.records)for(const row of fallback){const key=[row.thread,row.timestamp,JSON.stringify(row.usage)].join(':');if(requests.has(key))duplicates++;else requests.set(key,row);}
    stat.largestOutputs.sort((a,b)=>b.chars-a.chars);stat.largestOutputs=stat.largestOutputs.slice(0,3);
    files.push(stat);
  }
  const rows=[...requests.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  for(const row of rows) {
    const u=row.usage;
    assert(u.cached_input_tokens <= u.input_tokens, 'Cached input must be a subset');
    assert(u.reasoning_output_tokens <= u.output_tokens, 'Reasoning must be a subset');
    assert.equal(u.total_tokens, u.input_tokens+u.output_tokens, 'Token accounting mismatch');
  }
  const byFile=new Map(files.map(f=>[f.file,f]));
  for(const r of rows){const f=byFile.get(r.file);r.scope=project(r.cwd)||f.projectCwd?'project_cwd':f.mentionsProject?'project_mentioned':'other';}
  function aggregate(group) {
    const out={};
    for(const r of rows){const key=group(r);const a=out[key] ||= {requests:0,...Object.fromEntries(fields.map(k=>[k,0])),inputs:[],threads:new Set(),sources:{}};a.requests++;for(const k of fields)a[k]+=r.usage?.[k]||0;a.inputs.push(r.usage?.input_tokens||0);a.threads.add(r.thread);a.sources[r.source]=(a.sources[r.source]||0)+1;}
    for(const a of Object.values(out)){a.inputs.sort((x,y)=>x-y);a.medianInput=a.inputs[Math.floor(a.inputs.length*.5)];a.p90Input=a.inputs[Math.floor(a.inputs.length*.9)];a.maxInput=a.inputs.at(-1);a.over100k=a.inputs.filter(v=>v>100000).length;a.over200k=a.inputs.filter(v=>v>200000).length;a.over272k=a.inputs.filter(v=>v>272000).length;delete a.inputs;a.threadCount=a.threads.size;delete a.threads;a.cacheRate=a.cached_input_tokens/a.input_tokens;a.uncachedInput=a.input_tokens-a.cached_input_tokens;}
    return out;
  }
  const summary={cutoff,files:files.length,badLines,duplicates,range:[rows[0]?.timestamp,rows.at(-1)?.timestamp],total:aggregate(()=> 'all'),byDay:aggregate(r=>r.timestamp.slice(0,10)),byModel:aggregate(r=>r.model),byEffort:aggregate(r=>r.effort),byScope:aggregate(r=>r.scope),byThread:aggregate(r=>r.thread),byModelDay:aggregate(r=>r.timestamp.slice(0,10)+' '+r.model)};
  fs.writeFileSync('/tmp/mudavym-usage-summary.json',JSON.stringify({summary,files,rows,rateEvents},null,2));
  const top=Object.entries(summary.byThread).sort((a,b)=>b[1].input_tokens-a[1].input_tokens).slice(0,10).map(([id,v])=>{
    const rowFiles=new Set(rows.filter(r=>r.thread===id).map(r=>r.file));
    return {id,...v,files:files.filter(f=>rowFiles.has(f.file)).map(f=>({rollout:path.basename(f.file),calls:f.calls,turns:f.turns,compactions:f.compactions,tools:f.tools}))};
  });
  const exportData={...summary,byThread:undefined,byModelDay:undefined,top,
    method:'Unique response_id token_usage_record. Cached input and reasoning output are subsets. All dates UTC. Local logs only; not an invoice.',
    settingsValues:[...new Set(files.flatMap(f=>f.settings.map(s=>s.serviceTier)).filter(Boolean))]};
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(exportData,null,2)+'\n');
  console.log(JSON.stringify({cutoff,files:files.length,badLines,duplicates,range:summary.range,total:summary.total,settingsValues:exportData.settingsValues}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
