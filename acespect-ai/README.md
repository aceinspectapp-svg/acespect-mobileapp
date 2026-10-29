# acespect-ai

Python FastAPI + LangGraph multi-agent service that reviews submitted building
inspections. The Node backend (`acespect-backend`) enqueues review jobs on
a PostgreSQL-backed queue (pg-boss); its worker calls this service's `POST /review` per job (the "hybrid"
split — queue/retries in Node, agents in Python).

## Agent graph

```
START → [form ∥ photo] → risk → summary → END
```

- **form** — validates the submitted form (missing fields, inconsistencies)
- **photo** — vision: detects defects in inspection photos (needs image URLs)
- **risk** — scores overall risk from the form + photo findings
- **summary** — synthesises the reviewer-facing summary + advisory recommendation

Agents call Claude through the official `anthropic` SDK using forced tool use for
schema-valid JSON. Model per agent is configurable (see `.env.example`).

## Run

```bash
python -m venv .venv
. .venv/Scripts/activate        # Windows; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env            # set ANTHROPIC_API_KEY, or leave blank for STUB mode
uvicorn app.main:app --port 8000 --reload
```

`GET /health` reports whether it's in **stub mode** (no key → deterministic fake
outputs, so the pipeline is testable without spending tokens).

## Wire to the backend

In `acespect-backend/.env` set `AI_SERVICE_URL=http://localhost:8000` and restart
the worker (`npm run dev:worker`). With it unset, the worker simulates reviews
itself and never calls this service.
