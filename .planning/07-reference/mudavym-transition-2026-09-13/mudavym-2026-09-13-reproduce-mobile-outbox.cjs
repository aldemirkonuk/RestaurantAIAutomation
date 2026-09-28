/* Read-only, no-network control-flow reproduction. Runs current outbox source
 * in a VM with fake storage, API, Zustand and clock. It never loads app auth,
 * native code, credentials, or real HTTP. Not a backend authorization test. */
const { execFileSync } = require('child_process');
const vm = require('vm');
const ts = require(require('path').join(require('child_process').execFileSync('git',['rev-parse','--show-toplevel'],{cwd:__dirname,encoding:'utf8'}).trim(),'apps/api-gateway/node_modules/typescript'));
const source = 'apps/mobile/src/state/outbox.ts';
const sourceText = execFileSync('git', ['show', '60ed83a7e6d5eb8b8e0e631783a598cd0f562bff:' + source], { cwd: require('child_process').execFileSync('git',['rev-parse','--show-toplevel'],{cwd:__dirname,encoding:'utf8'}).trim(), encoding: 'utf8' });
const js = ts.transpileModule(sourceText, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
async function scenario(kind) {
  let state, principal = { user: 'A', restaurant: 'A', status: 'signedIn' };
  let timer = null;
  const calls = [], disk = new Map();
  const api = async (path, options) => calls.push({ path, ...principal });
  class ApiError extends Error {}
  const create = init => {
    const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = init(set, () => state);
    const store = selector => selector(state);
    store.getState = () => state; store.setState = set;
    return store;
  };
  const exports = {};
  const allowed = {
    zustand: { create },
    '@/api/client': { api, ApiError },
    '@/api/delivered-once': { alreadyDeliveredRefusal: () => null, alreadyDeliveredWords: () => '' },
    '@/design/motion': { GRACE_MS: 5000 },
    '@/lib/mmkv': { outboxStorage: { set: (k,v) => disk.set(k,v), getString: k => disk.get(k), delete: k => disk.delete(k) } },
    '@/lib/queryClient': { queryClient: { invalidateQueries: () => {} } },
  };
  vm.runInNewContext(js, {
    exports,
    require: key => { if (!(key in allowed)) throw new Error('Unexpected import: '+key); return allowed[key]; },
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; },
  }, { filename: source });
  exports.useOutbox.getState().enqueue({ path: '/synthetic-audit-action', label: 'Synthetic action A' });
  principal = kind === 'locked'
    ? { user: 'A', restaurant: 'A', status: 'locked' }
    : { user: 'B', restaurant: 'B', status: 'signedIn' };
  const callback = timer; timer = null; await callback();
  return { scenario: kind, queuedBy: 'A', apiCalls: calls, backendAcceptance: 'not tested; API mocked' };
}
(async () => {
  console.log(JSON.stringify(await scenario('locked'), null, 2));
  console.log(JSON.stringify(await scenario('account_changed'), null, 2));
})().catch(e => { console.error(e.message); process.exitCode=1; });
