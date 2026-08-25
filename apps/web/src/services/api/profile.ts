import { apiClient } from './client'

export interface LinkedProviders {
  google: boolean
  microsoft: boolean
}

export interface ProfileMe {
  userId: string
  email: string
  name: string
  phone?: string | null
  role: string
  hasPassword: boolean
  linkedProviders: LinkedProviders
}

export const profileApi = {
  async getMe(): Promise<ProfileMe> {
    const { data } = await apiClient.get<{ success: boolean; user: ProfileMe }>('/auth/me')
    return data.user
  },

  async updateMe(body: { name?: string; phone?: string }): Promise<ProfileMe> {
    const { data } = await apiClient.patch<{ success: boolean; user: ProfileMe }>(
      '/auth/me',
      body,
    )
    return data.user
  },

  async changePassword(body: {
    currentPassword?: string
    newPassword: string
  }): Promise<void> {
    await apiClient.post('/auth/me/password', body)
  },

  async getLinkedProviders(): Promise<LinkedProviders> {
    const { data } = await apiClient.get<{ success: boolean; linkedProviders: LinkedProviders }>(
      '/auth/me/linked-providers',
    )
    return data.linkedProviders
  },

  async linkProvider(
    provider: 'google' | 'microsoft',
    body: { token: string },
  ): Promise<{ linkedProviders: LinkedProviders }> {
    const { data } = await apiClient.post<{
      success: boolean
      linkedProviders: LinkedProviders
    }>(`/auth/me/link/${provider}`, body)
    return { linkedProviders: data.linkedProviders }
  },

  async unlinkProvider(
    provider: 'google' | 'microsoft',
  ): Promise<{ linkedProviders: LinkedProviders }> {
    const { data } = await apiClient.delete<{
      success: boolean
      linkedProviders: LinkedProviders
    }>(`/auth/me/link/${provider}`)
    return { linkedProviders: data.linkedProviders }
  },
}
