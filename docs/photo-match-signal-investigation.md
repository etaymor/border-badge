# SIGNAL-class Investigation — Vision-Image Coverage (U16)

**Status:** Investigation (U16 of the photo-match-quality remediation plan).
Resolves the diagnostic's open question — *does the client reliably send vision
images for every cluster?* — so the SIGNAL bucket the diagnostics trace surfaces
(`vision.had_images=false` / no romanized name) has a defined disposition rather
than reading as an un-actionable failure.

The measurement input is U4's per-cluster trace: `vision.had_images`,
`vision.business_name_candidates`, `vision.confidence`, and `outcome`. The
"quantify the SIGNAL fraction from a real import" step is a **user action** (run a
`PLACES_DIAGNOSTICS=true` import and read the traces — see
`backend/docs/how-to-label-place-matcher-dataset.md`); this doc captures the
code-path analysis that tells the labeler what each SIGNAL sub-cause means and
which are fixable.

---

## The SIGNAL pipeline (verified, client → backend)

A cluster reaches the matcher with **zero vision context** (`had_images=false`)
through one of these paths:

1. **`selectRepresentativePhotos` returns `[]`** — only when the cluster has no
   photos at all (`mobile/src/services/photoImport/visionPhoto.ts:41`). Clusters
   always carry photos, so this effectively never fires. *Not a real source.*

2. **Every selected photo fails preparation** — `prepareVisionImage`
   (`visionPhoto.ts:98-135`) returns `null` **silently** when (a) `expo-image-
   manipulator` throws, or (b) the compressed base64 exceeds
   `MAX_VISION_BASE64_LENGTH = 200_000` chars. `getVisionImagesForCluster`
   filters the nulls, so a cluster whose 3 selected photos all fail prep yields
   `[]` → `mapClusterToApiPayload` sets `vision_images_base64: undefined`
   (`photoImportUtils.ts:56`) → backend `had_images=false`. *A real but expected-
   to-be-rare source — large/corrupt images.*

3. **Backend per-request payload budget drops LATER clusters' images** —
   `validate_total_photos` (`backend/app/schemas/photos.py:130-171`). Two caps:
   - `MAX_VISION_IMAGES_PER_REQUEST = 50` — at `CHUNK_SIZE = 15` × 3 images = 45,
     this **does not fire** (matches the plan's out-of-scope note).
   - `MAX_VISION_PAYLOAD_CHARS = 10_000_000` (~7.5 MB decoded) — **this one can
     fire.** When a chunk's total vision payload exceeds 10 M chars, the
     validator keeps images for **earlier** clusters and **drops them from later
     ones** ("Keep images for earlier clusters; drop from later ones",
     `photos.py:160`). A cluster whose images are dropped becomes
     `had_images=false` purely because of its **position in the chunk** — even
     though it had perfectly good photos. **This is a coverage bug, not a genuine
     no-vision limit.**

4. **Genuine no-romanized-name SIGNAL** — the cluster HAS vision images
   (`had_images=true`) but vision extracted no usable business name (indoor food
   close-up, a beach, dark nightlife, non-Latin signage the strict OCR filter
   rejects). The matcher correctly degrades to GPS-only here; U14's broadened
   text-rescue (opt-in) is the only partial mitigation. *A real limit, not a bug.*

---

## Disposition by sub-cause

| Sub-cause | `had_images` | Class | Disposition |
| --- | --- | --- | --- |
| (1) cluster has no photos | false | n/a | Cannot occur in practice. |
| (2) all selected photos fail prep | false | coverage | **Accepted limit** for now (large/corrupt images). Cheap future hardening: log the prep-failure reason so the SIGNAL trace can distinguish "image too large" from "manipulator threw". Low priority — expected rare. |
| (3) backend char-budget drops later clusters | false | **coverage BUG** | **Actionable follow-up (recommended).** Order-dependent vision loss within a chunk. See *Recommended fix* below. |
| (4) has images, no usable name | true | SIGNAL (genuine) | **Accepted limit.** Matcher correctly degrades to GPS-only; U14 broadened rescue (opt-in) is the partial mitigation. Quantify from a real import; if dominant, the recall levers buy little on these clusters (ties into U6's `expected:none` gate). |

The single number to read from a real diagnostics import:

```
signal_blind_share = (# clusters with vision.had_images=false) / (total clusters)
```

Split it by whether the cluster's photos *could* have produced images:
- if a large share is sub-cause **(3)** (later-in-chunk clusters losing images
  while earlier ones keep them), prioritize the char-budget fix;
- if it is dominated by sub-cause **(4)** (`had_images=true` but no name), it is a
  genuine signal limit and the matcher's GPS-only degrade is correct — do not
  spend recall levers expecting to recover those.

---

## Recommended fix for sub-cause (3) — distribute the vision budget fairly

The current char-budget truncation is **greedy by position** — it fills earlier
clusters first and starves later ones. A fairer policy keeps **at least one image
per cluster** before adding second/third images to any cluster, so no cluster
goes fully SIGNAL-blind purely because it sorted late in the chunk. Sketch:

1. First pass: keep image[0] of every cluster (within the budget).
2. Second/third passes: add image[1], then image[2] of each cluster while the
   budget allows.

This bounds worst-case loss to "fewer images per cluster" rather than "whole
clusters blinded", which is what SIGNAL coverage actually cares about. It is a
backend-only change in `validate_total_photos`, failing-test-first per CLAUDE.md
(a chunk whose total exceeds the budget must leave every cluster with ≥1 image
when the per-cluster-first allocation fits). Left as a scoped follow-up rather
than folded into this plan, since it is a distinct behavior change with its own
test surface and the SIGNAL fraction (the trigger to prioritize it) needs the
real-import measurement first.

---

## What is NOT a problem (verified)

- The **50-image cap** never fires at `CHUNK_SIZE = 15` (45 < 50) — the plan's
  out-of-scope note is correct.
- `mapClusterToApiPayload` correctly omits `vision_images_base64` (sends
  `undefined`, not `[]`) when there are no images — the backend treats absent and
  empty identically (`had_images = cluster_id in vision_map`), so there is no
  empty-vs-absent ambiguity bug.
- A no-vision cluster genuinely has no text to query, so U14's broadened rescue
  cannot help it — that is the honest SIGNAL floor, not a missed fix.
