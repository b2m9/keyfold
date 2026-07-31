# Releasing

This package uses npm trusted publishing with GitHub Actions. The workflow stages
new versions on npm, but does not make them live. A maintainer must review and
approve the staged package on npm with 2FA.

The workflow supports stable releases. Prereleases need an explicit npm dist-tag
and are not covered by this process.

## Release checklist

1. Make sure `main` is green and contains the release commit.
2. Bump `package.json` and `package-lock.json` to the next version.
3. Run:

   ```sh
   npm ci
   npm run check
   npm pack --dry-run
   ```

4. Commit the version bump.
5. Create and push a matching tag, for example `v0.2.0`.
6. Publish a GitHub Release for that tag.
7. Wait for the `Publish` workflow to stage the package on npm.
8. Review the staged package on npm.
9. Approve the staged package with npm 2FA.

## Reviewing a staged package

Use npmjs.com, or inspect it from the CLI:

```sh
npm stage list @b2m9/keyfold
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

The workflow requires the GitHub Release tag to match the package version exactly:
`package.json` version `0.2.0` must be released from tag `v0.2.0`.
