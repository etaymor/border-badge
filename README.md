# Border Badge

A travel tracking app that helps users log countries visited, plan future trips, and share travel experiences with friends.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Mobile App    │────▶│  FastAPI Backend │────▶│    Supabase     │
│  (React Native) │     │    (Python)      │     │  (PostgreSQL)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

- **Mobile**: React Native (Expo) with TypeScript - iOS-first, Android-ready
- **Backend**: FastAPI (Python) - RESTful API with JWT authentication
- **Database**: Supabase (PostgreSQL) with Row-Level Security
- **Storage**: Supabase Storage for photos and media

## Project Structure

```
border-badge/
├── backend/          # FastAPI Python backend
│   ├── app/          # Application code
│   │   ├── api/      # API route handlers
│   │   ├── core/     # Config, security, shared utilities
│   │   └── db/       # Database client and session
│   └── tests/        # Backend tests
├── mobile/           # React Native (Expo) app
│   └── src/          # Mobile app source code
├── infra/            # Infrastructure configuration
│   └── supabase/     # Supabase migrations and seeds
├── docs/             # Project documentation
│   ├── travel-prd.md
│   ├── travel-technical-design.md
│   └── travel-mvp-blueprint.md
└── .github/          # GitHub Actions workflows
```

## Documentation

- [Product Requirements Document](docs/travel-prd.md)
- [Technical Design](docs/travel-technical-design.md)
- [MVP Blueprint](docs/travel-mvp-blueprint.md)

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 20+
- Poetry (Python package manager)
- Expo CLI
- A Supabase project (see [infra/supabase/README.md](infra/supabase/README.md))

### Backend

```bash
cd backend
poetry install
cp .env.example .env
# Edit .env with your Supabase credentials
poetry run uvicorn app.main:app --reload
```

The API will be available at http://localhost:8000

### Mobile

```bash
cd mobile
npm install
npx expo start
# Press 'i' to open iOS simulator
# Press 'a' to open Android emulator
```

## Development

### Running Tests

**Backend:**
```bash
cd backend
poetry run pytest
```

**Mobile:**
```bash
cd mobile
npm test
```

### Linting & Formatting

**Backend:**
```bash
cd backend
poetry run ruff check .
poetry run black --check .
```

**Mobile:**
```bash
cd mobile
npm run lint
npm run format:check
```

## CI/CD

All pull requests must pass CI checks before merging:
- Backend: ruff lint, black format check, pytest
- Mobile: ESLint, Prettier check, Jest tests

## License

Private - All rights reserved
