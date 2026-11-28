import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getInventory } from '../../services/api/inventory'
import { useAuth } from '../../contexts/AuthContext'
import { notCounted, toCountGood, type CountGood } from '../../lib/firstCount'

/**
 * onboarding-r110-g2: the /house row that opens the first count. No row once
 * every good is counted; a failed read offers the count without a number.
 */
export function HouseCountRow() {
  const [left, setLeft] = useState<number | 'unread' | null>(null)
  // The house is the session's, not localStorage's (see HouseCount).
  const { user } = useAuth()
  const houseId = user ? user.restaurantId || '' : null
  useEffect(() => {
    let live = true
    if (houseId === null) return
    if (houseId === '') {
      setLeft('unread')
      return
    }
    ;(async () => {
      try {
        const rows = await getInventory(houseId)
        const goods = (Array.isArray(rows) ? rows : []).map(toCountGood).filter((g): g is CountGood => g !== null)
        if (live) setLeft(notCounted(goods).length)
      } catch {
        if (live) setLeft('unread')
      }
    })()
    return () => {
      live = false
    }
  }, [houseId])

  if (left === null || left === 0) return null
  return (
    <div className="py-6" data-testid="house-count-row">
      <Link to="/house/count" className="block min-h-[44px] font-serif text-2xl">
        Count what is on the shelf
        <span className="text-[#6d685f]">
          {' '}
          · {left === 'unread' ? 'We could not count your goods just now' : `${left} ${left === 1 ? 'good' : 'goods'}, not counted yet`}
        </span>
      </Link>
    </div>
  )
}
