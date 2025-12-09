# Border Badge Backend

FastAPI backend service for the Border Badge travel tracking platform.

## Prerequisites

- Python 3.12+
- Poetry (Python package manager)
- Supabase project with configured database

## Getting Started

### 1. Install Dependencies

```bash
poetry install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```bash
ENV=development
DEBUG=true

# Get these from: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
```

### 3. Run Development Server

```bash
poetry run uvicorn app.main:app --reload --host 0.0.0.0
```

The API will be available at http://localhost:8000

- API docs: http://localhost:8000/docs (Swagger UI)
- Alternative docs: http://localhost:8000/redoc

## Project Structure

```
backend/app/
├── api/                  # API route modules
│   ├── __init__.py       # Router composition
│   ├── countries.py      # Country endpoints
│   ├── entries.py        # Entry CRUD
│   ├── lists.py          # Shareable lists
│   ├── media.py          # Media upload/management
│   ├── places.py         # Place details
│   ├── profile.py        # User profile
│   ├── public.py         # Public endpoints (no auth)
│   ├── trips.py          # Trip CRUD
│   └── utils.py          # API utilities
├── core/                 # Core functionality
│   ├── config.py         # Environment configuration
│   ├── security.py       # JWT validation
│   ├── validators.py     # Input validation
│   ├── media.py          # Media configuration
│   ├── thumbnails.py     # Image processing
│   └── notifications.py  # Notification stubs
├── schemas/              # Pydantic models
│   ├── countries.py      # Country schemas
│   ├── trips.py          # Trip schemas
│   ├── entries.py        # Entry schemas
│   ├── media.py          # Media schemas
│   ├── lists.py          # List schemas
│   ├── profile.py        # Profile schemas
│   └── public.py         # Public endpoint schemas
├── db/                   # Database
│   └── session.py        # Supabase client wrapper
├── services/             # Business logic
│   └── media_processing.py
├── templates/            # Jinja2 templates
├── static/               # Static assets
└── main.py               # FastAPI app entry point
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Health check |
| `/countries` | GET | List all countries |
| `/user_countries` | GET/POST/DELETE | User's visited/wishlist countries |
| `/trips` | GET/POST | List/create trips |
| `/trips/{id}` | GET/PATCH/DELETE | Trip detail/update/delete |
| `/trips/{id}/entries` | GET/POST | Trip entries |
| `/entries/{id}` | GET/PATCH/DELETE | Entry detail/update/delete |
| `/media/files/upload-url` | POST | Get signed upload URL |
| `/media/files/{id}` | GET/PATCH/DELETE | Media management |
| `/trips/{id}/lists` | GET/POST | Trip lists |
| `/lists/{id}` | GET/PATCH/DELETE | List management |
| `/profile` | GET/PATCH | User profile |
| `/public/lists/{slug}` | GET | Public list view |
| `/public/trips/{slug}` | GET | Public trip view |

See [API Reference](../docs/API.md) for complete documentation.

## Authentication

The API uses JWT tokens from Supabase Auth:

1. Client authenticates with Supabase (phone OTP)
2. Client receives JWT access token
3. Client includes token in `Authorization: Bearer <token>` header
4. Backend validates token and extracts user ID

```python
# Dependency injection for authenticated routes
from app.core.security import get_current_user

@router.get("/trips")
async def get_trips(current_user: CurrentUser = Depends(get_current_user)):
    # current_user.id contains the authenticated user's ID
    pass
```

## Database

### Supabase Client

The backend uses a custom HTTP client wrapper (`app/db/session.py`) that:
- Makes REST API calls to Supabase
- Passes user JWT for RLS-protected queries
- Uses service role key for admin operations

### Key Tables

| Table | Description |
|-------|-------------|
| `country` | Reference data (197 countries) |
| `user_countries` | User's visited/wishlist status |
| `trip` | User trips |
| `trip_tags` | Consent workflow for tagged friends |
| `entry` | Trip entries (place/food/stay/experience) |
| `place` | Google Places enrichment |
| `media_files` | Uploaded photos |
| `list` | Shareable curated lists |
| `user_profile` | Extended user data |

### Row-Level Security

All data access is controlled by RLS policies:
- Users see only their own data
- Trip viewers: owner OR approved in `trip_tags`
- Public lists: `is_public = true`

## Available Scripts

| Command | Description |
|---------|-------------|
| `poetry run uvicorn app.main:app --reload` | Start dev server |
| `poetry run pytest` | Run tests |
| `poetry run ruff check .` | Lint code |
| `poetry run ruff format .` | Format code |
| `poetry run ruff check --fix .` | Auto-fix lint issues |

## Testing

```bash
# Run all tests
poetry run pytest

# Run with coverage
poetry run pytest --cov=app

# Run specific test file
poetry run pytest tests/test_trips.py

# Run with verbose output
poetry run pytest -v
```

## Code Quality

```bash
# Check linting
poetry run ruff check .

# Check formatting
poetry run ruff format --check .

# Fix linting issues
poetry run ruff check --fix .

# Format code
poetry run ruff format .
```

## Configuration

Settings are managed via Pydantic Settings (`app/core/config.py`):

| Setting | Default | Description |
|---------|---------|-------------|
| `env` | `development` | Environment name |
| `debug` | `false` | Debug mode |
| `allowed_origins` | `[]` | CORS origins |
| `supabase_url` | - | Supabase project URL |
| `supabase_anon_key` | - | Supabase anonymous key |
| `supabase_service_role_key` | - | Supabase service role key |
| `supabase_jwt_secret` | - | JWT secret for validation |

## Media Upload Flow

1. Client requests signed URL: `POST /media/files/upload-url`
2. Backend creates `media_files` record with `status=processing`
3. Backend returns signed URL for direct Supabase Storage upload
4. Client uploads file directly to Supabase Storage
5. Client confirms upload: `PATCH /media/files/{id}` with `status=uploaded`
6. Backend generates thumbnail (async)

### Constraints

- Max file size: 10MB
- Max photos per entry: 10
- Allowed types: JPEG, PNG, HEIC, HEIF

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "InvalidInput",
  "message": "Country not found",
  "details": { "field": "country_id" }
}
```

Standard HTTP status codes:
- `400` - Bad request / validation error
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `409` - Conflict (duplicate, already exists)
- `422` - Unprocessable entity
- `500` - Internal server error

## Security Features

- JWT validation with audience/issuer checks
- Rate limiting via slowapi
- Security headers (XSS, CSP, clickjacking protection)
- CORS configuration
- RLS enforcement at database level

## Related Documentation

- [Root README](../README.md)
- [CLAUDE.md](../CLAUDE.md) - AI assistant context
- [API Reference](../docs/API.md)
- [Technical Design](../docs/travel-technical-design.md)
- [Mobile README](../mobile/README.md)
