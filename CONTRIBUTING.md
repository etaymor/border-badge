# Contributing to Border Badge

Thank you for your interest in contributing to Border Badge! This document provides guidelines and instructions for contributing.

## Getting Started

1. **Fork the repository** (if external contributor)
2. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd border-badge
   ```
3. **Set up development environment**
   - Follow [Backend README](./backend/README.md) for backend setup
   - Follow [Mobile README](./mobile/README.md) for mobile setup

## Development Workflow

### Branch Naming

Use descriptive branch names with prefixes:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/trip-sharing` |
| `fix/` | Bug fixes | `fix/auth-token-refresh` |
| `refactor/` | Code refactoring | `refactor/api-client` |
| `docs/` | Documentation | `docs/api-reference` |
| `chore/` | Maintenance | `chore/update-dependencies` |

### Commit Messages

Write clear, concise commit messages:

```
<type>: <description>

[optional body]

[optional footer]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting, no code change
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance

**Examples:**
```
feat: add trip sharing functionality

fix: resolve token refresh loop on 401

docs: update API reference for lists endpoint

refactor: simplify media upload hook
```

### Pull Request Process

1. **Create a feature branch** from `main`
   ```bash
   git checkout -b feature/your-feature
   ```

2. **Make your changes** following code style guidelines

3. **Test your changes**
   ```bash
   # Backend
   cd backend && poetry run pytest

   # Mobile
   cd mobile && npm test
   ```

4. **Lint your code**
   ```bash
   # Backend
   cd backend && poetry run ruff check .

   # Mobile
   cd mobile && npm run lint
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature
   ```

6. **Fill out PR template** with:
   - Description of changes
   - Related issues
   - Testing performed
   - Screenshots (for UI changes)

7. **Address review feedback**

8. **Merge** after approval and passing CI

## Code Style

### Mobile (TypeScript)

- **ESLint** for linting
- **Prettier** for formatting
  - 100 character line width
  - 2 space indentation
  - Single quotes
  - Trailing commas

```bash
# Check
npm run lint
npx prettier --check .

# Fix
npm run lint -- --fix
npx prettier --write .
```

**Guidelines:**
- Prefer functional components with hooks
- Use TypeScript strictly (avoid `any`)
- Use `useMemo` and `useCallback` for optimization
- Keep components focused and small
- Co-locate tests with components

### Backend (Python)

- **Ruff** for linting and formatting
  - 88 character line width
  - Google-style docstrings

```bash
# Check
poetry run ruff check .
poetry run ruff format --check .

# Fix
poetry run ruff check --fix .
poetry run ruff format .
```

**Guidelines:**
- Use type hints for all functions
- Use Pydantic for validation
- Write async functions where appropriate
- Keep routes thin, logic in services
- Follow REST conventions

## Testing

### Mobile Testing

```bash
cd mobile

# Run all tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
```

**What to test:**
- Custom hooks
- Utility functions
- Complex component logic
- Navigation flows (E2E)

### Backend Testing

```bash
cd backend

# Run all tests
poetry run pytest

# Verbose output
poetry run pytest -v

# Coverage
poetry run pytest --cov=app
```

**What to test:**
- API endpoints
- Business logic
- Validation
- Error handling

## Documentation

### When to Update Docs

- **New features** - Update relevant README and API docs
- **API changes** - Update [docs/API.md](./docs/API.md)
- **Configuration changes** - Update .env.example files
- **Architecture changes** - Update [CLAUDE.md](./CLAUDE.md)

### Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Project overview |
| `CLAUDE.md` | AI assistant context |
| `STYLEGUIDE.md` | Design system |
| `CONTRIBUTING.md` | This file |
| `mobile/README.md` | Mobile development |
| `backend/README.md` | Backend development |
| `docs/API.md` | API reference |

## Project Structure

Before making changes, understand the project structure:

```
border-badge/
├── mobile/              # React Native app
│   └── src/
│       ├── components/  # Reusable UI
│       ├── screens/     # App screens
│       ├── hooks/       # Data fetching
│       ├── services/    # API client
│       └── stores/      # State management
├── backend/             # FastAPI backend
│   └── app/
│       ├── api/         # Route handlers
│       ├── core/        # Config, security
│       ├── schemas/     # Pydantic models
│       └── db/          # Database client
└── supabase/            # Database migrations
```

## Common Tasks

### Adding a New API Endpoint

1. Create/update Pydantic schema in `backend/app/schemas/`
2. Add route handler in `backend/app/api/`
3. Register router if new file
4. Add tests
5. Update [docs/API.md](./docs/API.md)
6. Create corresponding mobile hook

### Adding a New Screen

1. Create screen in `mobile/src/screens/`
2. Add to navigation in `RootNavigator.tsx`
3. Update navigation types
4. Add tests
5. Update documentation if needed

### Database Changes

1. Create migration in `supabase/migrations/`
2. Apply via Supabase dashboard
3. Update Pydantic schemas
4. Update TypeScript types
5. Test thoroughly

## Questions?

- Check existing documentation
- Look at similar code in the codebase
- Open an issue for discussion

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
