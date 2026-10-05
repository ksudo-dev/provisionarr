# Catalog privacy policy

Provisionarr has two deliberately different catalog scopes.

## Shared Library

The Library is a household-owned catalog. Every authenticated Provisionarr
account may see the same owned Movies and TV shows. This keeps availability,
Movies/TV separation, sorting, paging, and request decisions consistent across
the household. It is not an Emby-profile privacy view and does not include
watch history, recommendation seeds, or recommendation reasons.

Anonymous callers cannot read the Library. Owner-only administration remains
owner-only; shared Library visibility does not grant any administrator action.
Owned titles remain in Library and are excluded from discovery and search
rails.

## Personal recommendations

Only an explicitly owner-linked Emby profile supplies a user's viewing-history
and library seeds. The server caches those results with both the Provisionarr
user ID and linked Emby user ID. A recommendation reason may refer only to the
same user's linked history or library. Unlinked users receive no personal
history-derived reason.
