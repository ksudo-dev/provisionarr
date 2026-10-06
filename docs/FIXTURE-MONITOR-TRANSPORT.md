# Fixture monitor transport boundary

The monitor execution route is available only when both fixture-control and
test-fixture-monitor flags are explicitly enabled. Its records are seeded into
an in-memory test transport. The route never uses a configured Sonarr or
Radarr URL and never performs an HTTP request or ARR editor PUT.

Production and normal configured-ARR monitor confirmation remain locked.
Fixture execution is not evidence of a remotely atomic ARR update.

## Future compatibility research only

Sonarr and Radarr editor endpoints may use monitored-only internal-record-ID
PUT operations and return `202`. That contract is documented for future
compatibility work only. It is not enabled here: no remote editor request,
full-object PUT, or live monitoring write is implemented by this route.
