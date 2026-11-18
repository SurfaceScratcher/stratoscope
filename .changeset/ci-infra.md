---
'stratoscope-ci': minor
---

`combineWithInfra` and `linkToInfra` connect CI results with a stratoscope-infra topology: containers run the images a pipeline builds (`runs-image`), stacks live where it deploys to (`deployed-by`). Image names now ignore tags from variables (`app:${TAG:-latest}`) and Docker Hub's implicit prefixes.
