---
name: Version Control Agent
description: Manages git version control, timestamped checkpoints, automated remote sync with GitHub (steven23lz/Enlogada-Clinic-Management-System), and 1-command code rollbacks.
---

# Version Control AI Agent Skill

This skill enables automated, safe version control operations for the **Enlogada Clinic Management System**.

## Capabilities

1. **Automated Checkpoints**: Creates timestamped git commits and annotated tags (`checkpoint-YYYYMMDD-HHMMSS`) before any major codebase edit.
2. **GitHub Synchronization**: Automatically pushes local commits and tags to the attached GitHub repository (`https://github.com/steven23lz/Enlogada-Clinic-Management-System.git`).
3. **Instant Rollback**: Restores the workspace to any previous checkpoint or commit instantly with a single command if anything breaks.

## Execution Scripts

- `scripts/Create-Checkpoint.ps1`: Creates a git snapshot & pushes to GitHub.
- `scripts/Rollback-Checkpoint.ps1`: Reverts workspace to a previous checkpoint.
- `scripts/Sync-GitHub.ps1`: Syncs local git state with GitHub remote.

## Usage Guide

To create a safety checkpoint before making code changes:
```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/version_control_agent/scripts/Create-Checkpoint.ps1 -Message "Pre-overhaul snapshot"
```

To rollback to the latest working checkpoint:
```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/version_control_agent/scripts/Rollback-Checkpoint.ps1
```
