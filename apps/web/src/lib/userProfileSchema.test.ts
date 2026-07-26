import { userProfileSchema } from './validation-schemas'

describe('userProfileSchema', () => {
  it('accepts a valid profile payload', () => {
    const parsed = userProfileSchema.parse({
      displayName: 'Hakki Germiyanligil',
      email: 'konukp@hotmail.com',
      phone: '+14155552671',
      role: 'manager',
    })
    expect(parsed.displayName).toBe('Hakki Germiyanligil')
  })

  it('rejects short display names', () => {
    const result = userProfileSchema.safeParse({
      displayName: 'A',
      email: 'a@b.com',
      role: 'staff',
    })
    expect(result.success).toBe(false)
  })

  it('allows omitting phone', () => {
    const parsed = userProfileSchema.parse({
      displayName: 'Staff Member',
      email: 'staff@wineops.com',
      role: 'staff',
    })
    expect(parsed.phone).toBeUndefined()
  })
})
