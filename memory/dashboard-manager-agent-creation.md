# Dashboard Manager Agent - Creation

**Created:** 2026-02-16 05:30–06:00 PT  
**Agent:** Dashboard Manager (skill: `dashboard-manager`)  
**Status:** Defined and ready to spawn

## What Was Created

### Skill Definition
- `skills/dashboard-manager/SKILL.md` - Comprehensive skill documentation covering:
  - Repository structure knowledge
  - Server architecture understanding
  - Common issues and fixes
  - Standard operating procedures
  - Tool usage patterns
  - Capabilities and limitations

### Agent Persona
- `agents/dashboard-manager/SOUL.md` - Agent identity as a systematic, cleanliness-obsessed DevOps specialist for the dashboard
- `agents/dashboard-manager/USER.md` - User expectations and communication preferences

## Agent Capabilities

The Dashboard Manager agent can:
- ✅ Perform health checks and diagnose issues
- ✅ Fix repository structure (consolidate duplicates)
- ✅ Repair server routing and static file serving
- ✅ Update service worker and restart scripts
- ✅ Run validation tests
- ✅ Execute git workflows safely
- ✅ Update documentation
- ✅ Create release branches
- ✅ Log all actions in memory files

## How to Spawn

```bash
# From workspace root, spawn the agent with the dashboard-manager skill
sessions_spawn agentId=dashboard-manager task="Perform a health check and report status"
```

Or with specific task:
```bash
sessions_spawn agentId=dashboard-manager task="Check dashboard health, fix any issues, and update memory"
```

## Example Tasks

- "Run a health check and tell me if anything is wrong"
- "Clean up any duplicate files in the repository"
- "Fix the server if modules are returning 404"
- "Create a release branch from current main"
- "Update the documentation to match the current structure"
- "Run the validation script and report results"

## Memory & Logging

The agent will:
- Update `dashboard/memory/YYYY-MM-DD.md` with all actions
- Distill key lessons into `dashboard/MEMORY.md`
- Reference specific files and commits in reports

## Testing

To verify the agent works, spawn it with a simple task:
```bash
sessions_spawn agentId=dashboard-manager task="Verify dashboard is healthy; report status"
```

Expected response: Health check results, any issues found, and actions taken.

## Next Steps

- [ ] Test spawn the agent with a simple health check
- [ ] Have it run the full validation script
- [ ] Let it perform a routine cleanup if needed
- [ ] Evaluate its performance and refine skill if necessary

---

**Note:** This agent is designed to be a dedicated caretaker for the Project Dashboard, handling routine maintenance, debugging, and improvements with minimal supervision. It embodies the best practices we've developed through the recent consolidation and fixes.
