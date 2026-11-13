# Versioning and releases

Ordiff uses `MAJOR.MINOR.PATCH` versions and matching `vMAJOR.MINOR.PATCH` Git tags. During 0.x, minor releases may change the MCP/API contract or storage behavior; patch releases contain compatible fixes. Document compatibility changes in `CHANGELOG.md`. A 1.0 release should follow validation of the supported installation and upgrade paths and the outstanding manual desktop checks.

Keep these versions aligned:

- `package.json` and the root entries in `package-lock.json`
- `src-tauri/Cargo.toml` and the `ordiff-desktop` entry in `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- The server identity in `server/mcp.js`

## Release procedure

1. Start from a clean checkout of the intended commit. Update the versions and changelog.
2. Run `npm test`, `npm run build`, and `npm audit --omit=dev`. Review advisories and build warnings.
3. On Apple Silicon macOS, run `npm run desktop:build`, then `npm run desktop:verify`. The packaged test includes strict signature verification and exercises the bundled runtime, Git, MCP, and backend shutdown.
4. Run the applicable manual checks in `docs/desktop.md`. Record any unverified checks explicitly in the release notes.
5. Commit the release metadata. Create an annotated tag on that commit and push the commit and tag without rewriting existing tags.
6. Archive the verified app with `ditto -c -k --sequesterRsrc --keepParent`, generate a SHA-256 checksum, and attach both to a GitHub release with the changelog and verification results. Confirm the published release's tag and assets.

The current macOS distribution is ad-hoc signed and not notarized. Preserve this limitation in download instructions until Developer ID signing and notarization are configured. Source builds remain available through GitHub's tag archives.
