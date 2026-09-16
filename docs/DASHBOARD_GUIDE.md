# Dashboard Monitoring Guide

## Audience and access

Dashboard is intended for management and HO monitoring. Super Admin controls Dashboard access and each widget's visibility by role through `Master Data > Portal Management > Dashboard Manager`.

## Dashboard content

- Executive summary: lounge visitors, Business pax, Economy pax, and estimated cost.
- Visitor composition: Business Class, Platinum, Elite Plus, SkyTeam, partnership, DPR, Paid Access, and other categories.
- Lounge utilization: Business lounge visitors divided by total Business pax, and eligible Economy lounge visitors divided by total Economy pax.
- Top 10 Branch Offices by lounge visitors.
- Provider cost comparison within the active filter.
- Verification, dispute, and final reconciliation status.

All values follow the active Period, Area, Branch Office, and Lounge/Provider filters.

## Passenger-volume denominator

Business and Economy passenger totals must come from DCS/source-system API in production. Until that integration is available, an authorized user can download the template and import CSV/XLSX data. The unique upsert key is Period + BO + Station + Provider.

The imported volume is a denominator for utilization analysis. It does not create a lounge visitor transaction.

## Production integration

Tim IT should connect the dashboard service to the production database and DCS/source systems, validate organization and station scopes server-side, schedule synchronization, expose freshness and error status, and retain an immutable import/audit log.
