# 📬 Communication Documentation

This folder contains all documentation related to WineOps AI communication systems.

## Files

| File | Description |
|------|-------------|
| [COMMUNICATION_TEMPLATES.md](./COMMUNICATION_TEMPLATES.md) | All message templates, delivery schedules, and format specifications |

## Quick Reference

### Report Delivery Schedule

| Report | Time | Channel |
|--------|------|---------|
| Morning Stock Snapshot | 6:00 AM | Email |
| Low Stock Alerts | Real-time | SMS/WhatsApp |
| End-of-Day Summary | 11:30 PM | Email |
| Weekly Digest | Monday 7:00 AM | Email |
| Monthly Financial | 1st, 8:00 AM | Email |

### Communication Channels

- **Email** (SendGrid/Gmail) - Comprehensive reports with attachments
- **SMS** (Plivo) - Time-sensitive alerts, one-tap actions
- **WhatsApp** (Business API) - Supplier communication
- **Push** (Firebase FCM) - Mobile app notifications

### Related Files

- [Blueprint](../Blueprint) - Core system specification
- [NOTIFICATIONS.md](../08-features/NOTIFICATIONS.md) - Notification feature specs
- [AGENT_PROTOCOLS.md](../02-architecture/AGENT_PROTOCOLS.md) - Agent communication rules

