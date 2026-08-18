---
status: ready
priority: p2
issue_id: "008"
tags: [code-review, security, compliance, ios]
dependencies: []
---

# Privacy Manifest Missing Email Address Data Type Declaration

## Problem Statement

The iOS privacy manifest declares `NSPrivacyCollectedDataTypeDeviceID` for third-party advertising but does not declare `NSPrivacyCollectedDataTypeEmailAddress`. The backend sends SHA-256-hashed email addresses to both Facebook CAPI and TikTok Events API for advanced matching. Apple considers hashed emails as "email address" data type.

Missing this declaration risks **App Store rejection** during review.

## Findings

- **File:** `mobile/app.config.js` (lines 42-61, `privacyManifests`)
- **Flagged by:** Security Sentinel
- **Apple requirement:** All data types sent to tracking domains must be declared

## Proposed Solutions

### Option A: Add email address to privacy manifest (Recommended)
**Effort:** Small

```javascript
NSPrivacyCollectedDataTypes: [
  // existing device ID entry...
  {
    NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
    NSPrivacyCollectedDataTypeLinked: true,
    NSPrivacyCollectedDataTypeTracking: true,
    NSPrivacyCollectedDataTypePurposes: [
      'NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising',
    ],
  },
],
```

## Technical Details

**Affected files:**
- `mobile/app.config.js`

## Acceptance Criteria

- [ ] Privacy manifest declares email address collection for tracking
- [ ] App Store Connect privacy questions are updated accordingly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during security review | Hashed PII still counts as PII for Apple privacy manifests |
