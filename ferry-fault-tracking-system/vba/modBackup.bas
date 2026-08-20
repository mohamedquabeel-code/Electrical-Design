Attribute VB_Name = "modBackup"
Option Compare Database
Option Explicit

' Simple no-admin backup: copies the backend .accdb to a dated file in a
' \Backups subfolder on the same share. Wire this to a "Backup Now" button,
' or call BackupBackendIfNeeded from the frontend's startup form Open event
' to take at most one backup per day automatically.
'
' Note: the copy will fail (harmlessly, with a message) if the backend is
' being written to at that exact instant - that's expected for a plain file
' copy. Re-run it, or use the button at a quiet moment (e.g. end of shift).

Private Const BACKEND_PATH As String = "\\SERVER\FerryData\Ferry_Backend.accdb"
Private Const BACKUP_FOLDER As String = "\\SERVER\FerryData\Backups\"

Public Sub BackupBackendNow()

    Dim destPath As String

    If Dir(BACKEND_PATH) = "" Then
        MsgBox "Backend not found - nothing to back up.", vbExclamation
        Exit Sub
    End If

    If Dir(BACKUP_FOLDER, vbDirectory) = "" Then
        MkDir BACKUP_FOLDER
    End If

    destPath = BACKUP_FOLDER & "Ferry_Backend_" & _
               Format(Now, "yyyy-mm-dd_hhnn") & ".accdb"

    On Error GoTo BackupFailed
    FileCopy BACKEND_PATH, destPath
    MsgBox "Backup saved:" & vbCrLf & destPath, vbInformation, "Backup Complete"
    Exit Sub

BackupFailed:
    MsgBox "Backup failed - the database may be in use right now." & vbCrLf & _
           "Try again in a moment. (" & Err.Description & ")", vbExclamation
End Sub

' Call this on frontend startup to auto-backup once per day, no button needed.
Public Sub BackupBackendIfNeeded()

    Dim marker As String
    marker = BACKUP_FOLDER & "last_backup_" & Format(Date, "yyyy-mm-dd") & ".marker"

    If Dir(BACKUP_FOLDER, vbDirectory) = "" Then
        On Error Resume Next
        MkDir BACKUP_FOLDER
        On Error GoTo 0
    End If

    If Dir(marker) = "" Then
        BackupBackendNow
        ' Drop a zero-byte marker so we don't back up again today.
        On Error Resume Next
        Dim f As Integer
        f = FreeFile
        Open marker For Output As #f
        Close #f
        On Error GoTo 0
    End If

End Sub
