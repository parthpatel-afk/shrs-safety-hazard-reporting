/**
 * useAuth — manager session stored in localStorage
 * Session shape: { id, name, username, plant, department, zone, line, company_id }
 */

export function getSession(companySlug) {
  try {
    const raw = localStorage.getItem(`shrs_session_${companySlug}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveSession(companySlug, manager) {
  localStorage.setItem(`shrs_session_${companySlug}`, JSON.stringify(manager))
}

export function clearSession(companySlug) {
  localStorage.removeItem(`shrs_session_${companySlug}`)
}
