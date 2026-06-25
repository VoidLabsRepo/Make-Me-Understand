# Make Me Understand

Upload your study materials, and let AI turn them into easy-to-understand notes — then chat with them or listen to voice explanations.

## What it does

1. **Upload** — snap photos of your notes, textbooks, or whiteboards
2. **AI Notes** — the app extracts all text and synthesizes structured study notes
3. **Chat** — ask questions about your material and get instant answers
4. **Voice** — tap the Halo button and speak naturally to get spoken explanations

## Languages & Technologies

- **TypeScript** — frontend (Next.js + React)
- **Python** — backend (FastAPI + SQLite)
- **Tailwind CSS** — styling
- **Kokoro TTS** — text-to-speech (Af-Heart voice)
- **Rive** — animations (Halo character)

## Getting Started

### With Docker (recommended)

```bash
# Clone the repo
git clone https://github.com/VoidLabsRepo/Make-Me-Understand.git
cd Make-Me-Understand

# Add your API key
cp .env.example .env
# Edit .env and add your OpenCode API key

# Start everything
docker compose up --build
```

The app will be available at **http://localhost:3000**

### Without Docker

**Backend:**
```bash
cd backend
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8007
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev -- -p 3007
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENCODE_API_KEY` | Your OpenCode API key | Yes |

## License

MIT
