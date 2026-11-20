---
'stratoscope-ci': minor
---

`--results latest` (`results: 'latest'`) fills the result layer from the latest run whose producing step finished, however far back, not only from the fetched pipelines; `--results-branch`, `--results-event` and `--results-depth` limit the search. Results carry `Pipeline` and `Link` of the run their state comes from (#10).
