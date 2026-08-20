Attribute VB_Name = "modBuildForms"
Option Compare Database
Option Explicit

' One-click form builder. Creates frmSwitchboard, frmFaultEntry,
' frmFaultList and frmPMItems with bound controls, using the Access/DAO
' object model (CreateForm / CreateControl). Run BuildBackendTables (in
' modBuildBackend.bas) FIRST so the tables these forms bind to already
' exist. Then run BuildAllForms from the Immediate window (Ctrl+G).
'
' Layout is plain and functional (Access measures control position/size in
' twips; 1440 twips = 1 inch) - resize/restyle anything you like afterwards
' in Design view, this just saves you creating every control by hand.

Public Sub BuildAllForms()
    BuildFrmFaultEntry
    BuildFrmFaultList
    BuildFrmPMItems
    BuildFrmSwitchboard
    MsgBox "All forms created: frmSwitchboard, frmFaultEntry, frmFaultList, frmPMItems.", _
           vbInformation, "Ferry Tracking - Build Forms"
End Sub

' ---------------------------------------------------------------- Fault Entry

Public Sub BuildFrmFaultEntry()

    Dim frm As Access.Form
    Set frm = CreateForm
    frm.RecordSource = "tblFaults"

    AddField frm.Name, "Ferry", "FerryID", 200, "lookup", _
        "SELECT FerryID, FerryName FROM tblFerries ORDER BY FerryName"
    AddField frm.Name, "Equipment", "EquipmentID", 550, "lookup", _
        "SELECT EquipmentID, SystemName FROM tblEquipmentSystems ORDER BY SystemName"
    AddField frm.Name, "Date Reported", "DateReported", 900, "text", "=Now()"
    AddField frm.Name, "Reported By", "ReportedBy", 1250, "text", "=Environ(""UserName"")"
    AddField frm.Name, "Description", "Description", 1600, "memo"
    AddField frm.Name, "Severity", "Severity", 2650, "valuelist", "Low;Medium;High;Critical"
    AddField frm.Name, "Status", "Status", 3000, "valuelist", "Open;Monitoring;Resolved"
    AddField frm.Name, "Send to Next PM", "SendToNextPM", 3350, "check"

    Dim ctl As Access.Control
    Set ctl = CreateControl(frm.Name, acCommandButton, acDetail, , , 1600, 3800, 1400, 350)
    ctl.Name = "cmdSendToPM"
    ctl.Caption = "Send to Next PM"
    ctl.OnClick = "=SendCurrentFaultToPM()"

    Set ctl = CreateControl(frm.Name, acCommandButton, acDetail, , , 3100, 3800, 1200, 350)
    ctl.Name = "cmdClose"
    ctl.Caption = "Close"
    ctl.OnClick = "=CloseForm()"

    ' Capture the name before closing - frm becomes invalid the instant the
    ' form closes, so frm.Name can no longer be read after DoCmd.Close.
    Dim tempName As String
    tempName = frm.Name
    DoCmd.Close acForm, tempName, acSaveYes
    DoCmd.Rename "frmFaultEntry", acForm, tempName

End Sub

' Called from cmdSendToPM on the saved, running frmFaultEntry form.
Public Function SendCurrentFaultToPM() As Boolean
    On Error GoTo Fail
    If IsNull(Forms!frmFaultEntry!FaultID) Then
        MsgBox "Save the fault first, then click Send to Next PM.", vbExclamation
        Exit Function
    End If

    CurrentDb.Execute "INSERT INTO tblPMItems (FerryID, SourceFaultID, DateAdded, AddedBy, " & _
        "ItemDescription, Priority, Status) VALUES (" & _
        Forms!frmFaultEntry!FerryID & ", " & _
        Forms!frmFaultEntry!FaultID & ", Now(), '" & _
        Replace(Environ("UserName"), "'", "''") & "', '" & _
        Replace(Nz(Forms!frmFaultEntry!Description, ""), "'", "''") & "', 'Normal', 'Pending')", dbFailOnError

    Forms!frmFaultEntry!SendToNextPM = True
    MsgBox "Added to the next PM worklist.", vbInformation
    SendCurrentFaultToPM = True
    Exit Function
Fail:
    MsgBox "Could not add to PM list: " & Err.Description, vbExclamation
End Function

Public Function CloseForm() As Boolean
    DoCmd.Close acForm, Screen.ActiveForm.Name
    CloseForm = True
End Function

' ----------------------------------------------------------------- Fault List

Public Sub BuildFrmFaultList()

    Dim frm As Access.Form
    Set frm = CreateForm
    frm.RecordSource = "SELECT tblFaults.*, tblFerries.FerryName FROM tblFaults " & _
        "INNER JOIN tblFerries ON tblFaults.FerryID = tblFerries.FerryID " & _
        "ORDER BY tblFaults.DateReported DESC"
    frm.DefaultView = 1 ' Continuous Forms

    CreateControl frm.Name, acTextBox, acDetail, , "FerryName", 100, 60, 1600, 250
    CreateControl frm.Name, acTextBox, acDetail, , "DateReported", 1750, 60, 1200, 250
    CreateControl frm.Name, acTextBox, acDetail, , "Severity", 3000, 60, 1000, 250
    CreateControl frm.Name, acTextBox, acDetail, , "Status", 4050, 60, 1200, 250
    CreateControl frm.Name, acTextBox, acDetail, , "Description", 5300, 60, 3500, 250

    frm.Section(acHeader).Visible = True
    frm.Section(acHeader).Height = 350
    AddHeaderLabel frm.Name, "Ferry", 100
    AddHeaderLabel frm.Name, "Date", 1750
    AddHeaderLabel frm.Name, "Severity", 3000
    AddHeaderLabel frm.Name, "Status", 4050
    AddHeaderLabel frm.Name, "Description", 5300

    Dim tempName As String
    tempName = frm.Name
    DoCmd.Close acForm, tempName, acSaveYes
    DoCmd.Rename "frmFaultList", acForm, tempName

End Sub

Private Sub AddHeaderLabel(frmName As String, caption As String, leftPos As Long)
    Dim lbl As Access.Control
    Set lbl = CreateControl(frmName, acLabel, acHeader, , , leftPos, 60, 1500, 250)
    lbl.Caption = caption
    lbl.FontBold = True
End Sub

' ------------------------------------------------------------------- PM Items

Public Sub BuildFrmPMItems()

    Dim frm As Access.Form
    Set frm = CreateForm
    frm.RecordSource = "tblPMItems"

    AddField frm.Name, "Ferry", "FerryID", 200, "lookup", _
        "SELECT FerryID, FerryName FROM tblFerries ORDER BY FerryName"
    AddField frm.Name, "Item Description", "ItemDescription", 550, "memo"
    AddField frm.Name, "Priority", "Priority", 1600, "valuelist", "Low;Normal;High"
    AddField frm.Name, "Target PM Date", "TargetPMDate", 1950
    AddField frm.Name, "Status", "Status", 2300, "valuelist", "Pending;Completed;Deferred"
    AddField frm.Name, "Date Completed", "DateCompleted", 2650
    AddField frm.Name, "Completed By", "CompletedBy", 3000
    AddField frm.Name, "Notes", "Notes", 3350, "memo"

    Dim ctl As Access.Control
    Set ctl = CreateControl(frm.Name, acCommandButton, acDetail, , , 1600, 4400, 1200, 350)
    ctl.Name = "cmdClose"
    ctl.Caption = "Close"
    ctl.OnClick = "=CloseForm()"

    Dim tempName As String
    tempName = frm.Name
    DoCmd.Close acForm, tempName, acSaveYes
    DoCmd.Rename "frmPMItems", acForm, tempName

End Sub

' ----------------------------------------------------------------- Switchboard

Public Sub BuildFrmSwitchboard()

    Dim frm As Access.Form
    Set frm = CreateForm

    Dim lbl As Access.Control
    Set lbl = CreateControl(frm.Name, acLabel, acDetail, , , 400, 200, 3000, 400)
    lbl.Caption = "Ferry Fault & PM Tracking"
    lbl.FontSize = 16
    lbl.FontBold = True

    AddSwitchboardButton frm.Name, "cmdLogFault", "Log a Fault", 800, "frmFaultEntry"
    AddSwitchboardButton frm.Name, "cmdViewFaults", "View Faults", 1250, "frmFaultList"
    AddSwitchboardButton frm.Name, "cmdPMItems", "Next PM List", 1700, "frmPMItems"

    Dim tempName As String
    tempName = frm.Name
    DoCmd.Close acForm, tempName, acSaveYes
    DoCmd.Rename "frmSwitchboard", acForm, tempName

End Sub

Private Sub AddSwitchboardButton(frmName As String, ctrlName As String, caption As String, topPos As Long, targetForm As String)
    Dim ctl As Access.Control
    Set ctl = CreateControl(frmName, acCommandButton, acDetail, , , 500, topPos, 2200, 400)
    ctl.Name = ctrlName
    ctl.Caption = caption
    ctl.OnClick = "=OpenTargetForm(""" & targetForm & """)"
End Sub

Public Function OpenTargetForm(formName As String) As Boolean
    DoCmd.OpenForm formName
    OpenTargetForm = True
End Function

' ------------------------------------------------------------------- Helper

' Adds a label + bound control to the Detail section of a form being built.
'   frmName   - name/temp name of the form (frm.Name from CreateForm)
'   caption   - label text
'   boundCol  - field name in the form's RecordSource to bind to
'   topPos    - vertical position in twips (1440 twips = 1 inch)
'   ctrlKind  - "text" (default) | "memo" | "check" | "lookup" | "valuelist"
'   src       - for "lookup": a full "SELECT id, displayField FROM tbl..." row
'               source (id column first - that's what gets stored in boundCol).
'               for "valuelist": a semicolon-separated list, e.g. "Low;High".
'               for "text": optional Default Value expression, e.g. "=Now()".
Private Sub AddField(frmName As String, caption As String, boundCol As String, topPos As Long, _
                      Optional ctrlKind As String = "text", Optional src As String = "")

    Dim lbl As Access.Control
    Set lbl = CreateControl(frmName, acLabel, acDetail, , , 100, topPos, 1400, 250)
    lbl.Caption = caption

    Dim ctl As Access.Control

    Select Case ctrlKind

        Case "check"
            Set ctl = CreateControl(frmName, acCheckBox, acDetail, , boundCol, 1600, topPos, 250, 250)

        Case "memo"
            Set ctl = CreateControl(frmName, acTextBox, acDetail, , boundCol, 1600, topPos, 3500, 900)

        Case "lookup"
            Set ctl = CreateControl(frmName, acComboBox, acDetail, , boundCol, 1600, topPos, 2500, 250)
            ctl.RowSourceType = "Table/Query"
            ctl.RowSource = src
            ctl.ColumnCount = 2
            ctl.BoundColumn = 1
            ctl.ColumnWidths = "0"";1.5"""

        Case "valuelist"
            Set ctl = CreateControl(frmName, acComboBox, acDetail, , boundCol, 1600, topPos, 2200, 250)
            ctl.RowSourceType = "Value List"
            ctl.RowSource = src

        Case Else ' "text"
            Set ctl = CreateControl(frmName, acTextBox, acDetail, , boundCol, 1600, topPos, 2500, 250)
            If Len(src) > 0 Then ctl.DefaultValue = src

    End Select

End Sub
