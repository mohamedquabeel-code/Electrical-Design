# Ferry Fault & PM Tracking — Excel Version

A ready-to-use alternative to the Access version in the parent folder: a single
shared workbook, `Ferry_Fault_PM_Tracking.xlsx`, with the logging tables,
dropdown-driven data entry, and a live summary dashboard already built in.
Open the **Instructions** tab inside the workbook for full usage steps — this
file just covers setup and the key tradeoff vs. the Access version.

## Setup (no admin rights needed)

1. Put `Ferry_Fault_PM_Tracking.xlsx` on a shared network folder everyone can
   already reach, e.g. `\\SERVER\FerryData\Ferry_Fault_PM_Tracking.xlsx`.
2. Everyone opens it directly from that shared path in their own Excel — no
   copies, no install, no macros to enable.
3. Make a desktop shortcut to that path for quick daily access.

## What's inside

| Tab | Purpose |
|---|---|
| **Instructions** | Full how-to, read this first |
| **Fault Log** | Daily fault entries — one row per fault, dropdowns for Ferry/Severity/Status |
| **PM Worklist** | Items to action at the next PM — one row per item, dropdowns for Ferry/Priority/Status |
| **Dashboard** | Live counts (open/resolved, by severity, PM pending/completed) with a chart — updates automatically as you log entries |
| **Lists** | The dropdown source lists (ferries, severity levels, statuses) — edit here to add a new ferry or change a list |

Both log tabs are real Excel Tables with color-coded conditional formatting
(severity/status/priority) and column filters already turned on — for a
"report," just click a column header's filter arrow (e.g. Status = Open) and
print or export that view.

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
