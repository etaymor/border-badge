# Supabase Infrastructure

This directory contains database migrations and seed data for the Border Badge Supabase project.

## Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Choose your organization and set:
   - **Name**: `border-badge` (or your preferred name)
   - **Database Password**: Generate a strong password and save it securely
   - **Region**: Choose the closest to your users
4. Wait for the project to be provisioned (~2 minutes)

### 2. Get Your API Keys

1. Go to **Project Settings** > **API**
2. Copy the following values to your `.env` files:

| Key | Location | Usage |
|-----|----------|-------|
| `SUPABASE_URL` | Project URL | Both backend and mobile |
| `SUPABASE_ANON_KEY` | `anon` `public` | Mobile app (respects RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` `secret` | Backend only (bypasses RLS) |
| `SUPABASE_JWT_SECRET` | JWT Settings > JWT Secret | Backend JWT verification |

### 3. Configure Environment Files

Copy the example and fill in your values:

```bash
# For infra folder (reference)
cp .env.example .env

# For backend
cp ../backend/.env.example ../backend/.env
# Edit ../backend/.env with your Supabase credentials
```

## Migrations

Migrations are SQL files that define database schema changes.

### Directory Structure

```
migrations/
├── 0000_initial_skeleton.sql   # Phase 0: Verify pipeline works
├── 0001_init_schema.sql        # Phase 1: Core tables (future)
└── 0002_rls_policies.sql       # Phase 1: RLS policies (future)

seed/
└── countries.sql               # Phase 1: Seed 195 countries (future)
```

### Applying Migrations

#### Option A: Supabase Dashboard (Recommended for now)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of each migration file
4. Run them in order (0000, 0001, 0002, etc.)

#### Option B: Supabase CLI (For local development)

1. Install Supabase CLI:
   ```bash
   # macOS
   brew install supabase/tap/supabase

   # npm
   npm install -g supabase
   ```

2. Login:
   ```bash
   supabase login
   ```

3. Link to your project:
   ```bash
   supabase link --project-ref YOUR_PROJECT_ID
   ```

4. Push migrations:
   ```bash
   supabase db push
   ```

### Verifying Migrations

After applying migrations, verify in the Supabase dashboard:

1. Go to **Table Editor** - you should see your tables
2. Go to **Database** > **Policies** - you should see RLS policies
3. Run a test query in **SQL Editor**:
   ```sql
   SELECT * FROM pg_tables WHERE schemaname = 'public';
   ```

## Troubleshooting

### "Permission denied" errors
- Ensure you're using the `service_role` key for backend operations
- Check that RLS policies are correctly configured

### Migration order matters
- Always apply migrations in numerical order
- Never skip a migration

### Reset database (development only)
In the Supabase dashboard: **Database** > **Database Settings** > **Reset Database**

> **Warning**: This deletes ALL data. Only use in development.
