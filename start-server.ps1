$ErrorActionPreference = "Stop"

$env:DT_HOST = "0.0.0.0"
$env:DT_PORT = "8080"
$env:DT_DATA_FILE = "\\10.106.53.191\Backup\dtm\flex-downtime-state.json"

Write-Host "Iniciando Downtime Control en el puerto $env:DT_PORT"
Write-Host "Archivo compartido: $env:DT_DATA_FILE"
Write-Host "Deja esta ventana abierta mientras el equipo use la aplicación."

& node (Join-Path $PSScriptRoot "server.js")
if ($LASTEXITCODE -ne 0) {
  throw "El servidor Node terminó con código $LASTEXITCODE."
}
