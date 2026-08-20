-- Reference DDL for the Ferry Fault & PM Tracking backend.
-- Written in Access (Jet/ACE) SQL syntax. You can paste each statement into
-- a new Query in SQL View in Access and run it to create the table, or use
-- this simply as a field-by-field checklist while building tables in the
-- Table Designer (often easier for setting up combo-box lookups).
--
-- Build/run these in this order (foreign keys depend on earlier tables).

CREATE TABLE tblFerries (
    FerryID     AUTOINCREMENT PRIMARY KEY,
    FerryName   TEXT(50)      NOT NULL,
    Notes       MEMO
);

CREATE TABLE tblEquipmentSystems (
    EquipmentID   AUTOINCREMENT PRIMARY KEY,
    FerryID       LONG          NOT NULL REFERENCES tblFerries (FerryID),
    SystemName    TEXT(75)      NOT NULL,
    Notes         MEMO
);

CREATE TABLE tblFaults (
    FaultID          AUTOINCREMENT PRIMARY KEY,
    FerryID          LONG      NOT NULL REFERENCES tblFerries (FerryID),
    EquipmentID      LONG      REFERENCES tblEquipmentSystems (EquipmentID),
    DateReported     DATETIME  NOT NULL,
    TimeReported     DATETIME,
    ReportedBy       TEXT(50)  NOT NULL,
    Description      MEMO      NOT NULL,
    Severity         TEXT(20)  NOT NULL,   -- e.g. Low / Medium / High / Critical
    Status           TEXT(20)  NOT NULL DEFAULT 'Open',  -- Open / Monitoring / Resolved
    DateResolved     DATETIME,
    ResolutionNotes  MEMO,
    SendToNextPM     YESNO     NOT NULL DEFAULT 0
);

CREATE TABLE tblPMEvents (
    PMEventID   AUTOINCREMENT PRIMARY KEY,
    FerryID     LONG      NOT NULL REFERENCES tblFerries (FerryID),
    PMDate      DATETIME  NOT NULL,
    PMType      TEXT(30),          -- e.g. Weekly / Monthly / Annual / Dry-dock
    Status      TEXT(20)  NOT NULL DEFAULT 'Scheduled'  -- Scheduled / Completed
);

CREATE TABLE tblPMItems (
    PMItemID         AUTOINCREMENT PRIMARY KEY,
    FerryID          LONG      NOT NULL REFERENCES tblFerries (FerryID),
    SourceFaultID    LONG      REFERENCES tblFaults (FaultID),
    PMEventID        LONG      REFERENCES tblPMEvents (PMEventID),
    DateAdded        DATETIME  NOT NULL,
    AddedBy          TEXT(50)  NOT NULL,
    ItemDescription  MEMO      NOT NULL,
    Priority         TEXT(20)  NOT NULL DEFAULT 'Normal',  -- Low / Normal / High
    TargetPMDate     DATETIME,
    Status           TEXT(20)  NOT NULL DEFAULT 'Pending', -- Pending / Completed / Deferred
    DateCompleted    DATETIME,
    CompletedBy      TEXT(50),
    Notes            MEMO
);

-- Optional: single-row table used by the frontend to detect stale copies.
CREATE TABLE tblVersion (
    VersionID    AUTOINCREMENT PRIMARY KEY,
    CurrentVersion  TEXT(20) NOT NULL,
    UpdatedOn       DATETIME
);

-- Seed the one ferry you're tracking today; add more rows later as needed.
INSERT INTO tblFerries (FerryName) VALUES ('Ferry X');
