import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, MapPin } from 'lucide-react'
import { useAuth, type RestaurantBranch } from '../../contexts/AuthContext'
import { Popover } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import { useSyncManager } from '../../hooks/useSyncManager'

interface RestaurantBranchSwitcherProps {
  /**
   * `compact` keeps a phone-width trigger short: the house's name, truncated,
   * without its letter tile or its chain and city line (F-1184 — the letter
   * alone did not say which house the page was in).
   */
  compact?: boolean
  className?: string
}

export function RestaurantBranchSwitcher({ compact = true, className }: RestaurantBranchSwitcherProps) {
  const { activeRestaurantId, availableRestaurants, setActiveRestaurantId, activeRole } = useAuth()
  // F-913: only an owner may open a location (the gateway refuses anyone
  // else, F-242), so only an owner is offered the link. F-1570: the owner of
  // the business, not a house owner by invite, whom the gateway also refuses.
  const canAddLocation =
    activeRole === 'owner' &&
    availableRestaurants.find((b) => b.id === activeRestaurantId)?.organization_owner === true
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  // A refused switch: the house asked for and the house the page was in.
  const [refused, setRefused] = useState<{ to: string; from: string | null } | null>(null)
  // F-1036: only the latest switch may report. An earlier one answers "not
  // opened" when a later pick supersedes it, and that is not a refusal.
  const switchSeq = useRef(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shell = useMudavymShell()
  // F-1259: this person's changes queued in another house wait there unseen;
  // each house row says how many, and tapping it is the switch.
  const { waitingElsewhere = [], refresh } = useSyncManager()
  const waitingIn = (id: string) => waitingElsewhere.find((w) => w.restaurantId === id)?.count ?? 0

  const branchGroups = useMemo(() => {
    const chains: Record<string, { chainName: string; branches: RestaurantBranch[] }> = {}
    const standalone: RestaurantBranch[] = []
    availableRestaurants.forEach((b) => {
      if (b.chain_id && b.chain_name) {
        if (!chains[b.chain_id]) chains[b.chain_id] = { chainName: b.chain_name, branches: [] }
        chains[b.chain_id].branches.push(b)
      } else {
        standalone.push(b)
      }
    })
    return { chains: Object.values(chains), standalone }
  }, [availableRestaurants])

  if (availableRestaurants.length <= 1) return null

  const activeBranch = availableRestaurants.find((b) => b.id === activeRestaurantId)
  const activeChainName = activeBranch?.chain_name
  const subtitle = [activeChainName, activeBranch?.city].filter(Boolean).join(' · ')
  const initial = (activeBranch?.name ?? 'L')[0].toUpperCase()

  const handleSwitch = async (branchId: string) => {
    const seq = ++switchSeq.current
    const from = activeRestaurantId
    setIsSwitching(true)
    setOpen(false)
    setRefused(null)
    const ok = await setActiveRestaurantId(branchId)
    if (ok) void refresh?.()
    if (seq !== switchSeq.current) return
    setIsSwitching(false)
    // A refused switch stays in this house and says so (ADR 0164, R6); the
    // page used to relabel itself anyway.
    if (!ok) setRefused({ to: branchId, from })
  }

  // Said in the house the page is in now, and dropped once it is elsewhere.
  const refusal =
    refused && refused.from === activeRestaurantId
      ? `Couldn't open ${availableRestaurants.find((b) => b.id === refused.to)?.name ?? 'that house'}. You're still in ${activeBranch?.name ?? 'this house'}.`
      : null

  return (
    <div className={className ?? 'relative'}>
      {refusal && (
        // F-1184: anchored to the trigger's right edge, which sits at the
        // header's right, and wrapped, so a long house name stays on screen.
        <p role="alert" className="absolute right-0 top-full mt-1 z-50 w-max max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal break-words rounded-lg bg-white px-2 py-1 text-[11px] text-red-700 shadow-sm">
          {refusal}
        </p>
      )}
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-3 pl-3 pr-2.5 py-1.5 bg-white border border-gray-200 hover:border-wine-300 hover:shadow-sm rounded-xl transition-all"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={activeBranch ? `Switch location. Now in ${activeBranch.name}` : 'Switch location'}
      >
        <div
          className={`w-7 h-7 rounded-lg bg-wine-50 items-center justify-center flex-shrink-0 ${
            compact && !isSwitching ? 'hidden sm:flex' : 'flex'
          }`}
        >
          {isSwitching ? (
            <div className="w-3.5 h-3.5 border-2 border-wine-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="text-xs font-bold text-wine-600">{initial}</span>
          )}
        </div>
        <div className="text-left min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-tight max-w-[96px] sm:max-w-[120px] truncate">
            {activeBranch?.name ?? 'Switch Branch'}
          </p>
          {subtitle && (
            <p className={`text-[11px] text-gray-400 leading-tight truncate max-w-[120px] ${compact ? 'hidden sm:block' : ''}`}>
              {subtitle}
            </p>
          )}
        </div>
        <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-wine-500 ml-1 transition-colors" />
      </button>

      {shell.on ? (
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          label="Switch location"
          width={330}
          eyebrow={`${availableRestaurants.length} location${availableRestaurants.length !== 1 ? 's' : ''}${
            branchGroups.chains.length > 0
              ? ` across ${branchGroups.chains.length} chain${branchGroups.chains.length !== 1 ? 's' : ''}`
              : ''
          }`}
          title="Switch location"
          showClose={false}
          footer={
            <span style={{ display: 'flex', justifyContent: canAddLocation ? 'space-between' : 'flex-end', gap: 12 }}>
              {canAddLocation && (
                <button
                  type="button"
                  className="mdv-link"
                  style={{ color: 'var(--ink-4)' }}
                  onClick={() => {
                    navigate('/settings?tab=locations&action=add')
                    setOpen(false)
                  }}
                >
                  Add location
                </button>
              )}
              <button
                type="button"
                className="mdv-link"
                onClick={() => {
                  navigate('/settings')
                  setOpen(false)
                }}
              >
                Manage locations
              </button>
            </span>
          }
        >
          {branchGroups.chains.map(({ chainName, branches }) => (
            <div key={chainName}>
              <span className="mdv-sect">{chainName}</span>
              {branches.map((branch) => (
                <HouseBranchRow
                  key={branch.id}
                  branch={branch}
                  isActive={branch.id === activeRestaurantId}
                  waiting={waitingIn(branch.id)}
                  onSelect={() => void handleSwitch(branch.id)}
                />
              ))}
            </div>
          ))}
          {branchGroups.standalone.length > 0 && (
            <div>
              {branchGroups.chains.length > 0 && <span className="mdv-sect">Other locations</span>}
              {branchGroups.standalone.map((branch) => (
                <HouseBranchRow
                  key={branch.id}
                  branch={branch}
                  isActive={branch.id === activeRestaurantId}
                  waiting={waitingIn(branch.id)}
                  onSelect={() => void handleSwitch(branch.id)}
                />
              ))}
            </div>
          )}
        </Popover>
      ) : null}

      <AnimatePresence>
        {open && !shell.on && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.18),0_4px_16px_-4px_rgba(0,0,0,0.08)] border border-gray-100 overflow-hidden z-50"
            >
              <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-900">Switch Location</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {availableRestaurants.length} location{availableRestaurants.length !== 1 ? 's' : ''}
                    {branchGroups.chains.length > 0
                      ? ` across ${branchGroups.chains.length} chain${branchGroups.chains.length !== 1 ? 's' : ''}`
                      : ''}
                  </p>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" title="Live sync" />
              </div>

              <div className="max-h-72 overflow-y-auto py-2">
                {branchGroups.chains.map(({ chainName, branches }) => (
                  <div key={chainName} className="px-3 pt-2 pb-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.12em]">
                        {chainName}
                      </span>
                      <span className="flex-1 h-px bg-gray-100" />
                      <span className="text-[10px] text-gray-300">
                        {branches.length} location{branches.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {branches.map((branch) => (
                      <BranchRow
                        key={branch.id}
                        branch={branch}
                        isActive={branch.id === activeRestaurantId}
                        waiting={waitingIn(branch.id)}
                        onSelect={() => void handleSwitch(branch.id)}
                      />
                    ))}
                  </div>
                ))}

                {branchGroups.standalone.length > 0 && (
                  <div className="px-3 pb-2">
                    {branchGroups.chains.length > 0 && (
                      <div className="flex items-center gap-2 mb-2 mt-1">
                        <div className="flex-1 h-px bg-gray-100" />
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.12em]">
                          Other Locations
                        </span>
                        <div className="flex-1 h-px bg-gray-100" />
                      </div>
                    )}
                    {branchGroups.standalone.map((branch) => (
                      <BranchRow
                        key={branch.id}
                        branch={branch}
                        isActive={branch.id === activeRestaurantId}
                        waiting={waitingIn(branch.id)}
                        onSelect={() => void handleSwitch(branch.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className={`border-t border-gray-100 px-4 py-2.5 flex items-center ${canAddLocation ? 'justify-between' : 'justify-end'} bg-gray-50/50`}>
                {canAddLocation && (
                  <button
                    type="button"
                    onClick={() => {
                      navigate('/settings?tab=locations&action=add')
                      setOpen(false)
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
                  >
                    <MapPin className="w-3 h-3" />
                    Add location
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    navigate('/settings')
                    setOpen(false)
                  }}
                  className="text-xs text-wine-600 hover:text-wine-700 font-semibold transition-colors"
                >
                  Manage Locations →
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The house row. `BranchRow` below is the legacy one, untouched. */
function HouseBranchRow({
  branch,
  isActive,
  waiting = 0,
  onSelect,
}: {
  branch: RestaurantBranch
  isActive: boolean
  /** This person's changes queued there on this device (F-1259). */
  waiting?: number
  onSelect: () => void
}) {
  return (
    <button type="button" className="mdv-item" data-active={isActive} onClick={onSelect}>
      <span className="mdv-item__text">
        <span className="mdv-item__label">{branch.name}</span>
        {branch.city && <span className="mdv-item__sub">{branch.city}</span>}
      </span>
      {waiting > 0 && <span className="mdv-kbd">{waiting} waiting</span>}
      {isActive && <span className="mdv-kbd">here</span>}
    </button>
  )
}

function BranchRow({
  branch,
  isActive,
  waiting = 0,
  onSelect,
}: {
  branch: RestaurantBranch
  isActive: boolean
  waiting?: number
  onSelect: () => void
}) {
  const init = (branch.name ?? 'L')[0].toUpperCase()
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1.5 transition-colors text-left ${isActive ? 'bg-wine-50 border border-wine-100' : 'hover:bg-gray-50'}`}
    >
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${isActive ? 'bg-wine-600 text-white' : 'bg-gray-200 text-gray-500'}`}
      >
        {init}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${isActive ? 'text-wine-900' : 'text-gray-800'}`}>
          {branch.name}
        </p>
        {branch.city && (
          <p className={`text-xs truncate ${isActive ? 'text-wine-500' : 'text-gray-400'}`}>{branch.city}</p>
        )}
      </div>
      {waiting > 0 && (
        <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">
          {waiting} waiting
        </span>
      )}
      {isActive && (
        <span className="text-[10px] font-semibold text-wine-600 bg-wine-100 px-2 py-0.5 rounded-full flex-shrink-0">
          Active
        </span>
      )}
    </button>
  )
}
