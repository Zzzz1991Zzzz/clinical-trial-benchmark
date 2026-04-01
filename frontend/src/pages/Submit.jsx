import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../utils/api'

function Submit({ user }) {
  const [benchmarks, setBenchmarks] = useState([])
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.getBenchmarks()
      .then(({ benchmarks: rows }) => {
        const openRows = rows.filter((item) => item.is_submission_open)
        setBenchmarks(openRows)
      })
      .catch((err) => setError(err.message))
  }, [])

  const selectedBenchmark = useMemo(() => benchmarks[0] || null, [benchmarks])

  function handleFileUpload(event) {
    const file = event.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must not exceed 5 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = (loadEvent) => setJsonText(loadEvent.target.result)
    reader.readAsText(file)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!user.email_verified) {
      setError('Verify your email before submitting.')
      return
    }

    if (!jsonText.trim()) {
      setError('Please upload a JSON file before submitting.')
      return
    }

    let payload
    try {
      payload = JSON.parse(jsonText)
    } catch {
      setError('Invalid JSON format. Please upload valid UTF-8 JSON.')
      return
    }

    setLoading(true)
    try {
      await api.submit({
        payload,
      })
      setSuccess('Submission received. It has been stored as pending results.')
      setTimeout(() => navigate('/my-submissions'), 1200)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="section-header">
        <p className="eyebrow">Submission Flow</p>
        <h1 className="page-title">Submit benchmark answers</h1>
      </div>
      <p className="page-subtitle">
        Upload JSON for the current open benchmark. The benchmark is unique and is resolved automatically by the backend.
      </p>

      {!user.email_verified && (
        <div className="alert alert-error">
          Your account is signed in but not verified yet. Complete email verification before submitting.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          {selectedBenchmark && (
            <div className="callout">
              <strong>{selectedBenchmark.display_name}</strong> accepts submissions until{' '}
              {new Date(selectedBenchmark.submission_close_at).toLocaleDateString()}.
            </div>
          )}

          {!selectedBenchmark && (
            <div className="alert alert-error">
              There is no open benchmark right now, so submissions are temporarily unavailable.
            </div>
          )}

          <div className="form-group">
            <label>Upload JSON File</label>
            <input type="file" accept=".json,application/json" onChange={handleFileUpload} />
          </div>

          <div className="form-group">
            <label>JSON Formatting Rules</label>
            <div className="card prose-card">
              <p>Upload a UTF-8 encoded JSON file. Direct pasting is not supported here.</p>
              <p>Required fields:</p>
              <pre className="code-block">{`{
  "answers": [
    { "problem_id": 201, "answer": "A" },
    { "problem_id": 202, "answer": "B" }
  ]
}`}</pre>
              <p>Optional fields:</p>
              <pre className="code-block">{`{
  "total_cost": 123.45
}`}</pre>
              <p>"problem_id" must be an integer, and "answer" must be A, B, or C.</p>
            </div>
          </div>

          <div className="button-row">
            <button type="submit" className="btn btn-primary" disabled={loading || !selectedBenchmark}>
              {loading ? 'Submitting...' : 'Submit JSON'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Submit
