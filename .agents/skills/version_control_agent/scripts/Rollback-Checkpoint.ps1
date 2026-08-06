param (
    [string]$TargetTag = ""
)

Write-Host "Version Control Rollback Utility" -ForegroundColor Cyan

# Fetch all tags sorted by creation
$tags = git tag --sort=-creatordate

if (-not $tags) {
    Write-Host "No checkpoints found. Performing hard reset to last commit..." -ForegroundColor Yellow
    git reset --hard HEAD
    git clean -fd
    Write-Host "Rollback to last commit completed!" -ForegroundColor Green
    exit 0
}

if (-not $TargetTag) {
    $TargetTag = ($tags | Select-Object -First 1)
}

Write-Host "Rolling back workspace to checkpoint tag: $TargetTag..." -ForegroundColor Yellow

git reset --hard $TargetTag
git clean -fd

Write-Host "Workspace successfully restored to checkpoint $TargetTag!" -ForegroundColor Green
