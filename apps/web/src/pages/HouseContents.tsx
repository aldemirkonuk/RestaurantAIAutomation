import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/brand/BrandMark'
import { addCustomProvider } from '../services/api/vendors'
import { updateOnboardingProgress } from '../services/api/menus'
import { pencilledCount, readProof } from '../lib/firstProof'

export default function HouseContents() {
  const navigate = useNavigate()
  const proof = readProof()
  const pencilled = proof ? pencilledCount(proof.items) : 0
  const [supplier, setSupplier] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveSupplier = async () => {
    if (!supplier.trim()) return
    setSaving(true)
    setError(null)
    try {
      await addCustomProvider({ name: supplier.trim() })
      await updateOnboardingProgress({ vendor_added: true })
      setSaved(true)
    } catch (cause: any) {
      setError(cause?.response?.data?.message || cause?.message || 'We could not add that supplier yet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#211f1b]">
      <header className="h-14 border-b border-[#211f1b]/15 bg-white px-5 flex items-center justify-between">
        <BrandMark size={24} alt="Mudavym" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6d685f]">The house</span>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">Contents</p>
        <h1 className="mt-3 font-serif text-5xl">Your house.</h1>
        <p className="mt-4 text-[#6d685f]">One thing at a time. The rest can wait.</p>

        <div className="mt-12 divide-y divide-[#211f1b]/15 border-y border-[#211f1b]/15">
          <div className="py-6">
            <p className="text-xs uppercase tracking-wider text-[#6d685f]">Menu</p>
            {proof ? (
              <button
                type="button"
                onClick={() => navigate('/house/menu')}
                className="mt-2 block text-left font-serif text-2xl"
              >
                {pencilled === 0 ? 'The first proof is set.' : `${pencilled} pencilled`}
              </button>
            ) : (
              <p className="mt-2 font-serif text-2xl text-[#6d685f]">No menu read yet.</p>
            )}
          </div>

          {saved ? (
            <p className="py-6 font-serif text-2xl">{supplier.trim()} is on the book.</p>
          ) : (
            <form
              className="py-6"
              onSubmit={(event) => {
                event.preventDefault()
                void saveSupplier()
              }}
            >
              <p className="text-xs uppercase tracking-wider text-[#1a5e6b]">The one ask · optional</p>
              <label className="mt-2 block">
                <span className="font-serif text-2xl">Who supplies you?</span>
                <input
                  aria-label="Supplier"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  placeholder="A name is enough"
                  className="mt-3 block w-full border-b border-[#211f1b]/25 bg-transparent pb-2 text-lg outline-none"
                />
              </label>
              {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={!supplier.trim() || saving}
                className="mt-5 bg-[#1a5e6b] px-5 py-2.5 text-white disabled:opacity-40"
              >
                {saving ? 'Adding…' : 'Add this supplier'}
              </button>
            </form>
          )}

          <p className="py-6 font-serif text-2xl text-[#b7b2a8]">Last invoice · later</p>
        </div>
      </main>
    </div>
  )
}
