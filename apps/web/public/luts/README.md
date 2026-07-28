# Packaged LUT resources

These binary resources are generated from the 26 selected Rec.709 `.cube` files supplied in an external directory labelled `精选26色LUT`. The original `.cube` files are intentionally not committed.

Rebuild from the approved source directory:

`pnpm --filter @yujee/web exec tsx scripts/build-luts.ts --source /absolute/path/to/精选26色LUT`

- `thumbs.bin.gz` contains 26 consecutive 17³ RGB LUTs in `LUT_DEFINITIONS` order.
- `full/<lut-id>.bin.gz` contains one 33³ RGB LUT per manifest ID.
- `provenance.json` records the original source-byte SHA-256 and emitted full-resource SHA-256 for each manifest entry.

## Green Book 709 provenance

The original LUT tool’s embedded `LUT_MANIFEST` identifies `绿皮书质感:复古:雪山:人像:风光` with distinct `o709`/`l709` and `oLOG`/`lLOG` slots. The unsuffixed source selected here is the original tool’s 709 slot; its `-LOG.cube` companion is deliberately excluded.

## Licensing provenance

The supplied source directory included LUT files and a scene-name mapping, but no license or copyright statement. This repository asserts no license for the LUT data. Before redistributing or using these generated resources beyond the authorized project, verify permission with the original LUT rights holder.
