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

---

### Public Endpoints

These endpoints do not require authentication.

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
| `GET /profile` | 30/minute |
| `POST /media/files/upload-url` | 60/minute |
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
