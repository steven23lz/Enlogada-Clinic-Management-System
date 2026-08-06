Write-Host "Synchronizing project with GitHub (steven23lz/Enlogada-Clinic-Management-System)..." -ForegroundColor Cyan

git add .
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
git commit -m "Auto-Sync: $timestamp"
git push origin system-overhaul-plan --tags

if ($LASTEXITCODE -eq 0) {
    Write-Host "GitHub synchronization complete!" -ForegroundColor Green
} else {
    Write-Host "GitHub push failed. Please check network connection or remote credentials." -ForegroundColor Red
}
