# GridWise Energy Optimizer

GridWise Smart Campus Energy Optimization Challenge — an LLM-assisted API that interprets operator directives and produces energy optimization plans.

## Features

- Express-based REST API
- LLM-assisted interpretation of operator directives (via OpenRouter)
- Linear programming optimization (`javascript-lp-solver`)
- Request validation with Zod
- Guardrail checks before executing optimization plans

## Live Deployment

The API is deployed on Render at:

- **Base URL:** `https://onest-phase.onrender.com`
- **Health check:** `GET https://onest-phase.onrender.com/health`
- **Optimize energy:** `POST https://onest-phase.onrender.com/optimize-energy`

> Note: free Render instances spin down when idle, so the response may delay over 1 minute due to cold start on the first request after inactivity.

## Requirements

- Node.js >= 18.0.0
- An [OpenRouter](https://openrouter.ai/) API key

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/<repo-name>.git
   cd <repo-name>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create your `.env` file from the example and fill in your API key:
   ```bash
   cp .env.example .env
   ```

## Running

Start the server:
```bash
npm start
```

Run in watch mode (auto-restarts on file changes):
```bash
npm run dev
```

The server runs on `http://localhost:3000` by default (configurable via `PORT`).

## Endpoints

| Method | Endpoint           | Description                              |
|--------|---------------------|-------------------------------------------|
| GET    | `/health`           | Health check                             |
| POST   | `/optimize-energy`  | Submit an operator directive for optimization |

These are available both locally (`http://localhost:3000`) and on the live deployment above.

## Project Structure

```
src/
├── app.js                     # Express app setup
├── server.js                  # Entry point
├── controllers/
│   └── energy.controller.js   # Request handlers
├── routes/
│   ├── energy.routes.js       # /optimize-energy route
│   └── health.routes.js       # /health route
├── services/
│   ├── llm.service.js         # LLM (OpenRouter) integration
│   └── optimizer.service.js   # Linear programming optimization logic
├── utils/
│   └── replay.js              # Replay utility
└── validators/
    ├── guardrail.js           # Safety/guardrail checks
    └── request.schema.js      # Zod request schemas
```

## Docker

The repository includes a `Dockerfile` based on the official Node.js 18 Alpine image. The image installs production dependencies, exposes port `3000`, and runs the API as the non-root `node` user.

### Build the image

From the repository root, run:

```bash
docker build -t gridwise-energy-optimizer .
```

### Run the container

Pass your OpenRouter API key when starting the container:

```bash
docker run --rm -p 3000:3000 \
  -e OPENROUTER_API_KEY=your_openrouter_api_key \
  gridwise-energy-optimizer
```

The API is then available at `http://localhost:3000`. Check that the container is running with:

```bash
curl http://localhost:3000/health
```
