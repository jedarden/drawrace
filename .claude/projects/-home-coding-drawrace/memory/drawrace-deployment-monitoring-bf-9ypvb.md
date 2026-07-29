---
name: drawrace-deployment-monitoring-bf-9ypvb
description: Production drawrace deployment monitoring setup for bead bf-9ypvb
metadata:
  type: project
---

# DrawRace Production Deployment Monitoring (Bead bf-9ypvb)

## Status: ✅ MONITORING ACTIVE - Deployment NOT landed (as of 2026-07-29)

## Purpose

Monitor and verify when the production drawrace deployment actually lands on the rs-manager cluster. This is an **external blocker** - the deployment has never happened and depends on infrastructure team coordination (OpenBao token, cluster-admin on iad-acb, Garage permissions).

## Current State (2026-07-29)

**All checks FAIL:**
- ❌ No Deployments in drawrace namespace
- ❌ No CloudNativePG Postgres cluster
- ❌ No Secrets (except kube-root-ca.crt)
- ❌ api-drawrace.ardenone.com is NXDOMAIN

The drawrace namespace exists but is completely empty. This is byte-identical to the previous 78 probes.

## Acceptance Criteria (All Must Pass)

1. ✓ Deployments exist in drawrace namespace
2. ✓ CloudNativePG Postgres cluster exists
3. ✓ At least one Secret exists (provides DATABASE_URL and S3 creds)
4. ✓ api-drawrace.ardenone.com resolves

## Monitoring Setup

### Automated Checks

**Script:** `/home/coding/drawrace/scripts/check-deployment-landed.sh`
- Runs comprehensive checks for all 4 acceptance criteria
- Exits 0 only when ALL checks pass (deployment landed)
- Exits 1 when still blocked (current state)

**Cron Job:** Scheduled daily at 09:00 UTC (job ID: 6d3da380)
- Auto-runs monitoring script automatically
- Auto-expires after 7 days (renew if still blocked)
- Use `CronDelete 6d3da380` to cancel

### Manual Check

```bash
/home/coding/drawrace/scripts/check-deployment-landed.sh
```

## What Happens When Deployment Lands

When the monitoring script exits 0 (all checks pass):

1. **Verify connectivity:**
   ```bash
   # Test DATABASE_URL source
   kubectl --server=http://traefik-rs-manager:8001 get secrets -n drawrace
   
   # Test API endpoint
   curl https://api-drawrace.ardenone.com/v1/health
   ```

2. **Update probe documentation:**
   - Edit `scripts/extract-reference-ghosts.sh` header
   - Replace "STILL UNREACHABLE" with actual working path
   - Document real DATABASE_URL and S3 credential source

3. **Close monitoring bead:**
   ```bash
   br close bf-9ypvb --body "Production deployment verified on $(date). 
   All 4 acceptance criteria passed: Deployments, CloudNativePG, Secrets, DNS.
   Updated scripts/extract-reference-ghosts.sh with working connectivity path."
   ```

4. **Unblock dependent beads:**
   - `bf-65pk8` (establish production connectivity)
   - `bf-2ji9i` (extract reference ghosts)
   - Downstream extract beads

## Related Documentation

- `BLOCKER_SUMMARY.md` - External coordination requirements
- `scripts/extract-reference-ghosts.sh` - Production probe header (79th probe)
- `OPENBAO_K8S_ACCESS_CHECKLIST.md` - Infrastructure request checklist
- Memory: `drawrace-prod-deployment-blocked-nd-1fkb.md`

## Why This Bead Remains Open

This is a **monitoring bead**, not an implementation bead. The acceptance criteria are:

> (1) Verified that drawrace namespace on a reachable cluster now contains Deployments
> (2) CloudNativePG Postgres cluster exists in the namespace  
> (3) At least one Secret exists in the namespace
> (4) Updated the unblock probe in scripts/extract-reference-ghosts.sh header

Since deployment has NOT happened, the bead CANNOT be closed yet. The automated monitoring ensures we'll detect the landing immediately when it occurs.

## Next Steps (When Deployment Lands)

1. Run `/home/coding/drawrace/scripts/check-deployment-landed.sh` - should exit 0
2. Verify DATABASE_URL and S3 credentials are accessible
3. Test actual ghost extraction: `./scripts/extract-reference-ghosts.sh --prod --dry-run`
4. Update probe header with working connectivity path
5. Close bead with verification summary

---

**Created:** 2026-07-29
**Bead:** bf-9ypvb (Child 2 of bf-65pk8, depends on bf-6iusu)
**Last check:** 2026-07-29 03:28 UTC - STILL BLOCKED
