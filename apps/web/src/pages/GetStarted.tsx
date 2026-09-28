import { useState, useEffect, lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera,
  FileSpreadsheet,
  PenLine,
  Check,
  Wine,
  Package,
  ShoppingCart,
  Truck,
  Users,
  Bot,
  Shield,
  ArrowRight,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { MenuImportCard } from '../components/onboarding/MenuImportCard'
import { MenuScanUpload } from '../components/onboarding/MenuScanUpload'
import { MenuCsvUpload } from '../components/onboarding/MenuCsvUpload'
import { MenuManualEntry } from '../components/onboarding/MenuManualEntry'
import { MenuReviewScreen } from '../components/onboarding/MenuReviewScreen'
import { ThresholdStep } from '../components/onboarding/ThresholdStep'
import { OptionalTail } from '../components/onboarding/OptionalTail'
import { StaffWelcome } from '../components/onboarding/StaffWelcome'
import { useOnboardingProgress } from '../hooks/queries/useOnboardingProgress'
import { useAuth } from '../contexts/AuthContext'
import type { MenuImportResult } from '../services/api/menus'
import { trackGuidance } from '../guidance/analytics'
import { cn } from '../lib/utils'
import { BrandMark } from '../components/brand/BrandMark'
import { useMudavymDesign } from '../lib/mudavym/useMudavymDesign'

// Flag-gated and lazy: with `mudavym_design_cellar` off this chunk is never
// requested, so the legacy onboarding bundle is unchanged.
const CellarRegistersOnboarding = lazy(
  () => import('../components/onboarding/CellarRegistersOnboarding'),
)

type ImportMethod = 'scan' | 'csv' | 'manual'
type TabId = 'activate' | 'use'

function SuccessScreen({
  result,
  restaurantId,
  onContinueGuide,
  onInventory,
}: {
  result: MenuImportResult
  restaurantId: string
  onContinueGuide: () => void
  onInventory: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col items-center px-8 py-12 bg-white overflow-y-auto">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', duration: 0.5 }}
        className="flex flex-col items-center text-center w-full max-w-lg"
      >
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          We found {result.itemsExtracted} wine{result.itemsExtracted !== 1 ? 's' : ''}!
        </h1>
        <p className="text-gray-500 text-center max-w-sm mb-8">
          Your wine list is uploaded and your inventory is live. Next, learn how to use Mudavym
          day to day.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onInventory}>
            View Inventory
          </Button>
          <Button
            onClick={onContinueGuide}
            className="bg-wine-600 hover:bg-wine-500 text-white"
          >
            How to use the app →
          </Button>
        </div>

        <div className="w-full">
          <OptionalTail restaurantId={restaurantId} />
        </div>
      </motion.div>
    </div>
  )
}

const USE_CARDS = [
  {
    id: 'import',
    title: 'Import your wine list',
    description: 'Scan, CSV, or manual entry — the foundation for accurate inventory.',
    icon: Wine,
    action: 'activate' as const,
    label: 'Activate',
    ownerOnly: true,
  },
  {
    id: 'inventory',
    title: 'Check inventory & alerts',
    description: 'See stock levels, low-stock signals, and cellar locations.',
    icon: Package,
    href: '/inventory',
    label: 'Open',
    ownerOnly: false,
  },
  {
    id: 'orders',
    title: 'Create & track orders',
    description: 'Turn low stock into vendor orders without leaving the app.',
    icon: ShoppingCart,
    href: '/orders',
    label: 'Open',
    ownerOnly: false,
  },
  {
    id: 'vendors',
    title: 'Add a vendor',
    description: 'Connect suppliers so sourcing and communication stay in one place.',
    icon: Truck,
    href: '/providers',
    label: 'Open',
    ownerOnly: true,
  },
  {
    id: 'team',
    title: 'Invite your team',
    description: 'Share load with managers and staff from Settings.',
    icon: Users,
    href: '/settings?tab=team',
    label: 'Invite',
    ownerOnly: true,
  },
  {
    id: 'wine-agent',
    title: 'Wine Agent',
    description:
      'After setup, a small Wine Agent button appears bottom-right and opens Sommelier AI for inventory & ordering help. It does not access your email.',
    icon: Bot,
    href: '/sommelier',
    label: 'Open',
    ownerOnly: false,
  },
  {
    id: 'services',
    title: 'Services & permissions',
    description:
      'Control email, web, and privacy access. Optional — never required to learn the app.',
    icon: Shield,
    href: '/settings?tab=services',
    label: 'Manage',
    ownerOnly: false,
  },
]

export default function GetStarted() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeMethod, setActiveMethod] = useState<ImportMethod | null>(null)
  const [reviewResult, setReviewResult] = useState<MenuImportResult | null>(null)
  const [pendingResult, setPendingResult] = useState<MenuImportResult | null>(null)
  const [result, setResult] = useState<MenuImportResult | null>(null)
  const { progress, isLoading } = useOnboardingProgress()

  // The house's registers are inferred, then CONFIRMED AT ONBOARDING (founder
  // decision; `.planning/06-pages/wines.md` §13 "Roadmap for the adaptation"
  // item 1). Gated on the cellar flag so the legacy page is byte-for-byte
  // unchanged when it is off, and never a gate on the flow either way.
  const cellarNext = useMudavymDesign('cellar')
  const [registersFor, setRegistersFor] = useState<MenuImportResult | null>(null)
  const [registersDoneInTab, setRegistersDoneInTab] = useState(false)

  const isStaff = user?.role === 'staff'

  const tabParam = searchParams.get('tab')
  const [tab, setTab] = useState<TabId>(
    tabParam === 'use' || progress?.menu_uploaded ? 'use' : 'activate',
  )

  useEffect(() => {
    const m = searchParams.get('method')?.toLowerCase()
    if (m === 'scan' || m === 'csv' || m === 'manual') {
      setActiveMethod(m as ImportMethod)
      setTab('activate')
    }
  }, [searchParams])

  useEffect(() => {
    if (tabParam === 'use' || tabParam === 'activate') {
      setTab(tabParam)
    }
  }, [tabParam])

  // After menu upload, prefer Use tab instead of bouncing away forever
  useEffect(() => {
    if (!isLoading && progress?.menu_uploaded && tabParam !== 'activate') {
      setTab('use')
    }
  }, [progress, isLoading, tabParam])

  // Once the threshold is already configured (e.g. a second import), skip
  // straight through the threshold step instead of showing it again.
  useEffect(() => {
    if (pendingResult && !isLoading && progress?.threshold_configured) {
      setResult(pendingResult)
      setPendingResult(null)
    }
  }, [pendingResult, isLoading, progress?.threshold_configured])

  const selectTab = (next: TabId) => {
    setTab(next)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('tab', next)
        return p
      },
      { replace: true },
    )
  }

  const toggleMethod = (method: ImportMethod) => {
    setActiveMethod((prev) => (prev === method ? null : method))
  }

  // Staff get a read-oriented welcome with no upload/threshold/invite steps —
  // those are owner/manager actions on the restaurant's shared menu.
  if (isStaff) {
    return <StaffWelcome />
  }

  // Where the review step hands off: to the registers question when the cellar
  // flag is on, otherwise straight on as before.
  const afterReview = (r: MenuImportResult) => {
    if (cellarNext) setRegistersFor(r)
    else setPendingResult(r)
    setReviewResult(null)
  }

  if (reviewResult) {
    return (
      <MenuReviewScreen
        result={reviewResult}
        onConfirm={() => afterReview(reviewResult)}
        onSkip={() => afterReview(reviewResult)}
      />
    )
  }

  // Step 2b (flag-gated): immediately after the menu review, confirm what this
  // house pours. Skippable, and self-skipping when there is nothing to ask —
  // `onDone` always continues to the existing threshold/success path.
  if (registersFor) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <Suspense fallback={null}>
            <CellarRegistersOnboarding
              onDone={() => {
                setPendingResult(registersFor)
                setRegistersFor(null)
              }}
            />
          </Suspense>
        </div>
      </div>
    )
  }

  // Step 3: low-stock threshold, shown once right after a successful import
  // if it hasn't been configured yet ("activated" = menu + threshold).
  if (pendingResult && !isLoading && !progress?.threshold_configured) {
    return (
      <ThresholdStep
        onDone={() => {
          setResult(pendingResult)
          setPendingResult(null)
        }}
      />
    )
  }

  if (pendingResult) {
    // Waiting on the progress fetch / threshold-configured effect above to
    // decide whether to show ThresholdStep or skip straight to `result`.
    return null
  }

  if (result) {
    return (
      <SuccessScreen
        result={result}
        restaurantId={user?.restaurantId ?? ''}
        onContinueGuide={() => {
          setResult(null)
          selectTab('use')
        }}
        onInventory={() => navigate('/inventory')}
      />
    )
  }

  const visibleUseCards = USE_CARDS.filter((c) => !c.ownerOnly || user?.role !== 'staff')

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="p-6 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center">
          <BrandMark size={20} alt="Mudavym" />
        </div>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          Go to Dashboard
        </button>
      </header>

      <div className="border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 flex gap-1">
          {(
            [
              { id: 'activate', label: 'Activate' },
              { id: 'use', label: 'Use the app' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-wine-600 text-wine-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 flex flex-col items-center px-4 pb-16 pt-10">
        <div className="w-full max-w-4xl">
          {tab === 'activate' && (
            <>
              <div className="text-center mb-10">
                <h1 className="text-3xl font-bold text-gray-900 mb-3">
                  Let&apos;s set up your wine list
                </h1>
                <p className="text-gray-500 max-w-lg mx-auto">
                  Uploading your menu helps Mudavym understand what you sell — making
                  ordering, inventory, and AI suggestions accurate from day one.
                </p>
                {progress?.menu_uploaded && (
                  <p className="mt-3 text-sm text-green-700">
                    Menu already uploaded — switch to Use the app to continue learning.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mb-6">
                <MenuImportCard
                  icon={<Camera className="w-5 h-5" />}
                  title="Scan Photo"
                  description="Take a photo of your menu with your camera or upload an image"
                  active={activeMethod === 'scan'}
                  dimmed={activeMethod !== null && activeMethod !== 'scan'}
                  onClick={() => toggleMethod('scan')}
                />
                <MenuImportCard
                  icon={<FileSpreadsheet className="w-5 h-5" />}
                  title="Upload File"
                  description="Export from your POS system or Excel and import directly. Supports CSV, PDF, and other common formats."
                  active={activeMethod === 'csv'}
                  dimmed={activeMethod !== null && activeMethod !== 'csv'}
                  onClick={() => toggleMethod('csv')}
                />
                <MenuImportCard
                  icon={<PenLine className="w-5 h-5" />}
                  title="Manual Entry"
                  description="Type your wines in — perfect for a quick start"
                  active={activeMethod === 'manual'}
                  dimmed={activeMethod !== null && activeMethod !== 'manual'}
                  onClick={() => toggleMethod('manual')}
                />
              </div>

              <AnimatePresence mode="wait">
                {activeMethod === 'scan' && (
                  <motion.div
                    key="scan"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="w-full"
                  >
                    <MenuScanUpload onSuccess={setReviewResult} />
                  </motion.div>
                )}
                {activeMethod === 'csv' && (
                  <motion.div
                    key="csv"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="w-full"
                  >
                    <MenuCsvUpload onSuccess={setReviewResult} />
                  </motion.div>
                )}
                {activeMethod === 'manual' && (
                  <motion.div
                    key="manual"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="w-full"
                  >
                    <MenuManualEntry onSuccess={setReviewResult} />
                  </motion.div>
                )}
              </AnimatePresence>

              {cellarNext && progress?.menu_uploaded && !registersDoneInTab && (
                <div className="w-full mt-8" data-testid="activate-cellar-registers">
                  <Suspense fallback={null}>
                    <CellarRegistersOnboarding
                      onDone={() => setRegistersDoneInTab(true)}
                    />
                  </Suspense>
                </div>
              )}

              <div className="flex justify-center gap-4 mt-6">
                <button
                  onClick={() => selectTab('use')}
                  className="text-sm text-wine-600 hover:text-wine-500 font-medium"
                >
                  Skip to app guide →
                </button>
                <button
                  onClick={() => navigate('/')}
                  className="text-sm text-gray-400 hover:text-gray-600"
                >
                  Go to Dashboard
                </button>
              </div>
            </>
          )}

          {tab === 'use' && (
            <>
              <div className="text-center mb-10">
                <h1 className="text-3xl font-bold text-gray-900 mb-3">
                  How to use Mudavym
                </h1>
                <p className="text-gray-500 max-w-lg mx-auto">
                  Short paths for busy shifts — open a surface, get the job done, come back
                  anytime from Learn & Help.
                </p>
              </div>

              <div className="space-y-3">
                {visibleUseCards.map((card) => {
                  const Icon = card.icon
                  return (
                    <div
                      key={card.id}
                      className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl border border-gray-200 hover:border-wine-600/30 transition-colors bg-white"
                    >
                      <div className="w-10 h-10 rounded-xl bg-wine-600/10 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-5 h-5 text-wine-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900">{card.title}</p>
                        <p className="text-sm text-gray-500 mt-0.5">{card.description}</p>
                      </div>
                      <Button
                        variant="outline"
                        className="flex-shrink-0 min-h-[44px]"
                        onClick={() => {
                          trackGuidance('guide_card_clicked', { cardId: card.id })
                          if ('action' in card && card.action === 'activate') {
                            selectTab('activate')
                            return
                          }
                          if ('href' in card && card.href) {
                            if (card.id === 'services') {
                              trackGuidance('services_visited', { source: 'get-started' })
                            }
                            navigate(card.href)
                          }
                        }}
                      >
                        {card.label}
                        <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  )
                })}
              </div>

              <div className="mt-8 rounded-xl border border-dashed border-gray-200 p-4 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-wine-600 text-white mb-2">
                  <Bot className="w-5 h-5" />
                </div>
                <p className="text-sm text-gray-600 max-w-md mx-auto">
                  After you activate, look for this Wine Agent circle at the bottom-right of
                  the app. It only opens Sommelier AI — it is not support chat and
                  does not control privacy permissions.
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
