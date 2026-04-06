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
    imports=("jobs.tasks", "jobs.haiku_tasks", "jobs.spend_tasks", "jobs.calibration_tasks", "jobs.web_verify_tasks", "jobs.ontology_tasks"),
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
}
