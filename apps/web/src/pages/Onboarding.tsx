/**
 * Onboarding Page
 * Multi-step wizard for new customer setup
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wine,
  Building2,
  User,
  Users,
  Package,
  Truck,
  CreditCard,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Upload,
  Camera,
  FileSpreadsheet,
  Plus,
  X,
  Search,
  AlertTriangle,
  Sparkles,
  Globe,
  Clock,
  Mail,
  Phone,
  Bell,
  Check,
  Loader2,
  ArrowRight,
} from 'lucide-react'
import {
  useOnboarding,
  OnboardingProvider,
  ONBOARDING_STEPS,
  WineImportItem,
  TeamMember,
  ProviderSetup,
} from '../contexts/OnboardingContext'
import { useRestaurantSettingsStore } from '../stores'
import { MenuScannerFlow } from '../components/scanner/MenuScannerFlow'

// Step components
function WelcomeStep() {
  const { nextStep } = useOnboarding()

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="text-center max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <div className="w-24 h-24 bg-gradient-to-br from-wine-500 to-wine-700 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-wine-500/30">
          <Wine className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Welcome to WineOps
        </h1>
        <p className="text-xl text-gray-600">
          Let's set up your restaurant's wine management system in just a few minutes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[
          { icon: Building2, title: 'Restaurant Profile', desc: 'Basic info about your venue' },
          { icon: Package, title: 'Wine Inventory', desc: 'Import your wine list' },
          { icon: Truck, title: 'Providers', desc: 'Connect with suppliers' },
        ].map((item, i) => (
          <div key={i} className="p-4 bg-gray-50 rounded-xl">
            <item.icon className="w-8 h-8 text-wine-600 mx-auto mb-2" />
            <h3 className="font-semibold text-gray-900">{item.title}</h3>
            <p className="text-sm text-gray-500">{item.desc}</p>
          </div>
        ))}
      </div>

      <button
        onClick={nextStep}
        className="px-8 py-4 bg-wine-600 text-white rounded-xl font-semibold text-lg hover:bg-wine-700 transition-colors shadow-lg shadow-wine-600/30 flex items-center gap-2 mx-auto"
      >
        Get Started
        <ArrowRight className="w-5 h-5" />
      </button>
    </motion.div>
  )
}

function RestaurantStep() {
  const { data, updateRestaurant, nextStep, prevStep, markStepComplete } = useOnboarding()
  const setMeasurementUnit = useRestaurantSettingsStore((s) => s.setMeasurementUnit)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!data.restaurant.name) newErrors.name = 'Restaurant name is required'
    if (!data.restaurant.address) newErrors.address = 'Address is required'
    if (!data.restaurant.city) newErrors.city = 'City is required'
    if (!data.restaurant.phone) newErrors.phone = 'Phone is required'
    if (!data.restaurant.email) newErrors.email = 'Email is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validate()) {
      markStepComplete(1)
      nextStep()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Restaurant Profile</h2>
        <p className="text-gray-600">Tell us about your restaurant</p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Restaurant Name *
          </label>
          <input
            type="text"
            value={data.restaurant.name}
            onChange={(e) => updateRestaurant({ name: e.target.value })}
            placeholder="e.g., The Wine Cellar"
            className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent ${
              errors.name ? 'border-red-300' : 'border-gray-200'
            }`}
          />
          {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address *
            </label>
            <input
              type="text"
              value={data.restaurant.address}
              onChange={(e) => updateRestaurant({ address: e.target.value })}
              placeholder="123 Main St"
              className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent ${
                errors.address ? 'border-red-300' : 'border-gray-200'
              }`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              City *
            </label>
            <input
              type="text"
              value={data.restaurant.city}
              onChange={(e) => updateRestaurant({ city: e.target.value })}
              placeholder="New York"
              className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent ${
                errors.city ? 'border-red-300' : 'border-gray-200'
              }`}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <input
              type="text"
              value={data.restaurant.state}
              onChange={(e) => updateRestaurant({ state: e.target.value })}
              placeholder="NY"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ZIP Code</label>
            <input
              type="text"
              value={data.restaurant.zipCode}
              onChange={(e) => updateRestaurant({ zipCode: e.target.value })}
              placeholder="10001"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select
              value={data.restaurant.timezone}
              onChange={(e) => updateRestaurant({ timezone: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            >
              <option value="America/New_York">Eastern</option>
              <option value="America/Chicago">Central</option>
              <option value="America/Denver">Mountain</option>
              <option value="America/Los_Angeles">Pacific</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
            <input
              type="tel"
              value={data.restaurant.phone}
              onChange={(e) => updateRestaurant({ phone: e.target.value })}
              placeholder="(555) 123-4567"
              className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent ${
                errors.phone ? 'border-red-300' : 'border-gray-200'
              }`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              value={data.restaurant.email}
              onChange={(e) => updateRestaurant({ email: e.target.value })}
              placeholder="contact@restaurant.com"
              className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent ${
                errors.email ? 'border-red-300' : 'border-gray-200'
              }`}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Volume Display Unit</label>
          <p className="text-xs text-gray-500 mb-2">How volumes are shown across the app</p>
          <div className="flex gap-2">
            {(['ml', 'oz'] as const).map((unit) => {
              const isSelected = (data.restaurant.measurementUnit ?? 'ml') === unit
              return (
                <button
                  key={unit}
                  type="button"
                  onClick={() => {
                    updateRestaurant({ measurementUnit: unit })
                    setMeasurementUnit(unit)
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {unit === 'ml' ? 'Metric (ml/L)' : 'US (oz)'}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cuisine Type</label>
            <select
              value={data.restaurant.cuisineType}
              onChange={(e) => updateRestaurant({ cuisineType: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            >
              <option value="">Select cuisine...</option>
              <option value="american">American</option>
              <option value="french">French</option>
              <option value="italian">Italian</option>
              <option value="mediterranean">Mediterranean</option>
              <option value="steakhouse">Steakhouse</option>
              <option value="seafood">Seafood</option>
              <option value="fusion">Fusion</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Seating Capacity</label>
            <input
              type="number"
              value={data.restaurant.seatingCapacity || ''}
              onChange={(e) => updateRestaurant({ seatingCapacity: parseInt(e.target.value) || 0 })}
              placeholder="100"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button
          onClick={prevStep}
          className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-3 bg-wine-600 text-white rounded-xl font-medium hover:bg-wine-700 transition-colors flex items-center gap-2"
        >
          Continue
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  )
}

function ManagerStep() {
  const { data, updateManager, nextStep, prevStep, markStepComplete } = useOnboarding()

  const handleNext = () => {
    markStepComplete(2)
    nextStep()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Your Profile</h2>
        <p className="text-gray-600">Set up your account and notification preferences</p>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
            <input
              type="text"
              value={data.manager.name}
              onChange={(e) => updateManager({ name: e.target.value })}
              placeholder="John Smith"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={data.manager.role}
              onChange={(e) => updateManager({ role: e.target.value as any })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            >
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="sommelier">Sommelier</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={data.manager.email}
              onChange={(e) => updateManager({ email: e.target.value })}
              placeholder="john@restaurant.com"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={data.manager.phone}
              onChange={(e) => updateManager({ phone: e.target.value })}
              placeholder="(555) 123-4567"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-wine-600" />
            Notification Preferences
          </h3>
          <div className="space-y-3">
            {[
              { key: 'email', label: 'Email notifications', icon: Mail },
              { key: 'sms', label: 'SMS notifications', icon: Phone },
              { key: 'lowStockAlerts', label: 'Low stock alerts', icon: AlertTriangle },
              { key: 'orderUpdates', label: 'Order updates', icon: Package },
              { key: 'deliveryReminders', label: 'Delivery reminders', icon: Truck },
            ].map(({ key, label, icon: Icon }) => (
              <label key={key} className="flex items-center justify-between p-3 bg-white rounded-lg cursor-pointer hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-gray-500" />
                  <span className="text-gray-700">{label}</span>
                </div>
                <input
                  type="checkbox"
                  checked={(data.manager.notificationPreferences as any)[key]}
                  onChange={(e) => updateManager({
                    notificationPreferences: {
                      ...data.manager.notificationPreferences,
                      [key]: e.target.checked,
                    },
                  })}
                  className="w-5 h-5 text-wine-600 rounded focus:ring-wine-500"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button
          onClick={prevStep}
          className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-3 bg-wine-600 text-white rounded-xl font-medium hover:bg-wine-700 transition-colors flex items-center gap-2"
        >
          Continue
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  )
}

function TeamStep() {
  const { data, addTeamMember, removeTeamMember, nextStep, prevStep, markStepComplete } = useOnboarding()
  const [newMember, setNewMember] = useState({ name: '', email: '', role: 'staff' as const })

  const handleAddMember = () => {
    if (newMember.name && newMember.email) {
      addTeamMember(newMember)
      setNewMember({ name: '', email: '', role: 'staff' })
    }
  }

  const handleNext = () => {
    markStepComplete(3)
    nextStep()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Team Setup</h2>
        <p className="text-gray-600">Invite team members to collaborate (optional)</p>
      </div>

      <div className="bg-gray-50 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-gray-900 mb-4">Add Team Member</h3>
        <div className="grid grid-cols-3 gap-4">
          <input
            type="text"
            value={newMember.name}
            onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
            placeholder="Name"
            className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
          />
          <input
            type="email"
            value={newMember.email}
            onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
            placeholder="Email"
            className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
          />
          <div className="flex gap-2">
            <select
              value={newMember.role}
              onChange={(e) => setNewMember({ ...newMember, role: e.target.value as any })}
              className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            >
              <option value="manager">Manager</option>
              <option value="sommelier">Sommelier</option>
              <option value="staff">Staff</option>
            </select>
            <button
              onClick={handleAddMember}
              disabled={!newMember.name || !newMember.email}
              className="px-4 py-3 bg-wine-600 text-white rounded-xl hover:bg-wine-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {data.team.length > 0 && (
        <div className="space-y-3 mb-6">
          {data.team.map(member => (
            <div key={member.id} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-wine-100 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-wine-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{member.name}</p>
                  <p className="text-sm text-gray-500">{member.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm capitalize">
                  {member.role}
                </span>
                <button
                  onClick={() => removeTeamMember(member.id)}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.team.length === 0 && (
        <div className="text-center py-8 bg-gray-50 rounded-xl mb-6">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No team members added yet</p>
          <p className="text-sm text-gray-400">You can always add team members later</p>
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button
          onClick={prevStep}
          className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-3 bg-wine-600 text-white rounded-xl font-medium hover:bg-wine-700 transition-colors flex items-center gap-2"
        >
          Continue
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  )
}

function InventoryStep() {
  const { data, bulkAddWines, removeWine, nextStep, prevStep, markStepComplete } = useOnboarding()
  const [importMethod, setImportMethod] = useState<'menu' | 'csv' | 'manual' | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showScannerFlow, setShowScannerFlow] = useState(false)

  const handleMenuScan = () => {
    // Open the real AI menu scanner flow
    setShowScannerFlow(true)
  }

  const handleScannerWinesAdded = (wines: any[]) => {
    const importedWines: Omit<WineImportItem, 'id'>[] = wines.map(w => ({
      name: w.name || 'Unknown Wine',
      producer: w.producer,
      vintage: w.vintage?.toString(),
      type: w.wineType || w.type,
      status: w.inMasterLibrary ? 'matched' : 'unknown',
      confidence: Math.round((w.confidence || 0) * 100),
      source: 'menu_scan',
    }))
    bulkAddWines(importedWines)
    setShowScannerFlow(false)
    setImportMethod(null)
  }

  const handleNext = () => {
    markStepComplete(4)
    nextStep()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-3xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Wine Inventory</h2>
        <p className="text-gray-600">Import your wine list to get started</p>
      </div>

      {/* Import methods */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { id: 'menu', icon: Camera, title: 'Scan Menu', desc: 'Upload a photo of your wine menu' },
          { id: 'csv', icon: FileSpreadsheet, title: 'Import CSV', desc: 'Upload a spreadsheet' },
          { id: 'manual', icon: Plus, title: 'Manual Entry', desc: 'Add wines one by one' },
        ].map(method => (
          <button
            key={method.id}
            onClick={() => setImportMethod(method.id as any)}
            className={`p-6 rounded-xl border-2 transition-all text-center ${
              importMethod === method.id
                ? 'border-wine-500 bg-wine-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <method.icon className={`w-8 h-8 mx-auto mb-3 ${
              importMethod === method.id ? 'text-wine-600' : 'text-gray-400'
            }`} />
            <h3 className="font-semibold text-gray-900">{method.title}</h3>
            <p className="text-sm text-gray-500">{method.desc}</p>
          </button>
        ))}
      </div>

      {/* Import action */}
      {importMethod === 'menu' && (
        <div className="bg-gray-50 rounded-xl p-6 mb-6 text-center">
          <Camera className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
          <p className="text-gray-600 mb-2">Scan your wine menu with AI-powered detection</p>
          <p className="text-xs text-gray-400 mb-4">YOLOv8 + OCR + Gemini Pro + Library Matching</p>
          <button
            onClick={handleMenuScan}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
          >
            Open Menu Scanner
          </button>
        </div>
      )}

      {/* Menu Scanner Flow Modal */}
      {showScannerFlow && (
        <MenuScannerFlow
          isOpen={showScannerFlow}
          onClose={() => setShowScannerFlow(false)}
          onWinesAdded={handleScannerWinesAdded}
        />
      )}

      {/* Imported wines */}
      {data.wines.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">
            Imported Wines ({data.wines.length})
          </h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {data.wines.map(wine => (
              <div
                key={wine.id}
                className={`flex items-center justify-between p-4 rounded-xl border ${
                  wine.status === 'unknown'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-white border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Wine className={`w-5 h-5 ${
                    wine.status === 'unknown' ? 'text-amber-500' : 'text-wine-600'
                  }`} />
                  <div>
                    <p className="font-medium text-gray-900">{wine.name}</p>
                    {wine.producer && (
                      <p className="text-sm text-gray-500">{wine.producer} • {wine.vintage}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {wine.status === 'unknown' ? (
                    <span className="flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm">
                      <AlertTriangle className="w-4 h-4" />
                      Needs Research
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                      <Check className="w-4 h-4" />
                      {wine.confidence}% match
                    </span>
                  )}
                  <button
                    onClick={() => removeWine(wine.id)}
                    className="p-2 text-gray-400 hover:text-red-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.wines.length === 0 && !importMethod && (
        <div className="text-center py-8 bg-gray-50 rounded-xl mb-6">
          <Wine className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No wines imported yet</p>
          <p className="text-sm text-gray-400">Select an import method above</p>
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button
          onClick={prevStep}
          className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-3 bg-wine-600 text-white rounded-xl font-medium hover:bg-wine-700 transition-colors flex items-center gap-2"
        >
          Continue
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  )
}

function ProvidersStep() {
  const { data, addProvider, removeProvider, nextStep, prevStep, markStepComplete } = useOnboarding()
  const [newProvider, setNewProvider] = useState({ name: '', email: '', phone: '', isPreferred: false })

  const handleAddProvider = () => {
    if (newProvider.name) {
      addProvider(newProvider)
      setNewProvider({ name: '', email: '', phone: '', isPreferred: false })
    }
  }

  const handleNext = () => {
    markStepComplete(5)
    nextStep()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Wine Providers</h2>
        <p className="text-gray-600">Add your wine suppliers (optional)</p>
      </div>

      <div className="bg-gray-50 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-gray-900 mb-4">Add Provider</h3>
        <div className="space-y-4">
          <input
            type="text"
            value={newProvider.name}
            onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
            placeholder="Provider name"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
          />
          <div className="grid grid-cols-2 gap-4">
            <input
              type="email"
              value={newProvider.email}
              onChange={(e) => setNewProvider({ ...newProvider, email: e.target.value })}
              placeholder="Email"
              className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
            <input
              type="tel"
              value={newProvider.phone}
              onChange={(e) => setNewProvider({ ...newProvider, phone: e.target.value })}
              placeholder="Phone"
              className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={handleAddProvider}
            disabled={!newProvider.name}
            className="w-full px-4 py-3 bg-wine-600 text-white rounded-xl font-medium hover:bg-wine-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Provider
          </button>
        </div>
      </div>

      {data.providers.length > 0 && (
        <div className="space-y-3 mb-6">
          {data.providers.map(provider => (
            <div key={provider.id} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <Truck className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{provider.name}</p>
                  <p className="text-sm text-gray-500">{provider.email || provider.phone || 'No contact info'}</p>
                </div>
              </div>
              <button
                onClick={() => removeProvider(provider.id)}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button
          onClick={prevStep}
          className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-3 bg-wine-600 text-white rounded-xl font-medium hover:bg-wine-700 transition-colors flex items-center gap-2"
        >
          Continue
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  )
}

function POSStep() {
  const { data, updatePOS, nextStep, prevStep, markStepComplete } = useOnboarding()

  const posOptions = [
    { id: 'square', name: 'Square', logo: '■' },
    { id: 'toast', name: 'Toast', logo: '🍞' },
    { id: 'clover', name: 'Clover', logo: '🍀' },
    { id: 'lightspeed', name: 'Lightspeed', logo: '⚡' },
    { id: 'other', name: 'Other', logo: '•••' },
    { id: 'none', name: 'Skip for now', logo: '→' },
  ]

  const handleNext = () => {
    markStepComplete(6)
    nextStep()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">POS Integration</h2>
        <p className="text-gray-600">Connect your point of sale system (optional)</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {posOptions.map(pos => (
          <button
            key={pos.id}
            onClick={() => updatePOS({ provider: pos.id as any })}
            className={`p-6 rounded-xl border-2 transition-all text-left ${
              data.pos.provider === pos.id
                ? 'border-wine-500 bg-wine-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className="text-3xl mb-2 block">{pos.logo}</span>
            <h3 className="font-semibold text-gray-900">{pos.name}</h3>
          </button>
        ))}
      </div>

      {data.pos.provider && data.pos.provider !== 'none' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <p className="text-blue-700">
            <Sparkles className="w-5 h-5 inline mr-2" />
            {data.pos.provider === 'other' 
              ? 'Contact us to set up your custom POS integration.'
              : `We'll help you connect your ${data.pos.provider} account after setup.`}
          </p>
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button
          onClick={prevStep}
          className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-3 bg-wine-600 text-white rounded-xl font-medium hover:bg-wine-700 transition-colors flex items-center gap-2"
        >
          Continue
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  )
}

function ReviewStep() {
  const { data, completeOnboarding, prevStep } = useOnboarding()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  const handleComplete = async () => {
    setIsSubmitting(true)
    await completeOnboarding()
    navigate('/')
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Review & Complete</h2>
        <p className="text-gray-600">Review your setup before getting started</p>
      </div>

      <div className="space-y-4 mb-8">
        {/* Restaurant */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="w-5 h-5 text-wine-600" />
            <h3 className="font-semibold text-gray-900">Restaurant</h3>
          </div>
          <p className="text-gray-600">{data.restaurant.name || 'Not set'}</p>
          <p className="text-sm text-gray-500">{data.restaurant.address}, {data.restaurant.city}</p>
        </div>

        {/* Team */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-wine-600" />
            <h3 className="font-semibold text-gray-900">Team</h3>
          </div>
          <p className="text-gray-600">{data.team.length} team member{data.team.length !== 1 ? 's' : ''} invited</p>
        </div>

        {/* Wines */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <Wine className="w-5 h-5 text-wine-600" />
            <h3 className="font-semibold text-gray-900">Wine Inventory</h3>
          </div>
          <p className="text-gray-600">{data.wines.length} wine{data.wines.length !== 1 ? 's' : ''} imported</p>
          {data.wines.filter(w => w.status === 'unknown').length > 0 && (
            <p className="text-sm text-amber-600">
              {data.wines.filter(w => w.status === 'unknown').length} need research
            </p>
          )}
        </div>

        {/* Providers */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <Truck className="w-5 h-5 text-wine-600" />
            <h3 className="font-semibold text-gray-900">Providers</h3>
          </div>
          <p className="text-gray-600">{data.providers.length} provider{data.providers.length !== 1 ? 's' : ''} added</p>
        </div>

        {/* POS */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-5 h-5 text-wine-600" />
            <h3 className="font-semibold text-gray-900">POS Integration</h3>
          </div>
          <p className="text-gray-600 capitalize">{data.pos.provider === 'none' ? 'Skipped' : data.pos.provider}</p>
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button
          onClick={prevStep}
          className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={handleComplete}
          disabled={isSubmitting}
          className="px-8 py-3 bg-wine-600 text-white rounded-xl font-semibold hover:bg-wine-700 transition-colors flex items-center gap-2 shadow-lg shadow-wine-600/30"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Setting up...
            </>
          ) : (
            <>
              Complete Setup
              <CheckCircle className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}

function CompleteStep() {
  const navigate = useNavigate()

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center max-w-xl mx-auto"
    >
      <div className="w-24 h-24 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-500/30">
        <CheckCircle className="w-12 h-12 text-white" />
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">You're All Set!</h1>
      <p className="text-xl text-gray-600 mb-8">
        Your WineOps account is ready. Start managing your wine inventory like a pro.
      </p>
      <button
        onClick={() => navigate('/')}
        className="px-8 py-4 bg-wine-600 text-white rounded-xl font-semibold text-lg hover:bg-wine-700 transition-colors shadow-lg shadow-wine-600/30"
      >
        Go to Dashboard
      </button>
    </motion.div>
  )
}

// Main onboarding component
function OnboardingContent() {
  const { currentStep, stepIndex, progress } = useOnboarding()

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome': return <WelcomeStep />
      case 'restaurant': return <RestaurantStep />
      case 'manager': return <ManagerStep />
      case 'team': return <TeamStep />
      case 'inventory': return <InventoryStep />
      case 'providers': return <ProvidersStep />
      case 'pos': return <POSStep />
      case 'review': return <ReviewStep />
      case 'complete': return <CompleteStep />
      default: return <WelcomeStep />
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-wine-50/20 to-gray-50">
      {/* Progress bar */}
      {currentStep !== 'welcome' && currentStep !== 'complete' && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-gray-200 z-50">
          <motion.div
            className="h-full bg-wine-600"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}

      {/* Step indicators */}
      {currentStep !== 'welcome' && currentStep !== 'complete' && (
        <div className="pt-8 pb-4 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2">
              {ONBOARDING_STEPS.slice(1, -1).map((step, i) => (
                <div
                  key={step.id}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < stepIndex - 1
                      ? 'bg-wine-600'
                      : i === stepIndex - 1
                      ? 'bg-wine-600 w-4'
                      : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
            <p className="text-center text-sm text-gray-500 mt-2">
              Step {stepIndex} of {ONBOARDING_STEPS.length - 2}
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-6 py-8">
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function Onboarding() {
  return (
    <OnboardingProvider>
      <OnboardingContent />
    </OnboardingProvider>
  )
}

export default Onboarding
