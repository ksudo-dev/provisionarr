# Historical synthetic fixture allowances

The public-data scanner checks every reachable Git ref. Two old
`test/discovery-catalog.test.js` fixtures intentionally model security
boundaries and match generic deployment-data detectors:

- `192.168.50.` followed by `9` is the synthetic non-loopback target used to verify that
  fixture-only administration rejects non-loopback services.
- `user` followed by `@static.tvmaze.com` is the synthetic URL-userinfo form used to verify
  that TVmaze poster validation rejects credentials in an image URL.

The scanner allows only those exact values at that exact path and in the exact
historical Git blobs that contain them. It continues to reject other private
addresses, all other personal-email forms, tokens, and even matching values in
the working tree or a different blob, including on reachable non-HEAD refs.
