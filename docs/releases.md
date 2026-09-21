# Release process

1. Review the change; update versions, CHANGELOG and documentation.
2. Review dependency licenses and corresponding-source availability.
3. Run unit tests, build Windows artifacts and verify the packaged app.
4. Test the portable launcher and inspect screenshots. State untested boundaries.
5. Commit the exact source and create an annotated vX.Y.Z tag. Do not move published tags.
6. Run npm run release:assemble. Attach installer, portable EXE, source, third-party source, notices and checksums to a draft GitHub Release.
7. Verify tag, assets and notes, then publish. Only the recommended release is marked latest.
8. Verify public downloads and CI. Do not report pending checks as passed.

Public 1.0/1.1 builds retain the original application behavior and are rebuilt with public license metadata and supplemental notices; their binary hashes differ from earlier private builds.

Publishing is manual. CI has read-only permissions and no publishing credential. Installers are built but not installed into a maintainer's normal profile during automated checks. All current builds are unsigned.
