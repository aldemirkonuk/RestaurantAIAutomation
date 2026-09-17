---
title: "Mudavym Go-Live Board"
source_url: https://claude.ai/artifact/5hZELUz2SuswDPGm3boWkD
internal_id: 260e2af7-8a3c-4bd0-8ff8-4fd1618007ee
pulled: 2026-09-16
live_version: 1789159369-1fa3
files: [index.html]
index_sha256: 5dd641c909e031b3043ec2c68e35d76fe01ab0b90f082e62216b0ca6dfb114cd
database: "verdicts, 0 documents"
description: "Go-live board for the dark launch, measured 2026-09-11: each stream landed, running, or waiting on the founder's word, with those verdicts saved to the artifact database."
note: "Snapshot read as the owner on 2026-09-16; the live page on claude.ai is interactive. The body is index.html as claude.ai serves it, with its frame-runtime block inserted: delete that block and the newline after this header to recover the published file. The artifact database follows as an artifact-db block: every document in collection verdicts, as the claude.ai page itself read them for the owner (collection listing complete, no further page), matching the document count claude.ai reports."
---

<!doctype html><html><head><!-- frame-runtime --><script>window.__FRAME_PREAMBLE={"v":1,"cred":"query","capabilities":{"artifact":"artifact.O-h4mzdy.js","assets":"assets.DhQw8DTi.js","comments":"comments.DrhK3r8W.js","db":"db.DV02l9iB.js","downloads":"downloads.axDW2QAi.js","embed":"embed.swQslL0W.js","endpoints":"endpoints.BPfoKaE1.js","mcp":"mcp.C8qKIFvQ.js","network":"network.B5UA9Su4.js","permissions":"permissions.DWFFeHI0.js","room":"room.BF1j0KPr.js","sample":"sample.C7KQQdQj.js","self":"artifact.O-h4mzdy.js","user":"user.CCh6oTS_.js"},"transforms":"_transforms.DOfCNjBN.js","comments":"_comments.D8Q8NfHc.js","translate":"_translate.DqxC5ek1.js","ldx":"_ldx.CqNtBrkk.js"}                                                    </script><script>(function(){"use strict";var Bn=3e5;function or(e,t){try{const r=e("navigation")[0],n=[r.responseStart,r.redirectEnd-r.redirectStart,r.domContentLoadedEventStart,t()];for(let a=0;a<n.length;a++){if(!(n[a]>=0&&n[a]<=3e5))return;n[a]=n[a]|0}return n}catch{return}}var ar=["light","dark","system"],sr=/^[A-Za-z0-9_-]{1,64}$/,bt=/^[a-zA-Z_:][a-zA-Z0-9_:.-]{0,127}$/,ir=new Set(["class","hidden","value","checked","style","title","alt","placeholder","lang","dir","role","tabindex","disabled","readonly","contenteditable","open","colspan","rowspan"]);function lr(e){const t=e.toLowerCase();return t.startsWith("data-")||t.startsWith("aria-")||ir.has(t)}var wt="data-ldx-props";function cr(e,t){if(t.toLowerCase()===wt)return!0;const r=e.getAttribute(wt);if(r===null)return!1;try{const n=JSON.parse(r);if(n===null||typeof n!="object"||Array.isArray(n))return!0;const a=t.toLowerCase();return Object.keys(n).some(s=>s.toLowerCase()===a)}catch{return!0}}var qn="http://www.w3.org/1999/xhtml",ur="http://www.w3.org/2000/svg",fr=new Set(["script","style","iframe","noscript","noframes","noembed","xmp","plaintext","template","title","textarea","object","embed"]),dr=new Set(["script","style"]);function hr(e){const t=e.localName.toLowerCase();return e.namespaceURI==="http://www.w3.org/1999/xhtml"?!fr.has(t):e.namespaceURI===ur?!dr.has(t):!1}function We(e,t){return e===t||(e===160||e===32)&&(t===160||t===32)}function pr(e,t){const r=e.length,n=t.length;let a=0;for(;a<r&&a<n&&We(e.charCodeAt(a),t.charCodeAt(a));)a++;let s=0;for(;s<r-a&&s<n-a&&We(e.charCodeAt(r-1-s),t.charCodeAt(n-1-s));)s++;return{p:a,s}}function mr(e,t){const r=e.firstChild;if(e.childNodes.length!==1||r===null||r.nodeType!==Node.TEXT_NODE){e.textContent=t;return}const n=r.data,a=n.length,s=t.length,{p:c,s:d}=pr(n,t);c===a&&d===0&&a===s||r.replaceData(c,a-c-d,t.slice(c,s-d));const R=r.data,y=e.ownerDocument.getSelection?.()??null,T=y!==null&&y.rangeCount>0&&(y.anchorNode===r||y.focusNode===r)?{anchor:y.anchorNode,anchorOffset:y.anchorOffset,focus:y.focusNode,focusOffset:y.focusOffset}:null;let v=-1,A=-1;for(let h=0;h<R.length&&h<t.length;h++){const L=R.charCodeAt(h),$=t.charCodeAt(h);L!==$&&We(L,$)&&(v<0&&(v=h),A=h)}const m=v>=0;if(m&&r.replaceData(v,A-v+1,t.slice(v,A+1)),m&&T!==null&&T.anchor!==null&&T.focus!==null)try{y.setBaseAndExtent(T.anchor,T.anchorOffset,T.focus,T.focusOffset)}catch{}}var vr=new Set(["html","head","body","frameset"]);function yr(e){return e.namespaceURI==="http://www.w3.org/1999/xhtml"&&vr.has(e.localName)}function _r(e){if(e===null||typeof e!="object")return!1;const t=e;if(typeof t.target!="string"||!sr.test(t.target)||t.text!==void 0&&typeof t.text!="string")return!1;if(t.attrsSet!==void 0){if(t.attrsSet===null||typeof t.attrsSet!="object")return!1;for(const[r,n]of Object.entries(t.attrsSet))if(!bt.test(r)||typeof n!="string")return!1}if(t.attrsRemoved!==void 0){if(!Array.isArray(t.attrsRemoved))return!1;for(const r of t.attrsRemoved)if(typeof r!="string"||!bt.test(r))return!1}return!0}function gr(e,t){if(e===null||typeof e!="object")return!1;const{seq:r,elements:n}=e;if(typeof r!="number"||!Number.isSafeInteger(r)||!Array.isArray(n)||n.length===0||n.length>64)return!1;for(let a=0;a<n.length;a++)if(!t(n[a]))return!1;return!0}function br(e){return e===null||typeof e!="object"?!1:gr(e.__frame_patch,_r)}function wr(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_init;return t!==null&&typeof t=="object"}function Er(e){return e!==null&&typeof e=="object"&&e.__frame_size_poke===!0}function Sr(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_host_visible;return t!==null&&typeof t=="object"&&typeof t.visible=="boolean"}function Ar(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_theme;if(t===null||typeof t!="object")return!1;const r=t.theme;return typeof r=="string"&&ar.includes(r)}var kr=["ok","empty","snapshot_error","snapshot_timeout","unclonable","oversize","unavailable","restore_error","withheld"],Rr=["TypeError","RangeError","ReferenceError","SyntaxError","DataCloneError","QuotaExceededError","AbortError","TimeoutError","SecurityError","Error","other"];function Tr(e){return typeof e=="string"&&Rr.includes(e)?e:"other"}var Or=Object.freeze({until:null,now:!1}),Lr="__claude_hot",Mr="__claude_hot_in",Pr=/^__claude_hot(?:_in)?(?::|$)/,Et=/^[0-9a-z]{1,32}$/,Ve=e=>e===void 0?Lr:"__claude_hot:"+e,_e=e=>e===void 0?Mr:"__claude_hot_in:"+e;function Cr(e,t){const r=[];for(let n=0;n<e.length;n++){const a=e.key(n);a!==null&&a!==t&&Pr.test(a)&&r.push(a)}for(const n of r)e.removeItem(n)}function Nr(e){let t=null;try{t=q(JSON.parse(e)?.hot)}catch{return null}return t===null||typeof t.k!="string"||!Et.test(t.k)?null:ae(t.g)?{k:t.k,g:t.g}:{k:t.k}}var Un=262144,xr=3e3,jr=5e3,St=/^[a-z0-9._:-]{1,64}$/,Ir=["none","hot-restart","hard-reload"],Dr=["asset","doc","added","removed"],Fr=1500,Hr=/^[0-9a-f]{64}$/;function q(e){return e!==null&&typeof e=="object"?e:null}function ae(e){return typeof e=="number"&&Number.isInteger(e)&&e>=0&&e<2**31}function At(e){return e===void 0||typeof e=="number"&&Number.isFinite(e)}function Br(e){return e===void 0||typeof e=="string"&&St.test(e)}function kt(e){const t=q(e);return t!==null&&(t.until===null||typeof t.until=="number"&&Number.isFinite(t.until))&&typeof t.now=="boolean"}function Xe(e){const t=q(e);return t!==null&&typeof t.ver=="string"&&t.ver.length<=128&&At(t.seq)&&typeof t.handoff=="string"&&kr.includes(t.handoff)&&Br(t.note)}function qr(e){const t=q(e);return t!==null&&ae(t.gen)&&(t.phase==="final"||t.phase==="pending")&&(t.from===null||Xe(t.from))}function Ur(e){const t=q(e);return t!==null&&t.kv===1&&ae(t.gen)&&Xe(t.from)&&Object.hasOwn(t,"data")}function zr(e){const t=q(e);return t!==null&&t.__frame_hot_snapshot===!0&&ae(t.gen)&&typeof t.timeoutMs=="number"&&t.timeoutMs>=0&&t.timeoutMs<=6e4&&(t.handoff===void 0||typeof t.handoff=="boolean")&&(t.deadline===void 0||kt(t.deadline))&&At(t.seq)&&(t.note===void 0||typeof t.note=="string")&&(t.key===void 0||typeof t.key=="string")}function Gr(e){const t=q(e);return t!==null&&t.__frame_hot_start===!0&&ae(t.gen)&&Xe(t.from)}function Kr(e){return typeof e=="string"&&e.length>=1&&e.length<=128}function Rt(e){return q(e)!==null&&!Array.isArray(e)}function $r(e){const t=q(e);return t!==null&&t.__frame_cap_grant===!0&&typeof t.cap=="string"&&Kr(t.ver)&&(t.grant===void 0||Rt(t.grant))&&(t.budgets===void 0||Rt(t.budgets)&&Object.values(t.budgets).every(Number.isFinite))&&(t.brokerGen===void 0||ae(t.brokerGen))}function Wr(e){const t=q(e);return t!==null&&t.__frame_cap_rewired===!0&&(t.caps===void 0||Array.isArray(t.caps)&&t.caps.every(r=>typeof r=="string"))&&(t.brokerGen===void 0||ae(t.brokerGen))}function Tt(e){const t=q(e);return t!==null&&typeof t.ver=="string"&&t.ver.length<=128&&Number.isFinite(t.seq)}function Ot(e){if(e==null||typeof e=="string")return!0;const t=q(e);return t!==null&&typeof t.doc=="string"&&typeof t.profile=="string"}function Vr(e){const t=q(e);return t!==null&&typeof t.path=="string"&&Dr.includes(t.kind)&&Ot(t.from)&&Ot(t.to)}function Xr(e){return e===null?null:Object.freeze(e.filter(Vr))}function Yr(e){const t=q(e);return t!==null&&t.__frame_hot_update===!0&&Number.isFinite(t.id)&&Tt(t.from)&&Tt(t.to)&&(t.changed===null||Array.isArray(t.changed))&&Ir.includes(t.required)&&kt(t.deadline)&&typeof t.verdictTimeoutMs=="number"&&t.verdictTimeoutMs>=0&&t.verdictTimeoutMs<=6e4&&(t.preflight===void 0||typeof t.preflight=="string"&&Hr.test(t.preflight))}var se=/^[\w.-]+\.js$/;function Jr(e,t,r){return r?"inert":typeof t=="string"&&se.test(t)?e?[t]:"inert":e?"inert":"framed"}var Lt=Object.freeze({[Symbol("claude.hot.restart")]:!0});function Mt(e,t){let r;try{r=e??sessionStorage}catch{return null}const n=Ve(t?.k),a=_e(t?.k);let s=null;try{s=r.getItem(n)}catch{}try{r.removeItem(n)}catch{}try{Cr(r,a)}catch{}let c=null;if(s!==null&&!(t!==null&&t.g===void 0))try{const d=JSON.parse(s);Ur(d)&&(t===null||d.gen===t.g)&&(c=d)}catch{}if(c===null)try{r.removeItem(a)}catch{}return c}function Pt(){const e=/^\/_f\/([^/]{1,128})\//.exec(location.pathname);return e?e[1]:""}var Zr=/^[^/\\?#]{1,128}$/,Ct=e=>Zr.test(e)&&e!=="."&&e!=="..";function Nt(e,t,r){const n=new URL(e),a="/_f/"+t+"/";if(!t||!n.pathname.startsWith(a)||!Ct(r))return null;const s=n.search.slice(1).split("&").filter(c=>!/^__frame_t(?:=|$)/.test(c)).join("&");return n.origin+"/_f/"+r+"/"+n.pathname.slice(a.length)+(s?"?"+s:"")+n.hash}var Ne="{}";function ge(e){if(!e)return null;const t={ver:e.ver,handoff:e.handoff};return e.seq!==void 0&&(t.seq=e.seq),e.note!==void 0&&(t.note=e.note),t}function xt(e,t){return e!==null&&e.note===void 0&&t?.note!==void 0?{...e,note:t.note}:e}function jt(e){const t=e?.k;return t!==null&&typeof t=="object"?t:void 0}function Qr(e,t,r,n=null){const a=setTimeout,s=clearTimeout,c=queueMicrotask,d=performance.now.bind(performance),R=new TextEncoder;let y=null,T=null;try{y=history,T=y.replaceState.bind(y)}catch{}const v=(...o)=>{try{console.warn(...o)}catch{}};let A=Pt(),m=null;try{m=sessionStorage}catch{}const h={storage:m,fetch:typeof fetch=="function"?fetch.bind(globalThis):null,entry:location.origin+location.pathname+location.search,ver:A,key:n?.k};let L=n?.k;const $=typeof requestAnimationFrame=="function"?requestAnimationFrame:o=>a(()=>o(d()),16);let g=t?.data??{},N=ge(t?.from),O=t?.gen??0,I=t!==null,W=!1,Q=!1,V=null,Se=!1;const Ae=new AbortController;let ke=null,B=null,Re=null,Te=!1,l=()=>{};const p=new Promise(o=>{l=o});let b=!1,D=!1,x=!1,F,P=null,ce=!1,Fe=!1,re=!1,Oe=!1,ne=!1,de=!1;const oe=o=>{for(const u of[Ve(o),_e(o)])try{m?.removeItem(u)}catch{}},H=(o,u)=>{try{u!==null&&r.post(o,u)}catch{}},he=()=>ne||=re&&(B===null||Oe),X=()=>{const o={__frame_hot:!0,ready:B!==null,accept:Re!==null,demand:!0};de=!ne,de&&(o.booting=!0),b&&(o.readData=!0),x&&(o.threw=!0),P?.assess&&(o.preflight=!0),H(o,V)};let Le=!1,Me=!1,i=!1,w=!1;const _=()=>{Le||!Se||i||(Le=!0,H({__frame_reveal_hold:!0},"*"))},C=()=>new Promise(o=>{let u,f=0;const E=j=>{if(u===void 0)u=j;else if(j!==u||++f>=8){o();return}try{$(E)}catch{o()}};try{$(E)}catch{o()}}),Y=()=>{i=!0,H({__frame_reveal_ready:!0},"*")},K=o=>{Me||(Me=!0,o.then(u=>{if(u===!1)return;let f=null;try{f=P?.settle?.()??null}catch{}return(f===null?C():new Promise(E=>{a(E,50),Promise.resolve(f).then(E,E)}).then(C)).then(Y)}))},Pe=()=>{if(w||!i)return;w=!0;const o=()=>{try{P?.afterReveal?.()}catch{}};o(),C().then(()=>{o(),Y()})},He=(o=!1)=>{if(Te||B===null||!I||!Q)return;Te=!0;const u=B,f=g;c(()=>{let E;try{E=u(f)}catch(U){throw l(!1),U}let j=!1;try{j=typeof E?.then=="function"}catch{}if(!j){l(!0);return}Promise.resolve(E).then(()=>l(!0),U=>{l(!1),c(()=>{throw U})})}),K(o?p:r.dcl.then(()=>p))},Be=o=>typeof o=="string"&&St.test(o)?o:void 0,ct=o=>{const u={__frame_hot_restart:!0},f=Be(o?.note);f!==void 0&&(u.note=f),o?.required==="hard-reload"&&(u.required="hard-reload"),H(u,V)},Yt=Object.freeze({get data(){return Q||(D=!0),!I&&!b&&(b=!0,Q&&X()),g},get from(){return N},get gen(){return O},signal:Ae.signal,snapshot(o){typeof o=="function"&&(ke=o)},ready(o){typeof o!="function"||B!==null||(B=o,_(),X(),W&&H({__frame_hot_ready:!0,gen:O},V),He())},accept(o){typeof o=="function"&&(Re=o,X())},restart(o){const u={note:o?.note,required:o?.required};if(Q){ct(u);return}const f=F;F={note:Be(f?.note)??u.note,required:f?.required==="hard-reload"||u.required==="hard-reload"?"hard-reload":void 0}}});let qe=null,Jt=()=>{};const Cn=new Promise(o=>{Jt=o});let Nn=null;const Zt=()=>Nn??=r.dcl.then(()=>{let o=!1;try{o=qe!==null&&qe.expect()}catch{}if(!o)return;const u=qe.maxMs;return new Promise(f=>{Cn.then(f),a(f,u)})}),Qt=()=>{if(!ce||Fe||P===null)return;Fe=!0;const o=P;Zt().then(()=>{try{i||o.afterStart(jt(t),!1)}catch{}})},er=o=>{t!==null&&D&&(b=!0),g={},N=null,O=0;try{m?.removeItem(_e(n?.k))}catch{}t!==null&&!o&&K(r.dcl.then(()=>B!==null?p:void 0))},xn=()=>{ce=!0,K(Zt().then(()=>B!==null?p:void 0)),Qt()};try{addEventListener("error",()=>{x||B!==null||(x=!0,X())})}catch{}const tr=()=>{a(()=>{!ne&&he()&&de&&X()},0)};try{re=document.readyState==="complete",re||addEventListener("load",()=>{re=!0,tr()},{once:!0})}catch{re=!0}he(),p.then(()=>{Oe=!0,tr()});let ue=-1,ut,ft,Ce=!0,dt=!1,ht,Ue=null;const pt=o=>{const u=Ue===null;Ue=Ce&&o[0]!=="withheld"?o:["withheld",o[1],Ne];let f=o[0];if(Ce&&f!=="withheld"){const j={ver:A,handoff:f};ut!==void 0&&(j.seq=ut),ft!==void 0&&(j.note=ft);try{if(m===null)throw new Error("no storage");m.setItem(Ve(L),'{"kv":1,"gen":'+ue+',"from":'+JSON.stringify(j)+(ht!==void 0?',"k":'+JSON.stringify(ht):"")+',"data":'+(f==="ok"?o[2]:Ne)+"}")}catch{f="unavailable"}}else{f="withheld",oe(L);try{P?.release?.()}catch{}}const E={__frame_hot_snapshotted:!0,gen:ue,handoff:f,bytes:o[1]};o[3]!==void 0&&(E.errName=o[3]),H(E,V),u&&(f==="snapshot_error"||f==="unclonable"||f==="oversize")&&v("claude.hot: snapshot",f,o[3])},pe=o=>{try{return Tr(o?.name)}catch{return"other"}},me=(o,u,f=0)=>pt(u===void 0?[o,f,Ne]:[o,f,Ne,pe(u)]),jn=o=>{if(o.gen<=ue)return;const u=ue>=0;if(ue=o.gen,ut=o.seq,ft=Be(o.note),typeof o.key=="string"&&Et.test(o.key)&&o.key!==L&&(oe(L),L=o.key),Ce&&=o.handoff!==!1,u){Ue!==null?pt(Ue):dt&&H({__frame_hot_held:!0,gen:ue},V);return}Ae.abort();const f=Object.freeze({handoff:Ce,timeoutMs:o.timeoutMs,deadline:o.deadline??Or}),E=ke,j=()=>{if(Ce)try{ht=P?.capture()}catch{}if(E===null){me("empty");return}let k=!1;const z=a(()=>{k||(k=!0,me("snapshot_timeout"))},Math.max(0,f.timeoutMs));Promise.resolve().then(()=>E(f)).then(ve=>{if(k)return;k=!0,s(z);let ee;try{ee=JSON.stringify(ve)}catch(mt){me("unclonable",mt);return}if(typeof ee!="string"){me("unclonable");return}let te=ee.length;try{te=R.encode(ee).length}catch{}if(te>262144){me("oversize",void 0,te);return}pt(["ok",te,ee])},ve=>{k||(k=!0,s(z),me("snapshot_error",ve))})};let U=null;try{U=P?.holdForIme()??null}catch{}if(U===null)j();else{dt=!0,H({__frame_hot_held:!0,gen:ue},V);const k=()=>{dt=!1,j()};U.then(k,k)}},In=o=>{if(!W||I||B===null||o.gen!==O)return;let u=null;try{u=Mt(m,n&&{k:n.k,g:o.gen})}catch{}if(u!==null&&u.gen!==o.gen){u=null;try{m?.removeItem(_e(n?.k))}catch{}}g=u?.data??{},N=xt(ge(u?.from??o.from),ge(o.from)),u!==null&&(O=u.gen),I=!0,W=!1;const f=jt(u);p.then(E=>{try{E&&P?.afterStart(f,!0)}catch{}}),He(!0)};let ze=0;const Dn=o=>{const u=Re;if(u===null||o.id<=ze)return;ze=o.id;const f=P?.assess;if(o.preflight===void 0||f===void 0){rr(o,u);return}let E=!1;const j=z=>{E||(E=!0,s(k),o.id===ze&&rr(o,u,z))},U=()=>j(f.timeout(o)),k=a(U,Fr+100);f.run(o,window).then(j,U)},rr=(o,u,f)=>{let E,j=!1,U=!1,k,z,ve=null;const ee=S=>{if(U)return!1;if(k!==void 0&&k!==S)return v(`claude.hot: u.${S}() ignored - u.${k}() was called first`),!1;const Z=k===void 0;return k=S,Z},te=S=>{k="restart",v(`claude.hot: ${S} - restarting`)},mt=()=>{if(!ee("adopt")||o.id!==ze)return;const S=o.to.ver;if(Ge.required!=="none"){te(`u.adopt() needs required 'none', it is '${Ge.required}'`);return}if(!Ct(S)){te("u.adopt() cannot address this version");return}if(!A||S===A)return;const Z=A,J=h.entry;let Ke="",yt,ye=null,$e;try{Ke=location.href,yt=y.state,ye=Nt(Ke,Z,S),ye!==null&&(T(yt,"",ye),location.pathname.startsWith("/_f/"+S+"/")?ye=location.href:$e="navigate event canceled")}catch(gt){$e=pe(gt)}if($e!==void 0){z="adopt_failed",te(`adopt_failed ${$e}; URL not changed`);return}ye===null?(z="adopt_skipped",v(`claude.hot: adopt_skipped - page already left /_f/${Z}/; URL not changed, update still applied`)):z="adopted",A=h.ver=S;try{h.entry=Nt(J,Z,S)??J}catch{}const _t=ye;ve=()=>{if(A===S){if(_t!==null)try{if(location.href!==_t)v("claude.hot: adopt_revert_skipped - update not applied; URL left where the page navigated");else{if(T(yt,"",Ke),location.href!==Ke){v("claude.hot: adopt_revert_failed navigate event canceled - URL still at the new version");return}z="adopt_reverted",v("claude.hot: adopt_reverted - adopt() was called but the handler threw; URL restored")}}catch(gt){v(`claude.hot: adopt_revert_failed ${pe(gt)} - URL still at the new version`);return}A=h.ver=Z,h.entry=J,_t===null&&(z=void 0)}}},Ge=Object.freeze({from:{ver:o.from.ver,seq:o.from.seq},to:{ver:o.to.ver,seq:o.to.seq},changed:Xr(o.changed),required:o.required,deadline:o.deadline,adopt:mt,defer(){return ee("defer")&&Ge.deadline.now&&te("u.defer() past the deadline"),Lt},restart(S){return ee("restart"),k==="restart"&&!U&&(E??=Be(S?.note),j||=S?.required==="hard-reload"),Lt},...f?.update}),Fn=(S,Z)=>{U=!0,S==="threw"?(ve?.(),E??=pe(Z).toLowerCase()):k===void 0&&v(S==="timeout"?"claude.hot: accept handler did not answer in time - restarting":"claude.hot: accept handler settled without defer/restart/adopt - restarting");const J={__frame_hot_verdict:!0,id:o.id};J.verdict=S==="threw"||k===void 0||k==="restart"?"restart":k==="adopt"?"applied":"deferred",J.verdict==="restart"&&(j&&(J.required="hard-reload"),E!==void 0&&(J.note=E)),z!==void 0&&(J.verdict==="applied"||z!=="adopted")&&(J.adopt=z),H(Object.assign(J,f?.verdict),V)};let nr=!1;const vt=(S,Z)=>nr?!1:(nr=!0,s(Hn),Fn(S,Z),!0),Hn=a(()=>vt("timeout"),o.verdictTimeoutMs);Promise.resolve().then(()=>u(Ge)).then(()=>vt("settled"),S=>{!vt("threw",S)&&k==="adopt"&&ct({note:pe(S).toLowerCase()}),v("claude.hot: accept",pe(S))})};try{e.hot===void 0&&Object.defineProperty(e,"hot",{value:Yt,writable:!1,configurable:!1,enumerable:!1})}catch{}return{hot:Yt,boot:h,afterConnect(){Se=!0,(t!==null||B!==null)&&_()},onInit(o,u){V=u,Q=!0;const f=qr(o)?o:null;f?.phase==="final"&&t!==null&&t.gen===f.gen?(I=!0,N=xt(N,ge(f.from)),xn()):(W=f?.phase==="pending",er(W),I=!W,O=f?.gen??0,N=ge(f?.from)),X(),de&&a(()=>{ne||(ne=!0,X())},jr),W&&B!==null&&H({__frame_hot_ready:!0,gen:O},u),F!==void 0&&(ct(F),F=void 0),He()},onNoInit(){Q=!0,er(!1),I=!0,He()},onShell(o){return o?.__frame_revealed===!0?(Pe(),!1):zr(o)?(jn(o),!0):Gr(o)?(In(o),!0):Yr(o)?(Dn(o),!0):!1},attachExtras(o){P=o,Qt(),o.assess&&X()},inSlot:()=>_e(L),hydration(o,u){qe??={expect:o,maxMs:u}},hydrated(){Jt()},carried(){return I?g:{}},presented:()=>i}}var zn="frame_ldx_runtime",en="frame_ldx_build",Gn="script#an-form",tn=256;function It(e,t,r){for(const n of e)r(n)&&e.delete(n);e.size>=tn&&!e.has(t)&&e.delete(e.values().next().value),e.add(t)}function Ye(e,t,r){try{const n=e[t];if(typeof n!="function")return;e[t]=function(...a){const s=n.apply(this,a);try{r(this)}catch{}return s}}catch{}}var Je;function rn(){if(Je)return Je;const e={media:new Set,contexts:new Set,onStart:null,onPause:null};Je=e;const t=window.HTMLMediaElement?.prototype;t&&(Ye(t,"play",a=>{It(e.media,a,s=>s.paused),e.onStart?.(a)}),Ye(t,"pause",a=>e.onPause?.(a)));const r=window.AudioContext,n=window.AudioNode?.prototype;return r&&n&&Ye(n,"connect",a=>{const s=a.context;s instanceof r&&(It(e.contexts,s,c=>c.state==="closed"),e.onStart?.(s))}),e}function nn(e){let t=window;for(let r=0;t.parent&&t.parent!==t&&r<8;r++)if(t=t.parent,e(t))return!0;return!1}function on(){let e=null;const t=()=>e??parent,r=n=>e?n===e:nn(a=>a===n);return{post(n,a){if(e){t().postMessage(n,a);return}let s=parent;for(let c=0;c<8&&(s.postMessage(n,a),!(!s.parent||s.parent===s));c++)s=s.parent},on(n){const a=s=>{const c=s.source;r(c)&&n(s.data,s.origin,s.isTrusted,()=>{e??=c})};return addEventListener("message",a),()=>removeEventListener("message",a)},port:n=>({post(a,s){if(s?.activation){t().postMessage(a,{targetOrigin:n,includeUserActivation:!0});return}if(s?.transfer){t().postMessage(a,n,s.transfer);return}t().postMessage(a,n)},on(a,s){const c=d=>{r(d.source)&&d.origin===n&&a(d.data,d)};return addEventListener("message",c,s),()=>removeEventListener("message",c,s)}})}}function an(){const e={post:()=>{},on:()=>()=>{}};return{...e,port:()=>e}}function sn(e){return String.fromCharCode(e)}var ln="This browser isn"+sn(8217)+"t supported",cn="Update it to open this artifact.",Kn=500,un=2e4,fn="data-token-reads",Dt=':host{all:initial}.layer{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 24px 12vh;background:#fff;background:Canvas;color:#1f1e1d;color:CanvasText;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}.tile{width:60px;height:60px;margin-bottom:20px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.14);background:color-mix(in srgb,CanvasText 7%,Canvas)}svg{width:22px;height:22px;opacity:.72}h1{margin:0 0 8px;max-width:16em;font:400 28px/1.2 ui-serif,Georgia,serif}p{margin:0;max-width:24em;color:#6b6a68;color:color-mix(in srgb,CanvasText 65%,Canvas)}@media (min-width:640px){h1{font-size:34px}}',Ft="http://www.w3.org/2000/svg";function dn(){const e=document.createElementNS(Ft,"svg");e.setAttribute("viewBox","0 0 24 24"),e.setAttribute("fill","none"),e.setAttribute("stroke","currentColor"),e.setAttribute("stroke-width","1.5"),e.setAttribute("stroke-linecap","round"),e.setAttribute("stroke-linejoin","round"),e.setAttribute("aria-hidden","true");const t=document.createElementNS(Ft,"path");return t.setAttribute("d","M10.3 4.2a2 2 0 0 1 3.4 0l7.5 12.8a2 2 0 0 1-1.7 3H4.5a2 2 0 0 1-1.7-3zM12 9.5v4m0 3h.01"),e.append(t),e}var hn=/(?:^|\s)stylesheet(?:\s|$)/i;function pn(e,t){let r="";if(e instanceof HTMLScriptElement?r=e.src:e instanceof HTMLLinkElement&&hn.test(e.rel)&&(r=e.href),!r)return null;try{const n=new URL(r);return n.origin===location.origin&&n.pathname.startsWith(t)?n.origin+n.pathname:null}catch{return null}}function mn(e){try{if("adoptedStyleSheets"in e&&typeof CSSStyleSheet=="function"){const r=new CSSStyleSheet;r.replaceSync(Dt),e.adoptedStyleSheets=[r];return}}catch{}const t=document.createElement("style");t.textContent=Dt,e.append(t)}function vn(){const e=document.documentElement;if(navigator.onLine===!1)return;const t=document.createElement("div");t.setAttribute("data-frame-runtime-notice","");const r=t.attachShadow({mode:"closed"});mn(r);const n=document.createElement("div");n.className="layer",n.style.colorScheme=e.style.colorScheme||"light dark",n.setAttribute("role","alert");const a=document.createElement("div");a.className="tile",a.append(dn());const s=document.createElement("h1");s.textContent=ln;const c=document.createElement("p");c.textContent=cn,n.append(a,s,c),r.append(n),e.append(t);let d=!1;try{d=getComputedStyle(n).position==="fixed"}catch{}d||t.remove()}function yn(e,t){if(!e||t!=="query")return;const r="/_f/"+e+"/",n=location.href,a=fetch,s=setTimeout,c={method:"HEAD",cache:"no-store",credentials:"same-origin"},d=A=>A.ok||A.status===304;let R=!1,y=!1;const T=()=>removeEventListener("error",v,!0),v=A=>{if(y||R)return;if(document.documentElement.hasAttribute(fn)){y=!0,T();return}const m=pn(A.target,r);m&&(R=!0,s(()=>{a(m,c).then(h=>{if(d(h))y=!0;else if(h.status===403)return a(n,c).then(L=>{d(L)?(y=!0,vn()):L.status>=400&&L.status<500&&(y=!0)})}).catch(()=>{}).finally(()=>{R=!1,y&&T()})},500))};addEventListener("error",v,!0),addEventListener("load",T,{once:!0}),s(T,un)}var Ze="__frame_scroll",_n=150,gn=310,bn=160,wn=3e4;function En(){let e=0,t=!1,r=!1,n=!1,a=0,s=null;const c=g=>{try{sessionStorage.setItem(Ze,JSON.stringify({y:g}))}catch{}},d=()=>{if(clearTimeout(e),s===null)return;const g=s;s=null,c(g)},R=()=>{if(t){t=!1;return}r=!0,s=scrollY,clearTimeout(e),e=setTimeout(d,_n)};try{addEventListener("scroll",R,{passive:!0}),addEventListener("pagehide",d)}catch{}const y=()=>{let g;try{g=sessionStorage.getItem(Ze)}catch{return null}if(g===null)return null;let N;try{N=JSON.parse(g)}catch{N=null}const O=N?.y;if(!(typeof O=="number"&&Number.isFinite(O)&&O>=0)){try{sessionStorage.removeItem(Ze)}catch{}return null}return O};let T=!1;const v=g=>{try{const N=scrollY;scrollTo({top:g,left:0,behavior:"instant"}),a=g,n=!0,clearTimeout(e),s=null,c(g);const O=scrollY;O!==N&&(t=!0),O!==g&&!T&&(T=!0,addEventListener("load",()=>{try{if(scrollY===O){const I=y();v(I!==null?I:a)}}catch{}},{once:!0}))}catch{}},A=()=>{try{return!!location.hash}catch{return!0}};let m=!1;const h=()=>{try{if(m||innerWidth>gn||innerHeight>bn)return;m=!0;const g=Date.now(),N=()=>{try{removeEventListener("resize",N)}catch{}if(Date.now()-g>wn||r||A())return;const O=y();v(O!==null?O:a)};addEventListener("resize",N)}catch{}};let L=!1,$=!1;return{restore(){if(L||(L=!0,A()))return;const g=y();g!==null&&(v(g),h())},promoted(){if($||($=!0,A()))return;const g=y();g!==null?(v(g),h()):n&&v(a)}}}function Sn(e,t,r,n){let a=null;try{a=window.trustedTypes?.createPolicy("frame-runtime",{createScriptURL:R=>R})??null}catch{}const s=window.Worker,c=s?.prototype,d=Object.freeze({Worker:s,workerOn:c?.addEventListener,workerPost:c?.postMessage,workerTerminate:c?.terminate,fetch:window.fetch.bind(window),preventDefault:Event.prototype.preventDefault,now:Date.now,policy:a,origins:t});r(e).then(R=>R?.bootTopLevel?R.bootTopLevel(d,n):n.settle()).catch(()=>n.settle())}var $n="modulepreload",Wn=function(e){return"/"+e},Vn={},An=function(t,r,n){let a=Promise.resolve();function s(c){const d=new Event("vite:preloadError",{cancelable:!0});if(d.payload=c,window.dispatchEvent(d),!d.defaultPrevented)throw c}return a.then(c=>{for(const d of c||[])d.status==="rejected"&&s(d.reason);return t().catch(s)})},kn=window===top,Ht=Object.getOwnPropertyDescriptor(window,"claude"),xe=Jr(kn,window.__FRAME_PREAMBLE?.topLevel,Ht?.writable===!1),Qe=typeof xe=="object"&&xe[0],M=Qe?an():on();(function(){const e=Object.defineProperty,t=globalThis,r=["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel","RTCIceCandidate","RTCSessionDescription","RTCRtpSender","RTCRtpReceiver"];let n=0;for(let a=0;a<r.length;a++){const s=r[a];try{e(t,s,{value:void 0,writable:!1,configurable:!1})}catch{try{delete t[s]}catch{}try{e(t,s,{value:void 0,writable:!1,configurable:!0})}catch{}}typeof t[s]=="function"&&n++}if(n&&xe==="framed")try{M.post({__frame_rtc_lockdown_failed:n},"*")}catch{}})();var Bt=1e4,Rn=2e3,et=2e3,qt=Object.freeze([...window.__FRAME_PREAMBLE?.origins??["https://claude.ai","https://preview.claude.ai"]]);function Ut(e){for(const t of qt)if(t.endsWith(":*"))try{const r=new URL(e);if(`${r.protocol}//${r.hostname}:*`===t)return!0}catch{}else if(e===t)return!0;return!1}var be=Object.freeze({...window.__FRAME_PREAMBLE?.capabilities}),je=window.__FRAME_PREAMBLE?.transforms,tt=window.__FRAME_PREAMBLE?.comments,rt=window.__FRAME_PREAMBLE?.translate,we=window.__FRAME_PREAMBLE?.ldx,Tn=window.__FRAME_PREAMBLE?.cred;function zt(e){return An(()=>import("/_runtime/"+e),void 0)}var Ee=new Set,On=setTimeout,Ln=800+800*Math.random();function ie(e){return zt(e).catch(()=>new Promise(t=>On(t,Ln)).then(()=>zt(e+"?r=1")).then(t=>(t!==void 0&&Ee.add(e),t)))}function Gt(e,t,r){return{contract:e.contract,changes:new Set(e.changes??[]),flags:new Set(e.flags??[]),capabilities:e.capabilities??{},capBudgets:e.capBudgets??{},brokerGen:e.brokerGen,transforms:new Map,shellOrigin:t,shell:r,mount:lt,hooks:Ie,pipe:()=>({wrap:(n,a)=>(...s)=>{try{return a(...s)}catch(c){return Promise.reject(c)}}})}}var fe=null,G=null;function Kt(e,t,r){try{Object.defineProperty(e,t,{value:r,writable:!1,configurable:!1,enumerable:!0})}catch{try{Object.defineProperty(e,t,{value:r,writable:!1,configurable:!0,enumerable:!0})}catch{}}}var nt=!1,Ie={editBefore:null,edit:null};function Mn(e,t,r=!1){const n=[];let a;if(r)try{Ie.editBefore?.(e)}catch{}for(const s of e.elements){const c=document.querySelector(`[data-id="${s.target}"]`);if(!c){a=s.target;break}if([...Object.keys(s.attrsSet??{}),...s.attrsRemoved??[]].some(d=>!lr(d)||cr(c,d))){a=s.target;break}if(s.text!==void 0&&(!hr(c)||yr(c))){a=s.target;break}for(const[d,R]of Object.entries(s.attrsSet??{}))if(!Wt(c,d)){try{c.setAttribute(d,R)}catch{}$t(c,d,R)}for(const d of s.attrsRemoved??[])Wt(c,d)||(c.removeAttribute(d),$t(c,d,null));typeof s.text=="string"&&mr(c,s.text),n.push(s.target)}if(r)try{Ie.edit?.(e.seq,n,a)}catch{}if(a!==void 0){M.post({__frame_patch_miss:{seq:e.seq}},t);return}try{document.dispatchEvent(new CustomEvent("claude:edit",{detail:{seq:e.seq,targets:n}}))}catch{}}function $t(e,t,r){if(!(e instanceof HTMLInputElement))return;const n=t.toLowerCase();n==="checked"?e.checked=r!==null:n==="value"&&e.type!=="file"&&(e.value=r??"")}function Wt(e,t){const r=t.toLowerCase(),n=e;return r==="data-id"||(r==="value"||r==="checked")&&(n.__artifactSecret===!0||/^(password|hidden|file)$/.test(n.type??"")||/(^|\s)(cc-|one-time-code|current-password|new-password)/i.test(`${e.getAttribute("autocomplete")??""} ${n.autocomplete??""}`))}function Vt(e){const t=document.documentElement;e==="light"||e==="dark"?(t.dataset.theme=e,t.style.colorScheme=e,nt=!0):nt&&(delete t.dataset.theme,t.style.colorScheme="",nt=!1)}var le=new Map,ot=null;function at(){let e;const t={u:new Promise(r=>{e=r}),r:r=>{t.done=!0,e(r)},done:!1,nulled:!1};return t}function De(e,t){e.nulled=!0,e.ver=t,e.r(null)}function st(e,t){for(const[r,n]of le)n.done||(t&&n.asked?t(r,n):De(n,e))}var Pn=Object.freeze(Object.assign(Object.create(null),{call:Function.prototype.call,apply:Function.prototype.apply,bind:Function.prototype.bind})),it=!1,lt=(e,t)=>{let r=le.get(e);if(r?.nulled&&it)r=at(),le.set(e,r);else if(!r||r.done){r?.nulled&&G&&M.post({__frame_cap_telemetry:{kind:"cap-load-error",cap:e,phase:"install"}},G);return}const n=typeof t=="function"?Object.setPrototypeOf(t,Pn):Object.assign(Object.create(null),t);typeof n.then=="function"&&delete n.then,r.want=void 0,r.r(Object.freeze(n))};function Xt(){const e=Ht?.value??{};Kt(window,"claude",e);for(const t of Object.keys(be)){if(e[t]!==void 0){Kt(e,t,e[t]);continue}le.set(t,at())}if(e.use===void 0){const t=r=>{if(typeof r!="string"||!Object.hasOwn(be,r))return Promise.resolve(null);let n=le.get(r);return n?(ot&&(n.nulled||n.want!==void 0)&&(n=ot(r,n)),n.asked=!0,n.u):Promise.resolve(e[r]??null)};try{Object.defineProperty(e,"use",{value:t,writable:!0,configurable:!0,enumerable:!1})}catch{}}return e}if(xe==="framed"){const e=je&&se.test(je)?ie(je).catch(()=>{}):Promise.resolve(void 0),t=l=>{if(l.type==="auxclick"&&l.button!==1)return;const p=l.target,b=p&&p.closest?p.closest("a[href],area[href]"):null;if(!b)return;const D=b.getAttribute("href");if(!D)return;let x;try{x=new URL(D,document.baseURI)}catch{return}if((x.protocol==="http:"||x.protocol==="https:")&&x.origin!==location.origin){l.preventDefault();const F=(b.getAttribute("target")??"").toLowerCase(),P=l.type==="auxclick"||l.metaKey||l.ctrlKey||l.shiftKey||l.altKey||!["","_self","_top","_parent"].includes(F);M.post({__frame_nav:!0,url:x.href,newTab:P},"*")}};addEventListener("click",t,!0),addEventListener("auxclick",t,!0);const r={},n=l=>{l.isTrusted&&(r.pointer=!0)},a=l=>{l.isTrusted&&(r.click=!0)};addEventListener("pointermove",n,{capture:!0,passive:!0}),addEventListener("click",a,{capture:!0,passive:!0});const s={cb:null};addEventListener("keydown",l=>s.cb?.(l),!0);const c={cb:null};addEventListener("keydown",l=>c.cb?.(l));const d=rn();e.then(l=>l?.installEscapeForward?.(s,p=>{G&&M.post(p,G)})),e.then(l=>{try{l?.installFocusKeep?.()}catch{}}),e.then(l=>{if(!l?.wireNav)return;const p=M.port("*");l.wireNav(p),removeEventListener("click",t,!0),removeEventListener("auxclick",t,!0),removeEventListener("pointermove",n,!0),removeEventListener("click",a,!0),l.wireEngagement?.(r,p,d)});let R=null;try{R=En()}catch{}const y=document.readyState==="loading"?new Promise(l=>document.addEventListener("DOMContentLoaded",()=>l(),{once:!0})):Promise.resolve();let T=null,v=null;try{v=Nr(window.name),T=Mt(null,v)}catch{}const A=Xt();let m=null;try{m=Qr(A,T,{post:(l,p)=>M.post(l,p),dcl:y},v)}catch{}e.then(l=>{try{m&&l?.installHotExtras?.(m)}catch{}});let h=null;const L=()=>Array.isArray(h?.flags)&&h.flags.includes("frame_ldx_runtime")&&!!we&&se.test(we)&&document.querySelector("script#an-form")!==null;try{m?.hydration(L,xr)}catch{}let $=null,g=0;const N=M.on((l,p,b,D)=>{Ut(p)&&wr(l)&&(D(),h=l.__frame_init,G=p,N(),clearTimeout(g),$?.())});M.post({__frame_connect:!0},"*");try{m?.afterConnect()}catch{}const O=setTimeout,I=clearTimeout;let W=()=>NaN,Q=()=>[];try{W=performance.now.bind(performance),Q=performance.getEntriesByType.bind(performance)}catch{}let V=0;const Se=()=>{try{M.post({__frame_alive:!0},"*")}catch{}V=O(Se,Rn)},Ae=()=>I(V);Se(),addEventListener("load",Ae,{once:!0});const ke=new Promise(l=>{$=l,g=setTimeout(()=>{N(),l()},Bt)}),B=new WeakSet;addEventListener("error",l=>{l.target&&B.add(l.target)},!0);try{yn(Pt(),Tn)}catch{}const Re=()=>{let l=[];try{l=[...document.querySelectorAll("link[rel~=stylesheet]:not([rel~=alternate])")].filter(b=>!b.sheet&&!b.disabled&&!B.has(b)&&b.getAttribute("href")&&URL.canParse(b.href)&&(!b.media||matchMedia(b.media).matches))}catch{}let p=l.length;return p===0?Promise.resolve():new Promise(b=>{try{const D=et-W(),x=O(b,D>0?D<et?D:et:0),F=()=>{--p===0&&(I(x),b())};for(const P of l)P.addEventListener("load",F,{once:!0}),P.addEventListener("error",F,{once:!0})}catch{b()}})};y.then(()=>{try{R?.restore()}catch{}}),Promise.all([ke,y,e]).then(([,,l])=>{if(h?.hostOverlays!==!0||!G)return;let p=!1;try{p=l?.declaresCover?.()===!0}catch{}M.post({__frame_layout:{cover:p}},G)});const Te={cb:null};M.on((l,p)=>{if(Ut(p)&&Er(l)){try{R?.promoted()}catch{}Te.cb?.()}}),ke.then(async()=>{if(!h||!G){st();try{m?.onNoInit()}catch{}return}if(Vt(h.theme),h.hostVisible===!1&&e.then(i=>i?.applyHostVisible?.(!1,d)),h.hostKeys!==void 0){const i=G,w=h.hostKeys;e.then(_=>_?.installHostKeyForward?.(c,w,C=>M.post(C,i)))}try{m?.onInit(h.hot,G)}catch{}const l=G,p=M.port(l),b=(i,w)=>M.post({__frame_cap_telemetry:{kind:"cap-load-error",cap:i,phase:w}},l),D=i=>M.post({__frame_cap_recovered:{cap:i}},l);let x=h.brokerGen;const F=()=>m?.boot.ver??"",P=F(),ce=(i,w)=>{const _=F();I(w.t),w.want=_,w.t=O(()=>{w.done||De(w,_)},Bt),M.post({__frame_cap_want:!0,cap:i,ver:_},l)},Fe=(i,w)=>{const _=le.get(i.cap),C=be[i.cap];if(!w||!_||_.done||_.want!==i.ver||!se.test(C))return;if(I(_.t),_.want=void 0,x=i.brokerGen??x,i.ver!==F()){ce(i.cap,_);return}if(!i.grant||i.cap==="network"){De(_,i.ver);return}const Y=fe,K=fe={...Y,capabilities:{...Y.capabilities,[i.cap]:i.grant},capBudgets:{...Y.capBudgets,[i.cap]:{...Y.capBudgets[i.cap],...i.budgets}}};ie(C).then(Pe=>{Ee.has(C)&&D(i.cap),K.brokerGen=x,it=!0;try{Pe?.install?.(K)}catch{b(i.cap,"install")}finally{it=!1}},()=>b(i.cap)).then(()=>{_.done||De(_,i.ver)})};let re=!1,Oe=!1;M.on((i,w,_)=>{if(w!==l)return;try{if(m?.onShell(i))return}catch{}if(Ar(i)&&Vt(i.__frame_theme.theme),$r(i)&&Fe(i,_),_&&Wr(i)&&(x=i.brokerGen??x),Sr(i)){const K=i.__frame_host_visible.visible;e.then(Pe=>Pe?.applyHostVisible?.(K,d))}br(i)&&Mn(i.__frame_patch,l,_);const C=i?.__fc_mode;C&&typeof C=="object"&&!re&&tt&&se.test(tt)&&(re=!0,ie(tt).then(K=>K.install?.(l,C.on===!0,p)).catch(()=>{}));const Y=i?.__ft_cmd;Y&&typeof Y=="object"&&!Oe&&rt&&se.test(rt)&&(Oe=!0,ie(rt).then(K=>K.install?.(l,Y,p)).catch(()=>{}))});const ne=Object.keys(h.capabilities??{}).filter(i=>Object.hasOwn(be,i)).map(i=>[i,be[i]]).filter(i=>typeof i[1]=="string"&&se.test(i[1])),de=await Promise.allSettled(ne.map(([,i])=>ie(i))),oe=await e,H=l;if(oe?.buildBoot||b("_transforms"),oe?.buildBoot)try{fe=oe.buildBoot(h,oe.TRANSFORMS??{},{shellOrigin:H,mount:lt,hooks:Ie,shell:p},i=>M.post({__frame_cap_telemetry:i},H))}catch{b("_transforms","install"),fe=Gt(h,H,p)}else fe=Gt(h,H,p);oe?.buildBoot&&Ee.has(je??"")&&D("_transforms");const he=fe;he.brokerGen=x,de.forEach((i,w)=>{const[_,C]=ne[w];if(i.status!=="fulfilled"){b(_);return}Ee.has(C)&&D(_);try{i.value?.install?.(he)}catch{b(_,"install")}});const X=h.capWants===!0;X&&(ot=(i,w)=>{const _=F();if(!_)return w;if(!w.nulled)return w.want!==_&&ce(i,w),w;if(_===w.ver)return w;const C=at();return le.set(i,C),ce(i,C),C}),st(P,X&&F()!==P?ce:void 0),await y,await Re(),Ae();const Le=or(Q,W);M.post(Le?{__frame_ready:!0,nav:Le}:{__frame_ready:!0},G),e.then(i=>{i?.installSizeReporter?.(H,Te,p),i?.installPaintReporter?.(p)});let Me=!1;try{Me=L()}catch{}we&&Me?ie(we).then(i=>i?.boot?.({shellOrigin:l,build:he.flags.has(en),hot:m?.hot??null,carried:m?.carried(),presented:()=>m?.presented()??!0})).catch(()=>!1).then(i=>{m?.hydrated(),i!==!0?b("_ldx"):Ee.has(we)&&D("_ldx")}):m?.hydrated()})}else Qe&&(Xt(),Sn(Qe,qt,ie,{settle:st,mount:lt}))})();</script><!-- /frame-runtime --><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>
<title>Mudavym Go-Live Board</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --paper-0: #FAF7F1; --paper-1: #F3EFE6; --paper-2: #EAE4D8;
    --ink-1: #211C16; --ink-2: #4F473C; --ink-3: #7C7365;
    --line: #D9D2C4; --line-strong: #B9B0A0;
    --seal: #1A5E6B; --seal-deep: #14515C; --seal-tint: rgba(26,94,107,.10); --seal-ring: rgba(26,94,107,.32);
    --hold: #7C7365;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper-0: #15130F; --paper-1: #1D1813; --paper-2: #262019;
      --ink-1: #EFE7D9; --ink-2: #C0B6A5; --ink-3: #8E8576;
      --line: #342C22; --line-strong: #4A4034;
      --seal: #5FB0BC; --seal-deep: #7DC3CD; --seal-tint: rgba(95,176,188,.14); --seal-ring: rgba(95,176,188,.38);
      --hold: #8E8576;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --paper-0: #15130F; --paper-1: #1D1813; --paper-2: #262019;
    --ink-1: #EFE7D9; --ink-2: #C0B6A5; --ink-3: #8E8576;
    --line: #342C22; --line-strong: #4A4034;
    --seal: #5FB0BC; --seal-deep: #7DC3CD; --seal-tint: rgba(95,176,188,.14); --seal-ring: rgba(95,176,188,.38);
    --hold: #8E8576;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper-0); color: var(--ink-1); font-family: "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif; font-size: 15px; line-height: 1.5; }
  main { max-width: 1040px; margin: 0 auto; padding: 40px 28px 96px; }
  .eyebrow { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--seal); }
  h1 { font-family: Fraunces, Georgia, serif; font-weight: 600; font-size: 40px; line-height: 1.05; margin: 8px 0 6px; letter-spacing: -.01em; text-wrap: balance; }
  h2 { font-family: Fraunces, Georgia, serif; font-weight: 500; font-size: 24px; margin: 0 0 4px; text-wrap: balance; }
  .lede { color: var(--ink-2); max-width: 66ch; margin: 0; }
  .mast { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: end; padding-bottom: 20px; border-bottom: 3px double var(--line-strong); }
  .mast .stamp { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: var(--ink-3); text-align: right; line-height: 1.7; }
  .mast .stamp b { color: var(--ink-1); font-weight: 500; }
  section { margin-top: 44px; }
  .sechead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
  .count { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  /* ledger */
  .ledger { border-top: 1px solid var(--line-strong); }
  .row { display: grid; grid-template-columns: 56px 1fr 300px; gap: 20px; padding: 16px 0; border-bottom: 1px solid var(--line); align-items: start; }
  .row.locked { border-bottom: 3px double var(--seal-ring); }
  .num { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: var(--ink-3); padding-top: 4px; font-variant-numeric: tabular-nums; }
  .fork { font-weight: 600; margin: 0 0 4px; }
  .rec { color: var(--ink-2); margin: 0; max-width: 62ch; }
  .rec b { color: var(--ink-1); font-weight: 600; }
  .ctl { display: grid; gap: 8px; }
  .seg { display: flex; border: 1px solid var(--line-strong); border-radius: 4px; overflow: hidden; }
  .seg button { flex: 1; background: transparent; border: 0; border-right: 1px solid var(--line-strong); padding: 7px 0; font: inherit; font-size: 13px; color: var(--ink-2); cursor: pointer; }
  .seg button:last-child { border-right: 0; }
  .seg button:hover { background: var(--paper-1); }
  .seg button:focus-visible { outline: 2px solid var(--seal); outline-offset: -2px; }
  .seg button[aria-pressed="true"] { background: var(--seal); color: var(--paper-0); font-weight: 600; }
  .seg button[aria-pressed="true"].hold { background: var(--hold); }
  .seg button[aria-pressed="true"].change { background: var(--paper-2); color: var(--ink-1); }
  .note { width: 100%; border: 1px solid var(--line); border-radius: 4px; background: var(--paper-1); color: var(--ink-1); font: inherit; font-size: 13px; padding: 7px 9px; resize: vertical; min-height: 38px; }
  .note:focus-visible { outline: 2px solid var(--seal); outline-offset: 0; }
  .when { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 11px; color: var(--ink-3); }
  .when.saved { color: var(--seal); }
  /* status ledger */
  .status { display: grid; grid-template-columns: 150px 1fr 140px; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .status .k { font-weight: 600; }
  .status .v { color: var(--ink-2); }
  .chip { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; padding: 3px 8px; border-radius: 3px; border: 1px solid var(--line-strong); color: var(--ink-2); justify-self: start; white-space: nowrap; }
  .chip.landed { border-color: var(--seal); color: var(--seal); background: var(--seal-tint); }
  .chip.running { border-style: dashed; }
  .rules { display: grid; gap: 0; border-top: 1px solid var(--line-strong); }
  .rule { display: grid; grid-template-columns: 40px 1fr 200px; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--line); align-items: start; }
  .rule p { margin: 0; color: var(--ink-2); }
  .rule p b { color: var(--ink-1); font-weight: 600; }
  .bulk { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  .btn { background: var(--seal); color: var(--paper-0); border: 0; border-radius: 4px; padding: 8px 14px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn.quiet { background: transparent; color: var(--ink-2); border: 1px solid var(--line-strong); }
  .btn:focus-visible { outline: 2px solid var(--seal); outline-offset: 2px; }
  .todo { display: grid; gap: 0; border-top: 1px solid var(--line-strong); }
  .todo label { display: grid; grid-template-columns: 24px 1fr; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); align-items: start; cursor: pointer; }
  .todo input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--seal); }
  .todo code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; background: var(--paper-1); padding: 1px 5px; border-radius: 3px; }
  .foot { margin-top: 40px; padding-top: 14px; border-top: 3px double var(--line-strong); color: var(--ink-3); font-size: 13px; }
  .foot a { color: var(--seal); }
  .offline { display: none; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: var(--ink-3); margin-top: 10px; }
  body[data-db="off"] .offline { display: block; }
  @media (max-width: 760px) {
    .row, .rule { grid-template-columns: 40px 1fr; }
    .row .ctl, .rule .ctl { grid-column: 2; }
    .status { grid-template-columns: 1fr; }
    .mast { grid-template-columns: 1fr; }
    .mast .stamp { text-align: left; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .seg button, .chip { transition: background-color 160ms cubic-bezier(.2,.8,.2,1), color 160ms cubic-bezier(.2,.8,.2,1); }
  }
</style>

<main>
  <header class="mast">
    <div>
      <div class="eyebrow">ADR 0131 · ADR 0134 · 2026-09-11</div>
      <h1>Mudavym Go-Live Board</h1>
      <p class="lede">The new house goes live dark on merge, then one house at a time. Every line below is either landed, running, or waiting on a word only you can give. Your verdicts here are saved to the board and read back by the session.</p>
    </div>
    <div class="stamp">
      <div>production houses <b>14</b> · design rows <b>0</b></div>
      <div>gateway serving <b>e29c8dd4</b> · booted 16:28Z</div>
      <div>design branch ahead <b>247</b> · behind <b>3</b></div>
      <div>queue: #326 <b>0f1c4f0d</b> · #322 <b>60dc122d</b> · #268 running</div>
    </div>
  </header>

  <section>
    <div class="sechead"><h2>The streams</h2><span class="count">as measured 2026-09-11</span></div>
    <div class="ledger" id="streams"></div>
  </section>

  <section>
    <div class="sechead"><h2>Fourteen forks</h2><span class="count" id="forkCount">0 of 14 answered</span></div>
    <p class="lede" style="margin-bottom:14px">Numbered as the adversary ranked them. Three are already answered by the primitive and packet builds and are shown for the record. Lock takes the recommendation as written into ADR 0134; Change means you want the alternative or something else, say which in the note; Hold parks it.</p>
    <div class="ledger" id="forks"></div>
  </section>

  <section>
    <div class="sechead"><h2>Ten rules that change</h2><span class="count" id="ruleCount">0 of 10 locked</span></div>
    <div class="bulk">
      <button class="btn" id="lockAll" type="button">Lock all ten as recommended</button>
      <button class="btn quiet" id="holdAll" type="button">Hold all ten</button>
    </div>
    <div class="rules" id="rules"></div>
  </section>

  <section>
    <div class="sechead"><h2>Only you can do these</h2><span class="count">keystrokes, not code</span></div>
    <div class="todo" id="todo"></div>
  </section>

  <p class="foot">Sources: <code>.planning/decisions/0131-…</code> (PR #328), <code>0134-one-motion-per-act-across-every-page.md</code> on <code>docs/motions-and-overlays-per-page</code>, the research reports in the session scratchpad. Nothing on this board writes to the repo; the session reads your verdicts and records them.</p>
  <p class="offline">Board storage is not available in this view. Verdicts you pick here will not be kept.</p>
</main>

<script>
(function () {
  const STREAMS = [
    ['Demo house', 'Meyhouse Palo Alto and its three logins deleted on your word (190 library submissions, 462 notifications, 227 impressions, 66 POS checks, 50 inventory rows, 5 audit rows). 14 houses remain.', 'landed'],
    ['Sketch 103', 'Your Overlay Sketches canvas and the 136-demo motion curation committed as the record (docs/modal-sketches, in the design branch).', 'landed'],
    ['ADR 0131', 'The go-live record plus the flip script and the demo-house script, PR #328 to main.', 'landed'],
    ['Primitive (packet 0)', 'Sheet to sketch 103: contract sentence as the accessible name, sheets take width not light, tear-to-stub, panel weight, three-deep spine, denied state. 168 files, 2357 tests green. Branch feat/overlays-packet-0-primitive.', 'landed'],
    ['Packet 1', 'Ten legacy modals on the primitive with six write-path defects fixed; census consent panel found unreachable (fork 14). Branch feat/overlays-packet-1.', 'landed'],
    ['Packet 2', 'Twelve owed acts built, three new sealed gateway routes; census owed count 12 to 0. Branch feat/overlays-packet-2.', 'landed'],
    ['Mudavym MCP server', 'Ten read tools live, eight writes declared and refused with the seal sentence, per-house key, ADR 0132 Proposed. Branch feat/connect-mudavym-mcp-server.', 'landed'],
    ['Calendar push', 'Direction 1 of ADR 0111: secondary-calendar push with idempotent ids and an honest reconcile; a series-update gap found and pinned. Branch feat/connect-calendar-push.', 'landed'],
    ['Text sender', 'ADR 0121 P0 and P1: honest push report, mobile numbers in the book, WhatsApp reply-shaped dispatch inside the 24-hour window. Branch feat/connect-text-sender.', 'landed'],
    ['Motions and overlays research', 'Three finders, an adversary, a judge: ADR 0134 Proposed, decisions written into 20 page notes and DESIGN-FOUNDATION §6g. The forks below are its output.', 'landed'],
    ['Merge queue', '#326, #322, #268, #328 landing in order with CI between each, then the third merge of main into the design branch.', 'running'],
    ['Merge #289', 'Un-drafted and retitled 2026-09-11; you arm auto-merge (merge commit) yourself once pass 3 is pushed; 70 migrations apply on merge; every house stays on legacy until flipped. The audit gate runs on the final head for the record.', 'running'],
    ['The flip', 'ALDEMIR plus the four simulator houses, all nineteen pages, by the audited script, after the deploy check reads the merged commit on /health/live.', 'waiting'],
    ['Phase-2 PRs', 'The six branches above take main after #289 and open as PRs in dependency order: primitive, packets 1 and 2, then the three connectors, then the research docs.', 'waiting'],
    ['New pages', 'Your separate session on the routes not yet rebuilt stalled on 2026-09-06 at the weekly limit; its ADR 0133 commit exists only in its worktree, not on origin. The launch orchestrator session is resuming it.', 'stalled'],
    ['Nightly e2e', 'Your separate session modernising the production suite; the account move waits on item 1 below.', 'running'],
  ];
  const FORKS = [
    ['sidebar', 'The sidebar: fix it, gate it, or name it as the last legacy chrome', 'Split it three ways: the reduced-motion guard now and ungated, the hover hint on <b>ink</b> inside the house branch only, the 260-to-72 collapse left alone as the last unmigrated chrome.', false],
    ['inventory', '/inventory: how the packet gets built without breaking flag-off', 'Answered by packet 1: gated inside the component. What remains: drop the ink swap and the row expand from this pass; add the reduced-motion guard.', true],
    ['esc-scrim', 'Esc, the scrim, and unsaved work', 'Answered by packet 0 (dirty, onTear, Stub; panel weight; sheet scrim off by default). Two residues are yours: the split is by shape, not dirtiness, and dirtiness is a prop on sixty sites rather than detected.', true],
    ['wax-vs-dry', 'Is rationed wax-versus-nothing, or wax-versus-dry?', '<b>Wax versus nothing.</b> Demoted acts get the sentence, not a smaller stamp; the bulk emboss stays and is named the plural rendering of the wax.', false],
    ['popover-send', 'A send lives inside a popover (row 105, /team Shift actions, "Offer cover")', '<b>The popover offers; the panel sends</b>, the bell\'s own shape. One extra surface on one row.', false],
    ['hold-to-reject', 'Is "Hold to reject" a send? (row 19 draws a hold, carries seal false)', '<b>Lose the hold, keep the required reason.</b> A rejection redeems nothing and destroys nothing; the flag and the drawing must agree either way.', false],
    ['denied', 'Permission-denied: build the panel now or after the grants table?', 'Answered by packet 0 (Denied.tsx, the grant line only when a grant is named). Never a guessed list of names.', true],
    ['swipe', 'The swipe: rebuild at 150 px, rebuild smaller, or replace it', '<b>Keep 96 px.</b> Add the resistance, the ghost seal, the stamp landing and a non-dragging pointer path. 68% of 150 px is 102 px of thumb travel, longer than today\'s full commit.', false],
    ['reduced-motion', 'Under reduced motion: nothing, or a cross-fade?', '<b>A 120 ms opacity-only cross-fade on arriving surfaces only.</b> This reverses a guard the primitive shipped the same day, which is why it is yours.', false],
    ['motion-guard', 'The motion guard: fix the specification or do not ship one', '<b>Ship it, re-specified</b> so it resolves each rebuilt slug from App.tsx and scans components/layout; as drafted it could see neither /inventory nor the sidebar.', false],
    ['eighth-token', 'The eighth token (an unnamed 420 ms literal on four pages)', '<b>Fold into settle 320.</b> Minting a named rise token at 420 ms is defensible; leaving the literal is not.', false],
    ['calendar-delete', '/calendar\'s delete', '<b>Keeps the wax</b> under the ration rule\'s second clause. The alternative puts a day-book entry on the undo-after list and drops it to a plain control.', false],
    ['wide-sheets', 'wide (640 px) on two sheets that are not letters (rows 33 and 59)', '<b>Force both to 440</b>, as packet 1 did to the cellar\'s carry sheet. Amending the rule to "a letter, or a table a person reads across" is the alternative.', false],
    ['consent', 'F13: the settings consent panel is built and unreachable', 'Either something reads a consent and the control comes back, or the act is a deletion. <b>Recommendation: delete</b>, unless a consumer is planned; a control whose effect does not exist is what ADR 0020 forbids.', false],
  ];
  const RULES = [
    'The 420 ms opening literal on four pages folds into <b>settle 320</b>; no eighth token.',
    'One wax-ration rule replaces three: orders\' reject loses the wax and the hold, the dashboard\'s unsealed die becomes a plain button, calendar\'s delete keeps the wax.',
    'The dry emboss is the plural rendering of the wax at bulk, not a second ceremony; BUILD-PROMPT rule 3 is amended.',
    'Keyboard-opened surfaces (palette, Ask AI, Recently viewed, Shortcuts) never animate on entry, per surface.',
    'The sidebar splits three ways; the collapse stays legacy because DashboardLayout renders it on every legacy page.',
    'Under reduced motion, arriving sheets and panels cross-fade 120 ms opacity-only; everything else renders none.',
    'The 1.9 s shimmer stops after two cycles and says the wait in words (WCAG 2.2.2, Level A).',
    'The receipts swipe keeps 96 px and gains resistance, the ghost seal, the stamp landing and a non-dragging path (WCAG 2.5.7).',
    'The manager\'s four digits gain a passkey peer path (WCAG 3.3.8); the chip is not a target-size failure and gets an explicit line-height.',
    'Two guards get built as re-specified: the motion-token guard that can see /inventory and the sidebar, and the emoji guard rule 8 already cites.',
  ];
  const TODO = [
    ['e2e-account', 'In this order: merge #349 (the sim-teardown landmine fix) first; then register <code>aldemirkonuk@mudavym.com</code> in the app; then set the GitHub secrets <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>E2E_TEST_EMAIL</code>, <code>E2E_TEST_PASSWORD</code>, <code>VERCEL_PRODUCTION_URL</code>. Main\'s nightly preflight exits 2 today because only <code>ADMIN_API_KEY</code> and <code>RAILWAY_ORCHESTRATOR_URL</code> are present, so the suite is not armed yet. The session then grants the account a simulator house.'],
    ['railway', 'On Railway (gateway): <code>CALENDAR_REMINDERS_ENABLED=true</code>, <code>PRICE_INDEX_FETCH_ENABLED=true</code>, <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code>, <code>STRIPE_API_VERSION</code>. After the merge lands and the flip is verified, as you chose.'],
    ['vercel', 'On Vercel (web): <code>VITE_STRIPE_PUBLISHABLE_KEY</code>. Same timing.'],
    ['dependabot', 'Eight Dependabot PRs (#339 to #346) opened on 2026-09-06; #345 (nodemailer 9.1.1) overlaps your CodeQL session\'s work. Decide whether they ride with that session or wait.'],
    ['public-door', 'AFTER the new-pages PR lands on main (the flag does nothing before the code is there): on Vercel set <code>VITE_MUDAVYM_PUBLIC=1</code>, which opens the public door for everyone (ADR 0133). Optional, values yours: <code>VITE_SUPPORT_EMAIL</code> and <code>VITE_SUPPORT_SLACK_URL</code>; unset, /help says no support address is configured.'],
  ];

  const $ = (s, el) => (el || document).querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  // streams
  const streams = $('#streams');
  for (const [k, v, st] of STREAMS) {
    const r = h('div', 'status');
    r.append(h('div', 'k', k), h('div', 'v', v), h('span', 'chip ' + st, st));
    streams.append(r);
  }

  // state
  const state = { forks: {}, rules: {}, todo: {} };
  let db = null;
  const fmt = (iso) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

  function seg(options, current, onPick) {
    const s = h('div', 'seg');
    for (const [val, label] of options) {
      const b = h('button', val, label); b.type = 'button';
      b.setAttribute('aria-pressed', String(current === val));
      b.addEventListener('click', () => onPick(val));
      s.append(b);
    }
    return s;
  }

  function renderForks() {
    const root = $('#forks'); root.innerHTML = '';
    let answered = 0;
    FORKS.forEach(([slug, fork, rec, done], i) => {
      const v = state.forks[slug] || {};
      if (v.verdict) answered++;
      const row = h('div', 'row' + (v.verdict === 'lock' ? ' locked' : ''));
      const left = h('div');
      left.append(h('p', 'fork', fork), h('p', 'rec', (done ? '<span class="eyebrow">answered by a build · </span>' : '') + rec));
      const ctl = h('div', 'ctl');
      ctl.append(seg([['lock', 'Lock'], ['change', 'Change'], ['hold', 'Hold']], v.verdict, (val) => save('forks', slug, { verdict: val })));
      const note = h('textarea', 'note'); note.placeholder = 'Your words, if any'; note.value = v.note || ''; note.setAttribute('aria-label', 'Note on fork ' + (i + 1));
      let t; note.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => save('forks', slug, { note: note.value }), 600); });
      const when = h('div', 'when' + (v.at ? ' saved' : ''), v.at ? 'saved ' + fmt(v.at) : 'not answered');
      ctl.append(note, when);
      row.append(h('div', 'num', String(i + 1).padStart(2, '0')), left, ctl);
      root.append(row);
    });
    $('#forkCount').textContent = answered + ' of 14 answered';
  }

  function renderRules() {
    const root = $('#rules'); root.innerHTML = '';
    let locked = 0;
    RULES.forEach((text, i) => {
      const slug = 'rule-' + (i + 1); const v = state.rules[slug] || {};
      if (v.verdict === 'lock') locked++;
      const r = h('div', 'rule' + (v.verdict === 'lock' ? ' locked' : ''));
      const ctl = h('div', 'ctl');
      ctl.append(seg([['lock', 'Lock'], ['hold', 'Hold']], v.verdict, (val) => save('rules', slug, { verdict: val })));
      ctl.append(h('div', 'when' + (v.at ? ' saved' : ''), v.at ? 'saved ' + fmt(v.at) : 'not answered'));
      r.append(h('div', 'num', String(i + 1).padStart(2, '0')), h('p', null, text), ctl);
      root.append(r);
    });
    $('#ruleCount').textContent = locked + ' of 10 locked';
  }

  function renderTodo() {
    const root = $('#todo'); root.innerHTML = '';
    for (const [slug, text] of TODO) {
      const v = state.todo[slug] || {};
      const l = h('label');
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!v.done;
      c.addEventListener('change', () => save('todo', slug, { done: c.checked }));
      l.append(c, h('span', null, text + (v.at ? ' <span class="when saved">' + (v.done ? 'done ' : 'reopened ') + fmt(v.at) + '</span>' : '')));
      root.append(l);
    }
  }

  function renderAll() { renderForks(); renderRules(); renderTodo(); }

  async function save(kind, slug, patch) {
    const prev = state[kind][slug] || {};
    const next = Object.assign({}, prev, patch, { at: new Date().toISOString(), kind, slug });
    state[kind][slug] = next; renderAll();
    if (!db) return;
    try { await db.doc('verdicts/' + kind + '-' + slug).set(next); }
    catch (e) { console.warn('verdict not saved', e); }
  }

  $('#lockAll').addEventListener('click', () => RULES.forEach((_, i) => save('rules', 'rule-' + (i + 1), { verdict: 'lock' })));
  $('#holdAll').addEventListener('click', () => RULES.forEach((_, i) => save('rules', 'rule-' + (i + 1), { verdict: 'hold' })));

  renderAll();

  (async () => {
    try {
      const use = window.claude && window.claude.use;
      db = use ? await use('db') : null;
    } catch (e) { db = null; }
    if (!db) { document.body.dataset.db = 'off'; return; }
    try {
      db.collection('verdicts').onSnapshot((snap) => {
        const docs = snap && snap.docs ? snap.docs : (Array.isArray(snap) ? snap : []);
        for (const d of docs) {
          const data = typeof d.data === 'function' ? d.data() : (d.data || d);
          if (!data || !data.kind || !data.slug) continue;
          if (!state[data.kind]) continue;
          const cur = state[data.kind][data.slug];
          if (!cur || !cur.at || (data.at && data.at >= cur.at)) state[data.kind][data.slug] = data;
        }
        renderAll();
      });
    } catch (e) {
      try {
        const snap = await db.collection('verdicts').get();
        const docs = snap && snap.docs ? snap.docs : [];
        for (const d of docs) { const data = typeof d.data === 'function' ? d.data() : d.data; if (data && data.kind && data.slug && state[data.kind]) state[data.kind][data.slug] = data; }
        renderAll();
      } catch (e2) { console.warn('verdicts not readable', e2); }
    }
  })();
})();
</script>

</body></html>
<!-- artifact-db: verdicts | 0 documents -->
```json
[]
```
