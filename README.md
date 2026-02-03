# @blockrun/openclaw-x402

Paid skills for OpenClaw. Skill creators earn money. End users get premium capabilities. Powered by [x402](https://www.x402.org/) micropayments.

## The Problem

OpenClaw has 3,000+ community skills on ClawHub. All free. No way for creators to earn money from their work.

Skills that fetch live data, run analysis, or call APIs cost real money to operate. Creators either eat the cost or don't build them. The result: most skills are simple prompt wrappers. The high-value skills — real-time crypto analysis, premium data feeds, AI-powered tools — don't exist because there's no business model.

OpenClaw maintainers have explicitly said payment features should be built as third-party extensions, not core ([Issue #3465](https://github.com/openclaw/openclaw/issues/3465)). Nobody has built it yet.

## The Solution

BlockRun turns any skill into a paid API endpoint. Creators submit their code, set a price, and earn USDC on every call. End users pay per execution — no subscriptions, no API keys, no accounts (for crypto users).

### For Skill Creators

```
1. Submit your skill code + USDC wallet address to BlockRun
2. Set your price per execution ($0.01 - $10.00)
3. BlockRun hosts and runs your code server-side
4. Every time someone calls your skill, you earn money
5. Payouts in USDC on Base (instant, no minimums)
```

Your skill's SKILL.md goes on ClawHub as usual (free). It tells the agent how to call your BlockRun API endpoint. The execution is what costs money.

### For End Users (OpenClaw Operators)

```bash
# Install the x402 extension
openclaw extension install @blockrun/openclaw-x402

# Configure your wallet (or use Stripe)
export BLOCKRUN_WALLET_KEY=0x...

# That's it. Your agent can now use paid skills.
```

When your agent calls a paid skill:
- **x402 (crypto)**: Extension auto-signs a USDC micropayment. No account needed — payment IS authentication.
- **Stripe (fiat)**: Pre-fund a balance at blockrun.ai, use an API key.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                          ClawHub                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SKILL.md (FREE)                                        │   │
│  │  "To analyze crypto, call:                               │   │
│  │   POST api.blockrun.ai/skills/crypto-analyst/execute"    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     End User's Agent                            │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │  OpenClaw     │───▶│  @blockrun/openclaw-x402 extension   │   │
│  │  Agent        │    │  (auto-handles payment)              │   │
│  └──────────────┘    └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    x402 payment or API key
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BlockRun Platform                           │
│                                                                 │
│  1. Verify payment (x402 USDC or Stripe balance)                │
│  2. Execute skill code server-side                              │
│  3. Return fresh results to agent                               │
│  4. Route payment: 80-85% → creator, 15-20% → BlockRun         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Why Per-Execution, Not Per-Download?

Static prompts and data can be copied once and never paid for again. That's why app store models don't work for skills.

BlockRun skills sell **execution**, not content:

| What's Free (SKILL.md on ClawHub) | What's Paid (BlockRun API) |
|-----------------------------------|---------------------------|
| Prompt instructions | Real-time data fetch (crypto prices, news) |
| Tool usage guide | LLM inference (each call costs tokens) |
| Skill description | Computation (image gen, analysis, code exec) |
| Install instructions | API aggregation (combines multiple paid APIs) |

Each call produces fresh, unique results. A crypto analysis from 10 minutes ago is already stale. You can't "copy" a live computation.

## Skill Categories

| Category | Example | Why It's Paid per Call |
|----------|---------|----------------------|
| Real-time data | Crypto market analysis | Fetches live prices, runs TA indicators |
| AI generation | Image/video creation | GPU compute per generation |
| Premium APIs | Financial data feeds | Upstream API costs per call |
| Code execution | Data pipeline runner | Server compute per run |
| LLM-powered | Research assistant | Token costs per query |

## Authentication

### x402 (Crypto Users) — No Auth Needed

Payment IS authentication. The USDC payment signature proves identity.

```
Agent → POST /skills/slug → 402 → extension signs USDC → retry with payment → result
Identity = wallet address (extracted from payment signature)
```

### Stripe (Fiat Users) — API Key

```
User creates account at blockrun.ai → funds via Stripe → gets API key
Agent sends API key in header → BlockRun deducts from balance → result
Identity = API key / BlockRun account
```

Both paths converge at the same execution endpoint. BlockRun accepts either valid x402 payment header OR valid API key with sufficient balance.

## Architecture

### Three Components

1. **BlockRun Skills API** (backend) — Hosts skill code, handles payments, routes payouts
2. **OpenClaw x402 Extension** (npm package) — Third-party extension that gives agents ability to pay
3. **Skill Creator Dashboard** (web UI) — Submit and manage skills at blockrun.ai

### Skills API

```
POST   /api/skills/register        — Creator submits skill code + wallet + pricing
GET    /api/skills/directory        — Browse/search available paid skills
POST   /api/skills/:slug/execute    — Execute a paid skill (x402 or API key)
GET    /api/skills/:slug/info       — Skill metadata + pricing
```

Hosted in BlockRun's existing Next.js app. Reuses existing x402 server code for payment verification and settlement.

### Database Schema

```sql
-- Skill registry
CREATE TABLE skills (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  creator_wallet TEXT NOT NULL,        -- Creator's USDC address on Base
  title TEXT NOT NULL,
  description TEXT,
  price_usd DECIMAL(10,6) NOT NULL,    -- Price per execution
  content JSONB NOT NULL,              -- Skill code, config, metadata
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Execution log
CREATE TABLE skill_executions (
  id UUID PRIMARY KEY,
  skill_id UUID REFERENCES skills(id),
  payer_address TEXT NOT NULL,          -- Who paid (wallet or account)
  amount_usd DECIMAL(10,6),
  tx_hash TEXT,                         -- On-chain settlement hash
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Creator payouts
CREATE TABLE payouts (
  id UUID PRIMARY KEY,
  creator_wallet TEXT NOT NULL,
  amount_usd DECIMAL(10,6),
  tx_hash TEXT,
  settled_at TIMESTAMPTZ
);

-- Stripe user balances
CREATE TABLE user_balances (
  id UUID PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  email TEXT,
  balance_usd DECIMAL(10,6) DEFAULT 0,
  total_deposited DECIMAL(10,6) DEFAULT 0,
  total_spent DECIMAL(10,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### x402 Extension

```
packages/openclaw-x402/
├── src/
│   ├── index.ts        # Extension entry point (registers tools)
│   ├── tools.ts        # x402_call + blockrun_skills tool definitions
│   ├── wallet.ts       # Wallet management (privateKey or auto-create)
│   └── types.ts        # OpenClaw extension type definitions
├── package.json
└── README.md
```

**Tools provided to the agent**:
1. `x402_call` — Call any x402-protected API endpoint with automatic USDC payment
2. `blockrun_skills` — Search BlockRun's paid skill directory by keyword/category

**Configuration**:
```json
{
  "extensions": {
    "entries": {
      "@blockrun/openclaw-x402": {
        "enabled": true,
        "config": {
          "walletKey": "0x...",
          "maxPaymentPerCall": "1.00"
        }
      }
    }
  }
}
```

### The x402 Payment Flow (Per Request)

```
Agent                   BlockRun API                    On-Chain (Base)
  │                         │                              │
  │── POST /skills/slug ──▶│                              │
  │                         │                              │
  │◀── 402 + price ────────│                              │
  │                         │                              │
  │ [x402 extension signs   │                              │
  │  USDC TransferWithAuth] │                              │
  │                         │                              │
  │── POST + X-PAYMENT ──▶│                              │
  │                         │── verify payment ──────────▶│
  │                         │◀── valid ──────────────────│
  │                         │                              │
  │                         │ [execute skill code]         │
  │                         │                              │
  │◀── 200 + results ──────│                              │
  │                         │── settle on-chain ─────────▶│
  │                         │   (85% → creator wallet)     │
```

## Revenue Model

```
End user pays $0.05 per skill execution
  → BlockRun keeps $0.0075-0.01 (15-20% platform fee)
  → Skill creator gets $0.04-0.0425 (80-85% payout)

If the skill also uses BlockRun LLM:
  → Additional LLM revenue on top of platform fee

Volume model:
  1,000 skill creators × 100 calls/day × $0.05 avg = $5,000/day = $150K/month
  BlockRun take at 15%: ~$22.5K/month
```

## Market Context

- **OpenClaw**: 156K GitHub stars, 3,000+ skills, ~30 new issues/hour
- **ClawHub**: Official skill registry, no monetization
- **Community demand**: Issue #757 "Decentralized Marketplace for AI Skills", Issue #3465 "x402 payment extension", Issue #7951 "payment integration"
- **Maintainer stance**: "Make it a third-party extension" — they won't build payments in core
- **Competition**: zauth submitted x402 PR, got rejected. Nobody else is building this.

## Quick Start

### Skill Creator

```bash
# Submit a skill via CLI (coming soon)
blockrun skills submit ./my-skill \
  --wallet 0x... \
  --price 0.05

# Or via the dashboard
open https://blockrun.ai/skills/submit
```

### End User

```bash
# Install extension
openclaw extension install @blockrun/openclaw-x402

# Option A: Crypto (no account needed)
export BLOCKRUN_WALLET_KEY=0x...your_private_key...

# Option B: Fiat (create account at blockrun.ai, fund via Stripe)
export BLOCKRUN_API_KEY=br_...

# Done — your agent can now use any paid skill on ClawHub
```

## Development

```bash
npm install
npm run build
npm run dev        # Watch mode
npm run typecheck
```

## Roadmap

- [x] Phase 1: OpenClaw LLM provider plugin (x402 proxy for BlockRun models)
- [ ] Phase 2: Skills API backend (register, execute, pay, payout)
- [ ] Phase 3: OpenClaw x402 extension (agent tool for paying skills)
- [ ] Phase 4: First paid skill (proof of concept, built by us)
- [ ] Phase 5: Creator dashboard (web UI at blockrun.ai)
- [ ] Phase 6: Stripe fiat on-ramp
- [ ] Phase 7: Community launch (ClawHub listing, npm publish, GitHub issues)

## License

MIT
