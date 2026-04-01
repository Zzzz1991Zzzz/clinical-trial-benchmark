import React, { useEffect, useState } from 'react'
import FaqAccordion from '../components/FaqAccordion'
import { api } from '../utils/api'

function About() {
  const [content, setContent] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.getHomeContent()
      .then(({ content: row }) => setContent(row))
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <div className="alert alert-error">{error}</div>
  if (!content) return <div className="loading-card">Loading instructions...</div>

  return (
    <div className="page-shell">
      <div className="section-header">
        <p className="eyebrow">Instructions</p>
        <h1 className="page-title">{content.introduction.title}</h1>
      </div>
      <div className="card prose-card">
        {content.introduction.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      <div className="card top-gap">
        <h2 className="section-title">Submission JSON Example</h2>
        <pre className="code-block">{`{
  "answers": [
    { "problem_id": 201, "answer": "A" },
    { "problem_id": 202, "answer": "B" }
  ]
}`}</pre>
      </div>

      <section className="info-section">
        <div className="section-header">
          <p className="eyebrow">FAQ</p>
          <h2>Frequently Asked Questions</h2>
        </div>
        <FaqAccordion items={content.faq} />
      </section>
    </div>
  )
}

export default About
