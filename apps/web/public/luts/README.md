# Packaged LUT resources

These binary resources are generated from the 26 selected Rec.709 `.cube` files supplied in an external directory labelled `精选26色LUT`. The original `.cube` files are intentionally not committed.

Rebuild from the approved source directory:

`pnpm --filter @yujee/web exec tsx scripts/build-luts.ts --source /absolute/path/to/精选26色LUT`

- `thumbs.bin.gz` contains 26 consecutive 17³ RGB LUTs in `LUT_DEFINITIONS` order.
- `full/<lut-id>.bin.gz` contains one 33³ RGB LUT per manifest ID.
- `provenance.json` records the original source-byte SHA-256 and emitted full-resource SHA-256 for each manifest entry.

## Licensing provenance

The supplied source directory included LUT files and a scene-name mapping, but no license or copyright statement. This repository asserts no license for the LUT data. Before redistributing or using these generated resources beyond the authorized project, verify permission with the original LUT rights holder.
