# StopCheck: testing permission withdrawal in existing agent stacks

StopCheck is an open-source conformance runner that tests whether an agent application continues protected work after a human withdraws permission. It separates cancellation by the application from a stop message delivered to the agent and scores effects from a trusted sink log instead of a model judge.

I have a working LangGraph pilot with 54 deterministic fixture trials covering queued, in-flight, retried, recovered and already-committed work, 23 passing tests, and a separate scorer that reproduces the verdicts from saved logs. In its deliberately constructed restart case, cancelling the graph and every registered live worker still allows a recovered job to act after the stop. A commit-time authority check blocks every late action in this fixture, as designed, while benign tasks complete. These are validation controls rather than real-world failure rates.

Zhu and Wang (2026) formalize durable root-epoch cuts and sink fencing, but their evaluation uses a provider-free ledger. StopCheck will test whether late effects occur after a stop, observed at the tool boundary of existing open-source stacks. The gate itself is an existing mitigation.

I am requesting **$4,000** for two prospectively selected, deliberately limited profiles:

- **A clean-architecture template following the common LangGraph plus Celery pattern** (`eng-mostafa-alrahal/langgraph-agent-clean-architecture`). It has no identified application-level stop control, so the baseline is Celery 5.6.3 revoke. Its late-acknowledged work and Celery's documented loss of in-memory revoke IDs after all workers restart make restart behavior worth measuring. Worker-loss/redelivery conditions will be explicit, with persistent `--statedb` as a comparator. This is a template study, not a claim about an adopted production application or a discovered bug.
- **LastMile's MCP basic agent with the official filesystem server.** This profile tests in-flight tool calls only, plus benign and already-committed controls. An explicitly requested file-write task replaces the basic read/fetch demonstration. It adds no queue, delegation or recovery scope.

Their exact commits, configuration changes and selection reasons are recorded before external stop experiments. Funding also covers stop-message trials on two models, with exact IDs and settings frozen before those calls.

A no-model compatibility preflight of the pinned MCP client/server already passed initialization, tool listing and file write/read. In-flight stop behavior remains to be measured.

The six-week output will be reproducible integration adapters, a published experiment manifest, observed outcomes including unsupported or indeterminate cases, execution traces, and any justified fixes. Testing will use locally deployed services and disposable effects. It will not claim production-wide failure rates or certification of the complete formal protocol.

## Proposed budget

| Item | Amount |
|---|---:|
| Engineering and analysis: 60 hours at $45/hour | $2,700 |
| Model API experiments: spending cap | $600 |
| Local/cloud test infrastructure: spending cap | $300 |
| External review of adapters, evidence and interpretation | $400 |
| **Total** | **$4,000** |

The API allowance is a cap, not a provider price quote. Measured pilot usage determines the predeclared main-run scale. The two target profiles retain outcome-neutral setup and substitution rules. The MCP profile remains limited to in-flight calls to keep the 60-hour, six-week scope feasible.

## AI assistance disclosure, when requested

The pilot code, tests and documentation were developed with ChatGPT/Codex assistance. Claude (Anthropic) reviewed the package and reproduced the test suite and fixture run in a separate Linux sandbox on Python 3.13.

## Sources and prospective record

- Zhu and Wang (2026), PDF Sections 7.2 and 8.4, checked directly for the provider-free evaluation and its claim boundary: https://arxiv.org/pdf/2609.21284
- Selected template: https://github.com/eng-mostafa-alrahal/langgraph-agent-clean-architecture
- Selected MCP application: https://github.com/lastmile-ai/mcp-agent
- Celery 5.6.3 worker/revoke documentation: https://docs.celeryq.dev/en/v5.6.3/userguide/workers.html
- BlueDot Rapid Grants: https://bluedot.org/grants/rapid
- Exact revisions, selection reasons and amendment rules: `INTEGRATION_SELECTION.json` and `INTEGRATIONS.md`.
