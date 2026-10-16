# Capacity workflow follow-up

This is a design follow-up, not part of the current request-path fix. Do not
move or delete media automatically from this task.

## Verified source and destination map

- Intake source: the 1 TB CRUCIAL disk on DietPiii, currently about 93% used
  with 60.4 GB free. Sonarr and Radarr expose only `/tv` and `/movies` there.
- Emby runs on NUCbox.
- Hard-excluded destinations: `/mnt/File-Island`, `/mnt/hairymanass/media`,
  `/mnt/ThunderDikkz`, and `/mnt/DockDisk`.
- Approved NUCbox candidates:
  - `/mnt/DiskBayStation`: ext4, 779 GB free, existing `mediaz/Movies` and
    `mediaz/TV-Shows`; preferred initial target.
  - `/mnt/DikkBay`: ext4, 785 GB free; no established media layout yet.
  - `/mnt/Crucialbooty`: CIFS from M4mini, 319 GB free, existing `Media/movies`.
  - `/mnt/StorageLand`: ext4, 295 GB free, existing `store/movies` and
    `store/tv`.
  - `/mnt/ExtraSSD`: ext4, 260 GB free; currently backups/Codex, no established
    media layout.
  - `/mnt/USBCSSD`: CIFS from M4mini, 229 GB free, existing
    `mediaserver/movies`.

`/mnt/DikkBay` and `/mnt/ExtraSSD` require an explicit media layout and
verified Emby library path before they can be used. `/mnt/Crucialbooty` and
`/mnt/USBCSSD` are approved Mac-connected destinations, eligible when mounted,
writable, above their reserve-space floor, and visible to Emby. Rank
always-on local NUC disks before Mac-dependent CIFS targets for availability;
the Mac-connected destinations are not emergency-only. Free-space figures are
a recorded snapshot and must be re-verified before any future operation.

## Verified Emby library paths

- Movies currently indexed by Emby:
  - `/mnt/Crucialbooty/Media/movies`
  - `/mnt/DiskBayStation/mediaz/Movies`
  - `/mnt/USBCSSD/mediaserver/movies`
- TV currently indexed by Emby:
  - `/mnt/Crucialbooty/Media/tvshows`
  - `/mnt/DiskBayStation/mediaz/TV-Shows`
  - `/mnt/StorageLand/store/tv/`
  - `/mnt/USBCSSD/mediaserver/tvshows`
- `/mnt/StorageLand/store/movies` exists but is not currently in Emby Movies.
- `/mnt/DikkBay` and `/mnt/ExtraSSD` are not Emby library paths and remain
  ineligible until explicitly configured and verified.
- Emby also lists the hard-excluded File-Island, `/mnt/hairymanass/media`, and
  ThunderDikkz paths. Their presence in Emby does not make them eligible mover
  destinations.

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

## Rolling-cache policy

- Treat the DietPiii intake as a rolling cache with an explicit destination
  allowlist and a per-target reserve-space floor.
- Alert Kasey when intake crosses warning and critical thresholds.
- First implementation mode is candidate report only; it must not delete or
  automatically move media.
- Every later transfer must stage the copy, verify size/count/checksum, trigger
  and verify Emby visibility, then retire the ARR record with `deleteFiles=false`
  or another explicitly reviewed non-destructive action.
- Preserve a journal and rollback information, and enforce one-writer locking.
- Cross-filesystem moves require a purpose-built copy/verify/retire workflow;
  TidyGuardian v2 cannot execute them.

This follow-up needs its own design, dry-run-first implementation, approval
boundary, rollback plan, and verification tests before implementation.
