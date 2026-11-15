# Execution runtime component

The application entry point is `../server.py`. Run `../Install.ps1` and `../Start-Xiaolajiao.ps1` from the package root; this component is not a separate application.

`bridge/` calls the official DeepSeek Harness Python SDK and bundled `dsh` process. `requirements.lock.txt` pins the tested packages. The optional `vendor/` checkout is not distributed; the root installer fetches the exact upstream tag only when `-FetchUpstreamSource` is supplied. See `UPSTREAM.json` and `../THIRD_PARTY/` for provenance and notices.

The configuration files are templates, not active credentials. Configure a model in the administrator interface after registering. No model service is contacted until it is configured and used. Model tasks have no filesystem, shell or external tool permissions; this is a tool restriction, not an operating-system sandbox.

Persistent workspace data and runtime sessions are created under `../data/workspace/` by the root launcher and are excluded from source packages. The test fixture in `scripts/mock_model.py` provides a temporary loopback model endpoint for regression tests; it is not an AI model.
