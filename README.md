# SOS Automated Schedule Maker

A multi-location scheduling application for Success On The Spectrum that keeps the familiar Excel-style clinic workflow while adding automatic scheduling, validation, call-outs, templates, reporting, and secure access.

## Technology

- Next.js 16 + TypeScript
- MongoDB Atlas + Mongoose
- Vercel deployment
- Gmail OTP login through a Google App Password
- Custom constraint-based scheduling engine

The project intentionally uses readable TypeScript instead of compressed one-line code. Scheduling logic, database models, authentication, UI components, and reporting are kept in separate folders so each part can be understood and changed independently.

## Calendar behavior

- 8:00 AM through 6:00 PM
- 30-minute blocks
- Staff displayed as columns
- Client assignments displayed inside cells
- Break, Break/Nap, Speech, Unavailable, and open blocks
- Keyboard arrow navigation
- Shift + arrow/click multi-selection
- Ctrl/Cmd+C and Ctrl/Cmd+V spreadsheet copy/paste
- Enter/F2 or double-click cell editing
- Auto-safe mode prevents accidental replacement of occupied assignments
- Manual Mode allows drag-and-drop replacement
- Displaced assignments are kept in an Unplaced Assignments tray instead of being silently deleted

## Locations

The same application supports Livingston and Parsippany. Staff, clients, teams, schedules, templates, call-outs, rules, and user permissions are location-scoped instead of duplicating the whole application for each clinic.

## Automatic scheduler

The scheduling engine currently separates hard constraints from preferences.

Hard constraints include:

- Staff availability
- Staff call-outs
- Existing occupied time slots
- Hard staff/client restrictions
- Maximum clients per technician per day
- Maximum technicians per client per day
- Maximum staff hour limits
- Locked/manual assignments

Soft preferences include:

- Preferred staff/client relationships
- Matching staff and clients from the same team
- Keeping staff/client continuity across consecutive blocks
- Fairer distribution of client blocks among eligible staff

The generator processes the most constrained client requirements first. A separate Repair Schedule flow is designed to fix affected blocks after a call-out without rearranging the rest of a manager-approved schedule.

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

## Database models

The application includes MongoDB models for:

- Locations
- Users
- Staff
- Clients
- Teams
- Schedule assignments
- Schedule templates
- Call-outs
- Speech sessions
- Scheduling rules
- Verification codes
- Audit logs
- Supervision records

Historical staff and clients should normally be archived rather than permanently deleted so old schedules and reports remain valid.

## Authentication

Protected application pages require a signed server-side session. Login uses:

1. Username or email
2. Password
3. Six-digit one-time verification code sent to the email on the account

Passwords are stored as salted scrypt hashes. OTP values are stored as hashes and expire after 10 minutes. Session cookies are HttpOnly, SameSite=Lax, and Secure in production.

## Required environment variables

Create `.env.local` for local development and add the same secrets in Vercel Environment Variables.

```text
MONGODB_URI=...
AUTH_SECRET=...
SETUP_KEY=...
GMAIL_USER=...
GMAIL_APP_PASSWORD=...
```

Never commit the real values to GitHub.

`AUTH_SECRET` should be a long random secret. `SETUP_KEY` is used only for first administrator setup. `GMAIL_APP_PASSWORD` must be a Google App Password for the Gmail account used to send OTP codes, not the normal Gmail account password.

## First administrator setup

After the environment variables are configured and the app is deployed:

1. Open `/setup`.
2. Enter the private `SETUP_KEY`.
3. Create the first administrator username, email, and password.
4. The setup endpoint creates Livingston and Parsippany if they do not exist.
5. After one user exists, the initial setup endpoint refuses to create another first admin.
6. Sign in through `/login` and complete the email OTP step.

## Local development

```bash
npm install
npm run dev
```

For a production-style validation run:

```bash
npm run build
npm start
```

## Implementation status

The following foundations are implemented:

- Vercel-compatible MongoDB connection
- SOS theme and responsive application shell
- Excel-style interactive schedule grid
- Staff, client, team, template, overview, activity, supervision, and settings interfaces
- MongoDB schemas for the scheduling domain
- Automatic scheduling constraint/scoring engine
- Targeted schedule repair engine
- Password + Gmail OTP authentication foundation
- Location-aware user permissions model

The management screens and calendar still use demonstration/local state in several places while the MongoDB API layer is being connected. The next implementation phase is to replace those temporary data sources with authenticated location-scoped APIs, then connect Generate/Repair directly to persisted schedules.
