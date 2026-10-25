Option Explicit
Dim shell, fso, root, runtime, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
runtime = fso.BuildPath(root, "runtime\node.exe")
If Not fso.FileExists(runtime) Then runtime = "node.exe"
shell.CurrentDirectory = root
command = Chr(34) & runtime & Chr(34) & " " & Chr(34) & fso.BuildPath(root, "launch.mjs") & Chr(34)
shell.Run command, 0, False
