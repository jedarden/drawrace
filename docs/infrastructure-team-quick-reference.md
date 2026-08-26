# OpenBao Token Quick Reference - Infrastructure Team

## 🎯 What We Need

**One OpenBao root token** for DrawRace secrets setup

## 🔐 How to Provide

Send via **secure channel only** (DM, password manager, encrypted file)
```
Format: s.<random-string>
Example: s.1234...abcd
```

## ⏱️ Time & Impact

- **Your time:** 2 minutes to send the token
- **Setup time:** 5-10 minutes automated
- **Impact:** Unblocks DrawRace production deployment

## 🚀 What Happens

1. You send token securely → We run `./scripts/setup-openbao-secrets.sh`
2. Script creates secrets → ExternalSecrets sync automatically  
3. We verify success → We clear the token from our environment

## ✅ Success Criteria

All three ExternalSecrets show:
```bash
kubectl get externalsecrets -n drawrace
# Expected: All show "SecretSynced" + "Ready: True"
```

## 🔒 Security Guarantee

- ✅ Token used only for initial setup
- ✅ Never written to files or git
- ✅ Cleared from shell history after use
- ✅ Recommend rotating after setup

## 📋 What Gets Created

| OpenBao Path | Purpose |
|--------------|---------|
| `secret/data/rs-manager/drawrace/s3` | API S3 credentials |
| `secret/data/rs-manager/drawrace/postgres-backup` | Backup S3 credentials |
| `secret/data/rs-manager/drawrace/postgres` | Database credentials |

## 🆘 Quick Troubleshooting

| Issue | Fix |
|-------|-----|
| "Token not set" | `export OPENBAO_TOKEN="<token>"` |
| "SecretSyncedError" | Run setup script with token |
| Permission denied | Check cluster admin access |

## 📚 Full Documentation

See: `docs/infrastructure-team-openbao-guide.md`

---

**Task:** drawrace-16b904bc | **Status:** Awaiting your token 🎯