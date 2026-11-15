# Contributing

Choose `editions/zh` or `editions/en` and enter that directory before running the installation and test commands below. Both editions contain their own complete source and tests.

This is an editable, source-available application. Read `LICENSE` and `LICENSING.md` before using or redistributing changes; it is not presented as an OSI-approved open-source license. Use [issues](https://github.com/lizhenjie137/intelligent-organization/issues) for reproducible problems and proposals, and [pull requests](https://github.com/lizhenjie137/intelligent-organization/pulls) for reviewed changes.

Develop on a separate checkout and temporary workspace. Never attach workspace databases, accounts, API keys, model configuration, runtime session files, or private documents to an issue or commit. Install on Windows with `./Install.ps1`; Node.js 20 or newer is needed only for frontend tests. Run:

```powershell
./deepseek-harness-base/.venv/Scripts/python.exe -X utf8 -m unittest discover -s tests -v
node --test tests/auth_frontend.test.cjs tests/coordination_assignment.test.cjs
```

The regression suite uses temporary SQLite databases and local mock model endpoints while exercising the real pinned SDK. No production model key is required. Keep changes focused, preserve authorization and provenance checks, and describe behavioral changes and validation in a pull request. Dependency updates require explicit review of runtime API compatibility, third-party notices, and the Windows runtime lifecycle.
