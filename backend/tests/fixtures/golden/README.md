# REQ-QA-01 golden fixtures (desktop Chart Analysis exports)

Drop CSV/XLSX exports here, e.g.:

- `som_sop.csv`
- `validation.csv`
- `elasticity.csv`

`tests/test_analytics_golden.py` is **skipped** until those files exist **and**
numeric assertions are implemented. Empty or missing fixtures must not produce
a green “parity” result.
