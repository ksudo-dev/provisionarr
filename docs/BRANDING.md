# Provisionarr artwork

`public/brand/provisionarr-mark.svg` is the canonical Provisionarr mark. The file contains editable SVG paths and shapes. It does not depend on a font, generated raster image, stock icon, or third-party logo.

The mark combines three product functions:

- The window represents the browser interface.
- The play tile represents movie and series requests.
- The wrench represents owner-only stack administration.

The source palette uses `#091720` for the frame, `#315064` for its outline, `#ff665b` for actions, and `#dce5ea` for the wrench. The SVG is also the browser favicon and header mark, so one source file controls every shipped use.

Use an SVG renderer such as Inkscape or `rsvg-convert` when a PNG export is required. Do not replace the source with an opaque raster asset or artwork containing a third-party product mark.
