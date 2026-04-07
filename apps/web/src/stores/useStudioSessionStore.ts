import { create } from 'zustand'

export interface WineRecord {
  id: string
  submission_id: string
  wine_name: string | null
  vintage: string | null
  producer: string | null
  region: string | null
  country: string | null
  grape_variety: string | null
  color: string | null
  primary_type: string | null
  sweetness_level: string | null
  price_bottle: string | null
  price_glass: string | null
  field_confidence: Record<string, { value: string | null; confidence: number | null; source: string | null }> | null
}

interface EditingCell {
  recordId: string
  field: string
}

interface StudioSessionState {
  sessionId: string | null
  scanSessionId: string | null
  records: WineRecord[]
  isExtracting: boolean
  extractionError: string | null
  editingCell: EditingCell | null
  setSession: (sessionId: string, scanSessionId: string | null) => void
  setRecords: (records: WineRecord[]) => void
  setIsExtracting: (v: boolean) => void
  setExtractionError: (err: string | null) => void
  setEditingCell: (cell: EditingCell | null) => void
  clearSession: () => void
}

export const useStudioSessionStore = create<StudioSessionState>((set) => ({
  sessionId: null,
  scanSessionId: null,
  records: [],
  isExtracting: false,
  extractionError: null,
  editingCell: null,
  setSession: (sessionId, scanSessionId) => set({ sessionId, scanSessionId }),
  setRecords: (records) => set({ records }),
  setIsExtracting: (v) => set({ isExtracting: v }),
  setExtractionError: (err) => set({ extractionError: err }),
  setEditingCell: (cell) => set({ editingCell: cell }),
  clearSession: () => set({
    sessionId: null,
    scanSessionId: null,
    records: [],
    isExtracting: false,
    extractionError: null,
    editingCell: null,
  }),
}))
