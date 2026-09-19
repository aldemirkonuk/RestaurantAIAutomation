// Isolated control-flow reproduction: exact audited source, fake React hooks,
// fake API and window. No real HTTP request, token, database, or browser state.
const {execFileSync}=require('child_process');
const vm=require('vm');
const ts=require(require('path').join(require('child_process').execFileSync('git',['rev-parse','--show-toplevel'],{cwd:__dirname,encoding:'utf8'}).trim(),'apps/api-gateway/node_modules/typescript'));
const revision='60ed83a7e6d5eb8b8e0e631783a598cd0f562bff';
const source=execFileSync('git',['show',revision+':apps/web/src/pages/dashboard/next/useDashboardNextData.ts'],{cwd:require('child_process').execFileSync('git',['rev-parse','--show-toplevel'],{cwd:__dirname,encoding:'utf8'}).trim(),encoding:'utf8'});
const slots=[],effects=[],calls=[];let index=0;
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
const react={
 useRef(v){const i=index++;return slots[i]??(slots[i]={current:v});},
 useState(v){const i=index++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],x=>{slots[i]=typeof x==='function'?x(slots[i]):x;}];},
 useCallback(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},
 useEffect(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
};
const dashboardApi={async getCalendarRevenue(y,m,r){calls.push(r);return{year:y,month:m,daily:[{date:'2026-09-01',procurement_spend:r==='A'?100:200,order_count:1,bottles_sold:1,events:[]}],monthly_procurement_spend:r==='A'?100:200,monthly_bottles:1};}};
const sandbox={exports:{},require:n=>n==='react'?react:n==='@/services/api'?{dashboardApi,inventoryApi:{},ordersApi:{}}:(()=>{throw Error('Unexpected import '+n)})(),window:{addEventListener(){},removeEventListener(){}},setInterval(){},clearInterval(){}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
async function render(r){index=0;const result=sandbox.exports.useMonthLedger(r,2026,9);while(effects.length)effects.shift()();await Promise.resolve();return result;}
(async()=>{await render('A');const a=await render('A');await render('B');const b=await render('B');console.log(JSON.stringify({revision,mountedHook:true,initialHouse:'A',initialSpend:a.month.ledger?.monthlySpend,selectedHouse:'B',displayedSpend:b.month.ledger?.monthlySpend,apiRequestsForHouses:calls},null,2));})();
