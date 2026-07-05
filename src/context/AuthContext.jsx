import { createContext, useContext, useEffect, useState } from 'react'
import { authApi } from '../lib/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // bootstrap: ask the backend who we are (uses the session cookie)
  useEffect(() => {
    let alive = true
    authApi.me()
      .then(r => { if (alive) setUser(r?.user || null) })
      .catch(() => { if (alive) setUser(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const login = async (email, password) => {
    const r = await authApi.login(email, password)
    setUser(r.user)
    return r.user
  }

  const signup = async (email, password, name, org) => {
    const r = await authApi.signup(email, password, name, org)
    setUser(r.user)
    return r.user
  }

  const logout = async () => {
    try { await authApi.logout() } finally { setUser(null) }
  }

  const completeOnboarding = async (org) => {
    const r = await authApi.completeOnboarding(org)
    if (r?.user) setUser(r.user)
    return r?.user
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, completeOnboarding }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
