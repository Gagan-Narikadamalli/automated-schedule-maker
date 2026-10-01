# SOS Automated Schedule Maker

Multi-location scheduling application modeled on the existing SOS Excel workflow.

## Stack
Next.js + TypeScript, MongoDB/Mongoose, Vercel.

## Core rules
- 8 AM–6 PM calendar with 30-minute blocks.
- One application supports Livingston and Parsippany with location-scoped data.
- Manual manager overrides are preserved.
- Hard scheduling constraints cannot be silently violated by auto-generation.
- Staff and clients with historical records should be archived rather than destructively deleted.

## Setup
1. npm install
2. Add MONGODB_URI to .env.local locally and Vercel Environment Variables in deployment.
3. npm run dev

## Planned modules
Authentication, Locations, Staff, Clients, Teams, Excel-style Calendar, Templates, Call-outs, Auto Scheduler, Weekly Overview, Activity Logs, Supervision, Excel/PDF exports.
