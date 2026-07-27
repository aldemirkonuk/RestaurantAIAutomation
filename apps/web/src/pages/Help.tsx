import { useNavigate, Link } from 'react-router-dom'
import {
  BookOpen,
  Rocket,
  Shield,
  Bot,
  HelpCircle,
  Mail,
  MessageSquare,
  ChevronDown,
} from 'lucide-react'
import { useState } from 'react'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/button'
import { trackGuidance } from '../guidance/analytics'
import { cn } from '../lib/utils'

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@wineops.ai'
const SUPPORT_SLACK_URL =
  import.meta.env.VITE_SUPPORT_SLACK_URL || 'https://wineops.slack.com'

const FAQS = [
  {
    q: 'How do I invite my team?',
    a: 'Owners and managers can invite teammates from Settings → Team. Share the invite code or link; staff join with that code.',
  },
  {
    q: 'Where do I change my password or linked login?',
    a: 'Open Profile from the avatar menu. Security and Linked accounts are personal — not restaurant Settings.',
  },
  {
    q: 'Who can edit restaurant locations and feature flags?',
    a: 'Owners and managers manage restaurant Settings. Staff can update their own Profile but not restaurant ops.',
  },
  {
    q: 'How do I get help from the WineOps team?',
    a: 'Email us or join Slack using the contact options on this page. For product tours, use Learn & Help in the sidebar.',
  },
]

/**
 * Help & Support — recovery entry for Learn, Get Started, Services, Wine Agent,
 * plus P0 support channels (email + Slack) and FAQ stubs.
 */
export default function Help() {
  const navigate = useNavigate()
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="Help & Support"
        subtitle="Guides, FAQs, and ways to reach us"
      />
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Contact — P0 */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Contact support</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="flex items-start gap-3 rounded-xl border border-gray-100 p-4 hover:bg-gray-50 transition-colors"
            >
              <Mail className="w-5 h-5 text-wine-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-900">Email</p>
                <p className="text-sm text-gray-500 break-all">{SUPPORT_EMAIL}</p>
              </div>
            </a>
            <a
              href={SUPPORT_SLACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 rounded-xl border border-gray-100 p-4 hover:bg-gray-50 transition-colors"
            >
              <MessageSquare className="w-5 h-5 text-wine-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-900">Slack</p>
                <p className="text-sm text-gray-500">Join the WineOps support channel</p>
              </div>
            </a>
          </div>
        </section>

        {/* FAQ stubs */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">FAQ</h2>
          <ul className="space-y-2">
            {FAQS.map((item, i) => {
              const open = openFaq === i
              return (
                <li key={item.q} className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
                    aria-expanded={open}
                  >
                    {item.q}
                    <ChevronDown
                      className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform', open && 'rotate-180')}
                    />
                  </button>
                  {open && (
                    <p className="px-4 pb-3 text-sm text-gray-500">{item.a}</p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-4">
          <BookOpen className="w-6 h-6 text-[#B8323A] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Learn & page tours</h2>
            <p className="text-sm text-gray-500 mt-1">
              Open Learn & Help in the sidebar to replay page tours, reset tips, or show the
              Wine Agent button again.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-4 items-start">
          <Rocket className="w-6 h-6 text-[#B8323A] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Get started guide</h2>
            <p className="text-sm text-gray-500 mt-1 mb-3">
              Activate your wine list and walk through how to use inventory, orders, and more.
            </p>
            <Button
              onClick={() => {
                trackGuidance('guide_card_clicked', { cardId: 'help-get-started' })
                navigate('/get-started?tab=use')
              }}
            >
              Open app guide
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-4 items-start">
          <Shield className="w-6 h-6 text-[#B8323A] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Services & permissions</h2>
            <p className="text-sm text-gray-500 mt-1 mb-3">
              Control email, web, and privacy access. Separate from product tours — Wine Agent
              does not grant email access.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                trackGuidance('services_visited', { source: 'help' })
                navigate('/settings?tab=services')
              }}
            >
              Manage services
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-4 items-start">
          <Bot className="w-6 h-6 text-[#B8323A] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Wine Agent</h2>
            <p className="text-sm text-gray-500 mt-1 mb-3">
              Inventory & ordering help entry. After activation, a small circle appears
              bottom-right — or open it here.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                trackGuidance('wine_agent_fab_clicked', { source: 'help' })
                // /wineagent is still a placeholder (App.tsx) — Sommelier AI
                // is the real inventory & ordering help surface today.
                navigate('/sommelier')
              }}
            >
              Open Wine Agent
            </Button>
          </div>
        </div>

        <p className="text-xs text-gray-400 flex items-center gap-1.5 pt-2">
          <HelpCircle className="w-3.5 h-3.5" />
          Prefer no tips? Dismiss them once — recover anytime from Learn & Help. Account settings live in{' '}
          <Link to="/profile" className="text-wine-600 hover:underline">
            Profile
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
