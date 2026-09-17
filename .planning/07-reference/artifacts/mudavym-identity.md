---
title: "Mudavym Identity"
source_url: https://claude.ai/artifact/KWf4ZygrDXjQQ9NDq2g5KD
internal_id: 95e8857e-5bc9-4719-acc4-57a94e4e4158
pulled: 2026-09-16
note: "Snapshot pulled 2026-09-16."
---

<!doctype html><html><head><!-- frame-runtime --><script>window.__FRAME_PREAMBLE={"v":1,"cred":"query","capabilities":{"artifact":"artifact.O-h4mzdy.js","assets":"assets.DhQw8DTi.js","comments":"comments.DrhK3r8W.js","db":"db.DV02l9iB.js","downloads":"downloads.axDW2QAi.js","embed":"embed.swQslL0W.js","endpoints":"endpoints.BPfoKaE1.js","mcp":"mcp.C8qKIFvQ.js","network":"network.B5UA9Su4.js","permissions":"permissions.DWFFeHI0.js","room":"room.BF1j0KPr.js","sample":"sample.C7KQQdQj.js","self":"artifact.O-h4mzdy.js","user":"user.CCh6oTS_.js"},"transforms":"_transforms.DOfCNjBN.js","comments":"_comments.D8Q8NfHc.js","translate":"_translate.DqxC5ek1.js","ldx":"_ldx.CqNtBrkk.js"}                                                                                                                                                                                                                                                                                                                        </script><script>(function(){"use strict";var Ot=3e5;function Te(e,t){try{const r=e("navigation")[0],o=[r.responseStart,r.redirectEnd-r.redirectStart,r.domContentLoadedEventStart,t()];for(let n=0;n<o.length;n++){if(!(o[n]>=0&&o[n]<=3e5))return;o[n]=o[n]|0}return o}catch{return}}var Pe=["light","dark","system"],je=/^[A-Za-z0-9_-]{1,64}$/,ae=/^[a-zA-Z_:][a-zA-Z0-9_:.-]{0,127}$/,Re=new Set(["class","hidden","value","checked","style","title","alt","placeholder","lang","dir","role","tabindex","disabled","readonly","contenteditable","open","colspan","rowspan"]);function Me(e){const t=e.toLowerCase();return t.startsWith("data-")||t.startsWith("aria-")||Re.has(t)}var Tt="http://www.w3.org/1999/xhtml",Le="http://www.w3.org/2000/svg",ke=new Set(["script","style","iframe","noscript","noframes","noembed","xmp","plaintext","template","title","textarea","object","embed"]),Ce=new Set(["script","style"]);function Ne(e){const t=e.localName.toLowerCase();return e.namespaceURI==="http://www.w3.org/1999/xhtml"?!ke.has(t):e.namespaceURI===Le?!Ce.has(t):!1}function Y(e,t){return e===t||(e===160||e===32)&&(t===160||t===32)}function Ue(e,t){const r=e.length,o=t.length;let n=0;for(;n<r&&n<o&&Y(e.charCodeAt(n),t.charCodeAt(n));)n++;let s=0;for(;s<r-n&&s<o-n&&Y(e.charCodeAt(r-1-s),t.charCodeAt(o-1-s));)s++;return{p:n,s}}function Ie(e,t){const r=e.firstChild;if(e.childNodes.length!==1||r===null||r.nodeType!==Node.TEXT_NODE){e.textContent=t;return}const o=r.data,n=o.length,s=t.length,{p:l,s:c}=Ue(o,t);l===n&&c===0&&n===s||r.replaceData(l,n-l-c,t.slice(l,s-c));const f=r.data,u=e.ownerDocument.getSelection?.()??null,p=u!==null&&u.rangeCount>0&&(u.anchorNode===r||u.focusNode===r)?{anchor:u.anchorNode,anchorOffset:u.anchorOffset,focus:u.focusNode,focusOffset:u.focusOffset}:null;let d=-1,R=-1;for(let w=0;w<f.length&&w<t.length;w++){const k=f.charCodeAt(w),I=t.charCodeAt(w);k!==I&&Y(k,I)&&(d<0&&(d=w),R=w)}const M=d>=0;if(M&&r.replaceData(d,R-d+1,t.slice(d,R+1)),M&&p!==null&&p.anchor!==null&&p.focus!==null)try{u.setBaseAndExtent(p.anchor,p.anchorOffset,p.focus,p.focusOffset)}catch{}}var De=new Set(["html","head","body","frameset"]);function qe(e){return e.namespaceURI==="http://www.w3.org/1999/xhtml"&&De.has(e.localName)}function xe(e){if(e===null||typeof e!="object")return!1;const t=e;if(typeof t.target!="string"||!je.test(t.target)||t.text!==void 0&&typeof t.text!="string")return!1;if(t.attrsSet!==void 0){if(t.attrsSet===null||typeof t.attrsSet!="object")return!1;for(const[r,o]of Object.entries(t.attrsSet))if(!ae.test(r)||typeof o!="string")return!1}if(t.attrsRemoved!==void 0){if(!Array.isArray(t.attrsRemoved))return!1;for(const r of t.attrsRemoved)if(typeof r!="string"||!ae.test(r))return!1}return!0}function Be(e,t){if(e===null||typeof e!="object")return!1;const{seq:r,elements:o}=e;if(typeof r!="number"||!Number.isSafeInteger(r)||!Array.isArray(o)||o.length===0||o.length>64)return!1;for(let n=0;n<o.length;n++)if(!t(o[n]))return!1;return!0}function He(e){return e===null||typeof e!="object"?!1:Be(e.__frame_patch,xe)}function Fe(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_init;return t!==null&&typeof t=="object"}function $e(e){return e!==null&&typeof e=="object"&&e.__frame_size_poke===!0}function ze(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_host_visible;return t!==null&&typeof t=="object"&&typeof t.visible=="boolean"}function Ke(e){if(e===null||typeof e!="object")return!1;const t=e.__frame_theme;if(t===null||typeof t!="object")return!1;const r=t.theme;return typeof r=="string"&&Pe.includes(r)}var Ve=/^__claude_hot(?:_in)?(?::|$)/;function We(e,t){const r=[];for(let o=0;o<e.length;o++){const n=e.key(o);n!==null&&n!==t&&Ve.test(n)&&r.push(n)}for(const o of r)e.removeItem(o)}function Ye(e){try{typeof reportError=="function"?reportError(e):setTimeout(()=>{throw e},0)}catch{}}var ie=["#62744c","#b04e72","#5b7596","#a3651f","#7a6ba8","#3f7a75"];function ce(e){let t=0;for(let r=0;r<e.length;r++)t=t*31+e.charCodeAt(r)>>>0;return ie[t%ie.length]??"#788c5d"}var le="#c7c9d1",Xe=["data:image","/svg+xml,"].join("");function ue(e){return Xe+"%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'%3E%3Ccircle cx='1' cy='1' r='1' fill='"+encodeURIComponent(e)+"'/%3E%3C/svg%3E"}var Ge=Object.freeze({id:null,name:"",avatarUrl:ue(le),color:le,email:null,isOwner:!1,canEdit:!1});function Je(...e){const t=e[0],r=typeof t=="string"?[t]:Array.isArray(t)?t.filter(n=>typeof n=="string"):[],o=Object.create(null);for(const n of r)o[n]={id:n,name:"",avatarUrl:ue(ce(n)),color:ce(n),email:null,isMe:!1};return o}var fe=Object.freeze(Object.assign(Object.create(null),{user:Object.freeze(Object.assign(Object.create(null),{id:null,isOwner:!1,canEdit:!1,can:null,me:Ge,profiles:Je,name:"",avatarUrl:null,search:Object.freeze([]),email:null}))})),Ze={sample:"sample"};function de(){const e=new Uint8Array(20);try{crypto.getRandomValues(e)}catch{for(let r=0;r<e.length;r++)e[r]=Math.floor(Math.random()*256)}let t="";for(const r of e)t+=(r%36).toString(36);return t}function Qe(e,t,r=o=>o){const o=l=>{const c=r(l,"doc"),f={path:c},u=c.split("/");return{id:u[u.length-1],path:c,get:()=>t("get",[f]),set:p=>t("set",[f,p]),update:p=>t("update",[f,p]),delete:()=>t("delete",[f]),acquire:p=>t("acquire",[f,p]),onSnapshot:(p,d)=>t("subscribe",[f,p,d]),collection:p=>s(c+"/"+String(p))}},n=l=>({where:(c,f,u)=>n({...l,where:[...l.where??[],{f:String(c),op:String(f),v:u}]}),orderBy:(c,f)=>n({...l,orderBy:{f:String(c),dir:f===void 0?"asc":String(f)}}),limit:c=>n({...l,limit:Number(c)}),get:()=>t("query",[l]),onSnapshot:(c,f)=>t("subscribe",[l,c,f])}),s=l=>{const c=r(l,"collection");return{...n({collection:c}),path:c,doc:f=>o(c+"/"+(f===void 0?de():r(String(f),"id"))),add:f=>{try{const u=o(c+"/"+de());return Promise.resolve(u.set(f)).then(()=>u)}catch(u){return Promise.reject({code:"invalid_argument",message:u instanceof Error?u.message:String(u)})}}}};e.doc=l=>o(String(l)),e.collection=l=>s(String(l))}var et=256;function pe(e,t,r){for(const o of e)r(o)&&e.delete(o);e.size>=et&&!e.has(t)&&e.delete(e.values().next().value),e.add(t)}function X(e,t,r){try{const o=e[t];if(typeof o!="function")return;e[t]=function(...n){const s=o.apply(this,n);try{r(this)}catch{}return s}}catch{}}var G;function tt(){if(G)return G;const e={media:new Set,contexts:new Set,onStart:null,onPause:null};G=e;const t=window.HTMLMediaElement?.prototype;t&&(X(t,"play",n=>{pe(e.media,n,s=>s.paused),e.onStart?.(n)}),X(t,"pause",n=>e.onPause?.(n)));const r=window.AudioContext,o=window.AudioNode?.prototype;return r&&o&&X(o,"connect",n=>{const s=n.context;s instanceof r&&(pe(e.contexts,s,l=>l.state==="closed"),e.onStart?.(s))}),e}var rt=Object.freeze([]);function nt(e,t){let r=null,o=null;const n=()=>e.__settled;e.peers=()=>rt,e.connected=()=>!1,e.emit=()=>n()?.()??Promise.resolve(),e.presence=s=>{const l=n();if(l)return l();let c=null;if(s!==null&&typeof s=="object")try{Array.isArray(s)||(c={...s})}catch{}return c===null?Promise.reject({code:"invalid_argument",message:"presence takes an object"}):(r===null&&(r=Object.create(null),o=Promise.resolve(t("presence",[r]))),Object.assign(r,c),o)}}var J="__frame_scroll",ot=150,st=310,at=160,it=3e4;function ct(){let e=0,t=!1,r=!1,o=!1,n=0,s=null;const l=m=>{try{sessionStorage.setItem(J,JSON.stringify({y:m}))}catch{}},c=()=>{if(clearTimeout(e),s===null)return;const m=s;s=null,l(m)},f=()=>{if(t){t=!1;return}r=!0,s=scrollY,clearTimeout(e),e=setTimeout(c,ot)};try{addEventListener("scroll",f,{passive:!0}),addEventListener("pagehide",c)}catch{}const u=()=>{let m;try{m=sessionStorage.getItem(J)}catch{return null}if(m===null)return null;let L;try{L=JSON.parse(m)}catch{L=null}const S=L?.y;if(!(typeof S=="number"&&Number.isFinite(S)&&S>=0)){try{sessionStorage.removeItem(J)}catch{}return null}return S};let p=!1;const d=m=>{try{const L=scrollY;scrollTo({top:m,left:0,behavior:"instant"}),n=m,o=!0,clearTimeout(e),s=null,l(m);const S=scrollY;S!==L&&(t=!0),S!==m&&!p&&(p=!0,addEventListener("load",()=>{try{if(scrollY===S){const F=u();d(F!==null?F:n)}}catch{}},{once:!0}))}catch{}},R=()=>{try{return!!location.hash}catch{return!0}};let M=!1;const w=()=>{try{if(M||innerWidth>st||innerHeight>at)return;M=!0;const m=Date.now(),L=()=>{try{removeEventListener("resize",L)}catch{}if(Date.now()-m>it||r||R())return;const S=u();d(S!==null?S:n)};addEventListener("resize",L)}catch{}};let k=!1,I=!1;return{restore(){if(k||(k=!0,R()))return;const m=u();m!==null&&(d(m),w())},promoted(){if(I||(I=!0,R()))return;const m=u();m!==null?(d(m),w()):o&&d(n)}}}var Pt="modulepreload",jt=function(e){return"/"+e},Rt={},lt=function(t,r,o){let n=Promise.resolve();function s(l){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=l,window.dispatchEvent(c),!c.defaultPrevented)throw l}return n.then(l=>{for(const c of l||[])c.status==="rejected"&&s(c.reason);return t().catch(s)})};(function(){const e=Object.defineProperty,t=globalThis,r=["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel","RTCIceCandidate","RTCSessionDescription","RTCRtpSender","RTCRtpReceiver"];let o=0;for(let n=0;n<r.length;n++){const s=r[n];try{e(t,s,{value:void 0,writable:!1,configurable:!1})}catch{try{delete t[s]}catch{}try{e(t,s,{value:void 0,writable:!1,configurable:!0})}catch{}}typeof t[s]=="function"&&o++}if(o&&window!==top)try{parent.postMessage({__frame_rtc_lockdown_failed:o},"*")}catch{}})();var ut=1e4,ft=2e3,Z=2e3,dt=Object.freeze([...window.__FRAME_PREAMBLE?.origins??["https://claude.ai","https://preview.claude.ai"]]);function me(e){for(const t of dt)if(t.endsWith(":*"))try{const r=new URL(e);if(`${r.protocol}//${r.hostname}:*`===t)return!0}catch{}else if(e===t)return!0;return!1}var x=Object.freeze({...window.__FRAME_PREAMBLE?.capabilities}),$=window.__FRAME_PREAMBLE?.transforms,Q=window.__FRAME_PREAMBLE?.comments,ee=window.__FRAME_PREAMBLE?.translate,z=/^[\w.-]+\.js$/,pt=/^[a-z][a-z0-9_-]{0,63}$/;function he(e){return lt(()=>import("/_runtime/"+e),void 0)}var te=new Set,mt=setTimeout,ht=800+800*Math.random();function K(e){return he(e).catch(()=>new Promise(t=>mt(t,ht)).then(()=>he(e+"?r=1")).then(t=>(t!==void 0&&te.add(e),t)))}function gt(e,t){return{contract:e.contract,changes:new Set(e.changes??[]),flags:new Set(e.flags??[]),capabilities:e.capabilities??{},capBudgets:e.capBudgets??{},transforms:new Map,shellOrigin:t,mount:oe,hooks:V,pipe:()=>({wrap:(r,o)=>(...n)=>{try{return o(...n)}catch(s){return Promise.reject(s)}}})}}var ge=null,U=null;function re(e,t,r){try{Object.defineProperty(e,t,{value:r,writable:!1,configurable:!1,enumerable:!0})}catch{try{Object.defineProperty(e,t,{value:r,writable:!1,configurable:!0,enumerable:!0})}catch{}}}var ne=!1,V={editBefore:null,edit:null};function vt(e,t,r=!1){const o=[];let n;if(r)try{V.editBefore?.(e)}catch{}for(const s of e.elements){const l=document.querySelector(`[data-id="${s.target}"]`);if(!l){n=s.target;break}if([...Object.keys(s.attrsSet??{}),...s.attrsRemoved??[]].some(c=>!Me(c))){n=s.target;break}if(s.text!==void 0&&(!Ne(l)||qe(l))){n=s.target;break}for(const[c,f]of Object.entries(s.attrsSet??{}))if(!ye(l,c)){try{l.setAttribute(c,f)}catch{}ve(l,c,f)}for(const c of s.attrsRemoved??[])ye(l,c)||(l.removeAttribute(c),ve(l,c,null));typeof s.text=="string"&&Ie(l,s.text),o.push(s.target)}if(r)try{V.edit?.(e.seq,o,n)}catch{}if(n!==void 0){parent.postMessage({__frame_patch_miss:{seq:e.seq}},t);return}try{document.dispatchEvent(new CustomEvent("claude:edit",{detail:{seq:e.seq,targets:o}}))}catch{}}function ve(e,t,r){if(!(e instanceof HTMLInputElement))return;const o=t.toLowerCase();o==="checked"?e.checked=r!==null:o==="value"&&e.type!=="file"&&(e.value=r??"")}function ye(e,t){const r=t.toLowerCase(),o=e;return r==="data-id"||(r==="value"||r==="checked")&&(o.__artifactSecret===!0||/^(password|hidden|file)$/.test(o.type??"")||/(^|\s)(cc-|one-time-code|current-password|new-password)/i.test(`${e.getAttribute("autocomplete")??""} ${o.autocomplete??""}`))}function _e(e){const t=document.documentElement;e==="light"||e==="dark"?(t.dataset.theme=e,t.style.colorScheme=e,ne=!0):ne&&(delete t.dataset.theme,t.style.colorScheme="",ne=!1)}var be=256,B=Object.assign(Object.create(null),{mcp:Object.assign(Object.create(null),{watchTool:{handlerArg:3}}),db:Object.assign(Object.create(null),{subscribe:{handlerArg:1,errArg:2}}),room:Object.assign(Object.create(null),{on:{handlerArg:1,errArg:2},onPeers:{handlerArg:0,errArg:1},onConnection:{handlerArg:0,errArg:1}})}),yt=Object.assign(Object.create(null),{db:(e,t)=>Qe(e,t),room:(e,t,r)=>nt(e,r)}),D=new Map;function oe(e,t){const r=D.get(e);if(!r)return;const o=Object.assign(Object.create(null),t);Object.assign(r.impl,o),r.r(r.ns),r.impl.__settled=()=>Promise.reject({code:"capability_removed",message:`${e}: method not in this runtime`});const n=r.queue;r.queue=[];for(const s of n){const l=o[s.method];if(l)if(B[e]?.[s.method])try{s.resolve(l(...s.args))}catch{H(s,B[e][s.method],{code:"transform_error",message:`${e}.${s.method} rejected its arguments`})}else l(...s.args).then(s.resolve,s.reject);else{const c={code:"capability_removed",message:`${e}.${s.method} is not in this runtime`},f=B[e]?.[s.method];if(f){H(s,f,c);continue}s.reject(c)}}}function _t(e,t){const r=D.get(e);if(!r)return;r.impl.__settled=()=>Promise.reject(t),r.r(null);const o=r.queue;r.queue=[];for(const n of o){const s=B[e]?.[n.method];if(s){H(n,s,t);continue}n.reject(t)}}function we(e,t){if(typeof e=="function")try{return e(...t)}catch{return Object.create(null)}return Array.isArray(e)?[...e]:e!==null&&typeof e=="object"?{...e}:e}function W(e,t){const r=fe[e];if(!r){_t(e,t);return}D.get(e)?.r(null),oe(e,Object.fromEntries(Object.entries(r).map(([o,n])=>[o,(...s)=>Promise.resolve(we(n,s))])))}function H(e,t,r){if(e.syncState?.dead)return;const o=t.errArg===void 0?void 0:e.args[t.errArg],n=t.errArg===void 0?e.args[t.handlerArg]:o;typeof n=="function"&&queueMicrotask(()=>{if(!e.syncState?.dead)try{n(t.errArg===void 0?{type:"error",error:r}:r)}catch(s){Ye(s)}})}var se=Object.getOwnPropertyDescriptor(window,"claude");if(window!==top&&!(se&&se.writable===!1)){const e=$&&z.test($)?K($).catch(()=>{}):Promise.resolve(void 0),t=a=>{if(a.type==="auxclick"&&a.button!==1)return;const _=a.target,g=_&&_.closest?_.closest("a[href],area[href]"):null;if(!g)return;const b=g.getAttribute("href");if(!b)return;let v,C;try{v=new URL(b,document.baseURI),C=new URL(document.baseURI).origin}catch{return}if((v.protocol==="http:"||v.protocol==="https:")&&v.origin!==C){a.preventDefault();const O=(g.getAttribute("target")??"").toLowerCase(),T=a.type==="auxclick"||a.metaKey||a.ctrlKey||a.shiftKey||a.altKey||!["","_self","_top","_parent"].includes(O);parent.postMessage({__frame_nav:!0,url:v.href,newTab:T},"*")}};addEventListener("click",t,!0),addEventListener("auxclick",t,!0);const r={},o=a=>{a.isTrusted&&(r.pointer=!0)},n=a=>{a.isTrusted&&(r.click=!0)};addEventListener("pointermove",o,{capture:!0,passive:!0}),addEventListener("click",n,{capture:!0,passive:!0});const s={cb:null};addEventListener("keydown",a=>s.cb?.(a),!0);const l={cb:null};addEventListener("keydown",a=>l.cb?.(a));const c=tt();e.then(a=>a?.installEscapeForward?.(s,_=>{U&&parent.postMessage(_,U)})),e.then(a=>{try{a?.installFocusKeep?.()}catch{}}),e.then(a=>{a?.wireNav&&(a.wireNav(),removeEventListener("click",t,!0),removeEventListener("auxclick",t,!0),removeEventListener("pointermove",o,!0),removeEventListener("click",n,!0),a.wireEngagement?.(r))});try{We(sessionStorage)}catch{}let f=null;try{f=ct()}catch{}const u=se?.value??{};re(window,"claude",u);const p=a=>{let _;const g=new Promise(A=>{_=A}),b={impl:Object.create(null),queue:[],u:g,r:_,ns:null};D.set(a,b);const v=b.impl,C=A=>({code:"queue_overflow",message:`${a}.${A}: pre-init call queue is full`}),O=(A,h)=>{if(b.queue.length>=be){const E=fe[a];return E&&A in E?Promise.resolve(we(E[A],h)):Promise.reject(C(A))}return new Promise((E,i)=>{b.queue.push({method:A,args:h,resolve:E,reject:i})})},T=Ze[a],q=new Proxy(T===void 0?v:(()=>{}),{apply:(A,h,E)=>{const i=T,y=v[i]??v.__settled;return y?y(...E):O(i,E)},get:(A,h)=>{if(typeof h!="string"||h==="then"||h==="toJSON"||h==="valueOf")return;if(h==="toString")return Object.prototype.toString;if(T!==void 0&&(h==="call"||h==="apply"||h==="bind"))return Function.prototype[h];const E=B[a]?.[h];return E?(...i)=>{if(typeof i[E.handlerArg]!="function")throw new TypeError(`${a}.${h} requires a handler function`);const y=v[h];if(y)return y(...i);if(v.__settled){const N={dead:!1},At={args:[...i],syncState:N};return v.__settled().catch(St=>H(At,E,St)),()=>{N.dead=!0}}if(b.queue.length>=be){const N={dead:!1};return H({args:[...i],syncState:N},E,C(h)),()=>{N.dead=!0}}let P=null;const j={dead:!1};return b.queue.push({method:h,args:i,resolve:N=>{P=typeof N=="function"?N:null,j.dead&&P?.()},reject:()=>{},syncState:j}),()=>{j.dead=!0,P?.()}}:(...i)=>{const y=v[h]??v.__settled;return y?y(...i):O(h,i)}},set:()=>!1});yt[a]?.(v,(A,h)=>q[A](...h),O),b.ns=q,re(u,a,q)};for(const a of Object.keys(x)){if(u[a]!==void 0){re(u,a,u[a]);continue}p(a)}if(u.use===void 0){const a=_=>{if(typeof _!="string"||!Object.hasOwn(x,_))return Promise.resolve(null);const g=D.get(_);return g?g.u:Promise.resolve(u[_]??null)};try{Object.defineProperty(u,"use",{value:a,writable:!0,configurable:!0,enumerable:!1})}catch{}}let d=null,R=null,M=0;const w=a=>{a.source!==parent||!me(a.origin)||Fe(a.data)&&(d=a.data.__frame_init,U=a.origin,removeEventListener("message",w),clearTimeout(M),R?.())};addEventListener("message",w),parent.postMessage({__frame_connect:!0},"*");const k=setTimeout,I=clearTimeout;let m=()=>NaN,L=()=>[];try{m=performance.now.bind(performance),L=performance.getEntriesByType.bind(performance)}catch{}let S=0;const F=()=>{try{parent.postMessage({__frame_alive:!0},"*")}catch{}S=k(F,ft)},Ee=()=>I(S);F(),addEventListener("load",Ee,{once:!0});const bt=new Promise(a=>{R=a,M=setTimeout(()=>{removeEventListener("message",w),a()},ut)}),Ae=document.readyState==="loading"?new Promise(a=>document.addEventListener("DOMContentLoaded",()=>a(),{once:!0})):Promise.resolve(),Se=new WeakSet;addEventListener("error",a=>{a.target&&Se.add(a.target)},!0);const wt=()=>{let a=[];try{a=[...document.querySelectorAll("link[rel~=stylesheet]:not([rel~=alternate])")].filter(g=>!g.sheet&&!g.disabled&&!Se.has(g)&&g.getAttribute("href")&&URL.canParse(g.href)&&(!g.media||matchMedia(g.media).matches))}catch{}let _=a.length;return _===0?Promise.resolve():new Promise(g=>{try{const b=Z-m(),v=k(g,b>0?b<Z?b:Z:0),C=()=>{--_===0&&(I(v),g())};for(const O of a)O.addEventListener("load",C,{once:!0}),O.addEventListener("error",C,{once:!0})}catch{g()}})};Ae.then(()=>{try{f?.restore()}catch{}});const Oe={cb:null},Et=a=>{if(!(a.source!==parent||!me(a.origin))&&$e(a.data)){try{f?.promoted()}catch{}Oe.cb?.()}};addEventListener("message",Et),bt.then(async()=>{if(!d||!U){for(const i of D.keys())W(i,{code:"not_granted",message:"frame initialization did not arrive - capability unavailable"});return}if(_e(d.theme),d.hostVisible===!1&&e.then(i=>i?.applyHostVisible?.(!1,c)),d.hostKeys!==void 0){const i=U,y=d.hostKeys;e.then(P=>P?.installHostKeyForward?.(l,y,j=>parent.postMessage(j,i)))}const a=U;let _=!1,g=!1;addEventListener("message",i=>{if(i.source!==parent||i.origin!==a)return;if(Ke(i.data)&&_e(i.data.__frame_theme.theme),ze(i.data)){const j=i.data.__frame_host_visible.visible;e.then(N=>N?.applyHostVisible?.(j,c))}He(i.data)&&vt(i.data.__frame_patch,a,i.isTrusted);const y=i.data?.__fc_mode;y&&typeof y=="object"&&!_&&Q&&z.test(Q)&&(_=!0,K(Q).then(j=>j.install?.(a,y.on===!0)).catch(()=>{}));const P=i.data?.__ft_cmd;P&&typeof P=="object"&&!g&&ee&&z.test(ee)&&(g=!0,K(ee).then(j=>j.install?.(a,P)).catch(()=>{}))});const b=Object.keys(d.capabilities??{});for(const i of b)Object.hasOwn(x,i)||pt.test(i)&&u[i]===void 0&&(p(i),W(i,{code:"capability_disabled",message:"capability not in this runtime generation"}));const v=b.filter(i=>Object.hasOwn(x,i)).map(i=>[i,x[i]]).filter(i=>typeof i[1]=="string"&&z.test(i[1])),C=await Promise.allSettled(v.map(([,i])=>K(i))),O=await e,T=U;O?.buildBoot||parent.postMessage({__frame_cap_telemetry:{kind:"cap-load-error",cap:"_transforms"}},T),ge=O?.buildBoot?O.buildBoot(d,O.TRANSFORMS??{},{shellOrigin:T,mount:oe,hooks:V},i=>parent.postMessage({__frame_cap_telemetry:i},T)):gt(d,T);const q=(i,y)=>parent.postMessage({__frame_cap_telemetry:{kind:"cap-load-error",cap:i,phase:y}},T),A=i=>parent.postMessage({__frame_cap_recovered:{cap:i}},T);O?.buildBoot&&te.has($??"")&&A("_transforms");const h=ge;C.forEach((i,y)=>{const[P,j]=v[y];if(i.status!=="fulfilled"){q(P);return}te.has(j)&&A(P);try{i.value?.install?.(h)}catch{q(P,"install")}});for(const[i,y]of D)if(y.impl.__settled===void 0){if(b.includes(i)){W(i,{code:"capability_disabled",message:"capability not available in this session"});continue}W(i,{code:"not_granted",message:"capability not available in this session"})}await Ae,await wt(),Ee();const E=Te(L,m);parent.postMessage(E?{__frame_ready:!0,nav:E}:{__frame_ready:!0},U),e.then(i=>i?.installSizeReporter?.(T,Oe))})}})();</script><!-- /frame-runtime --><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}</style></head><body>
<title>Mudavym Identity</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>
  :root{
    --paper-0:#FAF7F1; --paper-1:#F3EFE6; --surface:#FFFFFF;
    --line:#E3DBCB; --line-strong:#D2C7B2; --line-control:#8F8674;
    --ink-1:#211C16; --ink-2:#4F473C; --ink-3:#736B5D;
    --seal:#1A5E6B; --seal-deep:#14515C; --seal-700:#10424C; --seal-50:#F1F7F8; --seal-400:#5FB0BC;
    --ok:#17795E; --warn:#A5670A; --risk:#B3261E; --calm:#6D28D9;
    --shadow:0 1px 2px rgba(33,28,22,.05), 0 8px 28px rgba(33,28,22,.06);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --paper-0:#15130F; --paper-1:#1D1813; --surface:#1D1813;
      --line:#302921; --line-strong:#3E362B; --line-control:#736B61;
      --ink-1:#EFE7D9; --ink-2:#C0B6A5; --ink-3:#918879;
      --seal:#5FB0BC; --seal-deep:#7DC3CD; --seal-700:#8FC4CD; --seal-50:#123138; --seal-400:#5FB0BC;
      --ok:#369174; --warn:#B5751D; --risk:#E1513F; --calm:#A05CFF;
      --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 28px rgba(0,0,0,.35);
    }
  }
  :root[data-theme="dark"]{
    --paper-0:#15130F; --paper-1:#1D1813; --surface:#1D1813;
    --line:#302921; --line-strong:#3E362B; --line-control:#736B61;
    --ink-1:#EFE7D9; --ink-2:#C0B6A5; --ink-3:#918879;
    --seal:#5FB0BC; --seal-deep:#7DC3CD; --seal-700:#8FC4CD; --seal-50:#123138; --seal-400:#5FB0BC;
    --ok:#369174; --warn:#B5751D; --risk:#E1513F; --calm:#A05CFF;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 28px rgba(0,0,0,.35);
  }

  *{box-sizing:border-box}
  body{
    margin:0; background:var(--paper-0); color:var(--ink-1);
    font-family:'DM Sans','Segoe UI',system-ui,sans-serif;
    font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:1080px; margin:0 auto; padding:0 28px 120px}
  h1,h2,h3{font-family:'Plus Jakarta Sans','Segoe UI',system-ui,sans-serif; margin:0; text-wrap:balance; letter-spacing:-.02em}
  code,.mono,td.v,th.v{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace; font-variant-numeric:tabular-nums}

  /* ── masthead ─────────────────────────────────────── */
  .mast{padding:88px 0 44px; border-bottom:1px solid var(--line)}
  .lock{display:flex; align-items:center; gap:20px}
  .lock .name{font-family:'Plus Jakarta Sans',sans-serif; font-weight:800; font-size:54px; letter-spacing:-.03em; line-height:1}
  .mast p{max-width:60ch; color:var(--ink-2); font-size:17px; margin:26px 0 0}
  .stamp{color:var(--seal)}

  /* ── section scaffolding ──────────────────────────── */
  section{padding-top:76px}
  .eyebrow{font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3); margin-bottom:12px}
  h2{font-size:30px; line-height:1.15}
  .lede{max-width:62ch; color:var(--ink-2); margin:14px 0 0; font-size:16px}
  .grid{display:grid; gap:20px; margin-top:32px}
  .card{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:24px}
  .cap{font-size:11px; font-weight:600; letter-spacing:.09em; text-transform:uppercase; color:var(--ink-3)}

  /* ── logo displays ────────────────────────────────── */
  .marks{grid-template-columns:1fr 1fr 1fr}
  .markbox{display:flex; flex-direction:column; gap:16px; align-items:flex-start}
  .onchar{background:#15130F; border-color:#302921}
  .onchar .cap{color:#918879}
  .sizes{display:flex; align-items:flex-end; gap:26px; flex-wrap:wrap; margin-top:26px}
  .sizes figure{margin:0; text-align:center; display:flex; flex-direction:column; align-items:center; gap:9px}
  .sizes figcaption{font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--ink-3)}
  .appicon{width:104px;height:104px;border-radius:23px;background:#15130F;display:flex;align-items:center;justify-content:center}
  .appicon.light{background:#1A5E6B}

  /* ── tables ───────────────────────────────────────── */
  .scroll{overflow-x:auto; margin-top:28px; border:1px solid var(--line); border-radius:12px; background:var(--surface)}
  table{border-collapse:collapse; width:100%; min-width:640px; font-size:14px}
  th{text-align:left; font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3);
     padding:14px 16px; border-bottom:1px solid var(--line); white-space:nowrap; background:var(--paper-1)}
  td{padding:13px 16px; border-bottom:1px solid var(--line); vertical-align:top}
  tr:last-child td{border-bottom:0}
  td.v{font-size:12.5px; white-space:nowrap; color:var(--ink-2)}
  td.num{text-align:right; font-family:'JetBrains Mono',monospace; font-variant-numeric:tabular-nums; white-space:nowrap}
  .sw{display:inline-block; width:15px; height:15px; border-radius:4px; vertical-align:-2px; margin-right:9px; border:1px solid rgba(33,28,22,.14)}
  .tokname{font-family:'JetBrains Mono',monospace; font-size:12.5px; font-weight:500; white-space:nowrap}

  /* ── seal ramp ────────────────────────────────────── */
  .ramp{display:grid; grid-template-columns:repeat(10,1fr); border-radius:12px; overflow:hidden; border:1px solid var(--line); margin-top:28px}
  .ramp div{height:88px; display:flex; align-items:flex-end; padding:9px; font-family:'JetBrains Mono',monospace; font-size:10px}

  /* ── callouts ─────────────────────────────────────── */
  .flag{border-left:3px solid var(--risk); background:var(--surface); border-radius:0 10px 10px 0;
        border-top:1px solid var(--line); border-right:1px solid var(--line); border-bottom:1px solid var(--line);
        padding:20px 24px; margin-top:24px}
  .flag h3{font-size:17px; margin-bottom:8px}
  .flag p{margin:0; color:var(--ink-2); font-size:14.5px}
  .rules{counter-reset:r; list-style:none; padding:0; margin:28px 0 0; display:grid; gap:2px;
         border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--surface)}
  .rules li{counter-increment:r; padding:16px 20px 16px 58px; position:relative; border-bottom:1px solid var(--line); font-size:14.5px}
  .rules li:last-child{border-bottom:0}
  .rules li::before{content:counter(r); position:absolute; left:20px; top:16px; font-family:'JetBrains Mono',monospace;
                    font-size:12px; color:var(--seal); font-weight:600}
  .stat{display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:1px; background:var(--line);
        border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-top:28px}
  .stat div{background:var(--surface); padding:20px}
  .stat b{display:block; font-family:'Plus Jakarta Sans',sans-serif; font-size:30px; font-weight:700; letter-spacing:-.02em;
          font-variant-numeric:tabular-nums; line-height:1.1}
  .stat span{font-size:12.5px; color:var(--ink-3); display:block; margin-top:5px}
  .chip{display:inline-flex; align-items:center; gap:7px; height:23px; padding:0 10px; border-radius:999px;
        font-size:12px; font-weight:600; white-space:nowrap; border:1px solid; color:#211C16}
  .dot{width:6px;height:6px;border-radius:999px;flex-shrink:0}
  footer{margin-top:96px; padding-top:28px; border-top:1px solid var(--line); color:var(--ink-3); font-size:13px}
  @media (max-width:820px){ .marks{grid-template-columns:1fr} .lock .name{font-size:38px} h2{font-size:24px} }
</style>

<div class="wrap">

  <div class="mast">
    <div class="lock">
      <div class="name">Mudavym</div>
    </div>
    <p>The exact set of colours the whole codebase is allowed to use, and where the mark stands. Every value here has been measured — contrast, perceptual distance and colour-vision simulation — against the three audits that ran alongside it.</p>
  </div>

  <!-- ═══ THE MARK ═══ -->
  <section>
    <div class="eyebrow">01 — The mark</div>
    <h2>Chosen, not yet drawable.</h2>
    <p class="lede">The founder selected a slab monogram — an M crossed by a diagonal, rounded outer corners against sharp inner ink traps. It exists only as a 1024px raster with letterpress grain baked into it. Until there is a vector original, nothing below it on this page can be specified, so this section states the position rather than pretending to a spec.</p>

    <div class="flag" style="border-left-color:var(--risk)">
      <h3>The previous mark was withdrawn.</h3>
      <p>The bowtie-between-posts form drawn on 29 August read as the Visual Studio Code mark — near enough that it would have followed the brand around. Founder caught it; it is dead, and it has been removed from this page rather than left as an alternative.</p>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card">
        <div class="cap">Three defects to resolve first</div>
        <ol class="rules" style="margin-top:14px;border:0">
          <li><b>The counters clog.</b> The corner ink traps are small and the two counters are irregular — they fill in by 24px and the mark is a blob at 16. This is the same defect the founder rejected on the previous mark.</li>
          <li><b>The bottom-left step returns.</b> An asymmetric notch that competes with the silhouette — again, the same objection, in a new position.</li>
          <li><b>Weight is uneven.</b> The left stem reads markedly heavier than the diagonal.</li>
        </ol>
      </div>
      <div class="card">
        <div class="cap">And one nobody has raised yet</div>
        <p style="font-size:14.5px;margin:12px 0 0"><b>It reads N before it reads M.</b> The diagonal dominates, so the eye resolves "N" or an "AN" ligature first. For a brand called Mudavym that is worth deciding deliberately rather than discovering later on a sign.</p>
        <div class="cap" style="margin-top:22px">Still missing</div>
        <p style="font-size:14.5px;margin:10px 0 0;color:var(--ink-2)">Vector source · wordmark lockup · a simplified cut for ≤24px · reversed and dark versions · clear-space rule · the approve-stamp state. The letterpress grain is a render artifact and must be flattened out.</p>
      </div>
    </div>

    <div class="flag" style="border-left-color:var(--warn)">
      <h3>What unblocks this.</h3>
      <p>Drop the mark into the repo as SVG — or as the largest PNG available — and the vector redraw, the size ladder, the two cuts and the lockup all follow from it. Hand-tracing from the 1024px raster was attempted and abandoned: it was not a good enough likeness to serve as a brand's source of truth, and a logo that is approximately itself is worse than no logo.</p>
    </div>
  </section>

  <!-- ═══ THE PALETTE ═══ -->
  <section>
    <div class="eyebrow">02 — The palette</div>
    <h2>Every colour the codebase may use.</h2>
    <p class="lede">This list is closed. A colour that is not on it does not ship. Eleven values changed after the contrast audit ran — those rows are marked, and the reason is in section 03.</p>

    <div class="ramp">
      <div style="background:#F1F7F8;color:#10424C">50</div><div style="background:#E0EFF1;color:#10424C">100</div>
      <div style="background:#BEDDE2;color:#08262C">200</div><div style="background:#8FC4CD;color:#08262C">300</div>
      <div style="background:#5FB0BC;color:#08262C">400</div><div style="background:#1A5E6B;color:#fff">500 · #1A5E6B</div>
      <div style="background:#14515C;color:#fff">600</div><div style="background:#10424C;color:#fff">700</div>
      <div style="background:#0C343C;color:#fff">800</div><div style="background:#08262C;color:#fff">900</div>
    </div>

    <div class="scroll">
      <table>
        <thead><tr><th>Token</th><th>Light</th><th>Dark</th><th>What it is for</th></tr></thead>
        <tbody>
          <tr><td class="tokname">--paper-0</td><td class="v"><span class="sw" style="background:#FAF7F1"></span>#FAF7F1</td><td class="v"><span class="sw" style="background:#15130F"></span>#15130F</td><td>Page ground. Dark is Warm Charcoal.</td></tr>
          <tr><td class="tokname">--paper-1</td><td class="v"><span class="sw" style="background:#F3EFE6"></span>#F3EFE6</td><td class="v"><span class="sw" style="background:#1D1813"></span>#1D1813</td><td>Sunk wells, table zebra, inset panels.</td></tr>
          <tr><td class="tokname">--paper-2</td><td class="v"><span class="sw" style="background:#EAE4D8"></span>#EAE4D8</td><td class="v"><span class="sw" style="background:#262019"></span>#262019</td><td>Second-level surface.</td></tr>
          <tr><td class="tokname">--surface</td><td class="v"><span class="sw" style="background:#FFFFFF"></span>#FFFFFF</td><td class="v"><span class="sw" style="background:#1D1813"></span>#1D1813</td><td>Cards, sheets, rows.</td></tr>
          <tr><td class="tokname">--line</td><td class="v"><span class="sw" style="background:#E3DBCB"></span>#E3DBCB</td><td class="v"><span class="sw" style="background:#302921"></span>#302921</td><td>Decorative hairline <em>only</em>. Never borders a control.</td></tr>
          <tr><td class="tokname">--line-strong</td><td class="v"><span class="sw" style="background:#D2C7B2"></span>#D2C7B2</td><td class="v"><span class="sw" style="background:#3E362B"></span>#3E362B</td><td>Dividers that must read at a glance.</td></tr>
          <tr><td class="tokname">--line-control <b style="color:var(--seal)">NEW</b></td><td class="v"><span class="sw" style="background:#8F8674"></span>#8F8674</td><td class="v"><span class="sw" style="background:#736B61"></span>#736B61</td><td>The border of any input, select or field. 3.37 : 1.</td></tr>
          <tr><td class="tokname">--ink-1</td><td class="v"><span class="sw" style="background:#211C16"></span>#211C16</td><td class="v"><span class="sw" style="background:#EFE7D9"></span>#EFE7D9</td><td>Primary text, headings, numbers, every chip label.</td></tr>
          <tr><td class="tokname">--ink-2</td><td class="v"><span class="sw" style="background:#4F473C"></span>#4F473C</td><td class="v"><span class="sw" style="background:#C0B6A5"></span>#C0B6A5</td><td>Secondary text, labels.</td></tr>
          <tr><td class="tokname">--ink-3 <b style="color:var(--seal)">CHANGED</b></td><td class="v"><span class="sw" style="background:#736B5D"></span>#736B5D</td><td class="v"><span class="sw" style="background:#918879"></span>#918879</td><td>Muted, captions, placeholder. Was #7C7365 — failed AA as placeholder.</td></tr>
          <tr><td class="tokname">--seal-500</td><td class="v"><span class="sw" style="background:#1A5E6B"></span>#1A5E6B</td><td class="v"><span class="sw" style="background:#5FB0BC"></span>#5FB0BC</td><td>The brand. Buttons, active rail, mark, focus ring.</td></tr>
          <tr><td class="tokname">--ok</td><td class="v"><span class="sw" style="background:#17795E"></span>#17795E</td><td class="v"><span class="sw" style="background:#369174"></span>#369174</td><td>Confirmed, in stock, on budget.</td></tr>
          <tr><td class="tokname">--warn</td><td class="v"><span class="sw" style="background:#A5670A"></span>#A5670A</td><td class="v"><span class="sw" style="background:#B5751D"></span>#B5751D</td><td>Dots, borders, icons. Never a word.</td></tr>
          <tr><td class="tokname">--warn-text <b style="color:var(--seal)">NEW</b></td><td class="v"><span class="sw" style="background:#9C5F00"></span>#9C5F00</td><td class="v" style="color:var(--ink-3)">use --warn</td><td>Warn-coloured prose. --warn itself only reaches 4.13.</td></tr>
          <tr><td class="tokname">--risk</td><td class="v"><span class="sw" style="background:#B3261E"></span>#B3261E</td><td class="v"><span class="sw" style="background:#E1513F"></span>#E1513F</td><td>Breach, expired, failed, over budget.</td></tr>
          <tr><td class="tokname">--calm <b style="color:var(--seal)">CHANGED</b></td><td class="v"><span class="sw" style="background:#6D28D9"></span>#6D28D9</td><td class="v"><span class="sw" style="background:#A05CFF"></span>#A05CFF</td><td>Anything the platform did unasked. Was #6B5F8A — read as a shade of the brand.</td></tr>
          <tr><td class="tokname">--info <b style="color:var(--risk)">RETIRED</b></td><td class="v" colspan="2" style="color:var(--ink-2)">no hue — <span class="mono">--ink-1</span> mark + <span class="mono">--line-control</span> rule</td><td>The blue #2F58E0 was 6.3 from a selected row. Informational is now achromatic.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:20px">
      <div class="card">
        <div class="cap">Chip anatomy — label is always ink-1</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:14px">
          <span class="chip" style="background:#E9F5F1;border-color:#17795E"><span class="dot" style="background:#17795E"></span>Confirmed</span>
          <span class="chip" style="background:#FBF1DF;border-color:#A5670A"><span class="dot" style="background:#A5670A"></span>Low stock</span>
          <span class="chip" style="background:#FBEAE8;border-color:#B3261E"><span class="dot" style="background:#B3261E"></span>Short-shipped</span>
          <span class="chip" style="background:#F7EFFF;border-color:#6D28D9"><span class="dot" style="background:#6D28D9"></span>Drafted by Mudavym</span>
        </div>
        <p style="font-size:13.5px;color:var(--ink-2);margin:16px 0 0">The colour never carries the text. Label in <span class="mono">ink-1</span> reads at 14.5–15.1 : 1 on every tint, so the hue only has to clear the 3.0 non-text bar.</p>
      </div>
      <div class="card">
        <div class="cap">Selection is a rail, never a tint</div>
        <div style="margin-top:14px;border:1px solid var(--line);border-radius:8px;overflow:hidden">
          <div style="padding:10px 14px;border-bottom:1px solid var(--line);color:var(--ink-2);font-size:14px">Inventory</div>
          <div style="padding:10px 14px;border-bottom:1px solid var(--line);box-shadow:inset 3px 0 0 var(--seal);background:var(--seal-50);color:var(--seal-700);font-weight:600;font-size:14px">Orders</div>
          <div style="padding:10px 14px;color:var(--ink-2);font-size:14px">Receiving</div>
        </div>
        <p style="font-size:13.5px;color:var(--ink-2);margin:16px 0 0">The <span class="mono">seal-50</span> fill alone measures <b>1.01 : 1</b> against the page — invisible. The 3px rail carries the state at 7.35, the label at 10.18.</p>
      </div>
    </div>
  </section>

  <!-- ═══ WHAT THE AUDIT CHANGED ═══ -->
  <section>
    <div class="eyebrow">03 — What measurement changed</div>
    <h2>Eleven defects, none of them visible by eye.</h2>
    <p class="lede">The palette was locked before it was measured. These are the failures that came back, each with the value that fixes it.</p>

    <div class="scroll">
      <table>
        <thead><tr><th>Failure</th><th class="num">Was</th><th>Fix</th><th class="num">Now</th></tr></thead>
        <tbody>
          <tr><td>Focus ring sat on a fill of its own colour — keyboard focus on the primary button was invisible</td><td class="num">1.00</td><td>2px ground-coloured gap, then the seal ring outside it</td><td class="num">6.87</td></tr>
          <tr><td>No token could legally border a control — form fields had no perceivable edge</td><td class="num">1.29</td><td>New <span class="mono">--line-control</span></td><td class="num">3.37</td></tr>
          <tr><td>Active-nav tint invisible against the page</td><td class="num">1.01</td><td>3px seal rail + seal-700 label</td><td class="num">7.35</td></tr>
          <tr><td>Dark mode had no semantic layer at all</td><td class="num">2.69</td><td>Derived dark set</td><td class="num">4.64</td></tr>
          <tr><td>White label on the dark primary button</td><td class="num">2.49</td><td>Label is <span class="mono">paper-0</span></td><td class="num">7.44</td></tr>
          <tr><td><span class="mono">ink-3</span> failed AA as placeholder text</td><td class="num">4.07</td><td>#7C7365 → #736B5D</td><td class="num">4.92</td></tr>
          <tr><td><span class="mono">warn</span> as a word</td><td class="num">4.13</td><td>Split off <span class="mono">--warn-text</span></td><td class="num">4.63</td></tr>
          <tr><td><span class="mono">calm</span> was a shade of the brand for ~6% of men</td><td class="num">7.7 ΔE</td><td>#6B5F8A → #6D28D9 + a glyph</td><td class="num">16.6 ΔE</td></tr>
          <tr><td>An informational chip <em>was</em> a selected row</td><td class="num">6.3 ΔE</td><td>Retire the blue; go achromatic</td><td class="num">20.3 ΔE</td></tr>
        </tbody>
      </table>
    </div>

    <div class="flag">
      <h3>One defect has no colour fix.</h3>
      <p><span class="mono">warn</span> and <span class="mono">risk</span> collapse to <b>7.7 ΔE under deuteranopia</b>, and 3.2 in dark mode. Every amber tested either makes that worse or fails contrast; moving <span class="mono">risk</span> to crimson then collides with the achromatic informational. Amber and red must always carry <b>distinct icons</b> — the colour is redundant, not load-bearing.</p>
    </div>
  </section>

  <!-- ═══ RULES ═══ -->
  <section>
    <div class="eyebrow">04 — The rules tokens cannot enforce</div>
    <h2>Six rules a linter will never catch.</h2>
    <ol class="rules">
      <li>A focus ring never sits directly on a fill of its own colour — always a ground-coloured gap between.</li>
      <li>Selection is a rail plus a label colour. Never a tint alone.</li>
      <li>A chip's label is <span class="mono">ink-1</span>, never the semantic colour.</li>
      <li><span class="mono">warn</span> and <span class="mono">risk</span> always carry distinct icons.</li>
      <li><span class="mono">calm</span> always carries its own glyph — colour alone cannot mark autonomous action.</li>
      <li><span class="mono">line</span> and <span class="mono">line-strong</span> never border a control. That is what <span class="mono">line-control</span> is for.</li>
    </ol>
  </section>

  <!-- ═══ COST ═══ -->
  <section>
    <div class="eyebrow">05 — What the migration actually costs</div>
    <h2>This is not a find-and-replace.</h2>
    <p class="lede">Two audits swept the codebase. The headline is that re-pointing the brand scale moves about a tenth of the colour decisions in the web app.</p>

    <div class="stat">
      <div><b>16,993</b><span>colour decision sites, web</span></div>
      <div><b>297</b><span>files, web</span></div>
      <div><b>10.8%</b><span>use the brand scale</span></div>
      <div><b>10</b><span>distinct "brand primaries" outside the web app</span></div>
      <div><b>391</b><span>sites needing brand-vs-error triage</span></div>
      <div><b>858</b><span>sites across mobile, email, UI package</span></div>
    </div>

    <div class="flag">
      <h3>The brand colour and the error colour are the same colour.</h3>
      <p><span class="mono">wine</span>, <span class="mono">brand</span>, <span class="mono">red</span> and <span class="mono">danger</span> are four byte-identical scales, and <span class="mono">--destructive</span> resolves to <span class="mono">--primary</span>. A burgundy brand made that survivable; a teal one does not. Every one of the 391 sites has to be read and classified by hand before the swap — a codemod cannot tell "delete" from "our brand".</p>
    </div>

    <div class="flag">
      <h3>Editing the shared UI package changes nothing.</h3>
      <p><span class="mono">packages/ui</span> ships its own Tailwind config and <span class="mono">globals.css</span>, but the package builds with no CSS step and <span class="mono">dist/</span> has no stylesheet. Its 109 colour classes resolve against the web app's config instead. Changing those 50 hex values moves <b>zero pixels</b> — and would look like a completed migration.</p>
    </div>

    <div class="flag">
      <h3>Every transactional email is brown, and the database will keep it that way.</h3>
      <p>The email brand colour is <span class="mono">#7c2d12</span> — Tailwind <span class="mono">orange-900</span>, commented "Wine/burgundy — main brand color". It is also the default in <span class="mono">restaurant_branding.primary_color</span>, and the template builder prefers the database row over the code constant. Shipping İznik without a data migration means tenants keep sending brown-headed mail.</p>
    </div>

    <div class="flag">
      <h3>The app icons are a colour that exists in no source file.</h3>
      <p><span class="mono">#722F37</span> is 95% of every web PWA icon; mobile's icon and splash are 98–100% <span class="mono">#6B1B3D</span>, which already clashes with the <span class="mono">#7C1D3C</span> splash ground behind it on every cold launch. There is no vector source anywhere in the repo, so these are redrawn from the mark above, not recoloured. Mobile then needs an EAS build and a store release — the longest lead time in the whole migration, worth starting first.</p>
    </div>
  </section>

  <!-- ═══ FORKS ═══ -->
  <section>
    <div class="eyebrow">06 — Still yours to decide</div>
    <h2>Three forks the numbers can't close.</h2>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
      <div class="card">
        <div class="cap">Autonomous action</div>
        <p style="font-size:14.5px;margin:10px 0 0">Keep a sixth hue at <span class="mono">#6D28D9</span> plus a mandatory glyph, or drop the hue entirely and mark what the platform did structurally — a dashed seal rule and the mark itself. The second is more robust and costs a colour.</p>
      </div>
      <div class="card">
        <div class="cap">Informational</div>
        <p style="font-size:14.5px;margin:10px 0 0">Going achromatic removes a colour from the kit. An informational note becomes page-coloured with a rule. The measurement supports it; you have not seen it on screen yet.</p>
      </div>
      <div class="card">
        <div class="cap">Green-teal for "ok"</div>
        <p style="font-size:14.5px;margin:10px 0 0"><span class="mono">ok</span> sits 19.5 ΔE from the brand — thin for status-versus-brand. Moving it to a true green makes red-green deficiency far worse. The alternative is to stop using the seal anywhere it could read as a status.</p>
      </div>
    </div>
  </section>

  <footer>
    Mudavym identity · palette ADR 0042 · mark ADR 0043 (form withdrawn, see 01) · measured against COLOR-AUDIT-WEB, COLOR-AUDIT-PLATFORM and COLOR-CONTRAST-REPORT · 29 August 2026
  </footer>
</div>

</body></html>