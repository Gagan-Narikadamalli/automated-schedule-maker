# SOS Automated Schedule Maker

A multi-location scheduling application for Success On The Spectrum that keeps the familiar Excel-style clinic workflow while adding automatic scheduling, validation, call-outs, templates, reporting, and flexible schedule editing.

## Technology

- Next.js 16 + TypeScript
- MongoDB Atlas + Mongoose
- Vercel deployment
- Custom constraint-based scheduling engine

The project intentionally uses readable TypeScript instead of compressed one-line code. Scheduling logic, database models, UI components, and reporting are kept in separate folders so each part can be understood and changed independently.

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
- Displaced client assignments are kept in an Unplaced Assignments tray instead of being silently deleted
- Responsive scroll and focus views for smaller browsers, laptops, and tablets

## Locations

The same application supports Livingston and Parsippany. Staff, clients, teams, schedules, templates, call-outs, rules, and reporting are location-scoped instead of duplicating the whole application for each clinic.

## Automatic scheduler

Hard scheduling rules include staff availability, call-outs, occupied or locked cells, service-setting compatibility, hard staff-client restrictions, daily client/technician limits, and manual overrides.

Soft preferences include preferred staff-client relationships, same-team matching, continuity for standard clients, intentional rotation for rotation/high-support clients, workload balance, and stable scheduling.

The generator processes constrained client requirements first. Repair Schedule preserves unaffected assignments and refills holes caused by call-outs or new constraints instead of rebuilding the whole day.

## Rotation controls

Clients can use support levels such as Standard, 1:1, Rotation, and High Support. Rotation scheduling can also be tuned with:

- Maximum consecutive 30-minute blocks with the same staff member
- Desired number of different staff members per day

These settings are stored with the client and are used directly by the automatic scheduler.

## Main sections

- Calendar
- Staff
- Clients
- Teams
- Speech & Fixed Events
- Templates
- Weekly Overview
- Activity & Changes
- Supervision
- Clinic Settings

## Current scheduler modules

- MongoDB-backed staff management
- MongoDB-backed client management
- MongoDB-backed teams
- Live daily schedule loading and generation
- Manual spreadsheet editing and persistence
- Call-outs and targeted repair
- Break/Nap/Speech combined schedule states
- Unplaced Assignments storage and restoration
- Schedule undo/redo support
- Schedule templates captured from saved days
- Template application with target-date revalidation
- Copy Day support with target-date revalidation
- Week generation
- Recurring speech/fixed-event management
- Location-specific Clinic Settings saved to MongoDB
- Weekly Overview calculated from saved schedules and staff availability
- Activity & Changes backed by AuditLog
- Supervision planning backed by saved schedule/service-hour data
- Client rotation and high-support scheduling rules
- Staff/client in-center, in-home, and both service-setting compatibility

## Environment variables

The active application currently requires only the MongoDB connection:

```text
MONGODB_URI=...
```

Never commit real database credentials to GitHub.

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

## Development approach

Changes are implemented in readable feature batches and verified with the production build before relying on deployment. Authentication is intentionally out of scope for the current build phase so development can stay focused on completing and validating the scheduling workflow.
