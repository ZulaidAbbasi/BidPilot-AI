<div align="center">
  <h1>🚀 BidPilot-AI</h1>
  <p><strong>An advanced AI-powered procurement and negotiation platform.</strong></p>
</div>

BidPilot-AI leverages Voice AI, integrated data pipelines, and a modern React stack to automate and streamline the full negotiation lifecycle—from specification intake to quote finalization and evidence tracking.

## ✨ Key Features

- **Voice AI Negotiation**: Seamlessly integrate with ElevenLabs for AI-driven post-call processing, context loading, and quote extraction.
- **End-to-End Negotiation Lifecycle**: Manage every stage including Intake, Control Room, Readiness, Specifications, Providers, Quotes, Integrity checks, and final Reports.
- **Model Context Protocol (MCP)**: Native integration for exposing tool sets like `get-negotiation`, `list-calls`, and `recent-agent-events` to AI models.
- **Real-time Backend**: Powered by Supabase for authentication, Row-Level Security (RLS), and database migrations.
- **Modern UI/UX**: Built with React 19, Tailwind CSS v4, and Radix UI primitives for a sleek, responsive, and accessible interface.
- **TanStack Ecosystem**: Utilizes TanStack Start, Router, and Query for unmatched performance, type-safe routing, and state management.

---

## 🛠️ Technology Stack

- **Frontend Framework**: [React 19](https://react.dev/) & [TanStack Start](https://tanstack.com/start/latest)
- **Routing & State**: [TanStack Router](https://tanstack.com/router) & [TanStack Query](https://tanstack.com/query)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) & [Radix UI](https://www.radix-ui.com/)
- **Backend & Auth**: [Supabase](https://supabase.com/)
- **AI/Voice Integrations**: [ElevenLabs](https://elevenlabs.io/)
- **Build Tooling**: [Vite](https://vitejs.dev/) & [Bun](https://bun.sh/)

---

## 📂 Project Structure

```text
BidPilot-AI/
├── src/
│   ├── components/      # Reusable Radix/Tailwind UI components
│   ├── hooks/           # Custom React hooks (e.g., use-auth, use-mobile)
│   ├── integrations/    # Supabase client setup, types, and middleware
│   ├── lib/             # Core business logic, error tracking, MCP tools
│   └── routes/          # TanStack file-based routing
│       ├── api/         # Public API endpoints (e.g., ElevenLabs webhooks)
│       ├── app/         # Protected dashboard and negotiation interfaces
│       └── __root.tsx   # Application shell and global providers
├── supabase/
│   ├── migrations/      # Database schema definitions and changes
│   └── tests/           # Database integrity and RLS test suites
├── public/              # Static assets
└── package.json         # Project dependencies and scripts
```

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (or Node.js 22+)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (for local database development)

### 1. Clone the repository

```bash
git clone https://github.com/ZulaidAbbasi/BidPilot-AI.git
cd BidPilot-AI
```

### 2. Install dependencies

```bash
bun install
```

### 3. Environment Variables

Copy the example environment file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Ensure your `.env` has the following fields populated:

```env
# Client-visible variables
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_SUPABASE_PROJECT_ID=your-project-id

# Server-only variables
SUPABASE_URL=your-project-url
SUPABASE_PUBLISHABLE_KEY=your-anon-key
SUPABASE_PROJECT_ID=your-project-id
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 4. Database Setup

Ensure you have a local or remote Supabase instance running. Apply all migrations to set up the schema:

```bash
supabase start
supabase db push
```

### 5. Start the Development Server

```bash
bun run dev
```

The application will be available at `http://localhost:5173` (or the port dynamically allocated by Vite).

---

## 🧪 Testing & Linting

Keep the codebase clean and robust with the following built-in scripts:

- **Type Checking:** `bun run typecheck`
- **Linting:** `bun run lint`
- **Formatting:** `bun run format`
- **Unit & Integration Tests:** `bun run test`
- **Security Tests:** `bun run test:security`

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check out the [issues page](https://github.com/ZulaidAbbasi/BidPilot-AI/issues).

## 📄 License

This project is proprietary and confidential.

---

<div align="center">
  <p>Built with ❤️ using modern web standards.</p>
</div>
