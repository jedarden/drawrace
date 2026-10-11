# CI webhook-to-workflow verification

2026-10-11: the argo-events drawrace sensor path was verified end to end —
a push to main fired the github-webhooks event, the drawrace-sensor matched,
and a drawrace-build workflow was submitted on this commit (bead
declarat-78776a9c).
