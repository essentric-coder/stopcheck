# Celery target: declared baseline and restart hypothesis

The selected repository is a **clean-architecture template following the common LangGraph plus Celery pattern**. StopCheck makes no adoption or production-use claim. Its source is pinned at `7cdf9eda6b5419e2946dcac2beddbc8d426594f4`.

The upstream `uv.lock` fixes Celery at **5.6.3**, Redis client at 6.4.0 and LangGraph at 1.1.6. `workers/celery_app.py` explicitly enables `task_acks_late=True` and sets `worker_prefetch_multiplier=1`. It does not override `task_reject_on_worker_lost` or configure a persistent revoke-state database. No application cancellation/revoke control has been identified. Its native-application-stop cell is **unsupported**.

## Declared worker-level baseline

Use Celery's `control.revoke(task_id, terminate=False)` with recorded worker receipt. This is a Celery worker control, not a native application stop. Plain revoke prevents a worker from starting a task whose ID it remembers as revoked; it does not terminate an already-running task. Continuing work in that situation must not be mislabeled as violation of a termination promise Celery never made.

Compare that baseline with the same declared worker profile using persistent `--statedb`. The reference effect gate remains a separate intervention. The administrator-only terminate option is not the application baseline.

## What restart can and cannot establish

Celery normally keeps revoked IDs in memory. If all workers restart without persisted state, that revoke knowledge can disappear. A worker restarted while peers survive can instead synchronize their revoked IDs. Therefore the experiment must record all-worker versus single-worker restart and the presence of a state database.

**Late acknowledgement alone does not prove that killing a task process causes redelivery.** Celery 5.6.3 normally acknowledges abrupt task-child loss when `task_reject_on_worker_lost` is false. Requeueing on that loss requires the corresponding enabled setting. Whole-worker or broker-connection loss is a different condition; redelivery depends on the unacknowledged message and broker recovery. Redis's documented default visibility timeout is one hour.

That makes this a prospectively testable restart/revoke-persistence hypothesis, not an observed bug or a guaranteed replay outcome. Preserve the template's native acknowledgement settings. Any alternative `reject_on_worker_lost` setting or shortened broker visibility timeout must be a separately declared configuration, not silently called the default. Broker/worker restart tests remain pending.

## Version-specific evidence

Reviewed the versioned 5.6.3 documentation and cross-checked the actual `v5.6.3` repository documentation and worker request source. The hosted versioned pages display a 5.6.2 banner, so the source-tag check was used to resolve that presentation ambiguity.

- Revoke and persistent state: https://github.com/celery/celery/blob/v5.6.3/docs/userguide/workers.rst
- Acknowledgement/lost-worker defaults: https://github.com/celery/celery/blob/v5.6.3/docs/userguide/configuration.rst
- Executable failure/acknowledgement branch: https://github.com/celery/celery/blob/v5.6.3/celery/worker/request.py
- Redis visibility timeout: https://docs.celeryq.dev/en/v5.6.3/getting-started/backends-and-brokers/redis.html
