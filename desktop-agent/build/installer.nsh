; Custom NSIS include for PrintDrop Agent installer.
; Adds a Windows firewall rule so the agent can poll the PrintDrop API.

!macro customInstall
  DetailPrint "Configuring Windows firewall rule..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="PrintDrop Agent"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="PrintDrop Agent" dir=out action=allow program="$INSTDIR\${PRODUCT_FILENAME}.exe" enable=yes'
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows firewall rule..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="PrintDrop Agent"'
!macroend
