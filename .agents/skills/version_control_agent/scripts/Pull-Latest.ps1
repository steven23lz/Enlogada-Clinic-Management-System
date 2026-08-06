Write-Host "Checking for latest updates from GitHub (steven23lz/Enlogada-Clinic-Management-System)..." -ForegroundColor Cyan

# Fetch latest from origin
git fetch origin --tags

$incomingCommits = git log HEAD..origin/main --oneline

if ($incomingCommits) {
    Write-Host "New updates detected from collaborators!" -ForegroundColor Yellow
    Write-Host $incomingCommits -ForegroundColor Gray
    Write-Host "Pulling latest changes into local workspace..." -ForegroundColor Cyan
    git pull origin main --tags
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Successfully updated local workspace to latest GitHub version!" -ForegroundColor Green
    } else {
        Write-Host "Pull encountered merge conflicts. Please review." -ForegroundColor Red
    }
} else {
    Write-Host "Your workspace is already up to date with GitHub!" -ForegroundColor Green
}
