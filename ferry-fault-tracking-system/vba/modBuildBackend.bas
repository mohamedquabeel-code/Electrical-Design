Attribute VB_Name = "modBuildBackend"
Option Compare Database
Option Explicit

' One-click table builder. Creates all tables + relationships directly via
' DAO, so you don't have to type them into the Table Designer or paste SQL
' into a query window one statement at a time.
'
' HOW TO USE:
'   1. File > New > Blank database > name it Ferry_Tracking.accdb (temporary
'      working name - you'll split it into Ferry_Backend/Ferry_Frontend later).
'   2. Alt+F11 to open the VBA editor > Insert > Module > paste this file's
'      contents in > paste modBuildForms.bas in as a second module.
'   3. In the Immediate window (Ctrl+G), type:  BuildBackendTables
'      then press Enter. Then type:  BuildAllForms  and press Enter.
'   4. Close the VBA editor. Your tables and forms now exist in
'      Ferry_Tracking.accdb.
'   5. Database Tools > Access Database Splitter > split it. Name the
'      backend Ferry_Backend.accdb and keep the frontend as
'      Ferry_Frontend.accdb (matches the paths used in modRelink.bas /
'      modBackup.bas - update those constants if you name things differently).

Public Sub BuildBackendTables()

    Dim db As DAO.Database
    Set db = CurrentDb()

    RunDDL db, "CREATE TABLE tblFerries (" & _
        "FerryID AUTOINCREMENT PRIMARY KEY, " & _
        "FerryName TEXT(50) NOT NULL, " & _
        "Notes MEMO)"

    RunDDL db, "CREATE TABLE tblEquipmentSystems (" & _
        "EquipmentID AUTOINCREMENT PRIMARY KEY, " & _
        "FerryID LONG NOT NULL REFERENCES tblFerries (FerryID), " & _
        "SystemName TEXT(75) NOT NULL, " & _
        "Notes MEMO)"

    RunDDL db, "CREATE TABLE tblFaults (" & _
        "FaultID AUTOINCREMENT PRIMARY KEY, " & _
        "FerryID LONG NOT NULL REFERENCES tblFerries (FerryID), " & _
        "EquipmentID LONG REFERENCES tblEquipmentSystems (EquipmentID), " & _
        "DateReported DATETIME NOT NULL, " & _
        "TimeReported DATETIME, " & _
        "ReportedBy TEXT(50) NOT NULL, " & _
        "Description MEMO NOT NULL, " & _
        "Severity TEXT(20) NOT NULL, " & _
        "Status TEXT(20) NOT NULL DEFAULT 'Open', " & _
        "DateResolved DATETIME, " & _
        "ResolutionNotes MEMO, " & _
        "SendToNextPM YESNO NOT NULL DEFAULT 0)"

    RunDDL db, "CREATE TABLE tblPMEvents (" & _
        "PMEventID AUTOINCREMENT PRIMARY KEY, " & _
        "FerryID LONG NOT NULL REFERENCES tblFerries (FerryID), " & _
        "PMDate DATETIME NOT NULL, " & _
        "PMType TEXT(30), " & _
        "Status TEXT(20) NOT NULL DEFAULT 'Scheduled')"

    RunDDL db, "CREATE TABLE tblPMItems (" & _
        "PMItemID AUTOINCREMENT PRIMARY KEY, " & _
        "FerryID LONG NOT NULL REFERENCES tblFerries (FerryID), " & _
        "SourceFaultID LONG REFERENCES tblFaults (FaultID), " & _
        "PMEventID LONG REFERENCES tblPMEvents (PMEventID), " & _
        "DateAdded DATETIME NOT NULL, " & _
        "AddedBy TEXT(50) NOT NULL, " & _
        "ItemDescription MEMO NOT NULL, " & _
        "Priority TEXT(20) NOT NULL DEFAULT 'Normal', " & _
        "TargetPMDate DATETIME, " & _
        "Status TEXT(20) NOT NULL DEFAULT 'Pending', " & _
        "DateCompleted DATETIME, " & _
        "CompletedBy TEXT(50), " & _
        "Notes MEMO)"

    RunDDL db, "CREATE TABLE tblVersion (" & _
        "VersionID AUTOINCREMENT PRIMARY KEY, " & _
        "CurrentVersion TEXT(20) NOT NULL, " & _
        "UpdatedOn DATETIME)"

    db.Execute "INSERT INTO tblFerries (FerryName) VALUES ('Ferry X')", dbFailOnError
    db.Execute "INSERT INTO tblVersion (CurrentVersion, UpdatedOn) VALUES ('1.0', Now())", dbFailOnError

    MsgBox "Backend tables created.", vbInformation, "Ferry Tracking - Build Backend"

End Sub

Private Sub RunDDL(db As DAO.Database, sql As String)
    On Error GoTo AlreadyExists
    db.Execute sql, dbFailOnError
    Exit Sub
AlreadyExists:
    ' Table already there from a previous run - skip quietly, report anything else.
    If InStr(Err.Description, "already exists") = 0 Then
        MsgBox "Error creating table:" & vbCrLf & sql & vbCrLf & vbCrLf & Err.Description, vbCritical
    End If
End Sub
