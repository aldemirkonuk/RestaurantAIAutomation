import { mergeConfig } from 'vite'
import original from './vite.config'
export default mergeConfig(original, {cacheDir:'/tmp/mudavym-arrival-vite-cache',build:{outDir:'/tmp/mudavym-arrival-build',emptyOutDir:true,rollupOptions:{input:'.arrival-fixture.html'}}})
