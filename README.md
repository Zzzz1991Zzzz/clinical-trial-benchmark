# Clinical Trial Arena

Clinical Trial Arena is a benchmark website MVP for evaluating model performance on clinical-trial-related tasks.  
This repository contains a React frontend and an Express backend with benchmark browsing, published leaderboard tables, submission flow, account system, email verification, user history, and an admin overview.

## Project Structure

```text
clinical-trial-benchmark/
├── backend/    # Express API, auth, benchmark data, submission logic
├── frontend/   # React + Vite frontend
├── package.json
└── README.md
```

## Main Features

- Dynamic benchmark tabs
- Published benchmark leaderboard display
- Open benchmark download and submission flow
- User signup, signin, signout
- Email verification with code
- Submission history and submission detail pages
- Instructions and FAQ pages
- Admin overview page

## Tech Stack

### Frontend

- React
- React Router
- Vite

### Backend

- Node.js
- Express
- SQLite via `better-sqlite3`
- Cookie-based session auth

## Requirements

- Node.js 18+ recommended
- npm

## Install Dependencies

From the project root:

```bash
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..
```

## Run Locally

Open two terminals.

### 1. Start the backend

Recommended:

```bash
cd backend
npm start
```

The backend `dev` script uses `node --watch`, but in some environments it may restart unexpectedly.  
For normal local use, `npm start` is the safer option.

The backend runs on:

```text
http://localhost:3001
```

### 2. Start the frontend

```bash
cd frontend
npm run dev
```

Vite will usually run on:

```text
http://localhost:5173
```

If port `5173` is already occupied, Vite may switch to `5174` or another free port.

### 3. Open the website

Open the frontend URL shown in the terminal, for example:

```text
http://localhost:5173
```

## Admin Configuration

Admin credentials are configured through environment variables.
For local development, copy values from [backend/.env.example](/mnt/d/1_study/research/clinical-trial-benchmark/backend/.env.example) into a local `backend/.env`.
For Cloud Run, set real values in the `Variables & Secrets` section of the service configuration.

## Environment Variables

Current backend environment variables:

- `PORT=3001`
- `NODE_ENV=production`
- `JWT_SECRET=replace_me`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=replace_me`
- `ADMIN_EMAIL=admin@example.com`
- `SMTP_HOST=smtp.example.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_USER=your_smtp_username`
- `SMTP_PASS=your_smtp_password`
- `MAIL_FROM=no-reply@example.com`

## Available Pages

- `/` benchmark home page
- `/about` instructions and FAQ
- `/login` sign in
- `/register` create account
- `/verify-email` verify email with code
- `/submit` submit benchmark answers
- `/my-submissions` personal history
- `/submission/:id` submission detail
- `/admin` admin overview

## API Summary

### Authentication

- `POST /api/auth/signup`
- `POST /api/auth/signin`
- `POST /api/auth/logout`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `GET /api/me`

### Benchmarks

- `GET /api/benchmarks`
- `GET /api/benchmarks/:id`
- `GET /api/benchmarks/:id/leaderboard`
- `GET /api/benchmarks/:id/download`

### Submissions

- `POST /api/submissions`
- `GET /api/submissions/my`
- `GET /api/submissions/:id`

### Content

- `GET /api/content/home`

### Admin

- `GET /api/admin/stats`
- `GET /api/admin/users`

## Submission Format

The current submission payload is JSON and must look like this:

```json
{
  "benchmark_version": "26/06 Benchmark",
  "answers": [
    { "problem_id": 201, "answer": "A" },
    { "problem_id": 202, "answer": "B" },
    { "problem_id": 203, "answer": "C" }
  ],
  "total_cost": 123.45
}
```

Validation rules:

- `benchmark_version` is required
- `answers` must be a list
- `problem_id` must be an integer from `0` to `9999`
- `answer` must be one of `A`, `B`, `C` (case-insensitive input is normalized)
- `total_cost` must be numeric and `>= 0`

## Build Frontend

```bash
cd frontend
npm run build
```

## Notes

- The frontend proxies `/api/*` requests to the backend at `http://localhost:3001`.
- If the frontend shows `Request failed` or Vite reports `ECONNREFUSED 127.0.0.1:3001`, the backend is not running.
- If SMTP variables are not configured, email verification codes are printed in the backend terminal instead of being sent by email.
- Benchmark availability is controlled by backend benchmark state and timestamps.
- If there is no currently open benchmark, submissions will be rejected by the backend.

## Deployment Direction

For a quick first public deployment, the simplest approach is:

- Google Cloud Compute Engine VM
- Node.js + Nginx
- Static public IP
- Optional domain + HTTPS

For a more production-oriented future setup, the next step would be:

- Cloud Run
- Cloud SQL
- Secret Manager
- Cloud Build
