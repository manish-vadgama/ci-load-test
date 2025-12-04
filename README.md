## Overview

This repo performs **ci-load-testing** that:

- Creates a local **Kind** Kubernetes cluster (2 workers + 1 control plane)
- Installs the **NGINX Ingress Controller** with Helm
- Deploys a simple **http-echo** Helm chart exposing two hosts: `foo.localhost` and `bar.localhost`
- Runs a **k6** load test against the ingress
- Parses the k6 summary and posts a short report as a **comment on the Pull Request**

The workflow file is: `.github/workflows/ci.yml`  
Workflow name: **manish-vadgama**  
Job name: **ci-load-testing**

It runs on every **pull request** targeting the `main` or `testing` branches.

## Time Taken

This task took me approximately **3.5 hours** end‑to‑end, including setting up the Kind cluster, wiring the Helm chart and ingress, and iterating on the k6 load‑testing workflow and reporting.

## Notes

Due to limited availability and the additional responsibilities of caring for my 4‑month‑old baby, I wasn’t able to spend as much time on this part as I would have liked, so I used AI assistance to help with:

- Creating the `k6-loadtest/loadtest.js` script
- The `Extract k6 results` step in the GitHub Actions workflow
- The `Parse and format results` step
- Posting the parsed results as a GitHub Pull Request comment

## Step‑by‑step: What each step does

### 1. Checkout code

- **Step:** `Checkout code`
- **What it does:** Uses `actions/checkout` to pull the repo contents into the GitHub Actions runner so the rest of the steps can see the Helm chart and k6 script.

### 2. Install Kind CLI

- **Step:** `Install kind`
- **What it does:** Downloads the `kind` binary and installs it into `/usr/local/bin`.  
  This is the CLI used to create and destroy the local Kubernetes cluster inside the runner.

### 3. Install kubectl

- **Step:** `Install kubectl`
- **What it does:** Downloads the latest stable `kubectl` binary and installs it into `/usr/local/bin`.  
  All later Kubernetes operations (create cluster, deploy workloads, etc.) use this `kubectl`.

### 4. Create Kind cluster with 2 workers

- **Step:** `Create kind cluster with 2 nodes`
- **What it does:**
  - Creates a Kind cluster from an inline YAML config:
    - 1 control plane node
    - 2 worker nodes
  - Exits with status `0` on success and `1` on failure so the job fails early if the cluster cannot be created.

### 5. Wait for cluster to be ready

- **Step:** `Wait for cluster to be ready`
- **What it does:** Runs `kubectl wait --for=condition=Ready nodes --all` with a 300s timeout.  
  This ensures all Kind nodes are marked `Ready` before continuing.

### 6. Verify cluster status

- **Step:** `Verify cluster status`
- **What it does:**
  - Prints `kubectl cluster-info` to show the API server endpoints.
  - Prints `kubectl get nodes -o wide` to show the node list and their status.
  - This is purely diagnostic output to help reviewers see that the cluster came up correctly.

### 7. Verify cluster components

- **Step:** `Verify cluster components`
- **What it does:** Runs `kubectl get pods --all-namespaces` to show all system pods.  
  This is another sanity check to ensure core Kubernetes components are running.

### 8. Install NGINX Ingress Controller (Helm)

- **Step:** `Install NGINX Ingress Controller`
- **What it does:**
  - Adds the official `ingress-nginx` Helm repo.
  - Installs the `ingress-nginx/ingress-nginx` chart into the `ingress-nginx` namespace.
  - Waits for the ingress controller pod to be `Ready`.
  - This gives the Kind cluster an ingress implementation that understands `Ingress` resources.

### 9. Install Helm (CLI)

- **Step:** `Install Helm`
- **What it does:** Installs the Helm CLI from the official installation script so we can deploy our own Helm chart (`http-echo`) in the next step.

### 10. Deploy http‑echo Helm chart

- **Step:** `Deploy http-echo chart with ingress enabled`
- **What it does:**
  - Installs the local `./http-echo` Helm chart.
  - Sets `.Values.ingress.enabled=true` and `.Values.ingress.className=nginx` so the chart creates an `Ingress` routed through the NGINX Ingress Controller.
  - Waits until both deployments (`http-echo-foo` and `http-echo-bar`) report `Available`.

### 11. Verify Ingress configuration

- **Step:** `Verify ingress configuration`
- **What it does:** Runs:
  - `kubectl get ingress`
  - `kubectl describe ingress http-echo`
  to print the configured rules and backends for the ingress resource. This is for human verification in logs.

### 12. Test hostname‑based routing

- **Step:** `Test hostname routing`
- **What it does:**
  - Port‑forwards the `ingress-nginx-controller` service to `localhost:8080`.
  - Sends two HTTP requests from inside the runner:
    - `curl -H "Host: foo.localhost" http://localhost:8080`
    - `curl -H "Host: bar.localhost" http://localhost:8080`
  - Expects the body `foo` for the first and `bar` for the second.
  - If either check fails, the step exits with `1` and the job fails.  
  This proves the ingress is routing hosts `foo.localhost` and `bar.localhost` correctly before load testing.

### 13. Install k6 operator

- **Step:** `Install k6 operator`
- **What it does:**
  - Adds the Grafana Helm repo (`grafana`).
  - Installs the `grafana/k6-operator` chart into the `default` namespace.
  - Waits for the `TestRun` CRD (`testruns.k6.io`) to be established.
  - Sleeps briefly to give the operator time to start.  
  The k6 operator is a controller that watches for `TestRun` resources and creates Jobs to run k6 tests.

### 14. Create k6 test script ConfigMap

- **Step:** `Create k6 test script ConfigMap`
- **What it does:**
  - Creates (or updates) a ConfigMap named `k6-script` from `k6-loadtest/loadtest.js`.
  - This ConfigMap is referenced by the `TestRun` and mounted into the k6 container as `script.js`.

### 15. Run k6 load test via TestRun

- **Step:** `Run k6 load test`
- **What it does:**
  - Records a `TEST_START_TIME` environment variable (for possible future use).
  - Applies a `TestRun` custom resource (`kind: TestRun`) named `loadtest` that points to the `k6-script` ConfigMap.
  - The k6 operator sees this `TestRun` and creates a Job/Pod to run the test.
  - The step then:
    - Waits for the k6 pod to appear (by label).
    - Waits up to ~7 minutes for the test pod to finish (the script itself runs ~5.5 minutes).
  - Records `TEST_END_TIME` for completeness.

### 16. Extract raw k6 results

- **Step:** `Extract k6 results`
- **What it does:**
  - Finds the pod created for the `loadtest` TestRun.
  - Streams its logs into a local file `k6-results.txt`.
  - Prints a short “sample output” (last 20 lines) to the Actions log.
  - Exposes the results file path as an output (`results_file`) for the next step.

### 17. Parse and format the k6 report

- **Step:** `Parse and format results`
- **What it does:**
  - Reads `k6-results.txt` and uses `grep`/`awk` to extract:
    - `http_req_duration` average, P90, and P95
    - `http_req_failed` rate
    - `http_reqs` rate (requests/sec)
  - Converts the failure rate to a percentage.
  - Writes a small Markdown report (`loadtest-report.md`) with:

    - **Request Duration:** Average, P90, P95
    - **Request Statistics:** Requests/sec and failed requests %
    - **Full Results:** A fenced code block containing the last 50 lines of the raw k6 output.

  - Exposes the report file path as an output (`report_file`) for the final step.

### 18. Post results as a PR comment

- **Step:** `Post results as PR comment`
- **What it does:**
  - Only runs for `pull_request` events.
  - Uses `actions/github-script` with the default `GITHUB_TOKEN`.
  - Reads `loadtest-report.md`.
  - Calls `github.rest.issues.createComment` to post the report as a comment on the PR.

### 19. Cleanup Kind cluster

- **Step:** `Cleanup kind cluster`
- **What it does:**
  - Always runs (`if: always()`).
  - Deletes the Kind cluster with `kind delete cluster || true`.
  - Ensures the runner is cleaned up regardless of test success/failure.

## How to read the PR comment

The PR comment posted by the workflow shows:

- **Average / P90 / P95 latency** from k6
- **Requests per second** during the test
- **Failure rate** (percentage of HTTP requests that failed according to k6)
- A **tail of the raw k6 output** for deeper inspection

This gives reviewers a quick view of how the service behaved under load for the changes in that pull request.

## http‑echo Helm chart (very simple overview)

The `http-echo` chart lives in the `http-echo/` directory. It is intentionally minimal:

- **Deployments**
  - It creates two Deployments: one for `foo` and one for `bar`.
  - Each Deployment runs the `hashicorp/http-echo` image with:
    - `-listen` set to the configured port (default `5678`)
    - `-text` set to either `"foo"` or `"bar"` so the pod always echoes that word.

- **Services**
  - Each Deployment has a matching Service:
    - `http-echo-foo` → forwards to the `foo` pods.
    - `http-echo-bar` → forwards to the `bar` pods.
  - Both services expose a single TCP port for HTTP traffic.

- **Ingress**
  - When `ingress.enabled=true` in `values.yaml`, the chart creates a single `Ingress` named `http-echo`.
  - That Ingress has two host rules:
    - `foo.localhost` → routes to the `http-echo-foo` Service.
    - `bar.localhost` → routes to the `http-echo-bar` Service.
  - The GitHub Actions pipeline configures the class as `nginx`, so the NGINX Ingress Controller handles these routes.

In short: hitting `foo.localhost` through the ingress should return the body `foo`, and hitting `bar.localhost` should return `bar`. The k6 test and the hostname‑routing test both rely on this behaviour.

## k6 load test script (`k6-loadtest/loadtest.js`)

The k6 script lives in `k6-loadtest/loadtest.js`. It is responsible for generating traffic and checks:

- **Load profile**
  - Defined in `export const options = { stages: [...] }`.
  - The stages ramp virtual users (VUs) up from 0 → 10 → 20 → 30, hold at 30 VUs, then ramp back down to 0 over about 5.5 minutes.
  - This simulates a small but realistic load pattern instead of a single spike.

- **Request logic**
  - On each iteration, the script randomly picks one of two “targets”:
    - `foo.localhost` expecting body `foo`
    - `bar.localhost` expecting body `bar`
  - It sends an HTTP GET to the **ingress controller service** inside the cluster:
    - URL: `http://ingress-nginx-controller.ingress-nginx.svc.cluster.local`
    - Sets the `Host` header to either `foo.localhost` or `bar.localhost`.
  - The NGINX Ingress Controller uses the `Host` header to decide whether to route the request to the `foo` or `bar` service.

- **Checks**
  - After each request, two checks run:
    - `status is 200` → verifies the HTTP status code is 200.
    - `response is correct` → trims whitespace from the response body and checks it matches either `foo` or `bar` depending on the chosen host.
  - k6 uses these checks to compute the overall success/failure rate in the summary.

- **How the pipeline uses this script**
  - The GitHub Actions job:
    - Packs `loadtest.js` into a ConfigMap called `k6-script`.
    - Creates a k6 **TestRun** custom resource that tells the k6 operator to mount `k6-script` and execute it.
    - Waits for the TestRun pod to finish.
    - Fetches the pod logs (which contain the k6 summary with latency, throughput, and check results).
  - A later step parses the summary and posts a short Markdown report as a comment on the Pull Request.

In short: the script drives randomized traffic to both `foo.localhost` and `bar.localhost` through the ingress, validates the responses, and produces the metrics that end up in the CI load‑testing report.


