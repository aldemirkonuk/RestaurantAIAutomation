"""
Unit Tests for Recurring Order Agent
Tests scheduling, date calculations, and notification logic
"""

import pytest
import asyncio
from datetime import date, timedelta
from unittest.mock import Mock, AsyncMock
from agents.recurring_order_agent import RecurringOrderAgent


@pytest.fixture
def mock_db():
    """Mock database client"""
    db = Mock()
    db.fetch_active_recurring_orders = AsyncMock(return_value=[])
    db.get_wine_by_id = AsyncMock(return_value={'name': 'Test Wine', 'id': 'WINE001'})
    db.create_order = AsyncMock(return_value={'order_id': 'ORDER001'})
    db.update_recurring_order = AsyncMock()
    return db


@pytest.fixture
def mock_notification_agent():
    """Mock notification agent"""
    agent = Mock()
    agent.send_notification = AsyncMock()
    return agent


@pytest.fixture
def recurring_agent(mock_db, mock_notification_agent):
    """Get recurring order agent instance"""
    return RecurringOrderAgent(mock_db, mock_notification_agent)


def test_calculate_next_date_daily(recurring_agent):
    """Test daily frequency calculation"""
    current = date(2026, 1, 15)
    next_date = recurring_agent._calculate_next_date(current, 'daily', None)
    
    assert next_date == date(2026, 1, 16)


def test_calculate_next_date_weekly(recurring_agent):
    """Test weekly frequency calculation"""
    current = date(2026, 1, 15)  # Wednesday
    # Next Monday (day 0)
    next_date = recurring_agent._calculate_next_date(current, 'weekly', 0)
    
    assert next_date == date(2026, 1, 20)


def test_calculate_next_date_biweekly(recurring_agent):
    """Test bi-weekly frequency calculation"""
    current = date(2026, 1, 15)
    next_date = recurring_agent._calculate_next_date(current, 'biweekly', None)
    
    assert next_date == date(2026, 1, 29)


def test_calculate_next_date_monthly(recurring_agent):
    """Test monthly frequency calculation"""
    current = date(2026, 1, 15)
    # Next occurrence of 15th
    next_date = recurring_agent._calculate_next_date(current, 'monthly', 15)
    
    assert next_date == date(2026, 2, 15)


def test_calculate_next_date_monthly_edge_case(recurring_agent):
    """Test monthly calculation for dates that don't exist in all months"""
    current = date(2026, 1, 31)
    # February doesn't have 31 days, should use last day
    next_date = recurring_agent._calculate_next_date(current, 'monthly', 31)
    
    # Should handle Feb 28/29 gracefully
    assert next_date.month == 2


@pytest.mark.asyncio
async def test_process_due_order_auto_approve(recurring_agent):
    """Test processing order with auto-approve enabled"""
    order = {
        'id': 'REC001',
        'wine_id': 'WINE001',
        'quantity': 12,
        'unit_type': 'bottle',
        'auto_approve': True,
        'preferred_providers': ['PROV001'],
        'next_order_date': date.today().isoformat()
    }
    
    await recurring_agent._process_due_order(order)
    
    # Should create order
    recurring_agent.db.create_order.assert_called_once()
    # Should send execution notification
    recurring_agent.notification_agent.send_notification.assert_called()


@pytest.mark.asyncio
async def test_process_due_order_manual_approve(recurring_agent):
    """Test processing order with manual approval required"""
    order = {
        'id': 'REC002',
        'wine_id': 'WINE001',
        'quantity': 24,
        'unit_type': 'case',
        'auto_approve': False,
        'next_order_date': date.today().isoformat()
    }
    
    await recurring_agent._process_due_order(order)
    
    # Should NOT create order automatically
    recurring_agent.db.create_order.assert_not_called()
    # Should send approval request
    recurring_agent.notification_agent.send_notification.assert_called()
    
    # Check notification type
    call_args = recurring_agent.notification_agent.send_notification.call_args
    assert call_args[0][0]['type'] == 'recurring_order_approval'


@pytest.mark.asyncio
async def test_send_reminder_notification(recurring_agent):
    """Test 2-day advance reminder notification"""
    order = {
        'id': 'REC003',
        'wine_id': 'WINE001',
        'quantity': 6,
        'unit_type': 'bottle',
        'frequency': 'weekly',
        'next_order_date': (date.today() + timedelta(days=2)).isoformat()
    }
    
    await recurring_agent._send_reminder_notification(order)
    
    # Should send notification
    recurring_agent.notification_agent.send_notification.assert_called_once()
    
    # Verify notification content
    call_args = recurring_agent.notification_agent.send_notification.call_args
    notification = call_args[0][0]
    
    assert notification['type'] == 'recurring_order_reminder'
    assert notification['priority'] == 'high'
    assert 'actions' in notification
    assert len(notification['actions']) >= 3  # Confirm, Edit, Cancel


@pytest.mark.asyncio
async def test_check_scheduled_orders(recurring_agent):
    """Test daily check for scheduled orders"""
    today = date.today()
    in_two_days = today + timedelta(days=2)
    
    mock_orders = [
        {
            'id': 'REC001',
            'wine_id': 'WINE001',
            'next_order_date': in_two_days.isoformat(),
            'auto_approve': True,
            'quantity': 12,
            'unit_type': 'bottle',
            'preferred_providers': []
        },
        {
            'id': 'REC002',
            'wine_id': 'WINE002',
            'next_order_date': today.isoformat(),
            'auto_approve': False,
            'quantity': 6,
            'unit_type': 'case',
            'preferred_providers': []
        }
    ]
    
    recurring_agent.db.fetch_active_recurring_orders.return_value = mock_orders
    
    await recurring_agent.check_scheduled_orders()
    
    # Should process both orders (one reminder, one due)
    assert recurring_agent.notification_agent.send_notification.call_count >= 2


def test_parse_date(recurring_agent):
    """Test date string parsing"""
    # ISO format string
    parsed = recurring_agent._parse_date('2026-01-15')
    assert parsed == date(2026, 1, 15)
    
    # Already a date object
    date_obj = date(2026, 1, 20)
    parsed = recurring_agent._parse_date(date_obj)
    assert parsed == date_obj


@pytest.mark.asyncio
async def test_update_next_order_date(recurring_agent):
    """Test next order date calculation and update"""
    order = {
        'id': 'REC001',
        'next_order_date': '2026-01-15',
        'frequency': 'weekly',
        'frequency_day': 1  # Tuesday
    }
    
    await recurring_agent._update_next_order_date(order)
    
    # Should update database
    recurring_agent.db.update_recurring_order.assert_called_once()
    
    # Verify next date calculation
    call_args = recurring_agent.db.update_recurring_order.call_args
    updated_data = call_args[0][1]
    assert 'next_order_date' in updated_data


@pytest.mark.asyncio
async def test_agent_start_stop(recurring_agent):
    """Test agent lifecycle"""
    # Start agent
    asyncio.create_task(recurring_agent.start())
    
    # Simulate some time passing
    await asyncio.sleep(0.1)
    
    assert recurring_agent.running is True
    
    # Stop agent
    await recurring_agent.stop()
    
    assert recurring_agent.running is False


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

