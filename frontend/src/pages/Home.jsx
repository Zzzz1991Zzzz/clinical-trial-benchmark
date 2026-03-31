import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import FaqAccordion from '../components/FaqAccordion'
import { api } from '../utils/api'

function formatMetric(value, digits = 2) {
  return typeof value === 'number' ? value.toFixed(digits) : '-'
}

const METRIC_GROUPS = [
  {
    key: 'endpoint',
    label: 'Endpoint',
    columns: [
      { key: 'endpoint_prediction_f1', label: 'Macro-F1' },
      { key: 'endpoint_prediction_cross_entropy', label: 'W-Acc' },
    ],
  },
  {
    key: 'superiority',
    label: 'Superiority',
    columns: [
      { key: 'arm2arm_superiority_f1', label: 'Macro-F1' },
      { key: 'arm2arm_superiority_cross_entropy', label: 'W-Acc' },
    ],
  },
  {
    key: 'comparative_effect',
    label: 'Comparative Effect',
    columns: [
      { key: 'arm2arm_noninferiority_f1', label: 'Macro-F1' },
      { key: 'arm2arm_noninferiority_cross_entropy', label: 'W-Acc' },
    ],
  },
]

function PublishedBenchmarkTable({ benchmark, rows }) {
  const useUsernameIdentity = Number(benchmark.id) > 2
  const showHistoricalLayout = ['25-02', '25-09'].includes(benchmark.slug)

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
          {rows.map((row, index) => {
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
                  <strong>{useUsernameIdentity ? row.username : row.model}</strong>
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
    </div>
  )
}

function OpenBenchmarkPanel({ benchmark, user }) {
  return (
    <div className="open-benchmark-panel">
      <p className="eyebrow">Current Submission Window</p>
      <h2>{benchmark.display_name}</h2>
      <p>
        We are actively seeking submissions to solve the {benchmark.display_name}. Download the
        benchmark questions, run your pipeline, and upload a JSON file that matches the canonical
        manifest for this release.
      </p>

      <div className="cta-row">
        <a className="btn btn-primary" href={api.getDownloadUrl(benchmark.id)}>
          Download the Benchmark Questions
        </a>
        <Link className="btn btn-secondary" to="/submit">
          Ready to Submit?
        </Link>
      </div>

      {!user && (
        <div className="callout callout-warning">
          Please log in and submit. Open benchmarks only accept authenticated submissions.
        </div>
      )}

      {user && !user.email_verified && (
        <div className="callout callout-warning">
          Your account is signed in, but email verification is still required before submissions are accepted.
          <Link to="/verify-email"> Complete verification</Link>.
        </div>
      )}

      {user?.email_verified && (
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
          <p className="eyebrow">Engineering-ready MVP</p>
          <h1>Clinical Trial Arena</h1>
          <p>
            A benchmark platform for browsing benchmark releases, downloading question sets,
            submitting JSON answers, and comparing published results across clinical-trial tasks.
          </p>
        </div>
        <div className="hero-status">
          <div className="status-card">
            <strong>{benchmarks.length}</strong>
            <span>benchmark tabs live</span>
          </div>
          <div className="status-card">
            <strong>{benchmarks.filter((item) => item.is_result_published).length}</strong>
            <span>published result cycles</span>
          </div>
          <div className="status-card">
            <strong>{benchmarks.filter((item) => item.is_submission_open).length}</strong>
            <span>open submission windows</span>
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
              <small>{benchmark.state.replaceAll('_', ' ')}</small>
            </button>
          ))}
        </div>

        {activeBenchmark?.is_result_published ? (
          <div className="benchmark-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Published Results</p>
                <h2>{activeBenchmark.display_name}</h2>
              </div>
              <p className="panel-description">
                Historical benchmark results remain view-only and follow the published benchmark report layout.
              </p>
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
              <p className="eyebrow">Introduction</p>
              <h2>{content.introduction.title}</h2>
            </div>
            <div className="intro-grid">
              <div className="card prose-card">
                {content.introduction.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <div className="card link-card">
                <p className="mini-title">Resources</p>
                {content.introduction.links.map((link) => (
                  <a key={link.label} className="resource-link" href={link.href}>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </section>

          <section className="info-section">
            <div className="section-header">
              <p className="eyebrow">Support</p>
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
