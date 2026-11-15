# Source provenance

The `editions/zh` and `editions/en` directories were extracted from the reviewed source archives listed below. Every one of their 99 source files was verified against the SHA-256 and size recorded inside its archive before extraction. Product source bytes are unchanged.

| Edition | Reviewed archive | SHA-256 |
| --- | --- | --- |
| Chinese | xiaolajiao-zh-source-2026-11-15.zip | 33b91680d686a9206cd1eee8ff7394ec502901bc0ff4b37e6cae45ca1acbf648 |
| English | xiaolajiao-en-source-2026-11-15.zip | b76d6475a959fa04222b67846f8c179be87504bf401d0789c665de3df9ac98cd |

The archive-specific `SOURCE_MANIFEST.json` files are omitted from the browsable source tree: later Git commits become the repository history, while the original downloadable archives retain their manifests. Root-level governance, templates and third-party notices derive from the Chinese source archive. The repository workflow runs the existing checks separately from each edition directory on Windows; no new product dependencies are introduced.

## Publication metadata finalized on 2026-11-16

After extraction, nine documentation files in each edition were updated to remove pre-publication wording, identify the finalized license date, and provide repository, download, contribution and reporting links: `LICENSE`, `LICENSING.md`, `CONTRIBUTING.md`, both edition READMEs, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `ROADMAP.md`, and `docs/DESKTOP.md`. These are publication metadata changes. Product code, dependencies, tests and assets remain byte-for-byte identical to the reviewed archives above; the license's permission and no-resale terms are unchanged.

The final downloadable source archives contain these finalized documents, the same 99 source paths per edition and an embedded `SOURCE_MANIFEST.json`. Each archived source file matches its corresponding repository edition file exactly.

| Edition | Final source archive | SHA-256 |
| --- | --- | --- |
| Chinese | xiaolajiao-zh-source-2026-11-15.zip | c3fd0741dfd3d198bed6733441ad20b6c17b2a3a083b08807eded06317c041ed |
| English | xiaolajiao-en-source-2026-11-15.zip | a82950bd167d7095296d966a391da3a41558f5ceeed3517329e49f09b642261a |

No accounts, workspace databases, API credentials, active model settings, runtime sessions, virtual environments, installed dependencies or build outputs are included. Public screenshots use the explicitly labeled fictional sample already present in the reviewed archives. Local staging and upload audit files remain outside this repository.
