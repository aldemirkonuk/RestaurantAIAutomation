import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Pencil,
  X,
  Zap,
  Link as LinkIcon,
  ExternalLink,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Trash2,
} from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import { useContextMenu } from '../../hooks/useContextMenu'
import { useQuickActions } from '../../hooks/useQuickActions'
import {
  QUICK_ACTION_ICON_OPTIONS,
  QUICK_ACTION_ICON_MAP,
  type ResolvedQuickAction,
} from '../../data/quickActions'

interface FormState {
  title: string
  description: string
  icon: string
  actionUrl: string
  color: string
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  icon: 'Zap',
  actionUrl: '',
  color: 'wine',
}

const colorOptions = [
  { name: 'Wine', value: 'wine', bg: 'bg-wine-600', text: 'text-white' },
  { name: 'Emerald', value: 'emerald', bg: 'bg-emerald-600', text: 'text-white' },
  { name: 'Blue', value: 'blue', bg: 'bg-blue-600', text: 'text-white' },
  { name: 'Amber', value: 'amber', bg: 'bg-amber-600', text: 'text-white' },
  { name: 'Rose', value: 'rose', bg: 'bg-rose-600', text: 'text-white' },
  { name: 'Purple', value: 'purple', bg: 'bg-purple-600', text: 'text-white' },
]

function openHref(href: string, navigate: ReturnType<typeof useNavigate>, newTab = false) {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    window.open(href, '_blank', 'noopener')
    return
  }
  if (newTab) {
    window.open(href, '_blank', 'noopener')
    return
  }
  navigate(href)
}

export function QuickActionsPanel() {
  const navigate = useNavigate()
  const {
    actions,
    addCustom,
    updateCustom,
    removeCustom,
    hideBuiltin,
    moveAction,
    resetDefaults,
    getCustom,
  } = useQuickActions()
  const menu = useContextMenu<ResolvedQuickAction>()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        openCreate()
      }
      if (e.key === 'Escape') {
        setModalOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (action: ResolvedQuickAction) => {
    if (action.kind !== 'custom') return
    const custom = getCustom(action.id)
    setEditingId(action.id)
    setForm({
      title: custom?.title ?? action.label,
      description: custom?.description ?? '',
      icon: custom?.icon ?? action.iconName,
      actionUrl: custom?.href ?? action.href,
      color: custom?.color ?? 'wine',
    })
    setModalOpen(true)
  }

  const handleSave = () => {
    const payload = {
      title: form.title,
      href: form.actionUrl,
      icon: form.icon,
      color: form.color,
      description: form.description,
    }
    const ok = editingId ? updateCustom(editingId, payload) : addCustom(payload)
    if (ok) {
      setModalOpen(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    }
  }

  const menuItems: ContextMenuItem[] = (() => {
    const target = menu.target
    if (!target) return []
    const items: ContextMenuItem[] = [
      {
        id: 'open',
        label: 'Open',
        icon: ExternalLink,
        onClick: () => openHref(target.href, navigate),
      },
    ]
    if (target.kind === 'custom') {
      items.push(
        { id: 'edit', label: 'Edit', icon: Pencil, onClick: () => openEdit(target) },
        {
          id: 'up',
          label: 'Move up',
          icon: ArrowUp,
          onClick: () => moveAction(target.id, 'up'),
        },
        {
          id: 'down',
          label: 'Move down',
          icon: ArrowDown,
          onClick: () => moveAction(target.id, 'down'),
        },
        {
          id: 'new-tab',
          label: 'Open in new tab',
          icon: ExternalLink,
          onClick: () => openHref(target.href, navigate, true),
        },
        {
          id: 'remove',
          label: 'Remove',
          icon: Trash2,
          danger: true,
          dividerBefore: true,
          onClick: () => removeCustom(target.id),
        },
      )
    } else {
      items.push(
        {
          id: 'new-tab',
          label: 'Open in new tab',
          icon: ExternalLink,
          onClick: () => openHref(target.href, navigate, true),
        },
        {
          id: 'hide',
          label: 'Hide from Quick Actions',
          icon: EyeOff,
          dividerBefore: true,
          onClick: () => hideBuiltin(target.builtinKey),
        },
      )
    }
    return items
  })()

  return (
    <>
      <div className="bg-gradient-to-br from-wine-500 to-wine-700 rounded-xl shadow-lg overflow-hidden h-full">
        <div
          className="p-5"
          onContextMenu={(e) => {
            // Header / empty area: add or reset
            if ((e.target as HTMLElement).closest('[data-qa-row]')) return
            e.preventDefault()
            menu.setMenu({
              target: {
                id: '__panel__',
                kind: 'builtin',
                builtinKey: 'new_order',
                label: 'Panel',
                href: '/',
                icon: Zap,
              },
              x: e.clientX,
              y: e.clientY,
            })
          }}
        >
          <h3 className="font-semibold text-white mb-3">Quick Actions</h3>
          <div className="space-y-2">
            {actions.map((action) => {
              const Icon = action.icon
              const isCustom = action.kind === 'custom'
              const content = (
                <>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium flex-1 text-left">{action.label}</span>
                  {isCustom && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        openEdit(action)
                      }}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-white/20 transition-opacity"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )
              const rowClass =
                'group flex items-center gap-3 px-3 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg transition-all text-white w-full'

              if (action.href.startsWith('http')) {
                return (
                  <a
                    key={action.id}
                    data-qa-row
                    href={action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={rowClass}
                    onContextMenu={(e) => menu.onContextMenu(e, action)}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      if (isCustom) removeCustom(action.id)
                      else toast.message('Built-in — right-click to hide')
                    }}
                  >
                    {content}
                  </a>
                )
              }

              return (
                <NavLink
                  key={action.id}
                  data-qa-row
                  to={action.href}
                  className={rowClass}
                  onContextMenu={(e) => menu.onContextMenu(e, action)}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    if (isCustom) {
                      e.stopPropagation()
                      removeCustom(action.id)
                    } else {
                      toast.message('Built-in — right-click to hide')
                    }
                  }}
                  onClick={(e) => {
                    // Prevent navigation when double-clicking custom remove
                    if (e.detail > 1 && isCustom) {
                      e.preventDefault()
                    }
                  }}
                >
                  {content}
                </NavLink>
              )
            })}

            <button
              type="button"
              onClick={openCreate}
              className="flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-white/30 hover:border-white/50 hover:bg-white/10 rounded-lg transition-all text-white/80 hover:text-white group w-full"
              title="Create Quick Action (⌘N)"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">Add Quick Action</span>
            </button>
          </div>
        </div>
      </div>

      {menu.open && menu.menu && menu.target?.id === '__panel__' && (
        <ContextMenu
          x={menu.menu.x}
          y={menu.menu.y}
          onClose={menu.close}
          items={[
            { id: 'add', label: 'Add Quick Action', icon: Plus, onClick: openCreate },
            {
              id: 'reset',
              label: 'Reset to defaults',
              icon: Trash2,
              dividerBefore: true,
              onClick: resetDefaults,
            },
          ]}
        />
      )}

      {menu.open && menu.menu && menu.target && menu.target.id !== '__panel__' && (
        <ContextMenu x={menu.menu.x} y={menu.menu.y} onClose={menu.close} items={menuItems} />
      )}

      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-purple-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-wine-600 rounded-xl">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">
                      {editingId ? 'Edit Quick Action' : 'Create Quick Action'}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {editingId
                        ? 'Update this shortcut for your workflow'
                        : 'Design a custom quick action for your workflow'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Action Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g., Check Low Stock Wines"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Brief description of what this action does"
                    rows={2}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Action URL <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={form.actionUrl}
                      onChange={(e) => setForm({ ...form, actionUrl: e.target.value })}
                      placeholder="/inventory or https://example.com"
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_ACTION_ICON_OPTIONS.map((name) => {
                      const Icon = QUICK_ACTION_ICON_MAP[name]
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setForm({ ...form, icon: name })}
                          className={`p-2.5 rounded-lg border transition-all ${
                            form.icon === name
                              ? 'border-wine-500 bg-wine-50 text-wine-700'
                              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}
                          title={name}
                        >
                          <Icon className="w-4 h-4" />
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Color Theme</label>
                  <div className="flex gap-2 flex-wrap">
                    {colorOptions.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        onClick={() => setForm({ ...form, color: color.value })}
                        className={`w-10 h-10 rounded-lg ${color.bg} ${
                          form.color === color.value ? 'ring-2 ring-offset-2 ring-gray-900' : ''
                        } transition-all hover:scale-110`}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!form.title || !form.actionUrl}
                    className="flex-1 px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {editingId ? 'Save Changes' : 'Create Action'}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        removeCustom(editingId)
                        setModalOpen(false)
                      }}
                      className="px-6 py-3 border border-rose-200 text-rose-600 font-medium rounded-xl hover:bg-rose-50 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
