# Ferry Fault & PM Tracking — Excel Version

A ready-to-use alternative to the Access version in the parent folder: a single
shared workbook, `Ferry_Fault_PM_Tracking.xlsx`, with the logging tables,
dropdown-driven data entry, a Home page, and a live summary dashboard already
built in. Open the **Instructions** tab inside the workbook for full usage
steps (including the one-time VBA setup) — this file just covers setup and
the key tradeoff vs. the Access version.

## Setup (no admin rights needed)

1. Put `Ferry_Fault_PM_Tracking.xlsx` on a shared network folder everyone can
   already reach, e.g. `\\SERVER\FerryData\Ferry_Fault_PM_Tracking.xlsx`.
2. Everyone opens it directly from that shared path in their own Excel — no
   copies, no install.
3. Make a desktop shortcut to that path for quick daily access.
4. **Optional one-time step**, if you want Date/Time to auto-fill on new
   fault rows and "Send to Next PM = Yes" to auto-copy into PM Worklist: open
   the **Instructions** tab and follow the "ONE-TIME STEP" section — it's a
   short paste of VBA code into the Fault Log sheet, then a Save As to
   `.xlsm`. Everything else works without this step.

## What's inside

| Tab | Purpose |
|---|---|
| **Home** | Landing page with buttons to every other tab |
| **Instructions** | Full how-to, including the VBA paste-in step |
| **Fault Log** | Daily fault entries — dropdowns for Ferry/Equipment/Severity/Status, Send to Next PM (default No) |
| **PM Worklist** | Items to action at the next PM — one row per item, dropdowns for Ferry/Priority/Status |
| **PM Schedule** | The planned PM visits per ferry (PM name, scheduled date, status) — entirely manual, update it yourself |
| **Dashboard** | Live counts (open/resolved, by severity, PM pending/completed, PM schedule) with a chart |
| **Lists** | The dropdown source lists (ferries, equipment, severity, statuses) — edit here to add a new ferry or change a list |

Every tab (except Home) has a fixed "← Home" link in the top-right of its
frozen header row. All three log/schedule tabs are real Excel Tables with
color-coded conditional formatting and column filters already turned on —
click a column header's filter arrow to filter by Ferry (checkbox list) or
by Date (Date Filters → Between, for a from/to range); print or export that
filtered view as a report.

## Excel vs. Access — pick based on how many people log at once

This workbook is a **single shared file**, not a real-time multi-user
database. Only one person can have it open for editing at a time; anyone else
who opens it while that's happening gets a Read-Only copy and can't save
until the first person closes it. That's fine if people log entries one at a
time throughout the day (open, add a row, save, close) — it becomes a
problem if several people need to enter data at the exact same moment.

If simultaneous entry matters for your team, use the **Access split-database
version** in the parent `ferry-fault-tracking-system` folder instead — it
does real row-level locking so multiple people can enter faults for
different (or the same) ferry at once without blocking each other. Nothing
stops you running both if useful (e.g. Excel for a quick daily glance,
Access as the system of record), but pick one as the actual place data gets
entered to avoid the two going out of sync.

## Note on formulas

Every formula in this workbook uses only `COUNTA`, `COUNTIFS`, and `ROW` —
long-established Excel functions supported in every version back to Excel
2007. Excel recalculates automatically the moment you open the file, so
there's nothing to trigger manually.

## Note on the VBA (optional)

The automatic Date/Time stamping and the auto-copy of "Yes" faults into PM
Worklist both need real code — Excel formulas alone can't do either (a
formula that stamps "now" would keep changing every time the sheet
recalculates, which is the opposite of what's needed). The VBA in the
Instructions tab handles both, and it only needs to live in one place: the
**Fault Log** sheet's own code module (not a separate Module — Worksheet
events only fire from the sheet object they're attached to). Skip this step
entirely and the workbook still works fully — you'd just type the date/time
by hand and copy a flagged fault into PM Worklist yourself.
