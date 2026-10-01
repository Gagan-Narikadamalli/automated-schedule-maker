# SOS Automated Schedule Maker

A multi-location scheduling application for Success On The Spectrum that keeps the familiar Excel-style clinic workflow while adding automatic scheduling, validation, call-outs, templates, reporting, supervision planning, and protected access.

## Technology

- Next.js 16 + TypeScript
- MongoDB Atlas + Mongoose
- Vercel deployment
- Custom constraint-based scheduling engine
- Signed HTTP-only sessions
- Password + Gmail OTP authentication for normal accounts
- Optional environment-variable test account for temporary UI testing

The project intentionally uses readable TypeScript instead of compressed one-line code. Scheduling logic, database models, authentication, UI components, and reporting are kept in separate folders so each part can be understood and changed independently.

## Calendar behavior

- 8:00 AM through 6:00 PM
- 30-minute blocks
- Staff displayed as columns, matching the existing spreadsheet workflow
- Client assignments displayed inside cells
- Break, Nap, Speech, Break/Nap, Break/Speech, Unavailable, and open blocks
- Keyboard arrow navigation
- Shift + arrow/click multi-selection
- Ctrl/Cmd+C and Ctrl/Cmd+V spreadsheet copy/paste
- Enter/F2 or double-click cell editing
- Auto-safe mode prevents accidental replacement of occupied assignments
- Manual Mode allows drag-and-drop replacement
- Displaced client assignments are kept in an Unplaced Assignments tray instead of being silently deleted
- Persistent undo/redo support for manual schedule changes
- Responsive scroll and Focus View behavior for laptops, tablets, and smaller browser windows

## Locations

The same application supports Livingston and Parsippany. Staff, clients, teams, schedules, templates, call-outs, rules, fixed events, and user permissions are location-scoped instead of duplicating the whole application for each clinic.

## Automatic scheduler

Hard constraints include staff availability, call-outs, occupied/locked cells, client double-booking prevention, hard staff-client restrictions, service-setting compatibility, client and technician limits, configured client rotation caps, and manual overrides.

Soft preferences include preferred staff-client relationships, same-team matching, continuity for standard clients, deliberate staff rotation for rotation/high-support clients, workload balance, and stable scheduling.

Rotation behavior can be customized per client. Leaving the override fields blank uses support-level defaults:

- Standard / 1:1: favor continuity
- Rotation: default maximum 4 consecutive 30-minute blocks and aim for 2 different staff per day
- High Support: default maximum 2 consecutive 30-minute blocks and aim for 3 different staff per day

The generator processes constrained client requirements first. Repair Schedule preserves unaffected assignments and refills holes caused by call-outs or new constraints.

## Main sections

- Calendar
- Staff
- Clients
- Teams
- Fixed Events / Speech
- Templates
- Weekly Overview
- Activity & Changes
- Supervision
- Clinic Settings

## Current production-connected modules

- MongoDB-backed staff management
- MongoDB-backed client management
- Per-client rotation configuration
- MongoDB-backed teams
- Live daily schedule loading and generation
- Call-outs and targeted schedule repair
- Break/Nap/Speech combined schedule states
- Recurring speech/fixed-event management
- Schedule templates captured from saved days
- Template application with target-date revalidation
- Copy Day with target-date revalidation
- Persistent manual edits and unplaced assignments
- Location-specific Clinic Settings saved to MongoDB
- Weekly Overview calculated from saved schedules and staff availability
- Activity & Changes backed by AuditLog
- Supervision planning backed by saved schedule/service-hour data
- Location-specific supervision planning target

## Authentication

Two login paths can coexist during testing:

1. **Temporary test account** — enabled only when both `TEMP_LOGIN_USERNAME` and `TEMP_LOGIN_PASSWORD` are present in Vercel. This account signs in directly so the interface can be tested even while the first normal clinic account is being configured.
2. **Normal clinic account** — username/email + password, followed by a 6-digit Gmail OTP. Passwords are stored as hashes and sessions are signed HTTP-only cookies.

For final production launch, remove the two `TEMP_LOGIN_*` environment variables so all users are required to use normal account authentication and OTP verification.

## Environment variables

```text
MONGODB_URI=...
AUTH_SECRET=...
SETUP_KEY=...
GMAIL_USER=...
GMAIL_APP_PASSWORD=...
TEMP_LOGIN_USERNAME=...
TEMP_LOGIN_PASSWORD=...
```

Never commit real values to GitHub.

## Local development

```bash
npm install
npm run dev
```

Production-style validation:

```bash
npm run build
npm start
```

## Development rule

Changes are intentionally implemented in readable feature batches and verified with the GitHub production build before relying on the Vercel deployment. This avoids shipping compressed or difficult-to-maintain code and reduces deployment failures.
