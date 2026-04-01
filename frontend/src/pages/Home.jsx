import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import FaqAccordion from '../components/FaqAccordion'
import { api } from '../utils/api'

const SCHEDULE_ROWS = [
  {
    challenge: 'Summer Open 2026',
    window: 'June–September',
    deadline: 'May 31, 2026',
    deadlineDate: '2026-05-31T23:59:59Z',
    release: 'September 7, 2026',
    releaseDate: '2026-09-07T23:59:59Z',
    status: 'Accepting Submission',
  },
  {
    challenge: 'Fall Open 2026',
    window: 'September–December',
    deadline: 'August 31, 2026',
    deadlineDate: '2026-08-31T23:59:59Z',
    release: 'December 7, 2026',
    releaseDate: '2026-12-07T23:59:59Z',
    status: 'Upcoming',
  },
  {
    challenge: 'Winter Open 2027',
    window: 'December–March',
    deadline: 'November 30, 2026',
    deadlineDate: '2026-11-30T23:59:59Z',
    release: 'March 7, 2027',
    releaseDate: '2027-03-07T23:59:59Z',
    status: 'Upcoming',
  },
  {
    challenge: 'Spring Open 2027',
    window: 'March–June',
    deadline: 'February 28, 2027',
    deadlineDate: '2027-02-28T23:59:59Z',
    release: 'June 7, 2027',
    releaseDate: '2027-06-07T23:59:59Z',
    status: 'Upcoming',
  },
]

function formatMetric(value, digits = 2) {
  return typeof value === 'number' ? value.toFixed(digits) : '-'
}

function formatLongCountdown(dateString) {
  const target = Date.parse(dateString)
  if (Number.isNaN(target)) return ''

  const diff = target - Date.now()
  if (diff <= 0) return '00 weeks 00 days 00:00:00'

  const totalSeconds = Math.floor(diff / 1000)
  const weeks = Math.floor(totalSeconds / (7 * 24 * 60 * 60))
  const days = Math.floor((totalSeconds % (7 * 24 * 60 * 60)) / (24 * 60 * 60))
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60))
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60)
  const seconds = totalSeconds % 60

  return `${String(weeks).padStart(2, '0')} weeks ${String(days).padStart(2, '0')} days ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const METRIC_GROUPS = [
  {
    key: 'endpoint',
    label: 'Endpoint',
    columns: [
      { key: 'endpoint_prediction_f1', label: 'Macro-F1' },
      { key: 'endpoint_prediction_cross_entropy', label: 'Balanced Accuracy' },
    ],
  },
  {
    key: 'superiority',
    label: 'Superiority',
    columns: [
      { key: 'arm2arm_superiority_f1', label: 'Macro-F1' },
      { key: 'arm2arm_superiority_cross_entropy', label: 'Balanced Accuracy' },
    ],
  },
  {
    key: 'comparative_effect',
    label: 'Comparative Effect',
    columns: [
      { key: 'arm2arm_noninferiority_f1', label: 'Macro-F1' },
      { key: 'arm2arm_noninferiority_cross_entropy', label: 'Balanced Accuracy' },
    ],
  },
]

function PublishedBenchmarkTable({ benchmark, rows }) {
  const useUsernameIdentity = Number(benchmark.id) > 2
  const showHistoricalLayout = ['25-02', '25-09'].includes(benchmark.slug)
  const displayedRows = rows
  const showContaminationNote = showHistoricalLayout

  function renderModelLabel(row) {
    const label = useUsernameIdentity ? row.username : (showHistoricalLayout ? row.username : row.model)
    const flaggedModel = ['Claude Opus 4.5', 'Claude Opus 4.5 + RAG'].includes(row.username)

    return (
      <>
        <strong>{label}</strong>
        {flaggedModel && <span className="contamination-flag" aria-label="Potential contamination">!</span>}
      </>
    )
  }

  return (
    <div className={`table-container ${showHistoricalLayout ? 'historical-table-shell' : ''}`}>
      <table className={showHistoricalLayout ? 'historical-results-table' : ''}>
        {showHistoricalLayout && (
          <colgroup>
            <col className="historical-col-model" />
            <col className="historical-col-metric" />
            <col className="historical-col-metric" />
            <col className="historical-col-metric" />
            <col className="historical-col-metric" />
            <col className="historical-col-metric" />
            <col className="historical-col-metric" />
          </colgroup>
        )}
        <thead>
          <tr>
            <th rowSpan="2">{useUsernameIdentity ? 'Username' : 'Model'}</th>
            {METRIC_GROUPS.map((group) => (
              <th key={group.key} colSpan={group.columns.length}>
                {group.label}
              </th>
            ))}
          </tr>
          <tr>
            {METRIC_GROUPS.flatMap((group) =>
              group.columns.map((column) => (
                <th key={`${group.key}-${column.key}`}>{column.label}</th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {displayedRows.map((row, index) => {
            if (row.is_section_header) {
              return (
                <tr key={`section-${benchmark.slug}-${index}`} className="historical-section-row">
                  <td colSpan={1 + METRIC_GROUPS.reduce((total, group) => total + group.columns.length, 0)}>
                    <em>{row.model}</em>
                  </td>
                </tr>
              )
            }

            return (
              <tr key={`${benchmark.slug}-${index}`} className={showHistoricalLayout ? 'historical-data-row' : ''}>
                <td className={showHistoricalLayout ? 'historical-model-cell' : ''}>
                  {renderModelLabel(row)}
                  {!useUsernameIdentity && !showHistoricalLayout && row.username && (
                    <div className="table-subtext">{row.username}</div>
                  )}
                </td>
                {METRIC_GROUPS.flatMap((group) =>
                  group.columns.map((column) => (
                    <td
                      key={`${benchmark.slug}-${index}-${column.key}`}
                      className={showHistoricalLayout ? 'historical-metric-cell' : ''}
                    >
                      {formatMetric(row[column.key], column.digits ?? 2)}
                    </td>
                  ))
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {showContaminationNote && (
        <div className="historical-note">
          <span className="contamination-flag" aria-hidden="true">!</span>{' '}
          Results marked with an asterisk may be contaminated because these model variants were released after the historical submission cutoff, so their training data or system updates may have included knowledge of trial outcomes that were not available to participants at submission time.
        </div>
      )}
    </div>
  )
}

function OpenBenchmarkPanel({ benchmark, user }) {
  return (
    <div className="open-benchmark-panel">
      <p className="eyebrow">Actively Looking for Submissions, Deadline to submit is May 31, 2026</p>
      <h2>{benchmark.display_name}</h2>
      <p>
        We are actively seeking submissions to participate in the Summer Open Challenge 2026.
        Download the benchmark questions, submit your predictions for each question, and upload a
        JSON file according to our formatting rules.
      </p>

      <div className="cta-row">
        <a className="btn btn-secondary" href={api.getDownloadUrl(benchmark.id)}>
          Download the Benchmark Questions
        </a>
        <Link className="btn btn-primary" to="/submit">
          Ready to Submit?
        </Link>
      </div>

      {!user && (
        <div className="callout callout-warning">
          Please log in and submit. We only accept submissions from authenticated users.
        </div>
      )}

      {user && !user.email_verified && (
        <div className="callout callout-warning">
          Your account is signed in, but email verification is still required before submissions are accepted.
          <Link to="/verify-email"> Complete verification</Link>.
        </div>
      )}

      {Boolean(user?.email_verified) && (
        <div className="callout callout-success">
          Your account is verified. You can download the file above and submit through the benchmark upload flow.
        </div>
      )}
    </div>
  )
}

function Home({ user }) {
  const [benchmarks, setBenchmarks] = useState([])
  const [leaderboards, setLeaderboards] = useState({})
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    async function load() {
      try {
        const [{ benchmarks: benchmarkRows }, { content: siteContent }] = await Promise.all([
          api.getBenchmarks(),
          api.getHomeContent(),
        ])

        setBenchmarks(benchmarkRows)
        setContent(siteContent)
        setActiveTab(benchmarkRows[0]?.id ?? null)

        const published = benchmarkRows.filter((item) => item.is_result_published)
        const leaderboardEntries = await Promise.all(
          published.map(async (item) => [item.id, await api.getBenchmarkLeaderboard(item.id)])
        )
        setLeaderboards(Object.fromEntries(leaderboardEntries))
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const activeBenchmark = useMemo(
    () => benchmarks.find((item) => item.id === activeTab) || benchmarks[0],
    [benchmarks, activeTab]
  )

  if (loading) return <div className="loading-card">Loading benchmark data...</div>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <h1>CT Open Challenge</h1>
          <p>
            An Open-Access, Uncontaminated, Live Platform for the Open Challenge of Clinical Trial Outcome Prediction.
          </p>
          {content?.announcement?.items?.length > 0 && (
            <div className="notice-board top-gap">
              {content.announcement.items.map((item) => (
                <div key={item.date} className="notice-line">
                  <span className="notice-icon" aria-hidden="true">🎉</span>
                  <div>
                    <strong>New ({item.date}): </strong>
                    {item.parts.map((part, index) =>
                      part.type === 'link' ? (
                        <a key={`${item.date}-${index}`} href={part.href}>
                          {part.label}
                        </a>
                      ) : (
                        <span key={`${item.date}-${index}`}>{part.value}</span>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="info-section">
        <div className="section-header">
          <h2>Schedule</h2>
        </div>
        <div className="card">
          <div className="table-container schedule-table-shell">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Challenge</th>
                  <th>Window</th>
                  <th>Submission Deadline (AOE)</th>
                  <th>Leaderboard Release (AOE)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {SCHEDULE_ROWS.map((row) => (
                  <tr key={row.challenge}>
                    <td>{row.challenge}</td>
                    <td>{row.window}</td>
                    <td>
                      <div>{row.deadline}</div>
                      {row.challenge === 'Summer Open 2026' && (
                        <small className="schedule-countdown">
                          {formatLongCountdown(row.deadlineDate, now)}
                        </small>
                      )}
                    </td>
                    <td>
                      <div>{row.release}</div>
                    </td>
                    <td>
                      <span className={row.status === 'Accepting Submission' ? 'schedule-status-live' : 'schedule-status-upcoming'}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="benchmark-section">
        <div className="benchmark-tabs">
          {benchmarks.map((benchmark) => (
            <button
              type="button"
              key={benchmark.id}
              className={`benchmark-tab ${activeBenchmark?.id === benchmark.id ? 'active' : ''}`}
              onClick={() => setActiveTab(benchmark.id)}
            >
              <span>{benchmark.display_name}</span>
              {benchmark.is_result_published && <small>leaderboard</small>}
            </button>
          ))}
        </div>

        {activeBenchmark?.is_result_published ? (
          <div className="benchmark-panel">
            <div className="panel-header">
              <div>
                <h2>{activeBenchmark.display_name} Leaderboard</h2>
              </div>
            </div>
            <PublishedBenchmarkTable benchmark={activeBenchmark} rows={leaderboards[activeBenchmark.id]?.leaderboard || []} />
          </div>
        ) : (
          <div className="benchmark-panel">
            <OpenBenchmarkPanel benchmark={activeBenchmark} user={user} />
          </div>
        )}
      </section>

      {content && (
        <>
          <section className="info-section">
            <div className="section-header">
              <h2>{content.introduction.title}</h2>
            </div>
            <div className="card prose-card">
              <p>{content.introduction.paragraphs.join(' ')}</p>
              {content.introduction.links
                .filter((link) => /report|pdf/i.test(link.label))
                .map((link) => (
                  <div key={link.label} className="button-row top-gap">
                    <a className="btn btn-secondary" href={link.href}>
                      {link.label}
                    </a>
                  </div>
                ))}
            </div>
          </section>

          <section className="info-section">
            <div className="section-header">
              <h2>Frequently Asked Questions</h2>
            </div>
            <FaqAccordion items={content.faq} />
          </section>
        </>
      )}
    </div>
  )
}

export default Home
