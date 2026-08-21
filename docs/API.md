# Border Badge API Reference

Base URL: `http://localhost:8000` (development)

## Authentication

All authenticated endpoints require a JWT token from Supabase Auth:

```
Authorization: Bearer <access_token>
```

## Endpoints

### Health Check

#### `GET /health`

Check API health status.

**Response:**
```json
{
  "status": "healthy"
}
```

---

### Countries

#### `GET /countries`

List all countries.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Filter by name (partial match) |
| `region` | string | Filter by region |

**Response:**
```json
[
  {
    "id": "uuid",
    "code": "US",
    "name": "United States",
    "region": "Americas",
    "recognition": "un_member"
  }
]
```

---

### User Countries

#### `GET /user_countries`

Get current user's visited and wishlist countries.

**Auth:** Required

**Response:**
```json
[
  {
    "id": "uuid",
    "country_id": "uuid",
    "country_code": "FR",
    "country_name": "France",
    "status": "visited",
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

#### `POST /user_countries`

Add or update a country status.

**Auth:** Required

**Request:**
```json
{
  "country_code": "JP",
  "status": "visited"
}
```

**Status values:** `visited`, `wishlist`

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "country_id": "uuid",
  "status": "visited"
}
```

#### `POST /user_countries/batch`

Batch update multiple countries.

**Auth:** Required

**Request:**
```json
{
  "countries": [
    { "country_code": "JP", "status": "visited" },
    { "country_code": "FR", "status": "wishlist" }
  ]
}
```

**Response:** `200 OK`

#### `DELETE /user_countries/{country_code}`

Remove a country from user's list.

**Auth:** Required

**Response:** `204 No Content`

---

### Trips

#### `GET /trips`

List user's trips.

**Auth:** Required

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `country_code` | string | Filter by country |
| `include_system` | boolean | Include system trips like Saved Places (default: false) |

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Spring in Tokyo",
    "country_id": "uuid",
    "country_code": "JP",
    "cover_image_url": "https://...",
    "date_range": ["2024-03-15", "2024-03-22"],
    "share_slug": "abc123",
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

#### `POST /trips`

Create a new trip.

**Auth:** Required

**Request:**
```json
{
  "name": "Spring in Tokyo",
  "country_code": "JP",
  "cover_image_url": "https://...",
  "date_range": ["2024-03-15", "2024-03-22"],
  "tagged_user_ids": ["user-uuid-1", "user-uuid-2"]
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "Spring in Tokyo",
  "trip_tags": [
    {
      "tagged_user_id": "user-uuid-1",
      "status": "pending"
    }
  ]
}
```

#### `GET /trips/{trip_id}`

Get trip details.

**Auth:** Required (must be owner or approved tag)

**Response:**
```json
{
  "id": "uuid",
  "name": "Spring in Tokyo",
  "country_id": "uuid",
  "country_code": "JP",
  "cover_image_url": "https://...",
  "date_range": ["2024-03-15", "2024-03-22"],
  "share_slug": "abc123",
  "trip_tags": [...],
  "entries": [...],
  "created_at": "2024-01-15T10:30:00Z"
}
```

#### `PATCH /trips/{trip_id}`

Update a trip.

**Auth:** Required (owner only)

**Request:**
```json
{
  "name": "Updated Name",
  "cover_image_url": "https://...",
  "date_range": ["2024-03-15", "2024-03-25"]
}
```

**Response:** `200 OK`

#### `DELETE /trips/{trip_id}`

Soft delete a trip.

**Auth:** Required (owner only)

**Response:** `204 No Content`

#### `GET /trips/uncategorized`

Get or create the user's "Saved Places" system trip. This is a holding area for entries shared via the iOS Share Extension when no specific trip is selected. Users can later organize these entries by moving them to appropriate trips.

**Auth:** Required

**Rate Limit:** 30/minute

**Response:**
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "country_id": null,
  "country_code": null,
  "name": "Saved Places",
  "cover_image_url": null,
  "date_range": null,
  "is_system": true,
  "created_at": "2024-01-15T10:30:00Z",
  "deleted_at": null,
  "entry_count": 5
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Trip ID |
| `is_system` | boolean | Always `true` for system trips |
| `entry_count` | integer | Number of entries in the Saved Places trip |

---

#### `POST /trips/{trip_id}/restore`

Restore a soft-deleted trip.

**Auth:** Required (owner only)

**Response:** `200 OK`

---

### Trip Tags (Consent)

#### `POST /trips/{trip_id}/approve`

Approve being tagged on a trip.

**Auth:** Required (tagged user only)

**Response:**
```json
{
  "status": "approved"
}
```

#### `POST /trips/{trip_id}/decline`

Decline being tagged on a trip.

**Auth:** Required (tagged user only)

**Response:**
```json
{
  "status": "declined"
}
```

---

### Entries

#### `GET /trips/{trip_id}/entries`

List entries for a trip.

**Auth:** Required

**Response:**
```json
[
  {
    "id": "uuid",
    "type": "place",
    "title": "Senso-ji Temple",
    "notes": "Beautiful temple...",
    "link": "https://...",
    "date": "2024-03-16",
    "place": {
      "google_place_id": "ChIJ...",
      "place_name": "Senso-ji",
      "lat": 35.7148,
      "lng": 139.7967,
      "address": "..."
    },
    "media_files": [...]
  }
]
```

#### `POST /trips/{trip_id}/entries`

Create a new entry.

**Auth:** Required

**Request:**
```json
{
  "type": "place",
  "title": "Senso-ji Temple",
  "notes": "Beautiful temple...",
  "link": "https://...",
  "date": "2024-03-16",
  "place": {
    "google_place_id": "ChIJ...",
    "place_name": "Senso-ji",
    "lat": 35.7148,
    "lng": 139.7967,
    "address": "..."
  }
}
```

**Entry types:** `place`, `food`, `stay`, `experience`

**Response:** `201 Created`

#### `GET /entries/{entry_id}`

Get entry details.

**Auth:** Required

**Response:** Entry object with place and media

#### `PATCH /entries/{entry_id}`

Update an entry.

**Auth:** Required

**Request:**
```json
{
  "title": "Updated Title",
  "notes": "Updated notes..."
}
```

**Response:** `200 OK`

#### `DELETE /entries/{entry_id}`

Soft delete an entry.

**Auth:** Required

**Response:** `204 No Content`

#### `PATCH /entries/{entry_id}/move`

Move an entry to a different trip. This is useful for organizing entries from the Saved Places (uncategorized) trip into specific country trips.

**Auth:** Required

**Rate Limit:** 30/minute

**Request:**
```json
{
  "trip_id": "uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `trip_id` | uuid | Yes | Target trip ID to move the entry to |

**Response:** `200 OK`

Returns the updated entry with place data:
```json
{
  "id": "uuid",
  "trip_id": "uuid",
  "type": "place",
  "title": "Senso-ji Temple",
  "notes": "...",
  "place": {
    "id": "uuid",
    "google_place_id": "ChIJ...",
    "place_name": "Senso-ji",
    "lat": 35.7148,
    "lng": 139.7967
  }
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | `NotFound` | Entry not found or not authorized |
| 409 | `Conflict` | This place already exists in the target trip |

---

#### `POST /entries/bulk-move`

Move multiple entries to a target trip in a single atomic operation. All entries must belong to trips owned by the current user. If any entry would create a duplicate in the target trip, the entire operation is rolled back.

**Auth:** Required

**Rate Limit:** 10/minute

**Request:**
```json
{
  "entry_ids": ["uuid-1", "uuid-2", "uuid-3"],
  "target_trip_id": "uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entry_ids` | array | Yes | List of entry IDs to move (minimum 1) |
| `target_trip_id` | uuid | Yes | Target trip ID to move entries to |

**Response:** `200 OK`
```json
{
  "moved_count": 3,
  "entries": [
    {
      "id": "uuid-1",
      "trip_id": "uuid",
      "type": "place",
      "title": "Entry 1",
      "place": { ... }
    },
    ...
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `moved_count` | integer | Number of entries successfully moved |
| `entries` | array | List of moved entries with place data |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `InvalidInput` | No entries specified |
| 403 | `Forbidden` | Not authorized to move one or more entries |
| 404 | `NotFound` | One or more entries not found |
| 409 | `Conflict` | One or more places already exist in the target trip |

---

### Media Files

#### `POST /media/files/upload-url`

Get a signed URL for file upload.

**Auth:** Required

**Request:**
```json
{
  "entry_id": "uuid",
  "filename": "photo.jpg",
  "content_type": "image/jpeg"
}
```

Or for trip cover:
```json
{
  "trip_id": "uuid",
  "filename": "cover.jpg",
  "content_type": "image/jpeg"
}
```

**Response:**
```json
{
  "media_id": "uuid",
  "upload_url": "https://...",
  "file_path": "media/user-id/file-id.jpg"
}
```

#### `PATCH /media/files/{media_id}`

Update media status after upload.

**Auth:** Required

**Request:**
```json
{
  "status": "uploaded"
}
```

**Status values:** `processing`, `uploaded`, `failed`

**Response:** `200 OK`

#### `DELETE /media/files/{media_id}`

Delete a media file.

**Auth:** Required

**Response:** `204 No Content`

---

### Lists

#### `GET /trips/{trip_id}/lists`

Get lists for a trip.

**Auth:** Required

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Best Ramen Spots",
    "slug": "best-ramen-spots-abc123",
    "description": "...",
    "is_public": true,
    "entry_count": 5
  }
]
```

#### `POST /trips/{trip_id}/lists`

Create a new list.

**Auth:** Required

**Request:**
```json
{
  "name": "Best Ramen Spots",
  "description": "My favorite ramen places in Tokyo",
  "is_public": true,
  "entry_ids": ["entry-uuid-1", "entry-uuid-2"]
}
```

**Response:** `201 Created`

#### `GET /lists/{list_id}`

Get list details with entries.

**Auth:** Required (or public if `is_public`)

**Response:**
```json
{
  "id": "uuid",
  "name": "Best Ramen Spots",
  "slug": "best-ramen-spots-abc123",
  "description": "...",
  "is_public": true,
  "entries": [...]
}
```

#### `PATCH /lists/{list_id}`

Update a list.

**Auth:** Required

**Request:**
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "is_public": false
}
```

**Response:** `200 OK`

#### `PATCH /lists/{list_id}/entries`

Update list entries.

**Auth:** Required

**Request:**
```json
{
  "entry_ids": ["entry-uuid-1", "entry-uuid-2", "entry-uuid-3"]
}
```

**Response:** `200 OK`

#### `DELETE /lists/{list_id}`

Delete a list.

**Auth:** Required

**Response:** `204 No Content`

---

### Profile

#### `GET /profile`

Get current user's profile.

**Auth:** Required

**Response:**
```json
{
  "id": "uuid",
  "display_name": "John Traveler",
  "avatar_url": "https://...",
  "home_country_code": "US",
  "travel_motives": ["adventure", "food", "culture"],
  "persona_tags": ["explorer", "foodie"]
}
```

#### `PATCH /profile`

Update user profile.

**Auth:** Required

**Request:**
```json
{
  "display_name": "John Traveler",
  "home_country_code": "US",
  "travel_motives": ["adventure", "food"],
  "persona_tags": ["explorer"]
}
```

**Response:** `200 OK`

#### `DELETE /profile`

Permanently delete the current user's account and all associated data.

**Auth:** Required

**Rate Limit:** 5/hour

This operation is irreversible and will:
- Delete the user's authentication record from Supabase Auth
- Cascade delete all database records via ON DELETE CASCADE constraints (user_profile, user_countries, trips, entries, places, lists, list_entries, trip_tags, media_files records, outbound_links, social_ingest_jobs)

Note: Media files in Supabase Storage buckets are NOT automatically deleted and require a separate cleanup process.

**Response:**
```json
{
  "message": "Account deleted successfully"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 429 | `RateLimitExceeded` | Rate limit exceeded (5/hour) |
| 500 | `InternalError` | Failed to delete account |
| 503 | `ServiceUnavailable` | Service temporarily unavailable |

---

### Welcome Emails

#### `POST /welcome/emails`

Schedule welcome email sequence for a new user. This endpoint should be called immediately after successful signup. It schedules a series of welcome emails using Resend's scheduled delivery feature.

**Auth:** Required

**Rate Limit:** 3 requests per hour

**Request:**
```json
{
  "display_name": "John"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `display_name` | string | No | User's display name for email personalization (max 100 chars). Defaults to "there" if not provided. |

**Response:**
```json
{
  "status": "scheduled",
  "email_count": 4
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Result status (see below) |
| `email_count` | integer | Number of emails successfully scheduled |

**Status Values:**

| Status | Description |
|--------|-------------|
| `scheduled` | Emails successfully scheduled for delivery |
| `already_scheduled` | Welcome emails were already scheduled for this user (idempotency protection) |
| `skipped` | Email service not configured (development mode) |
| `failed` | All emails failed to schedule |

**Email Schedule:**

The welcome sequence consists of 4 emails sent at the following intervals after signup:

| Email | Delay | Subject |
|-------|-------|---------|
| Welcome | Immediate | "You're awesome" |
| Day 2 | 24 hours | "The apps out there just didn't cut it" |
| Day 4 | 72 hours | "The feature I use every single day" |
| Day 7 | 144 hours | '"Can you send me your recommendations?"' |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 422 | `UnprocessableEntity` | User email is missing |
| 429 | `RateLimitExceeded` | Rate limit exceeded (3/hour) |

---

### Ad Events

#### `POST /ad-events`

Track an ad conversion event from the mobile client. The backend fans out the event to Facebook Conversions API and TikTok Events API concurrently. Failures on one platform do not affect the other.

The mobile app fires events via the client-side Facebook SDK for real-time attribution and SKAdNetwork support, then sends the same event to this endpoint for server-side tracking on both Facebook CAPI and TikTok.

**Auth:** Required

**Rate Limit:** 20/minute

**Request:**
```json
{
  "event_name": "CompleteRegistration",
  "event_id": "complete_registration_550e8400-e29b-41d4-a716-446655440000",
  "properties": {
    "method": "apple"
  },
  "timestamp": 1707955200
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_name` | string | Yes | One of: `CompleteRegistration`, `StartTrial`, `Subscribe`, `FirstTripCreated`, `FirstPhotoImport` |
| `event_id` | string | Yes | Unique event ID shared with client-side Facebook SDK for deduplication |
| `properties` | object | No | Additional event properties (default: `{}`) |
| `timestamp` | integer | Yes | Client-side Unix epoch seconds when the event occurred |

**Event Names:**

| Event | Trigger | First-Only | Facebook CAPI Event | TikTok Event |
|-------|---------|------------|--------------------|--------------|
| `CompleteRegistration` | Account created | Yes | `CompleteRegistration` | `CompleteRegistration` |
| `StartTrial` | Free trial started | Yes | `StartTrial` | `Subscribe` |
| `Subscribe` | Subscription purchased | No | `Purchase` | `CompletePayment` |
| `FirstTripCreated` | First trip created | Yes | `Lead` | `AddToCart` |
| `FirstPhotoImport` | First photo import completed | Yes | `ViewContent` | `ViewContent` |

**Properties by Event:**

| Event | Property | Type | Description |
|-------|----------|------|-------------|
| `CompleteRegistration` | `method` | string | Auth method: `email`, `apple`, or `google` |
| `StartTrial` | `plan` | string | Subscription plan identifier |
| `StartTrial` | `is_trial` | boolean | Always `true` |
| `Subscribe` | `plan` | string | Subscription plan identifier |
| `Subscribe` | `price` | number | Purchase price (must be numeric; omitted if zero) |
| `Subscribe` | `currency` | string | ISO 4217 currency code (e.g., `USD`) |
| `FirstTripCreated` | `country_code` | string | ISO 3166-1 alpha-2 country code |
| `FirstPhotoImport` | `cluster_count` | number | Number of photo clusters imported |

**Response:**
```json
{
  "status": "ok"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid token |
| 422 | `UnprocessableEntity` | Invalid event name or properties |
| 429 | `RateLimitExceeded` | Rate limit exceeded (20/minute) |

---

### Social Ingest

#### `POST /ingest/social`

Process a social media URL (TikTok or Instagram) and extract metadata including place information. This endpoint uses LLM-first extraction with regex fallback to identify places mentioned in the content.

**Auth:** Required

**Rate Limit:** 30/minute

**Request:**
```json
{
  "url": "https://www.instagram.com/p/ABC123/",
  "caption": "Optional additional caption text",
  "extraction_method": "auto",
  "video_frames": ["base64-encoded-frame-1", "base64-encoded-frame-2"],
  "skip_cache": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | TikTok or Instagram URL (10-2048 characters) |
| `caption` | string | No | Additional caption text (max 2000 characters) |
| `extraction_method` | string | No | Extraction method: `auto` (default), `llm`, or `regex` |
| `video_frames` | array | No | Base64-encoded JPEG/PNG frames sampled on-device (max 20 frames, ~1.5MB each) |
| `skip_cache` | boolean | No | Skip cache lookup and force fresh extraction (default: false) |

**Extraction Methods:**

| Method | Description |
|--------|-------------|
| `auto` | LLM-first with regex fallback (default, recommended) |
| `llm` | LLM extraction only (requires `LLM_PLACE_EXTRACTION_ENABLED=true`) |
| `regex` | Regex extraction only (legacy behavior) |

**Response:**
```json
{
  "provider": "instagram",
  "canonical_url": "https://www.instagram.com/p/ABC123/",
  "thumbnail_url": "https://...",
  "author_handle": "traveler_jane",
  "title": "Amazing dinner at Cafe Lomi in Paris!",
  "detected_places": [
    {
      "google_place_id": "ChIJ...",
      "name": "Cafe Lomi",
      "address": "3 Rue Marcadet, 75018 Paris, France",
      "latitude": 48.8912,
      "longitude": 2.3522,
      "city": "Paris",
      "country": "France",
      "country_code": "FR",
      "confidence": 0.85,
      "primary_type": "cafe",
      "types": ["cafe", "restaurant"],
      "google_photo_url": "https://...",
      "llm_entry_type": "food"
    }
  ],
  "detected_place": {
    "google_place_id": "ChIJ...",
    "name": "Cafe Lomi",
    "address": "3 Rue Marcadet, 75018 Paris, France",
    "latitude": 48.8912,
    "longitude": 2.3522,
    "city": "Paris",
    "country": "France",
    "country_code": "FR",
    "confidence": 0.85,
    "primary_type": "cafe",
    "types": ["cafe", "restaurant"],
    "google_photo_url": "https://...",
    "llm_entry_type": "food"
  },
  "detected_country": {
    "country_code": "FR",
    "country_name": "France",
    "latitude": 48.8566,
    "longitude": 2.3522
  },
  "extraction_method_used": "llm",
  "extraction_source": "caption",
  "extraction_latency_ms": 450,
  "context_location": "Paris",
  "suggested_trips": [
    {
      "id": "uuid",
      "name": "Paris Trip 2026",
      "country_code": "FR",
      "is_system": false
    },
    {
      "id": "uuid",
      "name": "Saved Places",
      "country_code": null,
      "is_system": true
    }
  ],
  "extraction_error": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `provider` | string | Social media provider: `tiktok` or `instagram` |
| `canonical_url` | string | Canonicalized URL |
| `thumbnail_url` | string | Post thumbnail URL (if available) |
| `author_handle` | string | Author's username/handle |
| `title` | string | Post title or caption |
| `detected_places` | array | Array of all detected places (max 10) for multi-place extraction |
| `detected_place` | object | First detected place (deprecated, use `detected_places` for multi-place support) |
| `detected_place.llm_entry_type` | string | LLM-predicted entry type: `place`, `food`, `stay`, or `experience` |
| `detected_country` | object | Country hint (even when place detection fails) |
| `extraction_method_used` | string | Method that succeeded: `llm`, `regex`, `video`, or `none` |
| `extraction_source` | string | Source of extraction: `caption`, `video_frames`, `carousel`, or `screenshot` |
| `extraction_latency_ms` | integer | Extraction time in milliseconds |
| `context_location` | string | Context location detected from content (e.g., "Thailand") used as search bias |
| `suggested_trips` | array | Trips suggested for saving (matching country first, then "Saved Places") |
| `extraction_error` | string | User-facing error message when extraction fails due to platform limitations |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `InvalidInput` | URL is not from a supported provider |
| 429 | `RateLimitExceeded` | Rate limit exceeded (30/minute) |

---

#### `POST /ingest/save-to-trip`

Save social ingest data to a trip as an entry. Takes the metadata from `/ingest/social` and creates an entry in the specified trip.

**Auth:** Required

**Rate Limit:** 30/minute

**Request:**
```json
{
  "trip_id": "uuid",
  "provider": "instagram",
  "canonical_url": "https://www.instagram.com/p/ABC123/",
  "thumbnail_url": "https://...",
  "author_handle": "traveler_jane",
  "title": "Amazing dinner at Cafe Lomi!",
  "place": {
    "google_place_id": "ChIJ...",
    "name": "Cafe Lomi",
    "address": "3 Rue Marcadet, 75018 Paris, France",
    "latitude": 48.8912,
    "longitude": 2.3522,
    "city": "Paris",
    "country": "France",
    "country_code": "FR",
    "confidence": 0.85
  },
  "entry_type": "food",
  "notes": "Best coffee in Paris!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `trip_id` | uuid | Yes | Target trip ID |
| `provider` | string | Yes | Social provider: `tiktok` or `instagram` |
| `canonical_url` | string | Yes | Canonical URL (max 2048 chars) |
| `thumbnail_url` | string | No | Thumbnail URL |
| `author_handle` | string | No | Author handle (max 200 chars) |
| `title` | string | No | Post title (max 2200 chars) |
| `place` | object | No | Place data to save |
| `entry_type` | string | No | Entry type: `place`, `food`, `stay`, `experience` (default: `place`) |
| `notes` | string | No | User notes (max 2000 chars) |

**Response:** `201 Created`

Returns the created entry with place data (same format as `POST /trips/{trip_id}/entries`).

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 403 | `Forbidden` | Not authorized to add entries to this trip |
| 404 | `NotFound` | Trip not found |
| 409 | `Conflict` | This place has already been saved to this trip |
| 429 | `RateLimitExceeded` | Rate limit exceeded (30/minute) |

---

#### `POST /ingest/save-places`

Save multiple places from a social media post to a trip in a single batch operation. This endpoint is designed for multi-place extraction where a single post contains multiple places (e.g., a "Top 10 restaurants in Paris" video).

**Auth:** Required

**Rate Limit:** 30/minute

**Request:**
```json
{
  "trip_id": "uuid",
  "places": [
    {
      "google_place_id": "ChIJ...",
      "name": "Cafe Lomi",
      "entry_type": "food",
      "address": "3 Rue Marcadet, 75018 Paris, France",
      "latitude": 48.8912,
      "longitude": 2.3522,
      "city": "Paris",
      "country": "France",
      "country_code": "FR",
      "google_photo_url": "https://..."
    },
    {
      "google_place_id": "ChIK...",
      "name": "Le Comptoir",
      "entry_type": "food",
      "address": "9 Carrefour de l'Odéon, 75006 Paris, France",
      "latitude": 48.8520,
      "longitude": 2.3387,
      "city": "Paris",
      "country": "France",
      "country_code": "FR"
    }
  ],
  "provider": "instagram",
  "canonical_url": "https://www.instagram.com/p/ABC123/",
  "thumbnail_url": "https://...",
  "author_handle": "traveler_jane",
  "title": "Top 10 restaurants in Paris!",
  "notes": "From my Paris food tour"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `trip_id` | uuid | Yes | Target trip ID |
| `places` | array | Yes | Array of places to save (1-20 places) |
| `places[].google_place_id` | string | Yes | Google Place ID (1-512 chars) |
| `places[].name` | string | Yes | Place name (1-256 chars) |
| `places[].entry_type` | string | No | Entry type: `place`, `food`, `stay`, `experience` (default: `place`) |
| `places[].address` | string | No | Place address (max 512 chars) |
| `places[].latitude` | float | No | Latitude (-90 to 90) |
| `places[].longitude` | float | No | Longitude (-180 to 180) |
| `places[].city` | string | No | City name (max 200 chars) |
| `places[].country` | string | No | Country name (max 200 chars) |
| `places[].country_code` | string | No | ISO 3166-1 alpha-2 country code |
| `places[].google_photo_url` | string | No | Google Places photo URL (max 2048 chars) |
| `provider` | string | Yes | Social provider: `tiktok` or `instagram` |
| `canonical_url` | string | Yes | Canonical URL (max 2048 chars) |
| `thumbnail_url` | string | No | Thumbnail URL |
| `author_handle` | string | No | Author handle (max 256 chars) |
| `title` | string | No | Post title (max 2200 chars) |
| `notes` | string | No | Notes applied to all entries (max 5000 chars) |

**Response:** `201 Created`
```json
{
  "saved_count": 2,
  "skipped_count": 1,
  "saved_entry_ids": ["uuid-1", "uuid-2"],
  "skipped_place_names": ["Already Saved Place"],
  "results": [
    {
      "place_name": "Cafe Lomi",
      "status": "saved",
      "entry_id": "uuid-1"
    },
    {
      "place_name": "Le Comptoir",
      "status": "saved",
      "entry_id": "uuid-2"
    },
    {
      "place_name": "Already Saved Place",
      "status": "duplicate",
      "error_message": "Place already exists in this trip"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `saved_count` | integer | Number of places successfully saved |
| `skipped_count` | integer | Number of places skipped (duplicates or errors) |
| `saved_entry_ids` | array | UUIDs of created entries |
| `skipped_place_names` | array | Names of places that were skipped |
| `results` | array | Per-place status for detailed error handling |
| `results[].place_name` | string | Name of the place |
| `results[].status` | string | Status: `saved`, `duplicate`, or `error` |
| `results[].entry_id` | uuid | Entry ID if saved successfully |
| `results[].error_message` | string | Error message if skipped |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 403 | `Forbidden` | Not authorized to add entries to this trip |
| 404 | `NotFound` | Trip not found |
| 429 | `RateLimitExceeded` | Rate limit exceeded (30/minute) |

---

### Photos

#### `POST /photos/suggest-places`

Get place suggestions for photo GPS clusters using Google Places Nearby Search. This endpoint is used by the mobile app's photo import feature to automatically suggest trip entries based on where photos were taken.

**Auth:** Required

**Rate Limit:** 30/minute

**Request:**
```json
{
  "clusters": [
    {
      "id": "cluster-1",
      "centroid": {
        "latitude": 35.71478,
        "longitude": 139.79672
      },
      "photos": [
        {
          "asset_id": "photo-123",
          "latitude": 35.71480,
          "longitude": 139.79670,
          "timestamp": "2024-03-16T10:30:00Z"
        }
      ],
      "start_time": "2024-03-16T10:30:00Z",
      "end_time": "2024-03-16T11:00:00Z"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clusters` | array | Yes | List of photo clusters (1-100 clusters) |
| `clusters[].id` | string | Yes | Unique cluster identifier (1-64 chars) |
| `clusters[].centroid` | object | Yes | Center point of the cluster |
| `clusters[].centroid.latitude` | float | Yes | Latitude (-90 to 90) |
| `clusters[].centroid.longitude` | float | Yes | Longitude (-180 to 180) |
| `clusters[].photos` | array | Yes | Photos in the cluster (1-100 per cluster) |
| `clusters[].photos[].asset_id` | string | Yes | Device photo asset ID (1-256 chars) |
| `clusters[].photos[].latitude` | float | Yes | Photo latitude |
| `clusters[].photos[].longitude` | float | Yes | Photo longitude |
| `clusters[].photos[].timestamp` | datetime | No | When the photo was taken |
| `clusters[].start_time` | datetime | No | Earliest photo timestamp in cluster |
| `clusters[].end_time` | datetime | No | Latest photo timestamp in cluster |

**Limits:**
- Maximum 100 clusters per request
- Maximum 100 photos per cluster
- Maximum 500 total photos per request

**Response:**
```json
{
  "suggestions": [
    {
      "cluster_id": "cluster-1",
      "photo_ids": ["photo-123"],
      "places": [
        {
          "place_id": "ChIJ8T1GpMGOGGARDYGSgpooDWw",
          "name": "Senso-ji Temple",
          "address": "2 Chome-3-1 Asakusa, Taito City, Tokyo, Japan",
          "location": {
            "latitude": 35.71478,
            "longitude": 139.79672
          },
          "category": "place",
          "distance_m": 15.2,
          "types": ["tourist_attraction", "place_of_worship"]
        }
      ]
    }
  ],
  "failed_cluster_count": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `suggestions` | array | Place suggestions for each cluster |
| `suggestions[].cluster_id` | string | Matching cluster ID from request |
| `suggestions[].photo_ids` | array | Photo asset IDs in this cluster |
| `suggestions[].places` | array | Suggested places ranked by distance |
| `suggestions[].places[].place_id` | string | Google Place ID |
| `suggestions[].places[].name` | string | Place name |
| `suggestions[].places[].address` | string | Formatted address |
| `suggestions[].places[].location` | object | Place coordinates |
| `suggestions[].places[].category` | string | Entry type: `place`, `food`, `stay`, or `experience` |
| `suggestions[].places[].distance_m` | float | Distance from cluster centroid in meters |
| `suggestions[].places[].types` | array | Google Places type categories |
| `failed_cluster_count` | integer | Number of clusters that failed to process |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 429 | `RateLimitExceeded` | Rate limit exceeded (30/minute) or Google Places rate limit |
| 503 | `ServiceUnavailable` | Google Places API quota exceeded or service not configured |
| 504 | `GatewayTimeout` | Google Places API timed out |

---

### Guess Where (Quiz)

Guess Where lets an authenticated owner build a photo challenge from uploaded
travel photos, play it to establish a score to beat, and share it through a
public `/q/{slug}` link. Quiz questions are always sanitized: `id`, `position`,
`image_url`, and `options` are returned, but the correct country and capture
year are never included in question payloads or initial public responses.
After an answer, the server's grading response intentionally reveals that
question's `correct_country`; grading and the authoritative score remain
server-side. Quiz states are returned as strings by the API.

#### `POST /quiz`

Create an empty quiz draft owned by the authenticated user.

**Auth:** Required

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "state": "building"
}
```

#### `GET /quiz`

List the authenticated user's quizzes, newest first.

**Auth:** Required

**Response:**
```json
{
  "quizzes": [
    {
      "id": "uuid",
      "state": "shared",
      "slug": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "share_url": "https://atlasi.app/q/a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "score_to_beat": {
        "correct": 7,
        "total": 10
      },
      "cover_image_url": "https://...",
      "question_count": 10,
      "created_at": "2025-01-15T10:30:00+00:00",
      "revoked_at": null
    }
  ]
}
```

`slug` and `share_url` are served only while the quiz is `shared` (a revoked
slug serves nothing publicly), and `score_to_beat` is `null` until the owner
completes their own play. `cover_image_url` is `null` while a draft has no
questions, and `revoked_at` is `null` until revocation.

#### `POST /quiz/eligibility`

Classify a batch of camera-roll images for quiz eligibility. Each image is
identified by a client-generated `id` and sent as valid base64 JPEG data.
Requests contain 1-50 images, each with at most 200,000 `image_base64`
characters, and the combined image payload is at most 8,000,000 characters.

**Auth:** Required

**Rate Limit:** 30/hour

**Request:**
```json
{
  "quiz_id": "uuid",
  "images": [
    {
      "id": "photo-123",
      "image_base64": "/9j/4AAQSkZJRgABAQ..."
    }
  ]
}
```

**Response:**
```json
{
  "results": [
    {
      "id": "photo-123",
      "eligible": true,
      "status": "eligible",
      "reason": null,
      "landscape": "scenery"
    }
  ],
  "classified_count": 12,
  "budget_remaining": 288
}
```

Each result has `status` `eligible`, `ineligible`, or `error`; `reason` and
`landscape` may be `null`. The classification budget is reserved before model
calls, so `classified_count` includes attempted images.

#### `POST /quiz/{quiz_id}/upload-urls`

Mint signed upload targets for quiz-owned photo copies. Upload each file with
`PUT` to its returned `upload_url`; the `storage_path` is then supplied to
finalize or question replacement. No media-library row is created.

**Auth:** Required

**Rate Limit:** 60/hour

**Request:**
```json
{
  "count": 5
}
```

`count` must be between 1 and 10.

**Response:**
```json
{
  "uploads": [
    {
      "storage_path": "quiz/uuid/5f2e...jpg",
      "upload_url": "https://project.supabase.co/storage/v1/...",
      "cache_control": "60"
    }
  ]
}
```

#### `POST /quiz/{quiz_id}/finalize`

Turn a building draft into 5-10 questions. `storage_path` must identify an
object previously uploaded to that quiz's `quiz/{quiz_id}/` prefix.
`country_code` is a two-letter ISO code; `landscape` is optional and accepted
only for the server's supported landscape values.

**Auth:** Required

**Request:**
```json
{
  "photos": [
    {
      "storage_path": "quiz/uuid/5f2e...jpg",
      "country_code": "JP",
      "landscape": "landmark"
    }
  ]
}
```

**Response:**
```json
{
  "id": "uuid",
  "state": "awaiting_owner_play",
  "questions": [
    {
      "id": "uuid",
      "position": 0,
      "image_url": "https://...",
      "options": ["Japan", "South Korea", "Taiwan", "Thailand"]
    }
  ],
  "score_to_beat": null,
  "slug": null,
  "share_url": null
}
```

The response contains no `correct_index`, capture year, or other answer-bearing
metadata.

#### `GET /quiz/{quiz_id}`

Get the authenticated owner's quiz detail and sanitized question payloads.
Reading a revoked quiz also retries any pending photo cleanup.

**Auth:** Required

**Response:**
```json
{
  "id": "uuid",
  "state": "playable",
  "questions": [
    {
      "id": "uuid",
      "position": 0,
      "image_url": "https://...",
      "options": ["Japan", "South Korea", "Taiwan", "Thailand"]
    }
  ],
  "score_to_beat": {
    "correct": 7,
    "total": 10
  },
  "slug": null,
  "share_url": null
}
```

#### `GET /quiz/{quiz_id}/leaderboard`

Get the owner's leaderboard for any quiz state. Unlike the public board, this
view includes hidden sessions and marks each row with `hidden`; `session_ids`
lists the sessions represented by that row.

**Auth:** Required

**Response:**
```json
{
  "score_to_beat": {
    "correct": 7,
    "total": 10
  },
  "leaderboard": [
    {
      "display_name": "Maya",
      "best_score": 9,
      "attempts": 2,
      "hidden": false,
      "session_ids": ["uuid"]
    }
  ]
}
```

#### `POST /quiz/{quiz_id}/play`

Start an owner play session. The owner session is hidden from the public
leaderboard and uses the same server-side grading path as public play.

**Auth:** Required

**Response:** `201 Created`
```json
{
  "session_id": "uuid",
  "token": "owner-...",
  "questions": [
    {
      "id": "uuid",
      "position": 0,
      "image_url": "https://...",
      "options": ["Japan", "South Korea", "Taiwan", "Thailand"]
    }
  ]
}
```

#### `POST /quiz/{quiz_id}/answer`

Grade one owner answer. `selected_option_index` is zero-based and must be
between 0 and 3. The response reveals the correct option for that question.

**Auth:** Required

**Request:**
```json
{
  "session_id": "uuid",
  "question_id": "uuid",
  "selected_option_index": 0
}
```

**Response:**
```json
{
  "place_correct": true,
  "correct_option_index": 0,
  "correct_option": "Japan",
  "score": 1
}
```

#### `POST /quiz/{quiz_id}/complete`

Complete an owner play session after every question has been answered. The
first completed owner session seeds the quiz's permanent score-to-beat pair and
unlocks it for sharing.

**Auth:** Required

**Request:**
```json
{
  "session_id": "uuid"
}
```

**Response:**
```json
{
  "correct": 7,
  "total": 10,
  "score_to_beat": {
    "correct": 7,
    "total": 10
  },
  "state": "playable"
}
```

#### `POST /quiz/{quiz_id}/questions/{question_id}/swap`

Replace a question's photo before sharing. The request has the same fields as
one `QuizFinalizePhoto`; replacement deletes recorded answers for that
question, so the owner must answer it again before sharing.

**Auth:** Required

**Request:**
```json
{
  "storage_path": "quiz/uuid/8a91...jpg",
  "country_code": "FR",
  "landscape": "coastal"
}
```

**Response:**
The response is the updated `QuizDetailResponse` shown for
`GET /quiz/{quiz_id}`.

#### `DELETE /quiz/{quiz_id}/questions/{question_id}`

Remove a question before sharing. The quiz must still contain at least five
questions; recorded answers for the removed question are deleted.

**Auth:** Required

**Response:**
The response is the updated `QuizDetailResponse` shown for
`GET /quiz/{quiz_id}`.

#### `POST /quiz/{quiz_id}/share`

Lock a playable quiz and mint its opaque public slug. Repeating the request for
an already-shared quiz returns the same link. Every current question must have
an owner answer before sharing.

**Auth:** Required

**Response:**
```json
{
  "slug": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "share_url": "https://atlasi.app/q/a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "state": "shared"
}
```

#### `POST /quiz/{quiz_id}/sessions/{session_id}/hide`

Hide an owner-selected play session from the public leaderboard. Hiding keeps
its answers and makes it visible only in the owner's leaderboard.

**Auth:** Required

**Rate Limit:** 60/hour

**Response:**
```json
{
  "session_id": "uuid",
  "hidden": true
}
```

#### `POST /quiz/{quiz_id}/revoke`

Revoke a shared quiz. Public pages and JSON routes stop serving as soon as the
quiz enters `revoked`; the endpoint then removes display names and sweeps the
quiz's storage prefix. Calling it again retries pending cleanup.

**Auth:** Required

**Response:**
```json
{
  "state": "revoked",
  "revoked_at": "2025-01-15T12:00:00+00:00",
  "objects_deleted": true
}
```

`objects_deleted` is `false` when revocation succeeded but storage cleanup is
still pending.

#### `DELETE /quiz/{quiz_id}`

Delete a quiz that is not currently shared, including its questions, sessions,
answers, and storage objects. Revoke a shared quiz first.

**Auth:** Required

**Response:** `204 No Content`

---

### Places

#### `POST /places/autocomplete`

Search for places using Google Places Autocomplete. This endpoint is used by the iOS Share Extension for location search and keeps the Google Places API key server-side.

**Auth:** Required

**Rate Limit:** 30/minute

**Request:**
```json
{
  "query": "Senso-ji Temple",
  "country_code": "JP"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Search query (2-200 characters) |
| `country_code` | string | No | ISO 3166-1 alpha-2 country code to bias results (e.g., "JP", "US") |

**Response:**
```json
[
  {
    "place_id": "ChIJ8T1GpMGOGGARDYGSgpooDWw",
    "main_text": "Senso-ji",
    "secondary_text": "2 Chome-3-1 Asakusa, Taito City, Tokyo, Japan",
    "types": []
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `place_id` | string | Google Place ID for use with place details lookup |
| `main_text` | string | Primary place name |
| `secondary_text` | string | Address or location context |
| `types` | array | Place type categories (populated from details lookup) |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 422 | `UnprocessableEntity` | Query too short or invalid country code |
| 503 | `ServiceUnavailable` | Google Places API not configured or temporarily unavailable |

#### `GET /places/{place_id}`

Get place metadata by ID.

**Auth:** Required

**Response:**
```json
{
  "id": "uuid",
  "entry_id": "uuid",
  "google_place_id": "ChIJ...",
  "place_name": "Senso-ji",
  "lat": 35.7148,
  "lng": 139.7967,
  "address": "2 Chome-3-1 Asakusa, Taito City, Tokyo, Japan",
  "extra_data": {}
}
```

---

### Public Endpoints

These endpoints do not require authentication. The human-facing HTML share pages are served at `/l/{slug}` (lists), `/t/{slug}` (trips), and `/q/{slug}` (Guess Where challenges) — an editorial layout with a byline, category filters, and an interactive map for lists and trips (see `docs/app-overview.md`). Public entries expose `latitude`/`longitude` so those pages can plot map pins.

#### `GET /public/lists/{slug}`

Get a public list by slug.

**Response:**
```json
{
  "name": "Best Ramen Spots",
  "description": "...",
  "owner_display_name": "John Traveler",
  "entries": [
    {
      "title": "Ichiran Shibuya",
      "notes": "...",
      "place_name": "Ichiran",
      "latitude": 35.6595,
      "longitude": 139.7005,
      "media_urls": ["https://..."]
    }
  ]
}
```

#### `GET /public/trips/{slug}`

Get a public trip by share slug.

**Response:**
```json
{
  "name": "Spring in Tokyo",
  "country_name": "Japan",
  "cover_image_url": "https://...",
  "date_range": ["2024-03-15", "2024-03-22"],
  "owner_display_name": "John Traveler",
  "entry_count": 15
}
```

#### `POST /q/{slug}/session`

Start or resume an anonymous Guess Where play session. Send `{}` for a new
session, or provide a previously returned `token` to resume.

**Rate Limit:** 10/minute

**Request:**
```json
{
  "token": "optional-session-token"
}
```

**Response:**
```json
{
  "token": "opaque-session-token",
  "answered": [
    {
      "question_id": "uuid",
      "selected_option_index": 1,
      "correct": true,
      "correct_country": "Japan"
    }
  ],
  "completed": false,
  "score": null,
  "display_name": null
}
```

`token` is optional in the request. In the response, `score` is populated only
after completion; `display_name` is the name bound to a completed session, or
`null` when the player has not posted one.

#### `POST /q/{slug}/answer`

Grade one anonymous answer for the session identified by `token`.

**Rate Limit:** 60/minute

**Request:**
```json
{
  "token": "opaque-session-token",
  "question_id": "uuid",
  "selected_option_index": 1
}
```

**Response:**
```json
{
  "correct": true,
  "correct_country": "Japan",
  "answered_count": 1
}
```

The answer is recorded server-side and a question cannot be answered twice by
the same session.

#### `POST /q/{slug}/complete`

Complete an anonymous session after all questions are answered. `display_name`
is optional: omitting it reveals the result without adding the session to the
leaderboard; a name can then be submitted through `/q/{slug}/name`. There is
no score field in the request.

**Rate Limit:** 20/minute

**Request:**
```json
{
  "token": "opaque-session-token",
  "display_name": "Maya"
}
```

**Response:**
```json
{
  "score": 8,
  "total": 10,
  "score_to_beat": {
    "correct": 7,
    "total": 10
  },
  "leaderboard": [
    {
      "display_name": "Maya",
      "best_score": 8,
      "attempts": 1,
      "is_you": true
    }
  ],
  "already_completed": false,
  "leaderboard_full": false
}
```

Completion is idempotent. `already_completed` is `true` for a repeated
completion request, and `leaderboard_full` indicates that a named player was
excluded by the distinct-name cap.

#### `POST /q/{slug}/name`

Bind a display name to a completed anonymous session that does not have one.
Names are trimmed, must contain a letter or number, and must be 2-50
characters after trimming. A session name cannot be changed.

**Rate Limit:** 20/minute

**Request:**
```json
{
  "token": "opaque-session-token",
  "display_name": "Maya"
}
```

**Response:**
The response is the same `PublicQuizCompleteResponse` shape shown for
`POST /q/{slug}/complete`.

#### `POST /q/{slug}/reshared`

Record a player's onward share tap. This is a funnel-only endpoint; every tap
with a valid session token is counted.

**Rate Limit:** 30/minute

**Request:**
```json
{
  "token": "opaque-session-token"
}
```

**Response:** `204 No Content`

#### `GET /q/{slug}/leaderboard`

Get the current public leaderboard and the owner's score to beat. This response
has no `is_you` field and is never cached.

**Rate Limit:** 30/minute

**Response:**
```json
{
  "score_to_beat": {
    "correct": 7,
    "total": 10
  },
  "leaderboard": [
    {
      "display_name": "Maya",
      "best_score": 8,
      "attempts": 1
    }
  ]
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "ErrorCode",
  "message": "Human-readable message",
  "details": { ... }
}
```

### Error Codes

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `InvalidInput` | Validation error |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `Forbidden` | Insufficient permissions |
| 404 | `NotFound` | Resource not found |
| 409 | `Conflict` | Duplicate or already exists |
| 413 | `FileTooLarge` | Upload exceeds size limit |
| 422 | `UnprocessableEntity` | Invalid request |
| 429 | `RateLimitExceeded` | Too many requests |
| 500 | `InternalError` | Server error |

---

## Rate Limiting

Rate limits are applied per endpoint:

| Endpoint | Limit |
|----------|-------|
| `DELETE /profile` | 5/hour |
| `POST /welcome/emails` | 3/hour |
| `GET /profile` | 30/minute |
| `POST /ad-events` | 20/minute |
| `POST /places/autocomplete` | 30/minute |
| `POST /media/files/upload-url` | 60/minute |
| `POST /quiz` | 10/hour |
| `POST /quiz/eligibility` | 30/hour |
| `POST /quiz/{quiz_id}/upload-urls` | 60/hour |
| `POST /quiz/{quiz_id}/sessions/{session_id}/hide` | 60/hour |
| `POST /q/{slug}/session` | 10/minute |
| `POST /q/{slug}/answer` | 60/minute |
| `POST /q/{slug}/complete` | 20/minute |
| `POST /q/{slug}/name` | 20/minute |
| `POST /q/{slug}/reshared` | 30/minute |
| `GET /q/{slug}/leaderboard` | 30/minute |
| Other endpoints | 120/minute |

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 29
X-RateLimit-Reset: 1704067200
```

---

## Data Types

### Entry Type

```typescript
type EntryType = "place" | "food" | "stay" | "experience";
```

### Country Status

```typescript
type CountryStatus = "visited" | "wishlist";
```

### Trip Tag Status

```typescript
type TripTagStatus = "pending" | "approved" | "declined";
```

### Media Status

```typescript
type MediaStatus = "processing" | "uploaded" | "failed";
```

### Country Recognition

```typescript
type CountryRecognition = "un_member" | "observer" | "disputed" | "territory";
```
