# SOS Automated Schedule Maker

A multi-location scheduling application for Success On The Spectrum that keeps the familiar Excel-style clinic workflow while adding automatic scheduling, validation, call-outs, templates, reporting, and secure access.

## Technology

- Next.js 16 + TypeScript
- MongoDB Atlas + Mongoose
- Vercel deployment
- Temporary username/password access for current testing
- Full password + Gmail OTP authentication retained for later production enablement
- Custom constraint-based scheduling engine

The project intentionally uses readable TypeScript instead of compressed one-line code. Scheduling logic, database models, authentication, UI components, and reporting are kept in separate folders so each part can be understood and changed independently.

## Calendar behavior

- 8:00 AM through 6:00 PM
- 30-minute blocks
- Staff displayed as columns
- Client assignments displayed inside cells
- Break, Nap, Speech, Break/Nap, Break/Speech, Unavailable, and open blocks
- Keyboard arrow navigation
- Shift + arrow/click multi-selection
- Ctrl/Cmd+C and Ctrl/Cmd+V spreadsheet copy/paste
- Enter/F2 or double-click cell editing
- Auto-safe mode prevents accidental replacement of occupied assignments
- Manual Mode allows drag-and-drop replacement
- Displaced assignments are kept in an Unplaced Assignments tray instead of being silently deleted
- Responsive scroll/focus views for smaller browsers and tablets

## Locations

The same application supports Livingston and Parsippany. Staff, clients, teams, schedules, templates, call-outs, rules, and user permissions are location-scoped instead of duplicating the whole application for each clinic.

## Automatic scheduler

Hard constraints include staff availability, call-outs, occupied/locked cells, hard staff-client restrictions, client and technician limits, and manual overrides.

Soft preferences include preferred staff-client relationships, same-team matching, continuity, workload balance, and stable scheduling.

The generator processes the most constrained client requirements first. Repair Schedule preserves unaffected assignments and refills holes caused by call-outs or new constraints.

## Main sections

- Calendar
- Staff
- Clients
- Teams
- Templates
- Weekly Overview
- Activity & Changes
- Supervision
- Clinic Settings

## Current production-connected modules

- MongoDB-backed staff management
- MongoDB-backed client management
- MongoDB-backed teams
- Live daily schedule loading and generation
- Call-outs and targeted repair
- Break/Nap/Speech combined schedule states
- Schedule templates captured from saved days
- Template application with target-date revalidation
- Copy Day API with target-date revalidation
- Location-specific Clinic Settings saved to MongoDB
- Weekly Overview calculated from saved schedules and staff availability
- Activity & Changes backed by AuditLog
- Supervision planning backed by saved schedule/service-hour data
- Location-specific supervision planning target

## Authentication

Temporary test login is currently enabled through Vercel environment variables:

```text
TEMP_LOGIN_USERNAME=...
TEMP_LOGIN_PASSWORD=...
```

Do not commit their values to GitHub.

The full authentication foundation remains in the codebase for later production enablement and supports password hashing, Gmail OTP verification, and signed HTTP-only sessions.

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

Changes are intentionally implemented in readable batches and verified with the GitHub production build before relying on Vercel deployment. This avoids shipping compressed or difficult-to-maintain code and reduces deployment failures.
