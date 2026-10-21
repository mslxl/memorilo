# SVG image EPUB fixtures

These minimal EPUB 3 archives contain an original 8 × 8 PNG and a single cover page.
Both cover pages exercise SVG 1.1 XLink references, SVG 2 `href` references, ordinary
HTML images, and removal of active XLink URLs. The XHTML fixture also exercises a
different prefix bound to the XLink namespace; HTML uses the standard XLink prefix
because HTML parsing does not resolve custom XML namespace prefixes.

The archives contain no content from the book used to reproduce the reported bug.
