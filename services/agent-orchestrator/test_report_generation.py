"""
Test Script for Report Generation System

This script tests the complete report generation pipeline:
1. Reporting Agent registration
2. API endpoint functionality
3. Supabase pg_cron integration (manual test)
"""

import asyncio
import sys
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, '/Users/aldemirkonuk/Desktop/Unicorn Projects - /Restaurant AI Automation/services/agent-orchestrator')

from config.settings import get_settings
from core.message_bus import MessageBus
from core.database import DatabaseClient
from agents.reporting_agent import ReportingAgent
from services.notification_client import NotificationClient
from services.email_client import EmailClient
from core.base_agent import AgentConfig

print("=" * 80)
print("🧪 Report Generation System Test")
print("=" * 80)

async def test_reporting_agent():
    """Test Reporting Agent directly"""
    print("\n1️⃣ Testing Reporting Agent...")
    
    settings = get_settings()
    
    # Initialize dependencies
    db_client = DatabaseClient(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key,
        redis_url=settings.redis_url,
    )
    
    notification_client = NotificationClient(
        plivo_auth_id=settings.plivo_auth_id,
        plivo_auth_token=settings.plivo_auth_token,
        plivo_phone=settings.plivo_phone_number,
        mock_mode=True  # Mock for testing
    )
    
    email_client = EmailClient(
        backend=settings.email_backend,
        gmail_user=settings.gmail_user,
        gmail_password=settings.gmail_password,
        mock_mode=True  # Mock for testing
    )
    
    # Create Reporting Agent
    config = AgentConfig(
        agent_name="reporting_agent",
        agent_id="test_reporting_agent",
        queue_name="reporting_agent",
        extra_config={
            "ai_insights_enabled": False,
            "predictive_analytics_enabled": False
        }
    )
    
    agent = ReportingAgent(
        config=config,
        db_client=db_client,
        notification_client=notification_client,
        email_client=email_client
    )
    
    print("✅ Reporting Agent created")
    
    # Test on-demand report generation
    print("\n2️⃣ Testing on-demand report generation...")
    
    message = {
        "type": "generate_on_demand_report",
        "restaurant_id": "test-restaurant-uuid",
        "manager_id": "test-manager-uuid",
        "manager_email": "test@example.com",
        "report_type": "inventory",
        "format": "pdf"
    }
    
    result = await agent.process_message(message)
    
    if result.get("success"):
        print("✅ Report generation successful!")
        print(f"   Report type: {result.get('report_type')}")
        print(f"   Format: {result.get('format')}")
        print(f"   Generated at: {result.get('generated_at')}")
    else:
        print(f"❌ Report generation failed: {result.get('error')}")
    
    return result


async def test_api_endpoint():
    """Test API endpoint (requires running server)"""
    print("\n3️⃣ Testing API endpoint...")
    print("   ⚠️  This requires the Agent Orchestrator to be running")
    print("   Run: python main.py")
    print("   Then test with:")
    print("""
    curl -X POST http://localhost:8000/api/v1/reports/generate \\
      -H "Content-Type: application/json" \\
      -d '{
        "type": "generate_on_demand_report",
        "restaurant_id": "test-restaurant-uuid",
        "manager_id": "test-manager-uuid",
        "manager_email": "test@example.com",
        "report_type": "inventory",
        "format": "pdf"
      }'
    """)


def test_supabase_cron():
    """Instructions for testing Supabase pg_cron"""
    print("\n4️⃣ Testing Supabase pg_cron integration...")
    print("   Steps:")
    print("   1. Open Supabase SQL Editor")
    print("   2. Run the migration script: md_files/02-architecture/SUPABASE_CRON_SETUP.sql")
    print("   3. Verify cron jobs created:")
    print("      SELECT * FROM list_cron_jobs();")
    print("   4. Manually trigger a report:")
    print("""
      SELECT trigger_report_generation(
        'your-restaurant-uuid',
        'your-manager-uuid',
        'comprehensive'
      );
    """)
    print("   5. Check cron job history:")
    print("""
      SELECT 
        jobid,
        jobname,
        last_run_status,
        last_run_start_time
      FROM cron.job_run_details
      ORDER BY last_run_start_time DESC
      LIMIT 10;
    """)


async def main():
    """Run all tests"""
    try:
        # Test 1: Reporting Agent
        result = await test_reporting_agent()
        
        # Test 2: API Endpoint (instructions only)
        await test_api_endpoint()
        
        # Test 3: Supabase pg_cron (instructions only)
        test_supabase_cron()
        
        print("\n" + "=" * 80)
        print("✅ All tests completed!")
        print("=" * 80)
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())

