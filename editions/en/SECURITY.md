# Security

The current release is a local application bound to the loopback interface. It is not certified for hostile multi-tenant or public-internet deployment. Do not expose the development HTTP server directly to the internet. Accounts and business records are stored locally; administrators must protect the workspace and its backups. Model API credentials use Windows DPAPI where available; other platforms retain credentials only in the current process.

Never report a vulnerability by uploading a database, session cookie, API key or private organization document to a public issue. Use this repository's private vulnerability reporting feature if enabled, or request a private maintainer contact without disclosing exploitation details. No private reporting channel or response-time commitment is guaranteed.

Security fixes are not promised for older copies. Review changes before upgrading and back up your local workspace. Model tool restrictions are not an operating-system sandbox.
