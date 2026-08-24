from pathlib import Path

from dotenv import load_dotenv

# Load .env so SUPABASE_URL, ADMIN_API_KEY, etc. are available in worker processes.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from celery import Celery
from celery.schedules import crontab

from config.settings import Settings

settings = Settings()

celery_app = Celery(
    "wineops_jobs",
    broker=settings.celery_broker_url,
    backend=settings.celery_backend_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    # Include tasks from the tasks module
    imports=(
        "jobs.tasks",
        "jobs.haiku_tasks",
        "jobs.spend_tasks",
        "jobs.calibration_tasks",
        "jobs.web_verify_tasks",
        "jobs.ontology_tasks",
        "jobs.score_tasks",
        "jobs.recrawl_tasks",
        "jobs.trend_tasks",
        "jobs.research_tasks",
        "jobs.drift_tasks",
    ),
)

# =============================================================================
# CELERY BEAT SCHEDULE
# =============================================================================
# Periodic tasks for automated processing

celery_app.conf.beat_schedule = {
    # DLQ Processing - runs every minute to retry failed events
    "dlq-process-pending": {
        "task": "dlq.process_pending",
        "schedule": 60.0,  # Every 60 seconds
        "options": {"expires": 55},  # Expire before next run
    },
    # DLQ Cleanup - runs daily at 3 AM UTC to remove old resolved items
    "dlq-cleanup-old": {
        "task": "dlq.cleanup_old",
        "schedule": crontab(hour=3, minute=0),
        "args": (30,),  # Clean up items older than 30 days
    },
    # DLQ Stats - collect stats every 5 minutes for monitoring
    "dlq-collect-stats": {
        "task": "dlq.get_stats",
        "schedule": 300.0,  # Every 5 minutes
    },
    # Inventory reconciliation - check for low stock daily at 6 AM
    "inventory-low-stock-check": {
        "task": "inventory.reconciliation",
        "schedule": crontab(hour=6, minute=0),
        "args": ("default-restaurant-id", "all"),
    },
    # Refresh materialized views - every hour for reporting
    "refresh-materialized-views": {
        "task": "reports.refresh_views",
        "schedule": crontab(minute=0),  # Every hour at minute 0
    },
    # Monthly spend cap check — runs hourly, idempotent alert per provider/month
    "spend-monthly-cap-check": {
        "task": "spend.monthly_cap_check",
        "schedule": crontab(minute=0),  # Every hour at minute 0
        "options": {"expires": 3500},
    },
    # Daily field confidence calibration — adjusts per-field thresholds based on human review accuracy
    "calibration-daily": {
        "task": "calibration.calibrate_field_thresholds",
        "schedule": crontab(hour=4, minute=0),  # 4 AM UTC daily
        "options": {"expires": 3500},
    },
    # Nightly critic score refresh — rescores stale wines (empty critic_scores or > 30 days old)
    "score-stale-nightly": {
        "task": "score.rescore_stale_wines",
        "schedule": crontab(hour=3, minute=0),  # 3 AM UTC
        "options": {"expires": 3500},
    },
    # Phase 11: Scheduled restaurant re-crawls — daily at 4:30 AM UTC
    # (4:00 AM taken by calibration-daily, 3:00 AM by score-stale-nightly)
    "recrawl-scheduled-daily": {
        "task": "recrawl.scheduled",
        "schedule": crontab(hour=4, minute=30),
        "options": {"expires": 3500},
    },
    # Phase 11: Nightly trend metrics (after recrawl at 4:30 AM)
    "trend-metrics-nightly": {
        "task": "trend.compute_metrics",
        "schedule": crontab(hour=5, minute=0),  # 5:00 AM UTC
        "options": {"expires": 3500},
    },
    # Phase 12: Research agent daily budget check — advisory, runs hourly
    # Authoritative cap check is inside research_agent_task itself (pre-flight)
    "research-daily-budget-check": {
        "task": "research.daily_budget_check",
        "schedule": crontab(minute=0),  # hourly at minute 0
        "options": {"expires": 3500},
    },
    # Enrichment for wines the library matcher could not resolve. Before this
    # entry, research only ran when a human POSTed /api/v1/research/trigger, so
    # provisional wines created by a menu import stayed tier-3 stubs with
    # primary_type='unknown' indefinitely.
    #
    # The task is a no-op unless RESEARCH_DISPATCH_ENABLED=true, because it
    # spends money on outbound web searches. Runs at :30 so it does not
    # contend with the on-the-hour jobs, and skips itself while another
    # research run is in flight.
    "research-dispatch-batch": {
        "task": "research.dispatch_batch",
        "schedule": crontab(minute=30),  # hourly at minute 30
        "options": {"expires": 3500},
    },
    # Phase 12.1 D-07: Weekly staleness re-verification of human_resolved fields > 180 days
    # Re-fetches original citation URLs; downgrades to 0.85 if value no longer present
    "research-staleness-reverify-weekly": {
        "task": "research.staleness_reverify",
        "schedule": crontab(day_of_week=0, hour=2, minute=0),  # Sunday 2 AM UTC
        "options": {"expires": 3500},
    },
    # SimPOS testbed: catalog ↔ mappings/inventory drift (sim-* only, C31)
    "drift-scan-sim-catalogs": {
        "task": "drift.scan_sim_catalogs",
        "schedule": crontab(minute=15),  # hourly at :15
        "options": {"expires": 3500},
    },
}
