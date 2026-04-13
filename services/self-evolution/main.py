"""
Self-Evolution Service - The brain that makes WineOps AI learn and improve
Port: 8090

Architecture:
  - PASSIVE COLLECTION: Always active (records feedback, predictions, prompt usage)
  - LEARNING ENGINE: Disabled by default (ENABLE_SELF_EVOLUTION=false)
  - A/B TESTING: Disabled by default
  - META-AGENT: Disabled by default

Enable learning loops by setting ENABLE_SELF_EVOLUTION=true in .env
"""

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
import os
import uuid

# ============== FEATURE FLAG ==============
SELF_EVOLUTION_ENABLED = os.getenv("ENABLE_SELF_EVOLUTION", "false").lower() == "true"

# ============== SUPABASE CLIENT ==============
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

_supabase = None

def get_supabase():
    """Lazy-init Supabase client"""
    global _supabase
    if _supabase is None and SUPABASE_URL and SUPABASE_KEY:
        try:
            from supabase import create_client
            _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        except Exception as e:
            print(f"Warning: Supabase client init failed: {e}")
    return _supabase


# ============== MODELS ==============

class FeedbackType(str, Enum):
    OVERRIDE = "override"
    REJECT = "reject"
    MODIFY = "modify"
    APPROVE_AS_IS = "approve_as_is"


class FeedbackRequest(BaseModel):
    restaurant_id: str
    agent_name: str
    event_type: str
    prediction: Dict[str, Any]
    actual_outcome: Optional[Dict[str, Any]] = None
    correction_type: FeedbackType = FeedbackType.APPROVE_AS_IS
    correction_details: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None


class PredictionRequest(BaseModel):
    restaurant_id: str
    agent_name: str
    prediction_type: str
    predicted_value: Dict[str, Any]
    context: Optional[Dict[str, Any]] = None


class PredictionOutcomeRequest(BaseModel):
    prediction_id: str
    actual_value: Dict[str, Any]


class PromptUsageRequest(BaseModel):
    agent_name: str
    prompt_name: str
    version: int = 1
    tokens_used: int = 0
    latency_ms: int = 0
    success: bool = True


class ExperimentRequest(BaseModel):
    experiment_name: str
    agent_name: str
    parameter_name: str
    variant_a: Dict[str, Any]
    variant_b: Dict[str, Any]
    metric: str
    sample_size_target: int = 100


# ============== APP ==============

app = FastAPI(
    title="WineOps Self-Evolution Service",
    description="Passive data collection (always on) + Learning engine (disabled by default)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:4000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== STATUS ==============

@app.get("/")
async def root():
    return {
        "service": "self-evolution",
        "status": "active" if SELF_EVOLUTION_ENABLED else "passive_only",
        "passive_collection": "enabled",
        "learning_engine": "enabled" if SELF_EVOLUTION_ENABLED else "disabled",
        "message": (
            "Self-Evolution is fully active."
            if SELF_EVOLUTION_ENABLED
            else "Passive data collection is active. Learning loops are DISABLED. Set ENABLE_SELF_EVOLUTION=true to activate."
        ),
    }


@app.get("/health")
async def health():
    db = get_supabase()
    return {
        "status": "healthy",
        "service": "self-evolution",
        "self_evolution_enabled": SELF_EVOLUTION_ENABLED,
        "passive_collection": True,
        "database_connected": db is not None,
    }


# ==========================================================================
# PASSIVE COLLECTION ENDPOINTS (Always Active)
# ==========================================================================

@app.post("/feedback")
async def record_feedback(req: FeedbackRequest):
    """Record manager correction/override of AI suggestion (ALWAYS ACTIVE)"""
    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    # Calculate improvement signal
    signal = _calculate_improvement_signal(req.correction_type)

    record = {
        "restaurant_id": req.restaurant_id,
        "agent_name": req.agent_name,
        "event_type": req.event_type,
        "prediction": req.prediction,
        "actual_outcome": req.actual_outcome,
        "correction_type": req.correction_type.value,
        "correction_details": req.correction_details,
        "improvement_signal": signal,
        "context": req.context,
    }

    result = db.table("ai_feedback_loop").insert(record).execute()
    feedback_id = result.data[0]["id"] if result.data else None

    return {
        "status": "recorded",
        "feedback_id": feedback_id,
        "improvement_signal": signal,
    }


@app.post("/prediction")
async def record_prediction(req: PredictionRequest):
    """Record an agent prediction for later accuracy tracking (ALWAYS ACTIVE)"""
    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    record = {
        "restaurant_id": req.restaurant_id,
        "agent_name": req.agent_name,
        "prediction_type": req.prediction_type,
        "predicted_value": req.predicted_value,
        "prediction_made_at": datetime.utcnow().isoformat(),
        "context": req.context,
    }

    result = db.table("prediction_outcomes").insert(record).execute()
    prediction_id = result.data[0]["id"] if result.data else None

    return {
        "status": "recorded",
        "prediction_id": prediction_id,
    }


@app.post("/prediction/outcome")
async def record_prediction_outcome(req: PredictionOutcomeRequest):
    """Record actual outcome for a prediction (ALWAYS ACTIVE)"""
    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    # Fetch prediction
    pred = db.table("prediction_outcomes").select("*").eq("id", req.prediction_id).single().execute()
    if not pred.data:
        raise HTTPException(status_code=404, detail="Prediction not found")

    # Calculate accuracy
    accuracy = _calculate_accuracy(pred.data["predicted_value"], req.actual_value)

    db.table("prediction_outcomes").update({
        "actual_value": req.actual_value,
        "accuracy_score": accuracy,
        "outcome_recorded_at": datetime.utcnow().isoformat(),
    }).eq("id", req.prediction_id).execute()

    return {
        "status": "outcome_recorded",
        "accuracy_score": accuracy,
    }


@app.post("/prompt-usage")
async def record_prompt_usage(req: PromptUsageRequest):
    """Record prompt template performance (ALWAYS ACTIVE)"""
    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    # Upsert prompt version
    existing = (
        db.table("prompt_versions")
        .select("*")
        .eq("agent_name", req.agent_name)
        .eq("prompt_name", req.prompt_name)
        .eq("version", req.version)
        .execute()
    )

    if existing.data:
        row = existing.data[0]
        new_total = row["total_uses"] + 1
        new_successes = row["total_successes"] + (1 if req.success else 0)
        new_failures = row["total_failures"] + (0 if req.success else 1)

        db.table("prompt_versions").update({
            "total_uses": new_total,
            "total_successes": new_successes,
            "total_failures": new_failures,
            "performance_score": new_successes / max(new_total, 1),
            "avg_tokens_used": int((row.get("avg_tokens_used") or 0 + req.tokens_used) / 2),
            "avg_latency_ms": int((row.get("avg_latency_ms") or 0 + req.latency_ms) / 2),
        }).eq("id", row["id"]).execute()
    else:
        db.table("prompt_versions").insert({
            "agent_name": req.agent_name,
            "prompt_name": req.prompt_name,
            "prompt_template": "",  # Will be populated when learning engine is active
            "version": req.version,
            "total_uses": 1,
            "total_successes": 1 if req.success else 0,
            "total_failures": 0 if req.success else 1,
            "performance_score": 1.0 if req.success else 0.0,
            "avg_tokens_used": req.tokens_used,
            "avg_latency_ms": req.latency_ms,
        }).execute()

    return {"status": "recorded"}


# ==========================================================================
# LEARNING ENDPOINTS (DISABLED by default -- require ENABLE_SELF_EVOLUTION=true)
# ==========================================================================

def _require_evolution_enabled():
    if not SELF_EVOLUTION_ENABLED:
        raise HTTPException(
            status_code=403,
            detail="Self-evolution is disabled. Set ENABLE_SELF_EVOLUTION=true to activate learning loops.",
        )


@app.post("/optimize/prompts")
async def optimize_prompts(agent_name: str):
    """Analyze prompt performance and suggest optimizations (REQUIRES ENABLE_SELF_EVOLUTION=true)"""
    _require_evolution_enabled()

    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get all prompts for this agent
    prompts = (
        db.table("prompt_versions")
        .select("*")
        .eq("agent_name", agent_name)
        .eq("is_active", True)
        .order("performance_score", desc=False)
        .execute()
    )

    suggestions = []
    for prompt in prompts.data or []:
        if prompt["total_uses"] >= 20 and (prompt["performance_score"] or 0) < 0.7:
            suggestions.append({
                "prompt_name": prompt["prompt_name"],
                "current_score": prompt["performance_score"],
                "total_uses": prompt["total_uses"],
                "suggestion": "Consider A/B testing a revised version of this prompt",
            })

    return {
        "agent_name": agent_name,
        "suggestions": suggestions,
        "total_prompts_analyzed": len(prompts.data or []),
    }


@app.post("/optimize/thresholds")
async def optimize_thresholds(restaurant_id: str):
    """Analyze stockout events and suggest threshold adjustments (REQUIRES ENABLE_SELF_EVOLUTION=true)"""
    _require_evolution_enabled()

    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get prediction outcomes for stockout predictions
    outcomes = (
        db.table("prediction_outcomes")
        .select("*")
        .eq("restaurant_id", restaurant_id)
        .eq("prediction_type", "stockout_date")
        .not_.is_("accuracy_score", "null")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )

    if not outcomes.data or len(outcomes.data) < 10:
        return {"status": "insufficient_data", "message": "Need at least 10 stockout predictions with outcomes"}

    avg_accuracy = sum(o["accuracy_score"] for o in outcomes.data) / len(outcomes.data)

    return {
        "restaurant_id": restaurant_id,
        "avg_stockout_prediction_accuracy": round(avg_accuracy, 3),
        "sample_size": len(outcomes.data),
        "recommendation": (
            "Thresholds are well-calibrated"
            if avg_accuracy >= 0.7
            else "Consider increasing safety stock thresholds"
        ),
    }


@app.post("/experiments/create")
async def create_experiment(req: ExperimentRequest):
    """Create a new A/B experiment (REQUIRES ENABLE_SELF_EVOLUTION=true)"""
    _require_evolution_enabled()

    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    record = {
        "experiment_name": req.experiment_name,
        "agent_name": req.agent_name,
        "parameter_name": req.parameter_name,
        "variant_a": req.variant_a,
        "variant_b": req.variant_b,
        "metric": req.metric,
        "sample_size_target": req.sample_size_target,
        "status": "RUNNING",
        "started_at": datetime.utcnow().isoformat(),
    }

    result = db.table("ab_experiments").insert(record).execute()

    return {
        "status": "created",
        "experiment_id": result.data[0]["id"] if result.data else None,
    }


@app.post("/experiments/{experiment_id}/evaluate")
async def evaluate_experiment(experiment_id: str):
    """Evaluate A/B experiment results (REQUIRES ENABLE_SELF_EVOLUTION=true)"""
    _require_evolution_enabled()

    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    exp = db.table("ab_experiments").select("*").eq("id", experiment_id).single().execute()
    if not exp.data:
        raise HTTPException(status_code=404, detail="Experiment not found")

    data = exp.data
    total_a = max(data["current_sample_a"], 1)
    total_b = max(data["current_sample_b"], 1)
    rate_a = data["success_count_a"] / total_a
    rate_b = data["success_count_b"] / total_b

    # Simple winner determination (chi-squared test would go here in production)
    min_samples = data["sample_size_target"]
    if total_a >= min_samples and total_b >= min_samples:
        winner = "A" if rate_a >= rate_b else "B"
        confidence = abs(rate_a - rate_b) / max(rate_a, rate_b, 0.01)

        db.table("ab_experiments").update({
            "winner": winner,
            "confidence": round(confidence, 3),
            "status": "COMPLETED",
            "completed_at": datetime.utcnow().isoformat(),
        }).eq("id", experiment_id).execute()

        return {
            "status": "completed",
            "winner": winner,
            "rate_a": round(rate_a, 3),
            "rate_b": round(rate_b, 3),
            "confidence": round(confidence, 3),
        }
    else:
        return {
            "status": "in_progress",
            "samples_a": total_a,
            "samples_b": total_b,
            "target": min_samples,
            "rate_a": round(rate_a, 3),
            "rate_b": round(rate_b, 3),
        }


# ==========================================================================
# ANALYTICS ENDPOINTS
# ==========================================================================

@app.get("/analytics/agent/{agent_name}")
async def get_agent_analytics(agent_name: str):
    """Get analytics for a specific agent"""
    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    # Feedback stats
    feedback = (
        db.table("ai_feedback_loop")
        .select("improvement_signal, correction_type")
        .eq("agent_name", agent_name)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )

    # Prediction accuracy
    predictions = (
        db.table("prediction_outcomes")
        .select("accuracy_score")
        .eq("agent_name", agent_name)
        .not_.is_("accuracy_score", "null")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )

    feedback_data = feedback.data or []
    pred_data = predictions.data or []

    avg_signal = (
        sum(f["improvement_signal"] for f in feedback_data if f["improvement_signal"] is not None)
        / max(len([f for f in feedback_data if f["improvement_signal"] is not None]), 1)
    )

    avg_accuracy = (
        sum(p["accuracy_score"] for p in pred_data)
        / max(len(pred_data), 1)
    )

    return {
        "agent_name": agent_name,
        "feedback_count": len(feedback_data),
        "avg_improvement_signal": round(avg_signal, 3),
        "prediction_count": len(pred_data),
        "avg_prediction_accuracy": round(avg_accuracy, 3),
        "correction_breakdown": _count_corrections(feedback_data),
    }


# ==========================================================================
# HELPERS
# ==========================================================================

def _calculate_improvement_signal(correction_type: FeedbackType) -> float:
    """Map correction type to improvement signal"""
    signals = {
        FeedbackType.APPROVE_AS_IS: 1.0,
        FeedbackType.MODIFY: -0.3,
        FeedbackType.REJECT: -0.8,
        FeedbackType.OVERRIDE: -1.0,
    }
    return signals.get(correction_type, 0.0)


def _calculate_accuracy(predicted: Dict[str, Any], actual: Dict[str, Any]) -> float:
    """Simple accuracy calculation -- returns 0-1 score"""
    if not predicted or not actual:
        return 0.0

    # If both have a 'value' key, compare directly
    pred_val = predicted.get("value")
    actual_val = actual.get("value")

    if pred_val is not None and actual_val is not None:
        try:
            pred_num = float(pred_val)
            actual_num = float(actual_val)
            if actual_num == 0:
                return 1.0 if pred_num == 0 else 0.0
            error = abs(pred_num - actual_num) / abs(actual_num)
            return max(0.0, 1.0 - error)
        except (ValueError, TypeError):
            return 1.0 if str(pred_val) == str(actual_val) else 0.0

    # Fallback: check if all keys match
    matching = sum(1 for k in predicted if k in actual and predicted[k] == actual[k])
    total = max(len(set(list(predicted.keys()) + list(actual.keys()))), 1)
    return matching / total


def _count_corrections(feedback_data: list) -> Dict[str, int]:
    """Count feedback by correction type"""
    counts: Dict[str, int] = {}
    for f in feedback_data:
        ct = f.get("correction_type", "unknown")
        counts[ct] = counts.get(ct, 0) + 1
    return counts


# ==========================================================================
# ENTRYPOINT
# ==========================================================================

if __name__ == "__main__":
    import uvicorn

    if SELF_EVOLUTION_ENABLED:
        print("Self-Evolution Service: FULLY ACTIVE (learning loops enabled)")
    else:
        print("Self-Evolution Service: PASSIVE ONLY (data collection active, learning disabled)")
        print("   Set ENABLE_SELF_EVOLUTION=true in .env to activate learning loops")

    uvicorn.run(app, host="0.0.0.0", port=8090)
