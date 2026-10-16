# Capacity workflow follow-up

This is a design follow-up, not part of the current request-path fix. Do not
move or delete media automatically from this task.

## Desired workflow

1. Identify completed or cold media candidates on DietPiii.
2. Recommend a destination using a verified destination map and free-space
   policy. DiskBayStation is the preferred initial destination, but it must not
   be the only hardcoded destination.
3. Notify Kasey for review and approval.
4. Copy to a staged destination and verify content, integrity, and recovery
   metadata.
5. Confirm Emby on NUCbox can see the verified archive.
6. Retire the Sonarr/Radarr record only after archive verification. Never
   delete the verified archive automatically.

## Constraints

- Sonarr and Radarr currently expose only `/tv` and `/movies` on the nearly
  full CRUCIAL disk.
- Emby runs on NUCbox and has multiple existing Emby-capable storage
  locations.
- Destination selection must use a verified, current map rather than assuming
  identical paths across hosts.
- Automatic deletion is out of scope; retirement must preserve the verified
  archive.

This follow-up needs its own design, rollback plan, dry-run mode, approval
boundary, and verification tests before implementation.
