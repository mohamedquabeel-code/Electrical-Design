Attribute VB_Name = "modRelink"
Option Compare Database
Option Explicit

' Re-points every linked table in the frontend at the backend on the network
' share, using a plain UNC path. No DSN, no ODBC Administrator, no admin
' rights required. Call RelinkBackend from an AutoExec macro (RunCode) or
' from the startup form's Open event.
'
' Update BACKEND_PATH once to match your share.

Private Const BACKEND_PATH As String = "\\SERVER\FerryData\Ferry_Backend.accdb"

Public Sub RelinkBackend()

    Dim db As DAO.Database
    Dim tbl As DAO.TableDef
    Dim relinked As Long

    If Dir(BACKEND_PATH) = "" Then
        MsgBox "Cannot find the shared database at:" & vbCrLf & BACKEND_PATH & _
               vbCrLf & vbCrLf & "Check your network connection, then reopen this file.", _
               vbCritical, "Ferry Tracking - Backend Not Found"
        Exit Sub
    End If

    Set db = CurrentDb()
    relinked = 0

    For Each tbl In db.TableDefs
        ' Linked tables have a non-empty Connect string; local tables don't.
        If Len(tbl.Connect) > 0 Then
            If tbl.Connect Like ";DATABASE=*" Then
                tbl.Connect = ";DATABASE=" & BACKEND_PATH
                tbl.RefreshLink
                relinked = relinked + 1
            End If
        End If
    Next tbl

    Debug.Print "RelinkBackend: relinked " & relinked & " table(s) to " & BACKEND_PATH

End Sub
