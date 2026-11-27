import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getInventory } from '../../services/api/inventory'
import { notCounted, toCountGood, type CountGood } from '../../lib/firstCount'

/**
 * onboarding-r110-g2: the /house row that opens the first count. No row once
 * every good is counted; a failed read offers the count without a number.
 */
export function HouseCountRow() {
  const [left, setLeft] = useState<number | 'unread' | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const rows = await getInventory()
        const goods = (Array.isArray(rows) ? rows : []).map(toCountGood).filter((g): g is CountGood => g !== null)
        if (live) setLeft(notCounted(goods).length)
      } catch {
        if (live) setLeft('unread')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  if (left === null || left === 0) return null
  return (
    <div className="py-6" data-testid="house-count-row">
      <Link to="/house/count" className="block min-h-[44px] font-serif text-2xl">
        Count what is on the shelf
        {left !== 'unread' && (
          <span className="text-[#6d685f]">
            {' '}
            · {left} {left === 1 ? 'good' : 'goods'} from your menu, not counted yet
          </span>
        )}
      </Link>
    </div>
  )
}
