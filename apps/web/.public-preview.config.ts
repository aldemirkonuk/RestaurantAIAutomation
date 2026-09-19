import { mergeConfig } from 'vite'
import original from './vite.config'
export default mergeConfig(original, { cacheDir: '/tmp/mudavym-public-vite-cache', server: { port: 5275, strictPort: true } })
