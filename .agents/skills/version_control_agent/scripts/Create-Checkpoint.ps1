param (
    [string]$Message = "Automated System Checkpoint"
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tagName = "checkpoint-$timestamp"

Write-Host "Creating Version Control Checkpoint: $tagName..." -ForegroundColor Green

# Stage all files
git add .

# Create commit
$commitMsg = "Checkpoint ($timestamp): $Message"
git commit -m $commitMsg

# Tag current commit
git tag -a $tagName -m "Snapshot: $Message"

Write-Host "Checkpoint $tagName created locally!" -ForegroundColor Green

# Push to GitHub
Write-Host "Synchronizing checkpoint to GitHub (steven23lz/Enlogada-Clinic-Management-System)..." -ForegroundColor Cyan
git push origin HEAD --tags

if ($LASTEXITCODE -eq 0) {
    Write-Host "Successfully pushed checkpoint $tagName to GitHub!" -ForegroundColor Green
} else {
    Write-Host "Warning: Could not push to remote. Local checkpoint $tagName is safely stored." -ForegroundColor Yellow
}
