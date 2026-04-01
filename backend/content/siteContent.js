module.exports = {
  announcement: {
    items: [
      {
        date: 'March 31',
        parts: [
          { type: 'text', value: 'We added two new benchmark releases and published the ' },
          { type: 'link', label: 'Winter 2025 Leaderboard', href: '#' },
          { type: 'text', value: ' and ' },
          { type: 'link', label: 'Summer 2025 Leaderboard', href: '#' },
          { type: 'text', value: '.' }
        ]
      },
      {
        date: 'March 31',
        parts: [
          { type: 'text', value: 'The ' },
          { type: 'link', label: 'Summer Open 2026', href: '#' },
          { type: 'text', value: ' benchmark is now live and accepting submissions.' }
        ]
      }
    ]
  },
  introduction: {
    title: 'About CT Open',
    paragraphs: [
      'Scientists have long sought to accurately predict outcomes of real-world events before they happen. Can AI systems do so more reliably? We study this question through clinical trial outcome prediction, a high-stakes open challenge even for domain experts, with immediate consequences for patients, pharmaceutical companies, and investors.',
      'We introduce CT Open, an open-access, live platform that would run four challenge-cycles every year. Anyone can submit predictions for clinical trial outcomes in each challenge-cycle. In the next cycle, CT Open evaluates those submissions on trials whose outcomes were not yet public at the submission deadline but became public afterwards.',
      'Determining if a trial\'s outcome is public on the internet before a certain date is surprisingly difficult. Outcomes posted on official registries may lag behind years, while the first mention may appear in obscure news articles. To address this, we propose a novel, fully automated pipeline that uses iterative LLM-powered web search to identify the earliest mention of trial outcomes.',
      'We validate the pipeline’s quality and accuracy by human expert\'s annotations. Since CT Open’s pipeline ensures that every evaluated trial had no publicly reported outcome when the prediction was made, it allows participants to use any methodology and any data source.',
      'In this paper, we release a large-scale training set and two time-stamped test benchmarks, Winter25 and Summer25. We present promising results showing that retrieval-augmented and agentic LLMs outperform baseline methods. We believe CT Open can serve as a central hub for advancing AI research on forecasting real-world outcomes before they occur, while also informing biomedical research and improving clinical trial design.'
    ],
    links: [
      { label: 'Code', href: '#' },
      { label: 'Report / PDF', href: '#' }
    ]
  },
  faq: [
    {
      question: 'How exactly do you compute Average F1 Macro?',
      answer: 'Average F1 Macro is computed by calculating F1 for each benchmark subtask category independently and then averaging those category scores with equal weight. This avoids over-rewarding categories with more rows and keeps the headline score comparable across benchmark releases.'
    },
    {
      question: 'What does Cross Entropy mean in this table?',
      answer: 'Cross Entropy measures how well a model assigns probability mass to the correct label. Lower values are better. In Clinical Trial Arena, we display it next to F1 so the leaderboard captures both discrete prediction quality and confidence calibration.'
    },
    {
      question: 'How is the cost calculated?',
      answer: 'Cost is reported by submitters as the total benchmark inference cost for the uploaded run. The MVP stores the submitted numeric value directly so teams can compare accuracy-quality tradeoffs alongside benchmark metrics.'
    },
    {
      question: 'Why are some benchmarks open for submission but do not yet show results?',
      answer: 'Open benchmarks intentionally hide the final leaderboard until the submission window closes and ground-truth answers are ready to publish. This prevents leakage and ensures everyone is evaluated against the same final answer key.'
    },
    {
      question: 'How do you validate a submission file?',
      answer: 'Each uploaded JSON is validated in layers: authenticated request checks, JSON parsing, schema validation, and semantic validation against the canonical benchmark manifest. The server rejects duplicate problem IDs, missing required problems, unknown IDs, and invalid cost values.'
    },
    {
      question: 'What should the submission JSON look like?',
      answer: 'The MVP expects a JSON object with benchmark_version, answers, and total_cost. answers must be a list of objects that each include problem_id and answer. The benchmark version is human-readable, but the backend resolves it to a stable benchmark record internally.'
    },
    {
      question: 'Can I submit multiple times?',
      answer: 'Yes. The platform stores each submission attempt in your personal history. Open benchmarks may accept multiple submissions during the submission window, while published leaderboards remain read-only.'
    },
    {
      question: 'Why do some benchmark tabs have tables while others only have a submission call?',
      answer: 'Tabs are driven by benchmark lifecycle state. Published benchmarks render historical result tables, while open benchmarks render download and submission actions. As each cycle closes and results are published, that tab changes from submission mode into leaderboard mode.'
    },
    {
      question: 'How can I contact the team?',
      answer: 'For the MVP, use the placeholder contact workflow referenced in the site footer or report link. In a production deployment, this would typically route through a monitored team email alias or support form.'
    },
    {
      question: 'When will the 26/06 Benchmark leaderboard be published?',
      answer: 'The 26/06 Benchmark leaderboard appears after the submission window closes and results are published according to its benchmark schedule. Until then, the tab remains submission-focused and your uploads are stored as pending results.'
    }
  ]
};
