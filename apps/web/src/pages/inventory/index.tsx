// The page component is imported directly from `./command/InventoryCommandPage`
// (App.tsx). Re-exporting it here would close a cycle, since that module imports
// `useInventoryPage` from this barrel.
export { useInventoryPage } from './useInventoryPage'
export type { InventoryItem, ViewMode, SortField, SortOrder, UseInventoryPageOptions } from './useInventoryPage'
