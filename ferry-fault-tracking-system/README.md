# Ferry Fault & PM Tracking System — MS Access Split Database

Purpose: a shared, multi-PC system for recording daily faults on a ferry (per
vessel) and building a running list of items to be actioned at the next
Planned Maintenance (PM), without needing administrator rights on any PC.

## Why this works without admin rights

- Splitting a database (Database Tools → **Access Database Splitter**) is a
  normal wizard available to any user — not an admin function.
- The only two things you need are already usually available to a regular
  user:
  1. Microsoft Access (or the free **Access Runtime**, if it's already been
     deployed by IT) already present on each PC.
  2. Read/write access to one shared network folder (a mapped drive or a
     plain UNC path like `\\SERVER\FerryData\`). Mapping a drive letter is
     not required — UNC paths work without admin rights.
- No ODBC DSNs, no Windows registry changes, no SQL Server/service
  installation. Everything is plain files.

**If Access truly isn't installed anywhere and you can't get it installed**,
see [Alternatives](#alternatives-if-access-isnt-available) at the bottom.

## Architecture

```
\\SERVER\FerryData\
    Ferry_Backend.accdb        <- tables only, lives on the share, never opened directly by users

Each user's PC (local disk, e.g. Desktop or Documents):
    Ferry_Frontend.accdb       <- forms, queries, reports + LINKED tables pointing at the backend
```

- **Backend** = data only. One copy, on the network share, shared by
  everyone.
- **Frontend** = the app users actually open. Give **every user their own
  local copy** of the frontend (not shared). This is the standard
  Microsoft-recommended pattern and avoids the corruption/locking problems
  that come from multiple people running one shared `.accdb` file directly.

## Data model

| Table | Purpose | Key fields |
|---|---|---|
| `tblFerries` | List of vessels (just "Ferry X" today, room to add more later) | FerryID (PK), FerryName |
| `tblEquipmentSystems` | Optional breakdown by system (engine, steering, nav lights, generator, hull, etc.) | EquipmentID (PK), FerryID (FK), SystemName |
| `tblFaults` | One row per fault reported, any day | FaultID (PK), FerryID (FK), EquipmentID (FK, nullable), DateReported, TimeReported, ReportedBy, Description, Severity, Status, DateResolved, ResolutionNotes, SendToNextPM (Yes/No) |
| `tblPMItems` | Running list of items for the next PM | PMItemID (PK), FerryID (FK), SourceFaultID (FK, nullable), DateAdded, AddedBy, ItemDescription, Priority, TargetPMDate, Status, DateCompleted, CompletedBy, Notes |
| `tblPMEvents` | Optional: the actual PM visits, to close items against | PMEventID (PK), FerryID (FK), PMDate, PMType, Status |

Relationships: `tblFerries` 1‑to‑many `tblFaults`; `tblFerries` 1‑to‑many
`tblPMItems`; `tblFaults` 1‑to‑many `tblPMItems` (a fault can generate one or
more PM line items via a "Send to next PM" button); `tblPMEvents` 1‑to‑many
`tblPMItems` (optional, lets you close out a batch of items against one PM
visit).

Reference DDL is in [`schema/tables.sql`](schema/tables.sql) — paste it into
an Access query in SQL View to create all tables in one shot, or use it as a
checklist while building tables in the Table Designer.

## Forms

Build these as bound forms in the frontend:

- **frmSwitchboard** — landing screen with buttons: "Log a Fault", "View
  Open Faults", "Next PM List", "Reports". Auto-detect the user with
  `Environ("USERNAME")` so `ReportedBy`/`AddedBy` fill in without typing.
- **frmFaultEntry** — single-record form bound to `tblFaults`. Combo boxes
  for Ferry / Equipment System / Severity / Status. A "Send to next PM"
  checkbox/button that inserts a linked row into `tblPMItems` with
  `SourceFaultID` set, so nothing has to be typed twice.
- **frmFaultList** — continuous form / datasheet of `tblFaults` with filter
  controls (by ferry, date range, status) for quickly checking what's open.
- **frmPMItems** — bound to `tblPMItems`; the working list for "what gets
  handled next PM." Filter by Status = Pending to get the actual worklist.
- **frmPMChecklist** — read-mostly view used *during* the PM to tick items
  off (updates Status/DateCompleted/CompletedBy).
- **rptFaultLog / rptPMWorklist** — printable reports for handing to the crew
  or filing.

## Setup steps

1. **Build once, on one PC.** Create a normal `.accdb`, build the tables
   (see schema below), relationships, and forms.
2. **Split it.** Database Tools → Access Database Splitter → point the
   backend at `\\SERVER\FerryData\Ferry_Backend.accdb`. This is a standard
   user-level wizard.
3. **Distribute the frontend.** Copy `Ferry_Frontend.accdb` to each PC
   (Desktop or Documents — anywhere the user can already write). Copying a
   file needs no admin rights.
4. **Make a desktop shortcut** to each user's local frontend copy for easy
   daily use.
5. **Set multi-user options** in the frontend (Access Options → Client
   Settings → Advanced): Default open mode = *Shared*, Default record
   locking = *Edited record*. This lets several people enter faults for
   different ferries at the same time without locking each other out.
6. **Auto-relink on open.** PCs may see the share under different drive
   letters, or you may move the backend later. Add the relink code in
   [`vba/modRelink.bas`](vba/modRelink.bas) to an `AutoExec` macro or the
   frontend's startup form `Open` event — it re-points linked tables at a
   UNC path automatically, no DSN, no admin rights needed.
7. **Backups.** Since you likely can't rely on IT to schedule a backup job,
   use [`vba/modBackup.bas`](vba/modBackup.bas): a "Backup Now" button (and
   optionally an on-close check that only backs up once/day) that copies
   the backend `.accdb` to a dated file in a `\Backups` subfolder on the
   same share. Best run when the backend isn't mid-write; a manual button
   pressed at end of shift is the simplest reliable option without admin
   rights or Task Scheduler access.
8. **Roll out frontend updates.** When you change forms later, keep a
   `tblVersion` row in the backend with the current frontend version
   number, and have the frontend compare its own hard-coded version on
   startup; if it doesn't match, show "A newer version is available at
   \\SERVER\FerryData\Ferry_Frontend_latest.accdb — please copy it to your
   PC." Simple and needs no deployment tooling.

## Multi-user notes / limits to know about

- Works well on a stable wired LAN; avoid running it over Wi‑Fi or VPN if
  you can — Jet/ACE file-sharing is sensitive to dropped connections and
  that's the main cause of `.accdb` corruption.
- It's file-locking based, not a real client/server database — fine for a
  handful of concurrent users doing occasional data entry (which this is),
  not for dozens of simultaneous heavy users.
- There's no real record-level security model anymore (Access user-level
  security was removed after the .mdb era) — access control is just "who
  can reach the shared folder." That's normally fine for an internal team
  tool like this.
- Compact & Repair the backend periodically (Database Tools → Compact &
  Repair) to keep the file size and performance sane.

## Alternatives if Access isn't available

If it turns out Access genuinely isn't installed anywhere and IT won't add
it (both would need admin rights to fix):

- **Microsoft Lists / SharePoint list** — if you're on Microsoft 365 and
  already have SharePoint access, you can build the same two tables
  (Faults, PM Items) as browser-based lists. No install at all, works from
  any PC or phone, and it's naturally "shared across all PCs." Downside:
  weaker for relational lookups/reports than Access, and someone needs to
  have permission to create the list (usually not an issue, unlike
  installing software).
- **Shared Excel workbook via OneDrive/SharePoint co-authoring** — simplest
  possible fallback, no admin rights needed, but weak for structured/related
  data and concurrent form-style entry; only reach for this if the above
  aren't available either.

Access split-database is still the best fit for what you described
(structured daily entries, a working PM list, reporting) if it's available,
which it usually already is in an engineering/back-office environment.
