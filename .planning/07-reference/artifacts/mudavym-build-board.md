---
title: "Mudavym Build Board"
source_url: https://claude.ai/artifact/9nuqKGDTVxK7LWqfr912Vk
internal_id: 47322370-4b81-445d-ab74-09624d65c847
pulled: 2026-09-16
note: "Interactive board; snapshot pulled 2026-09-16."
---

<!doctype html><html><head><!-- frame-runtime --><script>window.__FRAME_PREAMBLE={"v":1,"cred":"query","capabilities":{"artifact":"artifact.O-h4mzdy.js","assets":"assets.DhQw8DTi.js","comments":"comments.DrhK3r8W.js","db":"db.DV02l9iB.js","downloads":"downloads.axDW2QAi.js","embed":"embed.swQslL0W.js","endpoints":"endpoints.BPfoKaE1.js","mcp":"mcp.C8qKIFvQ.js","network":"network.B5UA9Su4.js","permissions":"permissions.DWFFeHI0.js","room":"room.BF1j0KPr.js","sample":"sample.C7KQQdQj.js","self":"artifact.O-h4mzdy.js","user":"user.CCh6oTS_.js"},"transforms":"_transforms.DOfCNjBN.js","comments":"_comments.D8Q8NfHc.js","translate":"_translate.DqxC5ek1.js","ldx":"_ldx.CqNtBrkk.js"}                                                    </script><script>(function(){"use strict";var Bn=3e5;function or(e,t){try{const r=e("navigation")[0],n=[r.responseStart,r.redirectEnd-r.redirectStart,r.domContentLoadedEventStart,t()];for(let a=0;a<n.length;a++){if(!(n[a]>=0&&n[a]<=3e5))return;n[a]=n[a]|0}return n}catch{return}}var ar=["light","dark","system"],sr=/^[A-Za-z0-9_-]{1,64}$/,bt=/^[a-zA-Z_:][a-zA-Z0-9_:.-]{0,127}$/,ir=new Set(["class","hidden","value","checked","style","title","alt","placeholder","lang","dir","role","tabindex","disabled","readonly","contenteditable","open","colspan","rowspan"]);function lr(e){const t=e.toLowerCase();return t.startsWith("data-")||t.startsWith("aria-")||ir.has(t)}var wt="data-ldx-props";function cr(e,t){if(t.toLowerCase()===wt)return!0;const r=e.getAttribute(wt);if(r===null)return!1;try{const n=JSON.parse(r);if(n===null||typeof n!="object"||Array.isArray(n))return!0;const a=t.toLowerCase();return Object.keys(n).some(s=>s.toLowerCase()===a)}catch{return!0}}var qn="http://www.w3.org/1999/xhtml",ur="http://www.w3.org/2000/svg",fr=new Set(["script","style","iframe","noscript","noframes","noembed","xmp","plaintext","template","title","textarea","object","embed"]),dr=new Set(["script","style"]);function hr(e){const t=e.localName.toLowerCase();return e.namespaceURI==="http://www.w3.org/1999/xhtml"?!fr.has(t):e.namespaceURI===ur?!dr.has(t):!1}function We(e,t){return e===t||(e===160||e===32)&&(t===160||t===32)}function pr(e,t){const r=e.length,n=t.length;let a=0;for(;a<r&&a<n&&We(e.charCodeAt(a),t.charCodeAt(a));)a++;let s=0;for(;s<r-a&&s<n-a&&We(e.charCodeAt(r-1-s),t.charCodeAt(n-1-s));)s++;return{p:a,s}}function mr(e,t){const r=e.firstChild;if(e.childNodes.length!==1||r===null||r.nodeType!==Node.TEXT_NODE){e.textContent=t;return}const n=r.data,a=n.length,s=t.length,{p:c,s:d}=pr(n,t);c===a&&d===0&&a===s||r.replaceData(c,a-c-d,t.slice(c,s-d));const R=r.data,y=e.ownerDocument.getSelection?.()??null,T=y!==null&&y.rangeCount>0&&(y.anchorNode===r||y.focusNode===r)?{anchor:y.anchorNode,anchorOffset:y.anchorOffset,focus:y.focusNode,focusOffset:y.focusOffset}:null;let v=-1,A=-1;for(let h=0;h<R.length&&h<t.length;h++){const L=R.charCodeAt(h),$=t.charCodeAt(h);L!==$&&We(L,$)&&(v<0&&(v=h),A=h)}const m=v>=0;if(m&&r.replaceData(v,A-v+1,t.slice(v,A+1)),m&&T!==null&&T.anchor!==null&&T.focus!==null)try{y.setBaseAndExtent(T.anchor,T.anchorOffset,T.focus,T.focusOffset)}catch{}}var vr=new Set(["html","head","body","frameset"]);function yr(e){return e.namespaceURI==="http://www.w3.org/1999/xhtml"&&vr.has(e.localName)}function _r(e){if(e===null||typeof e!="object")return!1;const t=e;if(typeof t.target!="string"||!sr.test(t.target)||t.text!==void 0&&typeof t.text!="string")return!1;if(t.attrsSet!==void 0){if(t.attrsSet===null||typeof t.attrsSet!="object")return!1;for(const[r,n]of Object.entries(t.attrsSet))if(!bt.test(r)||typeof n!="string")return!1}if(t.attrsRemoved!==void 0){if(!Array.isArray(t.attrsRemoved))return!1;for(const r of t.attrsRemoved)if(typeof r!="string"||!bt.test(r))return!1}return!0}function gr(e,t){if(e===null||typeof e!="object")return!1;const{seq:r,elements:n}=e;if(typeof r!="number"||!Number.isSafeInteger(r)||!Array.isArray(n)||n.length===0||n.length>64)return!1;for(let a=0;a<n.length;a++)if(!t(n[a]))return!1;return!0}function br(e){return e===null||typeof e!="object"?!1:gr(e.__frame_patch,_r)}function wr(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_init;return t!==null&&typeof t=="object"}function Er(e){return e!==null&&typeof e=="object"&&e.__frame_size_poke===!0}function Sr(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_host_visible;return t!==null&&typeof t=="object"&&typeof t.visible=="boolean"}function Ar(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_theme;if(t===null||typeof t!="object")return!1;const r=t.theme;return typeof r=="string"&&ar.includes(r)}var kr=["ok","empty","snapshot_error","snapshot_timeout","unclonable","oversize","unavailable","restore_error","withheld"],Rr=["TypeError","RangeError","ReferenceError","SyntaxError","DataCloneError","QuotaExceededError","AbortError","TimeoutError","SecurityError","Error","other"];function Tr(e){return typeof e=="string"&&Rr.includes(e)?e:"other"}var Or=Object.freeze({until:null,now:!1}),Lr="__claude_hot",Mr="__claude_hot_in",Pr=/^__claude_hot(?:_in)?(?::|$)/,Et=/^[0-9a-z]{1,32}$/,Ve=e=>e===void 0?Lr:"__claude_hot:"+e,_e=e=>e===void 0?Mr:"__claude_hot_in:"+e;function Cr(e,t){const r=[];for(let n=0;n<e.length;n++){const a=e.key(n);a!==null&&a!==t&&Pr.test(a)&&r.push(a)}for(const n of r)e.removeItem(n)}function Nr(e){let t=null;try{t=q(JSON.parse(e)?.hot)}catch{return null}return t===null||typeof t.k!="string"||!Et.test(t.k)?null:ae(t.g)?{k:t.k,g:t.g}:{k:t.k}}var Un=262144,xr=3e3,jr=5e3,St=/^[a-z0-9._:-]{1,64}$/,Ir=["none","hot-restart","hard-reload"],Dr=["asset","doc","added","removed"],Fr=1500,Hr=/^[0-9a-f]{64}$/;function q(e){return e!==null&&typeof e=="object"?e:null}function ae(e){return typeof e=="number"&&Number.isInteger(e)&&e>=0&&e<2**31}function At(e){return e===void 0||typeof e=="number"&&Number.isFinite(e)}function Br(e){return e===void 0||typeof e=="string"&&St.test(e)}function kt(e){const t=q(e);return t!==null&&(t.until===null||typeof t.until=="number"&&Number.isFinite(t.until))&&typeof t.now=="boolean"}function Xe(e){const t=q(e);return t!==null&&typeof t.ver=="string"&&t.ver.length<=128&&At(t.seq)&&typeof t.handoff=="string"&&kr.includes(t.handoff)&&Br(t.note)}function qr(e){const t=q(e);return t!==null&&ae(t.gen)&&(t.phase==="final"||t.phase==="pending")&&(t.from===null||Xe(t.from))}function Ur(e){const t=q(e);return t!==null&&t.kv===1&&ae(t.gen)&&Xe(t.from)&&Object.hasOwn(t,"data")}function zr(e){const t=q(e);return t!==null&&t.__frame_hot_snapshot===!0&&ae(t.gen)&&typeof t.timeoutMs=="number"&&t.timeoutMs>=0&&t.timeoutMs<=6e4&&(t.handoff===void 0||typeof t.handoff=="boolean")&&(t.deadline===void 0||kt(t.deadline))&&At(t.seq)&&(t.note===void 0||typeof t.note=="string")&&(t.key===void 0||typeof t.key=="string")}function Gr(e){const t=q(e);return t!==null&&t.__frame_hot_start===!0&&ae(t.gen)&&Xe(t.from)}function Kr(e){return typeof e=="string"&&e.length>=1&&e.length<=128}function Rt(e){return q(e)!==null&&!Array.isArray(e)}function $r(e){const t=q(e);return t!==null&&t.__frame_cap_grant===!0&&typeof t.cap=="string"&&Kr(t.ver)&&(t.grant===void 0||Rt(t.grant))&&(t.budgets===void 0||Rt(t.budgets)&&Object.values(t.budgets).every(Number.isFinite))&&(t.brokerGen===void 0||ae(t.brokerGen))}function Wr(e){const t=q(e);return t!==null&&t.__frame_cap_rewired===!0&&(t.caps===void 0||Array.isArray(t.caps)&&t.caps.every(r=>typeof r=="string"))&&(t.brokerGen===void 0||ae(t.brokerGen))}function Tt(e){const t=q(e);return t!==null&&typeof t.ver=="string"&&t.ver.length<=128&&Number.isFinite(t.seq)}function Ot(e){if(e==null||typeof e=="string")return!0;const t=q(e);return t!==null&&typeof t.doc=="string"&&typeof t.profile=="string"}function Vr(e){const t=q(e);return t!==null&&typeof t.path=="string"&&Dr.includes(t.kind)&&Ot(t.from)&&Ot(t.to)}function Xr(e){return e===null?null:Object.freeze(e.filter(Vr))}function Yr(e){const t=q(e);return t!==null&&t.__frame_hot_update===!0&&Number.isFinite(t.id)&&Tt(t.from)&&Tt(t.to)&&(t.changed===null||Array.isArray(t.changed))&&Ir.includes(t.required)&&kt(t.deadline)&&typeof t.verdictTimeoutMs=="number"&&t.verdictTimeoutMs>=0&&t.verdictTimeoutMs<=6e4&&(t.preflight===void 0||typeof t.preflight=="string"&&Hr.test(t.preflight))}var se=/^[\w.-]+\.js$/;function Jr(e,t,r){return r?"inert":typeof t=="string"&&se.test(t)?e?[t]:"inert":e?"inert":"framed"}var Lt=Object.freeze({[Symbol("claude.hot.restart")]:!0});function Mt(e,t){let r;try{r=e??sessionStorage}catch{return null}const n=Ve(t?.k),a=_e(t?.k);let s=null;try{s=r.getItem(n)}catch{}try{r.removeItem(n)}catch{}try{Cr(r,a)}catch{}let c=null;if(s!==null&&!(t!==null&&t.g===void 0))try{const d=JSON.parse(s);Ur(d)&&(t===null||d.gen===t.g)&&(c=d)}catch{}if(c===null)try{r.removeItem(a)}catch{}return c}function Pt(){const e=/^\/_f\/([^/]{1,128})\//.exec(location.pathname);return e?e[1]:""}var Zr=/^[^/\\?#]{1,128}$/,Ct=e=>Zr.test(e)&&e!=="."&&e!=="..";function Nt(e,t,r){const n=new URL(e),a="/_f/"+t+"/";if(!t||!n.pathname.startsWith(a)||!Ct(r))return null;const s=n.search.slice(1).split("&").filter(c=>!/^__frame_t(?:=|$)/.test(c)).join("&");return n.origin+"/_f/"+r+"/"+n.pathname.slice(a.length)+(s?"?"+s:"")+n.hash}var Ne="{}";function ge(e){if(!e)return null;const t={ver:e.ver,handoff:e.handoff};return e.seq!==void 0&&(t.seq=e.seq),e.note!==void 0&&(t.note=e.note),t}function xt(e,t){return e!==null&&e.note===void 0&&t?.note!==void 0?{...e,note:t.note}:e}function jt(e){const t=e?.k;return t!==null&&typeof t=="object"?t:void 0}function Qr(e,t,r,n=null){const a=setTimeout,s=clearTimeout,c=queueMicrotask,d=performance.now.bind(performance),R=new TextEncoder;let y=null,T=null;try{y=history,T=y.replaceState.bind(y)}catch{}const v=(...o)=>{try{console.warn(...o)}catch{}};let A=Pt(),m=null;try{m=sessionStorage}catch{}const h={storage:m,fetch:typeof fetch=="function"?fetch.bind(globalThis):null,entry:location.origin+location.pathname+location.search,ver:A,key:n?.k};let L=n?.k;const $=typeof requestAnimationFrame=="function"?requestAnimationFrame:o=>a(()=>o(d()),16);let g=t?.data??{},N=ge(t?.from),O=t?.gen??0,I=t!==null,W=!1,Q=!1,V=null,Se=!1;const Ae=new AbortController;let ke=null,B=null,Re=null,Te=!1,l=()=>{};const p=new Promise(o=>{l=o});let b=!1,D=!1,x=!1,F,P=null,ce=!1,Fe=!1,re=!1,Oe=!1,ne=!1,de=!1;const oe=o=>{for(const u of[Ve(o),_e(o)])try{m?.removeItem(u)}catch{}},H=(o,u)=>{try{u!==null&&r.post(o,u)}catch{}},he=()=>ne||=re&&(B===null||Oe),X=()=>{const o={__frame_hot:!0,ready:B!==null,accept:Re!==null,demand:!0};de=!ne,de&&(o.booting=!0),b&&(o.readData=!0),x&&(o.threw=!0),P?.assess&&(o.preflight=!0),H(o,V)};let Le=!1,Me=!1,i=!1,w=!1;const _=()=>{Le||!Se||i||(Le=!0,H({__frame_reveal_hold:!0},"*"))},C=()=>new Promise(o=>{let u,f=0;const E=j=>{if(u===void 0)u=j;else if(j!==u||++f>=8){o();return}try{$(E)}catch{o()}};try{$(E)}catch{o()}}),Y=()=>{i=!0,H({__frame_reveal_ready:!0},"*")},K=o=>{Me||(Me=!0,o.then(u=>{if(u===!1)return;let f=null;try{f=P?.settle?.()??null}catch{}return(f===null?C():new Promise(E=>{a(E,50),Promise.resolve(f).then(E,E)}).then(C)).then(Y)}))},Pe=()=>{if(w||!i)return;w=!0;const o=()=>{try{P?.afterReveal?.()}catch{}};o(),C().then(()=>{o(),Y()})},He=(o=!1)=>{if(Te||B===null||!I||!Q)return;Te=!0;const u=B,f=g;c(()=>{let E;try{E=u(f)}catch(U){throw l(!1),U}let j=!1;try{j=typeof E?.then=="function"}catch{}if(!j){l(!0);return}Promise.resolve(E).then(()=>l(!0),U=>{l(!1),c(()=>{throw U})})}),K(o?p:r.dcl.then(()=>p))},Be=o=>typeof o=="string"&&St.test(o)?o:void 0,ct=o=>{const u={__frame_hot_restart:!0},f=Be(o?.note);f!==void 0&&(u.note=f),o?.required==="hard-reload"&&(u.required="hard-reload"),H(u,V)},Yt=Object.freeze({get data(){return Q||(D=!0),!I&&!b&&(b=!0,Q&&X()),g},get from(){return N},get gen(){return O},signal:Ae.signal,snapshot(o){typeof o=="function"&&(ke=o)},ready(o){typeof o!="function"||B!==null||(B=o,_(),X(),W&&H({__frame_hot_ready:!0,gen:O},V),He())},accept(o){typeof o=="function"&&(Re=o,X())},restart(o){const u={note:o?.note,required:o?.required};if(Q){ct(u);return}const f=F;F={note:Be(f?.note)??u.note,required:f?.required==="hard-reload"||u.required==="hard-reload"?"hard-reload":void 0}}});let qe=null,Jt=()=>{};const Cn=new Promise(o=>{Jt=o});let Nn=null;const Zt=()=>Nn??=r.dcl.then(()=>{let o=!1;try{o=qe!==null&&qe.expect()}catch{}if(!o)return;const u=qe.maxMs;return new Promise(f=>{Cn.then(f),a(f,u)})}),Qt=()=>{if(!ce||Fe||P===null)return;Fe=!0;const o=P;Zt().then(()=>{try{i||o.afterStart(jt(t),!1)}catch{}})},er=o=>{t!==null&&D&&(b=!0),g={},N=null,O=0;try{m?.removeItem(_e(n?.k))}catch{}t!==null&&!o&&K(r.dcl.then(()=>B!==null?p:void 0))},xn=()=>{ce=!0,K(Zt().then(()=>B!==null?p:void 0)),Qt()};try{addEventListener("error",()=>{x||B!==null||(x=!0,X())})}catch{}const tr=()=>{a(()=>{!ne&&he()&&de&&X()},0)};try{re=document.readyState==="complete",re||addEventListener("load",()=>{re=!0,tr()},{once:!0})}catch{re=!0}he(),p.then(()=>{Oe=!0,tr()});let ue=-1,ut,ft,Ce=!0,dt=!1,ht,Ue=null;const pt=o=>{const u=Ue===null;Ue=Ce&&o[0]!=="withheld"?o:["withheld",o[1],Ne];let f=o[0];if(Ce&&f!=="withheld"){const j={ver:A,handoff:f};ut!==void 0&&(j.seq=ut),ft!==void 0&&(j.note=ft);try{if(m===null)throw new Error("no storage");m.setItem(Ve(L),'{"kv":1,"gen":'+ue+',"from":'+JSON.stringify(j)+(ht!==void 0?',"k":'+JSON.stringify(ht):"")+',"data":'+(f==="ok"?o[2]:Ne)+"}")}catch{f="unavailable"}}else{f="withheld",oe(L);try{P?.release?.()}catch{}}const E={__frame_hot_snapshotted:!0,gen:ue,handoff:f,bytes:o[1]};o[3]!==void 0&&(E.errName=o[3]),H(E,V),u&&(f==="snapshot_error"||f==="unclonable"||f==="oversize")&&v("claude.hot: snapshot",f,o[3])},pe=o=>{try{return Tr(o?.name)}catch{return"other"}},me=(o,u,f=0)=>pt(u===void 0?[o,f,Ne]:[o,f,Ne,pe(u)]),jn=o=>{if(o.gen<=ue)return;const u=ue>=0;if(ue=o.gen,ut=o.seq,ft=Be(o.note),typeof o.key=="string"&&Et.test(o.key)&&o.key!==L&&(oe(L),L=o.key),Ce&&=o.handoff!==!1,u){Ue!==null?pt(Ue):dt&&H({__frame_hot_held:!0,gen:ue},V);return}Ae.abort();const f=Object.freeze({handoff:Ce,timeoutMs:o.timeoutMs,deadline:o.deadline??Or}),E=ke,j=()=>{if(Ce)try{ht=P?.capture()}catch{}if(E===null){me("empty");return}let k=!1;const z=a(()=>{k||(k=!0,me("snapshot_timeout"))},Math.max(0,f.timeoutMs));Promise.resolve().then(()=>E(f)).then(ve=>{if(k)return;k=!0,s(z);let ee;try{ee=JSON.stringify(ve)}catch(mt){me("unclonable",mt);return}if(typeof ee!="string"){me("unclonable");return}let te=ee.length;try{te=R.encode(ee).length}catch{}if(te>262144){me("oversize",void 0,te);return}pt(["ok",te,ee])},ve=>{k||(k=!0,s(z),me("snapshot_error",ve))})};let U=null;try{U=P?.holdForIme()??null}catch{}if(U===null)j();else{dt=!0,H({__frame_hot_held:!0,gen:ue},V);const k=()=>{dt=!1,j()};U.then(k,k)}},In=o=>{if(!W||I||B===null||o.gen!==O)return;let u=null;try{u=Mt(m,n&&{k:n.k,g:o.gen})}catch{}if(u!==null&&u.gen!==o.gen){u=null;try{m?.removeItem(_e(n?.k))}catch{}}g=u?.data??{},N=xt(ge(u?.from??o.from),ge(o.from)),u!==null&&(O=u.gen),I=!0,W=!1;const f=jt(u);p.then(E=>{try{E&&P?.afterStart(f,!0)}catch{}}),He(!0)};let ze=0;const Dn=o=>{const u=Re;if(u===null||o.id<=ze)return;ze=o.id;const f=P?.assess;if(o.preflight===void 0||f===void 0){rr(o,u);return}let E=!1;const j=z=>{E||(E=!0,s(k),o.id===ze&&rr(o,u,z))},U=()=>j(f.timeout(o)),k=a(U,Fr+100);f.run(o,window).then(j,U)},rr=(o,u,f)=>{let E,j=!1,U=!1,k,z,ve=null;const ee=S=>{if(U)return!1;if(k!==void 0&&k!==S)return v(`claude.hot: u.${S}() ignored - u.${k}() was called first`),!1;const Z=k===void 0;return k=S,Z},te=S=>{k="restart",v(`claude.hot: ${S} - restarting`)},mt=()=>{if(!ee("adopt")||o.id!==ze)return;const S=o.to.ver;if(Ge.required!=="none"){te(`u.adopt() needs required 'none', it is '${Ge.required}'`);return}if(!Ct(S)){te("u.adopt() cannot address this version");return}if(!A||S===A)return;const Z=A,J=h.entry;let Ke="",yt,ye=null,$e;try{Ke=location.href,yt=y.state,ye=Nt(Ke,Z,S),ye!==null&&(T(yt,"",ye),location.pathname.startsWith("/_f/"+S+"/")?ye=location.href:$e="navigate event canceled")}catch(gt){$e=pe(gt)}if($e!==void 0){z="adopt_failed",te(`adopt_failed ${$e}; URL not changed`);return}ye===null?(z="adopt_skipped",v(`claude.hot: adopt_skipped - page already left /_f/${Z}/; URL not changed, update still applied`)):z="adopted",A=h.ver=S;try{h.entry=Nt(J,Z,S)??J}catch{}const _t=ye;ve=()=>{if(A===S){if(_t!==null)try{if(location.href!==_t)v("claude.hot: adopt_revert_skipped - update not applied; URL left where the page navigated");else{if(T(yt,"",Ke),location.href!==Ke){v("claude.hot: adopt_revert_failed navigate event canceled - URL still at the new version");return}z="adopt_reverted",v("claude.hot: adopt_reverted - adopt() was called but the handler threw; URL restored")}}catch(gt){v(`claude.hot: adopt_revert_failed ${pe(gt)} - URL still at the new version`);return}A=h.ver=Z,h.entry=J,_t===null&&(z=void 0)}}},Ge=Object.freeze({from:{ver:o.from.ver,seq:o.from.seq},to:{ver:o.to.ver,seq:o.to.seq},changed:Xr(o.changed),required:o.required,deadline:o.deadline,adopt:mt,defer(){return ee("defer")&&Ge.deadline.now&&te("u.defer() past the deadline"),Lt},restart(S){return ee("restart"),k==="restart"&&!U&&(E??=Be(S?.note),j||=S?.required==="hard-reload"),Lt},...f?.update}),Fn=(S,Z)=>{U=!0,S==="threw"?(ve?.(),E??=pe(Z).toLowerCase()):k===void 0&&v(S==="timeout"?"claude.hot: accept handler did not answer in time - restarting":"claude.hot: accept handler settled without defer/restart/adopt - restarting");const J={__frame_hot_verdict:!0,id:o.id};J.verdict=S==="threw"||k===void 0||k==="restart"?"restart":k==="adopt"?"applied":"deferred",J.verdict==="restart"&&(j&&(J.required="hard-reload"),E!==void 0&&(J.note=E)),z!==void 0&&(J.verdict==="applied"||z!=="adopted")&&(J.adopt=z),H(Object.assign(J,f?.verdict),V)};let nr=!1;const vt=(S,Z)=>nr?!1:(nr=!0,s(Hn),Fn(S,Z),!0),Hn=a(()=>vt("timeout"),o.verdictTimeoutMs);Promise.resolve().then(()=>u(Ge)).then(()=>vt("settled"),S=>{!vt("threw",S)&&k==="adopt"&&ct({note:pe(S).toLowerCase()}),v("claude.hot: accept",pe(S))})};try{e.hot===void 0&&Object.defineProperty(e,"hot",{value:Yt,writable:!1,configurable:!1,enumerable:!1})}catch{}return{hot:Yt,boot:h,afterConnect(){Se=!0,(t!==null||B!==null)&&_()},onInit(o,u){V=u,Q=!0;const f=qr(o)?o:null;f?.phase==="final"&&t!==null&&t.gen===f.gen?(I=!0,N=xt(N,ge(f.from)),xn()):(W=f?.phase==="pending",er(W),I=!W,O=f?.gen??0,N=ge(f?.from)),X(),de&&a(()=>{ne||(ne=!0,X())},jr),W&&B!==null&&H({__frame_hot_ready:!0,gen:O},u),F!==void 0&&(ct(F),F=void 0),He()},onNoInit(){Q=!0,er(!1),I=!0,He()},onShell(o){return o?.__frame_revealed===!0?(Pe(),!1):zr(o)?(jn(o),!0):Gr(o)?(In(o),!0):Yr(o)?(Dn(o),!0):!1},attachExtras(o){P=o,Qt(),o.assess&&X()},inSlot:()=>_e(L),hydration(o,u){qe??={expect:o,maxMs:u}},hydrated(){Jt()},carried(){return I?g:{}},presented:()=>i}}var zn="frame_ldx_runtime",en="frame_ldx_build",Gn="script#an-form",tn=256;function It(e,t,r){for(const n of e)r(n)&&e.delete(n);e.size>=tn&&!e.has(t)&&e.delete(e.values().next().value),e.add(t)}function Ye(e,t,r){try{const n=e[t];if(typeof n!="function")return;e[t]=function(...a){const s=n.apply(this,a);try{r(this)}catch{}return s}}catch{}}var Je;function rn(){if(Je)return Je;const e={media:new Set,contexts:new Set,onStart:null,onPause:null};Je=e;const t=window.HTMLMediaElement?.prototype;t&&(Ye(t,"play",a=>{It(e.media,a,s=>s.paused),e.onStart?.(a)}),Ye(t,"pause",a=>e.onPause?.(a)));const r=window.AudioContext,n=window.AudioNode?.prototype;return r&&n&&Ye(n,"connect",a=>{const s=a.context;s instanceof r&&(It(e.contexts,s,c=>c.state==="closed"),e.onStart?.(s))}),e}function nn(e){let t=window;for(let r=0;t.parent&&t.parent!==t&&r<8;r++)if(t=t.parent,e(t))return!0;return!1}function on(){let e=null;const t=()=>e??parent,r=n=>e?n===e:nn(a=>a===n);return{post(n,a){if(e){t().postMessage(n,a);return}let s=parent;for(let c=0;c<8&&(s.postMessage(n,a),!(!s.parent||s.parent===s));c++)s=s.parent},on(n){const a=s=>{const c=s.source;r(c)&&n(s.data,s.origin,s.isTrusted,()=>{e??=c})};return addEventListener("message",a),()=>removeEventListener("message",a)},port:n=>({post(a,s){if(s?.activation){t().postMessage(a,{targetOrigin:n,includeUserActivation:!0});return}if(s?.transfer){t().postMessage(a,n,s.transfer);return}t().postMessage(a,n)},on(a,s){const c=d=>{r(d.source)&&d.origin===n&&a(d.data,d)};return addEventListener("message",c,s),()=>removeEventListener("message",c,s)}})}}function an(){const e={post:()=>{},on:()=>()=>{}};return{...e,port:()=>e}}function sn(e){return String.fromCharCode(e)}var ln="This browser isn"+sn(8217)+"t supported",cn="Update it to open this artifact.",Kn=500,un=2e4,fn="data-token-reads",Dt=':host{all:initial}.layer{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 24px 12vh;background:#fff;background:Canvas;color:#1f1e1d;color:CanvasText;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}.tile{width:60px;height:60px;margin-bottom:20px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.14);background:color-mix(in srgb,CanvasText 7%,Canvas)}svg{width:22px;height:22px;opacity:.72}h1{margin:0 0 8px;max-width:16em;font:400 28px/1.2 ui-serif,Georgia,serif}p{margin:0;max-width:24em;color:#6b6a68;color:color-mix(in srgb,CanvasText 65%,Canvas)}@media (min-width:640px){h1{font-size:34px}}',Ft="http://www.w3.org/2000/svg";function dn(){const e=document.createElementNS(Ft,"svg");e.setAttribute("viewBox","0 0 24 24"),e.setAttribute("fill","none"),e.setAttribute("stroke","currentColor"),e.setAttribute("stroke-width","1.5"),e.setAttribute("stroke-linecap","round"),e.setAttribute("stroke-linejoin","round"),e.setAttribute("aria-hidden","true");const t=document.createElementNS(Ft,"path");return t.setAttribute("d","M10.3 4.2a2 2 0 0 1 3.4 0l7.5 12.8a2 2 0 0 1-1.7 3H4.5a2 2 0 0 1-1.7-3zM12 9.5v4m0 3h.01"),e.append(t),e}var hn=/(?:^|\s)stylesheet(?:\s|$)/i;function pn(e,t){let r="";if(e instanceof HTMLScriptElement?r=e.src:e instanceof HTMLLinkElement&&hn.test(e.rel)&&(r=e.href),!r)return null;try{const n=new URL(r);return n.origin===location.origin&&n.pathname.startsWith(t)?n.origin+n.pathname:null}catch{return null}}function mn(e){try{if("adoptedStyleSheets"in e&&typeof CSSStyleSheet=="function"){const r=new CSSStyleSheet;r.replaceSync(Dt),e.adoptedStyleSheets=[r];return}}catch{}const t=document.createElement("style");t.textContent=Dt,e.append(t)}function vn(){const e=document.documentElement;if(navigator.onLine===!1)return;const t=document.createElement("div");t.setAttribute("data-frame-runtime-notice","");const r=t.attachShadow({mode:"closed"});mn(r);const n=document.createElement("div");n.className="layer",n.style.colorScheme=e.style.colorScheme||"light dark",n.setAttribute("role","alert");const a=document.createElement("div");a.className="tile",a.append(dn());const s=document.createElement("h1");s.textContent=ln;const c=document.createElement("p");c.textContent=cn,n.append(a,s,c),r.append(n),e.append(t);let d=!1;try{d=getComputedStyle(n).position==="fixed"}catch{}d||t.remove()}function yn(e,t){if(!e||t!=="query")return;const r="/_f/"+e+"/",n=location.href,a=fetch,s=setTimeout,c={method:"HEAD",cache:"no-store",credentials:"same-origin"},d=A=>A.ok||A.status===304;let R=!1,y=!1;const T=()=>removeEventListener("error",v,!0),v=A=>{if(y||R)return;if(document.documentElement.hasAttribute(fn)){y=!0,T();return}const m=pn(A.target,r);m&&(R=!0,s(()=>{a(m,c).then(h=>{if(d(h))y=!0;else if(h.status===403)return a(n,c).then(L=>{d(L)?(y=!0,vn()):L.status>=400&&L.status<500&&(y=!0)})}).catch(()=>{}).finally(()=>{R=!1,y&&T()})},500))};addEventListener("error",v,!0),addEventListener("load",T,{once:!0}),s(T,un)}var Ze="__frame_scroll",_n=150,gn=310,bn=160,wn=3e4;function En(){let e=0,t=!1,r=!1,n=!1,a=0,s=null;const c=g=>{try{sessionStorage.setItem(Ze,JSON.stringify({y:g}))}catch{}},d=()=>{if(clearTimeout(e),s===null)return;const g=s;s=null,c(g)},R=()=>{if(t){t=!1;return}r=!0,s=scrollY,clearTimeout(e),e=setTimeout(d,_n)};try{addEventListener("scroll",R,{passive:!0}),addEventListener("pagehide",d)}catch{}const y=()=>{let g;try{g=sessionStorage.getItem(Ze)}catch{return null}if(g===null)return null;let N;try{N=JSON.parse(g)}catch{N=null}const O=N?.y;if(!(typeof O=="number"&&Number.isFinite(O)&&O>=0)){try{sessionStorage.removeItem(Ze)}catch{}return null}return O};let T=!1;const v=g=>{try{const N=scrollY;scrollTo({top:g,left:0,behavior:"instant"}),a=g,n=!0,clearTimeout(e),s=null,c(g);const O=scrollY;O!==N&&(t=!0),O!==g&&!T&&(T=!0,addEventListener("load",()=>{try{if(scrollY===O){const I=y();v(I!==null?I:a)}}catch{}},{once:!0}))}catch{}},A=()=>{try{return!!location.hash}catch{return!0}};let m=!1;const h=()=>{try{if(m||innerWidth>gn||innerHeight>bn)return;m=!0;const g=Date.now(),N=()=>{try{removeEventListener("resize",N)}catch{}if(Date.now()-g>wn||r||A())return;const O=y();v(O!==null?O:a)};addEventListener("resize",N)}catch{}};let L=!1,$=!1;return{restore(){if(L||(L=!0,A()))return;const g=y();g!==null&&(v(g),h())},promoted(){if($||($=!0,A()))return;const g=y();g!==null?(v(g),h()):n&&v(a)}}}function Sn(e,t,r,n){let a=null;try{a=window.trustedTypes?.createPolicy("frame-runtime",{createScriptURL:R=>R})??null}catch{}const s=window.Worker,c=s?.prototype,d=Object.freeze({Worker:s,workerOn:c?.addEventListener,workerPost:c?.postMessage,workerTerminate:c?.terminate,fetch:window.fetch.bind(window),preventDefault:Event.prototype.preventDefault,now:Date.now,policy:a,origins:t});r(e).then(R=>R?.bootTopLevel?R.bootTopLevel(d,n):n.settle()).catch(()=>n.settle())}var $n="modulepreload",Wn=function(e){return"/"+e},Vn={},An=function(t,r,n){let a=Promise.resolve();function s(c){const d=new Event("vite:preloadError",{cancelable:!0});if(d.payload=c,window.dispatchEvent(d),!d.defaultPrevented)throw c}return a.then(c=>{for(const d of c||[])d.status==="rejected"&&s(d.reason);return t().catch(s)})},kn=window===top,Ht=Object.getOwnPropertyDescriptor(window,"claude"),xe=Jr(kn,window.__FRAME_PREAMBLE?.topLevel,Ht?.writable===!1),Qe=typeof xe=="object"&&xe[0],M=Qe?an():on();(function(){const e=Object.defineProperty,t=globalThis,r=["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel","RTCIceCandidate","RTCSessionDescription","RTCRtpSender","RTCRtpReceiver"];let n=0;for(let a=0;a<r.length;a++){const s=r[a];try{e(t,s,{value:void 0,writable:!1,configurable:!1})}catch{try{delete t[s]}catch{}try{e(t,s,{value:void 0,writable:!1,configurable:!0})}catch{}}typeof t[s]=="function"&&n++}if(n&&xe==="framed")try{M.post({__frame_rtc_lockdown_failed:n},"*")}catch{}})();var Bt=1e4,Rn=2e3,et=2e3,qt=Object.freeze([...window.__FRAME_PREAMBLE?.origins??["https://claude.ai","https://preview.claude.ai"]]);function Ut(e){for(const t of qt)if(t.endsWith(":*"))try{const r=new URL(e);if(`${r.protocol}//${r.hostname}:*`===t)return!0}catch{}else if(e===t)return!0;return!1}var be=Object.freeze({...window.__FRAME_PREAMBLE?.capabilities}),je=window.__FRAME_PREAMBLE?.transforms,tt=window.__FRAME_PREAMBLE?.comments,rt=window.__FRAME_PREAMBLE?.translate,we=window.__FRAME_PREAMBLE?.ldx,Tn=window.__FRAME_PREAMBLE?.cred;function zt(e){return An(()=>import("/_runtime/"+e),void 0)}var Ee=new Set,On=setTimeout,Ln=800+800*Math.random();function ie(e){return zt(e).catch(()=>new Promise(t=>On(t,Ln)).then(()=>zt(e+"?r=1")).then(t=>(t!==void 0&&Ee.add(e),t)))}function Gt(e,t,r){return{contract:e.contract,changes:new Set(e.changes??[]),flags:new Set(e.flags??[]),capabilities:e.capabilities??{},capBudgets:e.capBudgets??{},brokerGen:e.brokerGen,transforms:new Map,shellOrigin:t,shell:r,mount:lt,hooks:Ie,pipe:()=>({wrap:(n,a)=>(...s)=>{try{return a(...s)}catch(c){return Promise.reject(c)}}})}}var fe=null,G=null;function Kt(e,t,r){try{Object.defineProperty(e,t,{value:r,writable:!1,configurable:!1,enumerable:!0})}catch{try{Object.defineProperty(e,t,{value:r,writable:!1,configurable:!0,enumerable:!0})}catch{}}}var nt=!1,Ie={editBefore:null,edit:null};function Mn(e,t,r=!1){const n=[];let a;if(r)try{Ie.editBefore?.(e)}catch{}for(const s of e.elements){const c=document.querySelector(`[data-id="${s.target}"]`);if(!c){a=s.target;break}if([...Object.keys(s.attrsSet??{}),...s.attrsRemoved??[]].some(d=>!lr(d)||cr(c,d))){a=s.target;break}if(s.text!==void 0&&(!hr(c)||yr(c))){a=s.target;break}for(const[d,R]of Object.entries(s.attrsSet??{}))if(!Wt(c,d)){try{c.setAttribute(d,R)}catch{}$t(c,d,R)}for(const d of s.attrsRemoved??[])Wt(c,d)||(c.removeAttribute(d),$t(c,d,null));typeof s.text=="string"&&mr(c,s.text),n.push(s.target)}if(r)try{Ie.edit?.(e.seq,n,a)}catch{}if(a!==void 0){M.post({__frame_patch_miss:{seq:e.seq}},t);return}try{document.dispatchEvent(new CustomEvent("claude:edit",{detail:{seq:e.seq,targets:n}}))}catch{}}function $t(e,t,r){if(!(e instanceof HTMLInputElement))return;const n=t.toLowerCase();n==="checked"?e.checked=r!==null:n==="value"&&e.type!=="file"&&(e.value=r??"")}function Wt(e,t){const r=t.toLowerCase(),n=e;return r==="data-id"||(r==="value"||r==="checked")&&(n.__artifactSecret===!0||/^(password|hidden|file)$/.test(n.type??"")||/(^|\s)(cc-|one-time-code|current-password|new-password)/i.test(`${e.getAttribute("autocomplete")??""} ${n.autocomplete??""}`))}function Vt(e){const t=document.documentElement;e==="light"||e==="dark"?(t.dataset.theme=e,t.style.colorScheme=e,nt=!0):nt&&(delete t.dataset.theme,t.style.colorScheme="",nt=!1)}var le=new Map,ot=null;function at(){let e;const t={u:new Promise(r=>{e=r}),r:r=>{t.done=!0,e(r)},done:!1,nulled:!1};return t}function De(e,t){e.nulled=!0,e.ver=t,e.r(null)}function st(e,t){for(const[r,n]of le)n.done||(t&&n.asked?t(r,n):De(n,e))}var Pn=Object.freeze(Object.assign(Object.create(null),{call:Function.prototype.call,apply:Function.prototype.apply,bind:Function.prototype.bind})),it=!1,lt=(e,t)=>{let r=le.get(e);if(r?.nulled&&it)r=at(),le.set(e,r);else if(!r||r.done){r?.nulled&&G&&M.post({__frame_cap_telemetry:{kind:"cap-load-error",cap:e,phase:"install"}},G);return}const n=typeof t=="function"?Object.setPrototypeOf(t,Pn):Object.assign(Object.create(null),t);typeof n.then=="function"&&delete n.then,r.want=void 0,r.r(Object.freeze(n))};function Xt(){const e=Ht?.value??{};Kt(window,"claude",e);for(const t of Object.keys(be)){if(e[t]!==void 0){Kt(e,t,e[t]);continue}le.set(t,at())}if(e.use===void 0){const t=r=>{if(typeof r!="string"||!Object.hasOwn(be,r))return Promise.resolve(null);let n=le.get(r);return n?(ot&&(n.nulled||n.want!==void 0)&&(n=ot(r,n)),n.asked=!0,n.u):Promise.resolve(e[r]??null)};try{Object.defineProperty(e,"use",{value:t,writable:!0,configurable:!0,enumerable:!1})}catch{}}return e}if(xe==="framed"){const e=je&&se.test(je)?ie(je).catch(()=>{}):Promise.resolve(void 0),t=l=>{if(l.type==="auxclick"&&l.button!==1)return;const p=l.target,b=p&&p.closest?p.closest("a[href],area[href]"):null;if(!b)return;const D=b.getAttribute("href");if(!D)return;let x;try{x=new URL(D,document.baseURI)}catch{return}if((x.protocol==="http:"||x.protocol==="https:")&&x.origin!==location.origin){l.preventDefault();const F=(b.getAttribute("target")??"").toLowerCase(),P=l.type==="auxclick"||l.metaKey||l.ctrlKey||l.shiftKey||l.altKey||!["","_self","_top","_parent"].includes(F);M.post({__frame_nav:!0,url:x.href,newTab:P},"*")}};addEventListener("click",t,!0),addEventListener("auxclick",t,!0);const r={},n=l=>{l.isTrusted&&(r.pointer=!0)},a=l=>{l.isTrusted&&(r.click=!0)};addEventListener("pointermove",n,{capture:!0,passive:!0}),addEventListener("click",a,{capture:!0,passive:!0});const s={cb:null};addEventListener("keydown",l=>s.cb?.(l),!0);const c={cb:null};addEventListener("keydown",l=>c.cb?.(l));const d=rn();e.then(l=>l?.installEscapeForward?.(s,p=>{G&&M.post(p,G)})),e.then(l=>{try{l?.installFocusKeep?.()}catch{}}),e.then(l=>{if(!l?.wireNav)return;const p=M.port("*");l.wireNav(p),removeEventListener("click",t,!0),removeEventListener("auxclick",t,!0),removeEventListener("pointermove",n,!0),removeEventListener("click",a,!0),l.wireEngagement?.(r,p,d)});let R=null;try{R=En()}catch{}const y=document.readyState==="loading"?new Promise(l=>document.addEventListener("DOMContentLoaded",()=>l(),{once:!0})):Promise.resolve();let T=null,v=null;try{v=Nr(window.name),T=Mt(null,v)}catch{}const A=Xt();let m=null;try{m=Qr(A,T,{post:(l,p)=>M.post(l,p),dcl:y},v)}catch{}e.then(l=>{try{m&&l?.installHotExtras?.(m)}catch{}});let h=null;const L=()=>Array.isArray(h?.flags)&&h.flags.includes("frame_ldx_runtime")&&!!we&&se.test(we)&&document.querySelector("script#an-form")!==null;try{m?.hydration(L,xr)}catch{}let $=null,g=0;const N=M.on((l,p,b,D)=>{Ut(p)&&wr(l)&&(D(),h=l.__frame_init,G=p,N(),clearTimeout(g),$?.())});M.post({__frame_connect:!0},"*");try{m?.afterConnect()}catch{}const O=setTimeout,I=clearTimeout;let W=()=>NaN,Q=()=>[];try{W=performance.now.bind(performance),Q=performance.getEntriesByType.bind(performance)}catch{}let V=0;const Se=()=>{try{M.post({__frame_alive:!0},"*")}catch{}V=O(Se,Rn)},Ae=()=>I(V);Se(),addEventListener("load",Ae,{once:!0});const ke=new Promise(l=>{$=l,g=setTimeout(()=>{N(),l()},Bt)}),B=new WeakSet;addEventListener("error",l=>{l.target&&B.add(l.target)},!0);try{yn(Pt(),Tn)}catch{}const Re=()=>{let l=[];try{l=[...document.querySelectorAll("link[rel~=stylesheet]:not([rel~=alternate])")].filter(b=>!b.sheet&&!b.disabled&&!B.has(b)&&b.getAttribute("href")&&URL.canParse(b.href)&&(!b.media||matchMedia(b.media).matches))}catch{}let p=l.length;return p===0?Promise.resolve():new Promise(b=>{try{const D=et-W(),x=O(b,D>0?D<et?D:et:0),F=()=>{--p===0&&(I(x),b())};for(const P of l)P.addEventListener("load",F,{once:!0}),P.addEventListener("error",F,{once:!0})}catch{b()}})};y.then(()=>{try{R?.restore()}catch{}}),Promise.all([ke,y,e]).then(([,,l])=>{if(h?.hostOverlays!==!0||!G)return;let p=!1;try{p=l?.declaresCover?.()===!0}catch{}M.post({__frame_layout:{cover:p}},G)});const Te={cb:null};M.on((l,p)=>{if(Ut(p)&&Er(l)){try{R?.promoted()}catch{}Te.cb?.()}}),ke.then(async()=>{if(!h||!G){st();try{m?.onNoInit()}catch{}return}if(Vt(h.theme),h.hostVisible===!1&&e.then(i=>i?.applyHostVisible?.(!1,d)),h.hostKeys!==void 0){const i=G,w=h.hostKeys;e.then(_=>_?.installHostKeyForward?.(c,w,C=>M.post(C,i)))}try{m?.onInit(h.hot,G)}catch{}const l=G,p=M.port(l),b=(i,w)=>M.post({__frame_cap_telemetry:{kind:"cap-load-error",cap:i,phase:w}},l),D=i=>M.post({__frame_cap_recovered:{cap:i}},l);let x=h.brokerGen;const F=()=>m?.boot.ver??"",P=F(),ce=(i,w)=>{const _=F();I(w.t),w.want=_,w.t=O(()=>{w.done||De(w,_)},Bt),M.post({__frame_cap_want:!0,cap:i,ver:_},l)},Fe=(i,w)=>{const _=le.get(i.cap),C=be[i.cap];if(!w||!_||_.done||_.want!==i.ver||!se.test(C))return;if(I(_.t),_.want=void 0,x=i.brokerGen??x,i.ver!==F()){ce(i.cap,_);return}if(!i.grant||i.cap==="network"){De(_,i.ver);return}const Y=fe,K=fe={...Y,capabilities:{...Y.capabilities,[i.cap]:i.grant},capBudgets:{...Y.capBudgets,[i.cap]:{...Y.capBudgets[i.cap],...i.budgets}}};ie(C).then(Pe=>{Ee.has(C)&&D(i.cap),K.brokerGen=x,it=!0;try{Pe?.install?.(K)}catch{b(i.cap,"install")}finally{it=!1}},()=>b(i.cap)).then(()=>{_.done||De(_,i.ver)})};let re=!1,Oe=!1;M.on((i,w,_)=>{if(w!==l)return;try{if(m?.onShell(i))return}catch{}if(Ar(i)&&Vt(i.__frame_theme.theme),$r(i)&&Fe(i,_),_&&Wr(i)&&(x=i.brokerGen??x),Sr(i)){const K=i.__frame_host_visible.visible;e.then(Pe=>Pe?.applyHostVisible?.(K,d))}br(i)&&Mn(i.__frame_patch,l,_);const C=i?.__fc_mode;C&&typeof C=="object"&&!re&&tt&&se.test(tt)&&(re=!0,ie(tt).then(K=>K.install?.(l,C.on===!0,p)).catch(()=>{}));const Y=i?.__ft_cmd;Y&&typeof Y=="object"&&!Oe&&rt&&se.test(rt)&&(Oe=!0,ie(rt).then(K=>K.install?.(l,Y,p)).catch(()=>{}))});const ne=Object.keys(h.capabilities??{}).filter(i=>Object.hasOwn(be,i)).map(i=>[i,be[i]]).filter(i=>typeof i[1]=="string"&&se.test(i[1])),de=await Promise.allSettled(ne.map(([,i])=>ie(i))),oe=await e,H=l;if(oe?.buildBoot||b("_transforms"),oe?.buildBoot)try{fe=oe.buildBoot(h,oe.TRANSFORMS??{},{shellOrigin:H,mount:lt,hooks:Ie,shell:p},i=>M.post({__frame_cap_telemetry:i},H))}catch{b("_transforms","install"),fe=Gt(h,H,p)}else fe=Gt(h,H,p);oe?.buildBoot&&Ee.has(je??"")&&D("_transforms");const he=fe;he.brokerGen=x,de.forEach((i,w)=>{const[_,C]=ne[w];if(i.status!=="fulfilled"){b(_);return}Ee.has(C)&&D(_);try{i.value?.install?.(he)}catch{b(_,"install")}});const X=h.capWants===!0;X&&(ot=(i,w)=>{const _=F();if(!_)return w;if(!w.nulled)return w.want!==_&&ce(i,w),w;if(_===w.ver)return w;const C=at();return le.set(i,C),ce(i,C),C}),st(P,X&&F()!==P?ce:void 0),await y,await Re(),Ae();const Le=or(Q,W);M.post(Le?{__frame_ready:!0,nav:Le}:{__frame_ready:!0},G),e.then(i=>{i?.installSizeReporter?.(H,Te,p),i?.installPaintReporter?.(p)});let Me=!1;try{Me=L()}catch{}we&&Me?ie(we).then(i=>i?.boot?.({shellOrigin:l,build:he.flags.has(en),hot:m?.hot??null,carried:m?.carried(),presented:()=>m?.presented()??!0})).catch(()=>!1).then(i=>{m?.hydrated(),i!==!0?b("_ldx"):Ee.has(we)&&D("_ldx")}):m?.hydrated()})}else Qe&&(Xt(),Sn(Qe,qt,ie,{settle:st,mount:lt}))})();</script><!-- /frame-runtime --><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}</style></head><body>
<title>Mudavym Build Board</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap">

<style>
  :root{
    --seal:#1A5E6B; --seal-deep:#14515C; --seal-tint:rgba(26,94,107,.10); --seal-ring:rgba(26,94,107,.32);
    --paper-0:#FAF7F1; --paper-1:#F3EFE6; --paper-2:#EAE4D8;
    --ink-1:#211C16; --ink-2:#4F473C; --ink-3:#7C7365; --ink-4:#665D50;
    --good:#2F6B4F; --warn:#8A6A1F; --stop:#8C3A3A;
    --serif:"Fraunces",Georgia,"Times New Roman",serif;
    --sans:"DM Sans","Plus Jakarta Sans",system-ui,sans-serif;
    --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --seal:#5FB0BC; --seal-deep:#7DC3CD; --seal-tint:rgba(95,176,188,.12); --seal-ring:rgba(95,176,188,.34);
      --paper-0:#15130F; --paper-1:#1D1813; --paper-2:#2A241C;
      --ink-1:#F2EDE4; --ink-2:#C9C0B2; --ink-3:#8E8576; --ink-4:#A79C8B;
      --good:#6FBF95; --warn:#D9B45F; --stop:#D98A8A;
    }
  }
  :root[data-theme="dark"]{
    --seal:#5FB0BC; --seal-deep:#7DC3CD; --seal-tint:rgba(95,176,188,.12); --seal-ring:rgba(95,176,188,.34);
    --paper-0:#15130F; --paper-1:#1D1813; --paper-2:#2A241C;
    --ink-1:#F2EDE4; --ink-2:#C9C0B2; --ink-3:#8E8576; --ink-4:#A79C8B;
    --good:#6FBF95; --warn:#D9B45F; --stop:#D98A8A;
  }

  *{box-sizing:border-box}
  body{
    margin:0; background:var(--paper-0); color:var(--ink-1);
    font-family:var(--sans); font-size:15px; line-height:1.6;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:1120px; margin:0 auto; padding:44px 22px 72px}

  .label{
    font-family:var(--mono); font-size:9px; font-weight:600; letter-spacing:.14em;
    text-transform:uppercase; color:var(--ink-4);
  }
  h1{
    font-family:var(--serif); font-size:clamp(30px,5vw,44px); font-weight:600;
    letter-spacing:-.02em; line-height:1.08; margin:6px 0 0; text-wrap:balance;
  }
  .sub{color:var(--ink-2); max-width:62ch; margin:12px 0 0; font-size:15.5px}
  .rule{height:1px; background:var(--paper-2); margin:34px 0}

  .figs{display:flex; flex-wrap:wrap; gap:30px; margin-top:26px}
  .fig .n{
    font-family:var(--mono); font-size:26px; font-weight:600; letter-spacing:-.02em;
    font-variant-numeric:tabular-nums; color:var(--seal-deep); display:block;
  }
  .fig .c{font-size:12.5px; color:var(--ink-3)}

  h2{
    font-family:var(--serif); font-size:22px; font-weight:600; letter-spacing:-.01em;
    margin:0 0 4px;
  }
  .lede{color:var(--ink-2); font-size:14px; margin:0 0 20px; max-width:70ch}

  .grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:14px}
  .card{
    border:1px solid var(--paper-2); background:var(--paper-1);
    border-radius:12px; padding:15px 17px;
  }
  .card h3{
    font-family:var(--mono); font-size:12.5px; font-weight:600; margin:0;
    letter-spacing:.02em; color:var(--ink-1);
  }
  .card .verdict{
    font-family:var(--mono); font-size:9px; font-weight:600; letter-spacing:.1em;
    text-transform:uppercase; color:var(--seal-deep); border:1px solid var(--seal-ring);
    border-radius:5px; padding:2px 6px; white-space:nowrap;
  }
  .card .row{display:flex; align-items:center; justify-content:space-between; gap:10px}
  .card p{margin:9px 0 0; font-size:13px; color:var(--ink-2); line-height:1.55}
  .card .gap{
    margin:9px 0 0; font-size:12px; color:var(--ink-4);
    border-top:1px dashed var(--paper-2); padding-top:8px;
  }

  .state{
    display:inline-flex; align-items:center; gap:5px; font-family:var(--mono);
    font-size:10px; font-weight:600; letter-spacing:.04em; margin-top:10px;
  }
  .dot{width:7px; height:7px; border-radius:50%; display:inline-block}
  .built .dot{background:var(--good)} .built{color:var(--good)}
  .flagged .dot{background:var(--warn)} .flagged{color:var(--warn)}

  table{width:100%; border-collapse:collapse; font-size:13.5px}
  th{
    text-align:left; font-family:var(--mono); font-size:9px; font-weight:600;
    letter-spacing:.12em; text-transform:uppercase; color:var(--ink-4);
    padding:0 10px 8px 0; border-bottom:1px solid var(--paper-2);
  }
  td{padding:9px 10px 9px 0; border-bottom:1px solid var(--paper-2); color:var(--ink-2); vertical-align:top}
  td.k{color:var(--ink-1); font-weight:500; white-space:nowrap}
  td.n{font-family:var(--mono); font-variant-numeric:tabular-nums; color:var(--seal-deep); white-space:nowrap}
  .scroll{overflow-x:auto}

  .note{
    border-left:3px solid var(--seal); background:var(--seal-tint);
    border-radius:0 8px 8px 0; padding:13px 16px; margin:16px 0 0;
  }
  .note p{margin:0; font-size:13.5px; color:var(--ink-2)}
  .note strong{color:var(--ink-1)}

  .wait li{margin-bottom:9px; color:var(--ink-2); font-size:13.5px}
  .wait li strong{color:var(--ink-1); font-weight:500}

  footer{margin-top:44px; padding-top:18px; border-top:1px solid var(--paper-2); color:var(--ink-4); font-size:12px}
</style>

<div class="wrap">

  <div class="label">Build board · 1 September 2026</div>
  <h1>Ten pages, rebuilt behind flags</h1>
  <p class="sub">
    Every redesigned page is on <code style="font-family:var(--mono);font-size:13px">main</code> and renders
    nothing new until a flag is deliberately turned on. This board is what exists, what shipped today,
    and what is still yours to decide.
  </p>

  <div class="figs">
    <div class="fig"><span class="n">10</span><span class="c">pages rebuilt, all flags OFF</span></div>
    <div class="fig"><span class="n">13</span><span class="c">PRs merged &amp; verified live</span></div>
    <div class="fig"><span class="n">4,094</span><span class="c">wines in the catalogue</span></div>
    <div class="fig"><span class="n">2</span><span class="c">orders in production</span></div>
  </div>

  <div class="rule"></div>

  <h2>The ten pages</h2>
  <p class="lede">
    Each was reviewed against its recorded verdict, rebuilt on the shared Mudavym foundation,
    audited, and gated. The dashed line on each card is the honest gap — what is still missing or unproven.
  </p>

  <div class="grid">

    <div class="card">
      <div class="row"><h3>/ dashboard</h3><span class="verdict">Keep+ · rework blocks</span></div>
      <p>Spec approved after five-persona review. Calendar keeps its full month view but sits below a decisions band; each day cell gains an expected-vs-actual reference.</p>
      <p class="gap">Build in progress. Deep links fixed; drink-window, purchase-reason and count-freshness endpoints landed.</p>
      <div class="state flagged"><span class="dot"></span>SPEC APPROVED · BUILDING</div>
    </div>

    <div class="card">
      <div class="row"><h3>/orders</h3><span class="verdict">Gateway-first</span></div>
      <p>Reviewed as a pipeline, not a screen. Seven creation paths found; one worked. Line rows, unit arithmetic, provenance and price history all fixed at the source.</p>
      <p class="gap">Retroactive + recurring paths under repair now.</p>
      <div class="state built"><span class="dot"></span>PIPELINE FIXED · LIVE</div>
    </div>

    <div class="card">
      <div class="row"><h3>/receiving</h3><span class="verdict">ADR 0044 P2</span></div>
      <p>Rebuilt and flag-gated. The door now refuses an unreadable unit instead of guessing — the same fix that closed a 12× over-count.</p>
      <p class="gap">Not yet reviewed under the page-by-page process.</p>
      <div class="state built"><span class="dot"></span>BUILT · FLAG OFF</div>
    </div>

    <div class="card">
      <div class="row"><h3>receiving door</h3><span class="verdict">ADR 0044 P2</span></div>
      <p>Charcoal-ground surface for the loading dock. Counts stage through the receipt-event ledger rather than writing stock directly.</p>
      <p class="gap">Offline queue drops a bad-unit receipt on flush — recorded, not fixed.</p>
      <div class="state built"><span class="dot"></span>BUILT · FLAG OFF</div>
    </div>

    <div class="card">
      <div class="row"><h3>/receipts</h3><span class="verdict">Keep+</span></div>
      <p>Your four requirements plus the swipe-to-confirm ceremony. Audit caught a crash on a broken tie-out and a control that claimed success before the server answered.</p>
      <p class="gap">Three-way match runs, but no real invoice has ever entered the system.</p>
      <div class="state built"><span class="dot"></span>BUILT · AUDITED</div>
    </div>

    <div class="card">
      <div class="row"><h3>/inventory</h3><span class="verdict">Keep</span></div>
      <p>Not a page swap. The flag gates one named gap — the receipt-depth card inside the kept dropdown. The page renders identically with the flag off.</p>
      <p class="gap">Lot rollup still sums across bottle formats as if equal.</p>
      <div class="state built"><span class="dot"></span>BUILT · NARROW GATE</div>
    </div>

    <div class="card">
      <div class="row"><h3>/providers</h3><span class="verdict">Merge</span></div>
      <p>Small countable buckets with the twin sheet. Audit caught false-zero open counts — raw lowercase compared against SCREAMING_SNAKE statuses.</p>
      <p class="gap">One order read still lacks a restaurant filter; flagged, not fixed.</p>
      <div class="state built"><span class="dot"></span>BUILT · AUDITED</div>
    </div>

    <div class="card">
      <div class="row"><h3>/communications</h3><span class="verdict">Merge</span></div>
      <p>Glance strip, conversation ledger, template sheet that says what it is before it renders. An AI draft can never look sent.</p>
      <p class="gap">Duplicate thread list with documents-reports until the flag flips.</p>
      <div class="state built"><span class="dot"></span>BUILT · AUDITED</div>
    </div>

    <div class="card">
      <div class="row"><h3>/documents-reports</h3><span class="verdict">Rework</span></div>
      <p>The Sorting Office. Five sketch directions, you chose D. Countable drawers, oldest-debt-first queue, C's reading pane kept as the detail surface, plus File-to and Cross-filed.</p>
      <p class="gap">Most reviewed page: one Sonnet audit, two Opus reviews, 29 tests.</p>
      <div class="state built"><span class="dot"></span>BUILT · FULLY REVIEWED</div>
    </div>

    <div class="card">
      <div class="row"><h3>/team</h3><span class="verdict">Keep</span></div>
      <p>Gaps first, labour build-up, credential blockers — your three additions. Audit caught a timezone bug putting shifts on the wrong week.</p>
      <p class="gap">Not yet reviewed under the page-by-page process.</p>
      <div class="state built"><span class="dot"></span>BUILT · AUDITED</div>
    </div>

  </div>

  <div class="rule"></div>

  <h2>What went live today</h2>
  <p class="lede">Each verified on the wire by commit hash, not by a green board.</p>

  <div class="scroll">
    <table>
      <thead><tr><th>Change</th><th>Why it mattered</th><th>PR</th></tr></thead>
      <tbody>
        <tr><td class="k">mudavym.com live</td><td>Your production domain, TLS issued, www redirecting to apex, publicly reachable with the app's own login as the gate.</td><td class="n">—</td></tr>
        <tr><td class="k">OAuth hole closed</td><td>Any Google account could mint itself a <em>manager</em> of a real tenant. Verified live, then removed outright rather than re-gated on an env var.</td><td class="n">#179</td></tr>
        <tr><td class="k">Login fixed on the domain</td><td>Not a dead server — the gateway didn't allow the new origin, so the browser blocked every call. Domain now allow-listed in code.</td><td class="n">#180</td></tr>
        <tr><td class="k">Restaurant switching</td><td>Three real multi-restaurant users could not switch at all. The one route whose job is changing tenants was refused before it could be authorised.</td><td class="n">#202</td></tr>
        <tr><td class="k">Order capture</td><td>Orders now write a line row with wine identity, one function decides bottles at both ends, provenance separates AI from human, and price history records for the first time.</td><td class="n">#208</td></tr>
        <tr><td class="k">Cost honesty</td><td>~70 of 72 inventory rows had their cost invented as 60% of menu price — under a label claiming it was measured.</td><td class="n">#207</td></tr>
        <tr><td class="k">Ten-page wave</td><td>All ten redesigns merged behind flags defaulting to false.</td><td class="n">#185</td></tr>
      </tbody>
    </table>
  </div>

  <div class="note">
    <p><strong>The near-miss worth knowing.</strong> A migration that passed CI green would have broken
    every order creation — it pointed a foreign key at <code style="font-family:var(--mono)">auth.users</code>,
    which is disjoint from this app's <code style="font-family:var(--mono)">public.users</code> (5 rows vs 7, zero overlap).
    CI applies migrations to an empty database where no key can be violated, and the parity check compares
    columns but not constraint targets. Two green checks, neither able to see it. Caught by measuring
    production before applying.</p>
  </div>

  <div class="rule"></div>

  <h2>WineML — the honest state</h2>
  <p class="lede">Split cleanly in two, and only one half is actionable today.</p>

  <div class="scroll">
    <table>
      <thead><tr><th>Asset</th><th>State</th><th>Count</th></tr></thead>
      <tbody>
        <tr><td class="k">Wine catalogue</td><td>Real and ML-grade — 2,462 producers, 38 countries, producer and country on every row, region on 95%, vintage on 74%.</td><td class="n">4,094</td></tr>
        <tr><td class="k">Menu detection corpus</td><td>262 annotated pages, 11,496 boxes. Undocumented and not rebuildable from the repo — images are gitignored.</td><td class="n">11,496</td></tr>
        <tr><td class="k">Orders</td><td>No training data exists. Not a plumbing problem — the pipeline has never run at volume.</td><td class="n">2</td></tr>
        <tr><td class="k">Invoices</td><td>Every grader is wired and tested against an empty table.</td><td class="n">0</td></tr>
        <tr><td class="k">Price history</td><td>Perfect shape, zero writers — until today.</td><td class="n">0</td></tr>
        <tr><td class="k">Field review queue</td><td>Loop fully built; 198 rows queued, none ever reviewed, so nothing downstream calibrates.</td><td class="n">198</td></tr>
      </tbody>
    </table>
  </div>

  <div class="note">
    <p><strong>Why capture was the only thing worth doing.</strong> No model can train on two orders, and
    no engineering changes that. But every row WineML will ever learn from is written by the pipeline
    fixed today — and there is no legacy data to migrate and no bad rows to clean, which is a position
    you only get once.</p>
  </div>

  <div class="rule"></div>

  <h2>Waiting on you</h2>
  <ul class="wait">
    <li><strong>Two thresholds an agent chose, not decided</strong> — count staleness at 7 days, and the drink-window urgency tiers. Both are published in the API response so the page states the rule it uses.</li>
    <li><strong>ADRs 0053 and 0054</strong> — recorded as <em>proposed</em>. A decision here is locked by you, never by a session.</li>
    <li><strong>Repo setting:</strong> auto-merge is on, but branch auto-update is off — an armed PR can sit green and never land, which looks like success.</li>
    <li><strong>Vercel previews</strong> are rate-limited account-wide until roughly midday tomorrow, so anything user-visible merging today lands unviewed in a browser.</li>
    <li><strong>Flag flips</strong> — all ten pages are off. Turning one on is per-restaurant and deliberate.</li>
  </ul>

  <footer>
    Built from the repository and verified against production on 1 September 2026.
    Counts are point-in-time for this database, single tenant, mid-build.
  </footer>

</div>

</body></html>