# KnowledgeBot SaaS - WhatsApp AI with Supabase RAG

KnowledgeBot is a multi-tenant WhatsApp assistant for businesses with large knowledge bases. It keeps the same operational base as the existing SaaS bots, but replaces vertical-specific knowledge with a Supabase vector memory/RAG layer.

## Stack

- Next.js 16 App Router
- Supabase Auth, Postgres, RLS and Realtime
- Supabase `pgvector` tables for permanent knowledge memory
- OpenRouter for chat completions (configurable via `CHAT_MODEL`)
- OpenAI-compatible embeddings endpoint for vector search
- Google Calendar for scheduling
- OpenWA / whatsapp-web.js for WhatsApp (local bridge, NOT Meta Cloud API)

## RAG Memory

The schema creates:
- `knowledge_documents`: source documents per organization
- `knowledge_chunks`: embedded fragments with `vector(1536)`
- `match_knowledge_chunks(...)`: RPC used by the agent tool `queryKnowledgeBase`

Embeddings are generated via an OpenAI-compatible API (default: `text-embedding-3-small` producing 1536d vectors). The RAG threshold is configurable via `RAG_MATCH_THRESHOLD` (default `0.35`).

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Fill Supabase, OpenRouter, embeddings, Google OAuth and encryption values.
3. Start the WhatsApp bridge:
   ```bash
   # In a separate terminal, from wa-server-knowledge/
   node server.js
   ```
4. Apply Supabase migrations in order:
   - `supabase/migrations/00001_initial_schema.sql`
   - `supabase/migrations/00002_add_agent_metadata.sql`
   - `supabase/migrations/00003_multi_line_whatsapp.sql`
   - `supabase/create_whatsapp_sessions.sql`
5. Install and run:
   ```bash
   npm install
   npm run dev -- -p 3003
   ```

Open http://localhost:3003.

## Loading Knowledge

```bash
npm run ingest -- path/to/your-file.csv
```

The default schema expects 1536-dimensional embeddings. If you choose another embedding model, update both `knowledge_chunks.embedding vector(1536)` and the `match_knowledge_chunks` function signature.

## Docker & Production Deployment (Railway)

### Running Locally with Docker Compose

1. Ensure you have your `.env.local` configured in the root of `knowledgebot-saas`.
2. Start the services:
   ```bash
   docker-compose up --build
   ```
3. The Next.js SaaS app will be running at `http://localhost:3003`.
4. The WhatsApp bridge will be running at `http://localhost:3004`.

### Deploying to Railway

Railway natively detects the `Dockerfile` at the root of `knowledgebot-saas` and will automatically deploy it.

#### Service 1: KnowledgeBot SaaS (Next.js)

Create a new service on Railway from GitHub pointing to `knowledgebot-saas`. Set these environment variables:

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | `eyJ...` |
| `OPENROUTER_API_KEY` | OpenRouter API key | `sk-or-...` |
| `CHAT_MODEL` | LLM model via OpenRouter | `google/gemini-2.5-flash` |
| `EMBEDDINGS_API_KEY` | API key for embeddings | `sk-...` |
| `EMBEDDINGS_BASE_URL` | Embeddings endpoint | `https://api.openai.com/v1` |
| `EMBEDDINGS_MODEL` | Embedding model name | `text-embedding-3-small` |
| `RAG_MATCH_THRESHOLD` | Cosine similarity threshold | `0.35` |
| `ENCRYPTION_KEY` | AES-256-GCM key (base64) | `zB8N9...` |
| `WHATSAPP_BRIDGE_URL` | **Public URL of the bridge service** | `https://wa-server-knowledge-production.up.railway.app` |
| `BRIDGE_API_KEY` | **Shared secret** (same as bridge) | `abc123...` |
| `NEXT_PUBLIC_APP_URL` | **Public URL of THIS SaaS app** | `https://knowledgebot-app-production.up.railway.app` |
| `PORT` | Listen port | `3003` |

#### Service 2: WhatsApp Bridge (`wa-server-knowledge`)

Create a **second service** pointing to `wa-server-knowledge`. Set build configuration to use its Dockerfile. Set these environment variables:

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same service role key | `eyJ...` |
| `APP_URL` | **Public URL of the SaaS service** | `https://knowledgebot-app-production.up.railway.app` |
| `BRIDGE_API_KEY` | **Same shared secret** as the SaaS | `abc123...` |
| `PORT` | Listen port | `3004` |

The Dockerfile already sets `PUPPETEER_EXECUTABLE_PATH` to the system Chromium.

#### Communication Flow (Production)

```
WhatsApp → Bridge (Puppeteer) → APP_URL/api/webhooks/whatsapp (with x-bridge-key)
SaaS Panel → WHATSAPP_BRIDGE_URL/api/sessions/* (with X-API-Key)
Bridge → APP_URL/api/whatsapp-lines/qr (with x-bridge-key)
Bridge → APP_URL/api/whatsapp-lines/status (with x-bridge-key)
```

#### Resource Requirements

- **SaaS (Next.js):** 512 MB RAM is sufficient.
- **Bridge (Puppeteer):** Each WhatsApp line runs a Chromium instance. Plan accordingly:
  - 2–3 lines → 1 GB RAM (Hobby plan)
  - 4–6 lines → 2–4 GB RAM
  - 8 lines → 4–8 GB RAM (Pro plan)
- Use a Railway Volume mounted at `/data` for persistent session storage.

## Notes

- Use a fresh Supabase project for this bot.
- Keep `OPENROUTER_API_KEY` for the chat model and `EMBEDDINGS_API_KEY` for vector embeddings.
- Google OAuth is only needed for calendar scheduling.
- WhatsApp runs through OpenWA (whatsapp-web.js) bridge — this is the ONLY supported connection method.
