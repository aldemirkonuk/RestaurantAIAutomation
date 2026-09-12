import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Send,
  Mail,
  UserPlus,
  Eye,
  Check,
  AlertCircle,
  Loader2,
  FileText,
  Sparkles,
} from 'lucide-react'
import { SavedTemplate } from '../documents/GmailTemplateBuilder'
import { defaultTemplates } from '../../data/emailTemplateCategories'
import axios from 'axios'

interface QuickGmailModalProps {
  onClose: () => void
  prefilledTemplate?: SavedTemplate
  prefilledRecipient?: string
  prefilledSubject?: string
}

const API_URL = import.meta.env?.VITE_API_GATEWAY_URL || 'http://localhost:4000'

export function QuickGmailModal({
  onClose,
  prefilledTemplate,
  prefilledRecipient,
  prefilledSubject,
}: QuickGmailModalProps) {
  const [step, setStep] = useState<'select-template' | 'compose'>('select-template')
  const [selectedTemplate, setSelectedTemplate] = useState<SavedTemplate | null>(prefilledTemplate || null)
  const [recipients, setRecipients] = useState<string[]>(prefilledRecipient ? [prefilledRecipient] : [])
  const [recipientInput, setRecipientInput] = useState('')
  const [subject, setSubject] = useState(prefilledSubject || '')
  const [cc] = useState<string[]>([])
  const [bcc] = useState<string[]>([])
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)
  const [sendError, setSendError] = useState('')
  const [preview, setPreview] = useState(false)
  const [customBody, setCustomBody] = useState('')
  const [useCustomBody, setUseCustomBody] = useState(false)

  // Quick-add team emails from localStorage
  const quickAddEmails = (() => {
    try {
      const stored = localStorage.getItem('wineops_team_emails')
      return stored ? JSON.parse(stored) : [
        { label: 'Manager', email: '' },
        { label: 'Sommelier', email: '' },
      ]
    } catch { return [] }
  })()

  // Convert default templates to SavedTemplate format
  const templates: SavedTemplate[] = defaultTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description || '',
    subject: template.subject,
    thumbnail: '',
    category: template.category.toLowerCase() as any,
    panels: template.panels.map(panel => ({
      id: panel.id,
      type: 'text' as any,
      title: '',
      content: panel.config,
      config: {
        backgroundColor: '#FFFFFF',
        textColor: '#1F2937',
        fontSize: 'medium' as const,
        padding: 'medium' as const,
        alignment: 'left' as const,
        borderRadius: 'medium' as const,
      }
    })),
    created_at: new Date(),
    last_modified: new Date(),
    used_count: 0,
  }))

  useEffect(() => {
    if (prefilledTemplate) {
      setStep('compose')
      setSubject(prefilledTemplate.subject)
    }
  }, [prefilledTemplate])

  const handleTemplateSelect = (template: SavedTemplate) => {
    setSelectedTemplate(template)
    setSubject(template.subject)
    setStep('compose')
  }

  const addRecipient = () => {
    if (recipientInput && !recipients.includes(recipientInput)) {
      setRecipients([...recipients, recipientInput])
      setRecipientInput('')
    }
  }

  const removeRecipient = (email: string) => {
    setRecipients(recipients.filter(r => r !== email))
  }

  const generateEmailHTML = (): string => {
    if (!selectedTemplate) return '<p>No template selected</p>'

    const panels = selectedTemplate.panels || []
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${selectedTemplate.subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #7c2d12 0%, #991b1b 100%); padding: 40px 30px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🍷 Mudavym</h1>
      <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 14px;">Restaurant Wine Management System</p>
    </div>

    <!-- Content -->
    <div style="padding: 40px 30px;">
      <h2 style="color: #1f2937; font-size: 24px; margin: 0 0 20px 0; font-weight: 600;">${selectedTemplate.name}</h2>
      
      ${panels.map(panel => `
        <div style="margin-bottom: 30px; padding: 20px; background-color: #f9fafb; border-radius: 12px; border-left: 4px solid #7c2d12;">
          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0;">${panel.content}</p>
        </div>
      `).join('')}
      
      <div style="margin-top: 40px; padding-top: 30px; border-top: 2px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 14px; margin: 0;">
          This email was sent by <strong>Mudavym</strong> - Your intelligent wine inventory management system.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #f3f4f6; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} Mudavym. All rights reserved.
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin: 5px 0 0 0;">
        Automated wine procurement and inventory management
      </p>
    </div>
  </div>
</body>
</html>
    `
  }

  const handleSend = async () => {
    if (recipients.length === 0) {
      setSendError('Please add at least one recipient')
      return
    }

    if (!subject.trim()) {
      setSendError('Please enter a subject')
      return
    }

    setSending(true)
    setSendError('')

    try {
      let bodyHtml: string
      let bodyText: string
      
      if (useCustomBody && customBody) {
        // Convert simple markdown to HTML
        bodyText = customBody
        bodyHtml = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#7c2d12,#991b1b);padding:24px;border-radius:12px 12px 0 0;">
              <h1 style="color:#fff;margin:0;font-size:22px;">Mudavym</h1>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
              ${customBody
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/_(.*?)_/g, '<em>$1</em>')
                .split('\n').map(line => {
                  if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`
                  return `<p style="margin:4px 0;color:#374151;">${line || '&nbsp;'}</p>`
                }).join('')}
            </div>
            <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:12px;">Sent by Mudavym</p>
          </div>`
      } else {
        bodyHtml = generateEmailHTML()
        bodyText = selectedTemplate?.description || subject
      }
      
      const response = await axios.post(`${API_URL}/api/v1/notifications/send-email`, {
        to: recipients,
        subject: subject,
        body_html: bodyHtml,
        body_text: bodyText,
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
      })

      if (response.data.success) {
        setSendSuccess(true)
        setTimeout(() => {
          onClose()
        }, 2000)
      } else {
        setSendError(response.data.error || 'Failed to send email')
      }
    } catch (error: any) {
      console.error('Failed to send email:', error)
      setSendError(error.response?.data?.error || error.message || 'Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-600 to-rose-600">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Quick Gmail Send</h2>
                <p className="text-sm text-white/80">Send email using saved templates</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {step === 'select-template' && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-wine-600" />
                  Select a Template
                </h3>
                
                {/* Quick compose without template */}
                <button
                  onClick={() => { setUseCustomBody(true); setStep('compose') }}
                  className="w-full text-left p-4 border-2 border-dashed border-blue-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group mb-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                      <Send className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Compose Custom Email</h4>
                      <p className="text-sm text-gray-500">Write your own email without a template</p>
                    </div>
                  </div>
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleTemplateSelect(template)}
                      className="text-left p-4 border-2 border-gray-200 rounded-xl hover:border-wine-500 hover:shadow-lg transition-all group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-semibold text-gray-900 group-hover:text-wine-600 transition-colors">
                          {template.name}
                        </h4>
                        <Sparkles className="w-5 h-5 text-wine-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{template.description}</p>
                      <p className="text-xs text-gray-500 font-medium">Subject: {template.subject}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 'compose' && (selectedTemplate || useCustomBody) && (
              <div className="space-y-6">
                {/* Template Info */}
                <div className="p-4 bg-wine-50 border border-wine-200 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-wine-700 font-medium">Selected Template</p>
                      <p className="text-lg font-bold text-wine-900">{selectedTemplate?.name ?? 'Custom message'}</p>
                    </div>
                    <button
                      onClick={() => setStep('select-template')}
                      className="px-4 py-2 bg-white border border-wine-300 rounded-lg text-wine-700 text-sm font-medium hover:bg-wine-50 transition-colors"
                    >
                      Change Template
                    </button>
                  </div>
                </div>

                {/* Recipients */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    To <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="email"
                      value={recipientInput}
                      onChange={(e) => setRecipientInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addRecipient())}
                      className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                      placeholder="Enter email address"
                    />
                    <button
                      onClick={addRecipient}
                      className="px-4 py-2 bg-wine-600 text-white rounded-lg hover:bg-wine-700 transition-colors flex items-center gap-2"
                    >
                      <UserPlus className="w-4 h-4" />
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recipients.map((email, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                      >
                        {email}
                        <button
                          onClick={() => removeRecipient(email)}
                          className="hover:text-gray-900"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Quick-add buttons */}
                <div className="flex flex-wrap gap-2">
                  {quickAddEmails.filter((q: any) => q.email).map((q: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (q.email && !recipients.includes(q.email)) {
                          setRecipients([...recipients, q.email])
                        }
                      }}
                      className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium"
                    >
                      + {q.label}
                    </button>
                  ))}
                  {!showCc && (
                    <button
                      onClick={() => setShowCc(true)}
                      className="text-xs px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors font-medium"
                    >
                      Show CC
                    </button>
                  )}
                  {!showBcc && (
                    <button
                      onClick={() => setShowBcc(true)}
                      className="text-xs px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors font-medium"
                    >
                      Show BCC
                    </button>
                  )}
                </div>

                {/* Subject */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Subject <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    placeholder="Enter subject"
                  />
                </div>

                {/* Custom Body (when no template selected) */}
                {useCustomBody && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Message Body
                    </label>
                    <textarea
                      value={customBody}
                      onChange={(e) => setCustomBody(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent resize-none min-h-[200px] text-sm"
                      placeholder="Write your email message here...&#10;&#10;Formatting tips:&#10;- Use **bold** for emphasis&#10;- Start lines with - for bullet points"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          const sel = window.getSelection()?.toString()
                          if (sel) setCustomBody(customBody.replace(sel, `**${sel}**`))
                        }}
                        className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-bold"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const sel = window.getSelection()?.toString()
                          if (sel) setCustomBody(customBody.replace(sel, `_${sel}_`))
                        }}
                        className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 italic"
                      >
                        I
                      </button>
                      <span className="text-xs text-gray-400 flex items-center ml-2">
                        Basic formatting supported
                      </span>
                    </div>
                  </div>
                )}

                {/* Preview */}
                <div>
                  <button
                    onClick={() => setPreview(!preview)}
                    className="flex items-center gap-2 text-sm text-wine-600 hover:text-wine-700 font-medium"
                  >
                    <Eye className="w-4 h-4" />
                    {preview ? 'Hide Preview' : 'Show Preview'}
                  </button>
                  
                  {preview && (
                    <div className="mt-4 p-4 border-2 border-gray-200 rounded-xl max-h-96 overflow-y-auto">
                      <div dangerouslySetInnerHTML={{ __html: generateEmailHTML() }} />
                    </div>
                  )}
                </div>

                {/* Error Message */}
                {sendError && (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-rose-900">Error sending email</p>
                      <p className="text-sm text-rose-700">{sendError}</p>
                    </div>
                  </div>
                )}

                {/* Success Message */}
                {sendSuccess && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-3"
                  >
                    <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-emerald-900">Email sent successfully!</p>
                      <p className="text-sm text-emerald-700">Your email has been sent to {recipients.length} recipient(s)</p>
                    </div>
                  </motion.div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {step === 'compose' && (
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
              <button
                onClick={onClose}
                disabled={sending}
                className="px-5 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              
              <button
                onClick={handleSend}
                disabled={sending || recipients.length === 0 || !subject.trim()}
                className="px-6 py-2.5 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Send Email
                  </>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

