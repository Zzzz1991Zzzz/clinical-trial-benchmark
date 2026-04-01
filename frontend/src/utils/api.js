const API_BASE = '/api'

async function request(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.message || 'Request failed')
  }
  return data
}

export const api = {
  login: (username, password) => request('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  register: (payload) => request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  verifyEmail: (code) => request('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  resendVerification: () => request('/auth/resend-verification', { method: 'POST' }),
  getProfile: () => request('/me'),

  getBenchmarks: () => request('/benchmarks'),
  getBenchmarkLeaderboard: (id) => request(`/benchmarks/${id}/leaderboard`),
  getDownloadUrl: (id) => `${API_BASE}/benchmarks/${id}/download`,
  getHomeContent: () => request('/content/home'),

  submit: (payload) => request('/submissions', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  getMySubmissions: () => request('/submissions/my'),
  getSubmission: (id) => request(`/submissions/${id}`),

  getStats: () => request('/admin/stats'),
  getUsers: () => request('/admin/users'),
  getAdminSubmissions: () => request('/admin/submissions'),
  getAdminAnnouncement: () => request('/admin/content/announcement'),
  updateAdminAnnouncement: (items) => request('/admin/content/announcement', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  }),
}
