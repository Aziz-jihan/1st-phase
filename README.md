# GridWise Energy Optimizer

GridWise Smart Campus Energy Optimization Challenge — an LLM-assisted API that interprets operator directives and produces energy optimization plans.

## Features

- Express-based REST API
- LLM-assisted interpretation of operator directives (via OpenRouter)
- Linear programming optimization (`javascript-lp-solver`)
- Request validation with Zod
- Guardrail checks before executing optimization plans

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

## Environment Variables

See [`.env.example`](./.env.example) for the full list. At minimum, you need:

- `OPENROUTER_API_KEY` — your OpenRouter API key


