"""
Plivo Voice Client - Production-Ready Voice Calling Service

Handles voice calls via Plivo API with:
- Call initiation and management
- Recording and transcription
- Webhook handling
- AI conversation flow
- Error handling and retry logic
"""

import asyncio
from typing import Optional, Dict, Any, List, Callable
from datetime import datetime, timedelta
from enum import Enum
import plivo
from plivo.exceptions import PlivoRestError

from utils.logger import setup_logger

logger = setup_logger(__name__)


class CallStatus(Enum):
    """Voice call status states"""
    INITIATED = "initiated"
    RINGING = "ringing"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    BUSY = "busy"
    NO_ANSWER = "no-answer"
    FAILED = "failed"
    CANCELED = "canceled"


class PlivoVoiceClient:
    """
    Production-ready Plivo Voice client
    
    Features:
    - Async voice call initiation
    - Call recording with automatic transcription
    - Webhook handling for call events
    - Retry with exponential backoff
    - Cost tracking
    - AI-powered conversation flow
    """
    
    def __init__(
        self,
        auth_id: str,
        auth_token: str,
        from_number: str,
        webhook_base_url: str = "https://your-domain.com/webhooks/plivo",
        mock_mode: bool = False
    ):
        """
        Initialize Plivo Voice client
        
        Args:
            auth_id: Plivo Auth ID
            auth_token: Plivo Auth Token
            from_number: Source phone number (Plivo number)
            webhook_base_url: Base URL for webhooks
            mock_mode: If True, log instead of making real calls
        """
        self.auth_id = auth_id
        self.auth_token = auth_token
        self.from_number = from_number
        self.webhook_base_url = webhook_base_url
        self.mock_mode = mock_mode
        
        # Initialize Plivo client
        if not mock_mode and auth_id and auth_token:
            try:
                self.client = plivo.RestClient(auth_id, auth_token)
                logger.info("✅ Plivo Voice client initialized")
            except Exception as e:
                logger.error(f"Failed to initialize Plivo Voice client: {e}")
                self.client = None
        else:
            self.client = None
            if mock_mode:
                logger.info("📞 Plivo Voice running in MOCK mode")
        
        # Active calls tracking
        self.active_calls: Dict[str, Dict[str, Any]] = {}
        
        # Rate limiting
        self.rate_limit_per_hour = 50
        self.calls_made_timestamps: Dict[str, List[datetime]] = {}
        
        # Cost tracking
        self.cost_per_minute = 0.015  # $0.015 per minute (US)
        self.total_cost = 0.0
        self.total_calls = 0
        self.total_duration_seconds = 0
    
    async def make_call(
        self,
        to_number: str,
        answer_xml_url: Optional[str] = None,
        answer_method: str = "POST",
        record: bool = True,
        record_callback_url: Optional[str] = None,
        max_retries: int = 3,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Initiate a voice call
        
        Args:
            to_number: Destination phone number (E.164 format)
            answer_xml_url: URL returning XML for call flow
            answer_method: HTTP method for answer URL
            record: Whether to record the call
            record_callback_url: URL for recording callback
            max_retries: Number of retry attempts
            context: Additional context for the call
        
        Returns:
            Dict with call_uuid, status, etc.
        """
        # Validate inputs
        if not to_number:
            return {"success": False, "error": "Missing to_number"}
        
        # Normalize phone number
        to_number = self._normalize_phone(to_number)
        
        # Check rate limit
        if not self._check_rate_limit(to_number):
            logger.warning(f"Rate limit exceeded for {to_number}")
            return {
                "success": False,
                "error": "Rate limit exceeded",
                "rate_limit": self.rate_limit_per_hour
            }
        
        # Mock mode
        if self.mock_mode:
            mock_uuid = f"mock-call-{datetime.utcnow().timestamp()}"
            logger.info(f"📞 [MOCK CALL] To: {to_number}, UUID: {mock_uuid}")
            
            # Track mock call
            self.active_calls[mock_uuid] = {
                "to": to_number,
                "status": CallStatus.INITIATED.value,
                "started_at": datetime.utcnow().isoformat(),
                "context": context,
                "mock": True,
            }
            
            return {
                "success": True,
                "mock": True,
                "call_uuid": mock_uuid,
                "to": to_number,
                "status": CallStatus.INITIATED.value,
                "cost": 0.0
            }
        
        # Set default answer URL if not provided
        if not answer_xml_url:
            answer_xml_url = f"{self.webhook_base_url}/voice/answer"
        
        if not record_callback_url:
            record_callback_url = f"{self.webhook_base_url}/voice/recording"
        
        # Real call with retries
        for attempt in range(max_retries):
            try:
                response = await self._make_call_via_plivo(
                    to_number=to_number,
                    answer_xml_url=answer_xml_url,
                    answer_method=answer_method,
                    record=record,
                    record_callback_url=record_callback_url,
                )
                
                call_uuid = response.get("call_uuid")
                
                # Track rate limit
                self._record_call_made(to_number)
                
                # Track active call
                self.active_calls[call_uuid] = {
                    "to": to_number,
                    "status": CallStatus.INITIATED.value,
                    "started_at": datetime.utcnow().isoformat(),
                    "context": context,
                    "recording_enabled": record,
                }
                
                # Update stats
                self.total_calls += 1
                
                logger.info(f"✅ Call initiated to {to_number} (UUID: {call_uuid})")
                
                return {
                    "success": True,
                    "call_uuid": call_uuid,
                    "to": to_number,
                    "status": CallStatus.INITIATED.value,
                    "attempt": attempt + 1
                }
                
            except PlivoRestError as e:
                logger.error(f"Plivo API error (attempt {attempt + 1}/{max_retries}): {e}")
                
                # Don't retry on certain errors
                if hasattr(e, 'status') and e.status in [400, 401, 403]:
                    return {
                        "success": False,
                        "error": str(e),
                        "error_code": e.status
                    }
                
                # Retry on temporary errors
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt
                    logger.info(f"Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    return {
                        "success": False,
                        "error": str(e),
                        "attempts": max_retries
                    }
            
            except Exception as e:
                logger.error(f"Unexpected error making call (attempt {attempt + 1}): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return {
                        "success": False,
                        "error": str(e),
                        "attempts": max_retries
                    }
        
        return {"success": False, "error": "Max retries exceeded"}
    
    async def _make_call_via_plivo(
        self,
        to_number: str,
        answer_xml_url: str,
        answer_method: str,
        record: bool,
        record_callback_url: str,
    ) -> Dict[str, Any]:
        """
        Make call via Plivo API (async wrapper)
        """
        if not self.client:
            raise Exception("Plivo client not initialized")
        
        # Run synchronous Plivo call in executor
        loop = asyncio.get_event_loop()
        
        call_params = {
            "from_": self.from_number,
            "to_": to_number,
            "answer_url": answer_xml_url,
            "answer_method": answer_method,
            "hangup_url": f"{self.webhook_base_url}/voice/hangup",
            "hangup_method": "POST",
            "fallback_url": f"{self.webhook_base_url}/voice/fallback",
            "fallback_method": "POST",
        }
        
        if record:
            call_params["record"] = True
            call_params["record_callback_url"] = record_callback_url
            call_params["record_callback_method"] = "POST"
        
        response = await loop.run_in_executor(
            None,
            lambda: self.client.calls.create(**call_params)
        )
        
        return {
            "call_uuid": response[0].request_uuid if hasattr(response[0], 'request_uuid') else None,
            "status": "initiated"
        }
    
    async def hangup_call(self, call_uuid: str) -> Dict[str, Any]:
        """
        Hang up an active call
        
        Args:
            call_uuid: UUID of the call to hang up
        
        Returns:
            Dict with status
        """
        if self.mock_mode:
            if call_uuid in self.active_calls:
                self.active_calls[call_uuid]["status"] = CallStatus.COMPLETED.value
                logger.info(f"📞 [MOCK] Hung up call {call_uuid}")
            return {"success": True, "mock": True}
        
        if not self.client:
            return {"success": False, "error": "Client not initialized"}
        
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self.client.calls.delete(call_uuid)
            )
            
            if call_uuid in self.active_calls:
                self.active_calls[call_uuid]["status"] = CallStatus.COMPLETED.value
            
            logger.info(f"✅ Hung up call {call_uuid}")
            return {"success": True, "call_uuid": call_uuid}
            
        except Exception as e:
            logger.error(f"Failed to hang up call {call_uuid}: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_call_details(self, call_uuid: str) -> Dict[str, Any]:
        """
        Get details of a call
        
        Args:
            call_uuid: UUID of the call
        
        Returns:
            Call details
        """
        if self.mock_mode:
            return self.active_calls.get(call_uuid, {"error": "Call not found", "mock": True})
        
        if not self.client:
            return {"error": "Client not initialized"}
        
        try:
            loop = asyncio.get_event_loop()
            call = await loop.run_in_executor(
                None,
                lambda: self.client.calls.get(call_uuid)
            )
            
            return {
                "call_uuid": call_uuid,
                "status": call.call_status if hasattr(call, 'call_status') else "unknown",
                "duration": call.duration if hasattr(call, 'duration') else 0,
                "from": call.from_number if hasattr(call, 'from_number') else None,
                "to": call.to_number if hasattr(call, 'to_number') else None,
                "direction": call.call_direction if hasattr(call, 'call_direction') else None,
            }
            
        except Exception as e:
            logger.error(f"Failed to get call details for {call_uuid}: {e}")
            return {"error": str(e)}
    
    async def get_recording(self, recording_uuid: str) -> Dict[str, Any]:
        """
        Get recording details and URL
        
        Args:
            recording_uuid: UUID of the recording
        
        Returns:
            Recording details including URL
        """
        if self.mock_mode:
            return {
                "recording_uuid": recording_uuid,
                "recording_url": f"https://mock-recording.plivo.com/{recording_uuid}.mp3",
                "mock": True
            }
        
        if not self.client:
            return {"error": "Client not initialized"}
        
        try:
            loop = asyncio.get_event_loop()
            recording = await loop.run_in_executor(
                None,
                lambda: self.client.recordings.get(recording_uuid)
            )
            
            return {
                "recording_uuid": recording_uuid,
                "recording_url": recording.recording_url if hasattr(recording, 'recording_url') else None,
                "duration": recording.recording_duration_ms / 1000 if hasattr(recording, 'recording_duration_ms') else 0,
                "call_uuid": recording.call_uuid if hasattr(recording, 'call_uuid') else None,
            }
            
        except Exception as e:
            logger.error(f"Failed to get recording {recording_uuid}: {e}")
            return {"error": str(e)}
    
    def handle_call_webhook(self, webhook_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle incoming call webhook
        
        Args:
            webhook_data: Webhook payload from Plivo
        
        Returns:
            Processed webhook data
        """
        event_type = webhook_data.get("Event")
        call_uuid = webhook_data.get("CallUUID")
        
        logger.info(f"📞 Call webhook: {event_type} for {call_uuid}")
        
        if call_uuid and call_uuid in self.active_calls:
            # Update call status
            if event_type == "CallRinging":
                self.active_calls[call_uuid]["status"] = CallStatus.RINGING.value
            elif event_type == "CallAnswer":
                self.active_calls[call_uuid]["status"] = CallStatus.IN_PROGRESS.value
                self.active_calls[call_uuid]["answered_at"] = datetime.utcnow().isoformat()
            elif event_type == "Hangup":
                self.active_calls[call_uuid]["status"] = CallStatus.COMPLETED.value
                self.active_calls[call_uuid]["ended_at"] = datetime.utcnow().isoformat()
                
                # Calculate duration and cost
                duration = int(webhook_data.get("Duration", 0))
                self.total_duration_seconds += duration
                call_cost = (duration / 60) * self.cost_per_minute
                self.total_cost += call_cost
                self.active_calls[call_uuid]["duration_seconds"] = duration
                self.active_calls[call_uuid]["cost"] = call_cost
        
        return {
            "event": event_type,
            "call_uuid": call_uuid,
            "processed": True
        }
    
    def handle_recording_webhook(self, webhook_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle recording completion webhook
        
        Args:
            webhook_data: Webhook payload from Plivo
        
        Returns:
            Processed recording data
        """
        call_uuid = webhook_data.get("CallUUID")
        recording_url = webhook_data.get("RecordUrl")
        recording_uuid = webhook_data.get("RecordingID")
        duration = int(webhook_data.get("RecordingDuration", 0))
        
        logger.info(f"📼 Recording webhook: {recording_uuid} for call {call_uuid}")
        
        if call_uuid and call_uuid in self.active_calls:
            self.active_calls[call_uuid]["recording_url"] = recording_url
            self.active_calls[call_uuid]["recording_uuid"] = recording_uuid
            self.active_calls[call_uuid]["recording_duration"] = duration
        
        return {
            "call_uuid": call_uuid,
            "recording_uuid": recording_uuid,
            "recording_url": recording_url,
            "duration": duration,
            "processed": True
        }
    
    def generate_answer_xml(
        self,
        speak_text: Optional[str] = None,
        gather_input: bool = False,
        gather_action_url: Optional[str] = None,
        record_voicemail: bool = False,
    ) -> str:
        """
        Generate Plivo XML for call flow
        
        Args:
            speak_text: Text to speak to the caller
            gather_input: Whether to gather DTMF input
            gather_action_url: URL to send gathered input
            record_voicemail: Whether to record a voicemail
        
        Returns:
            Plivo XML string
        """
        xml_parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>']
        
        if speak_text:
            if gather_input:
                xml_parts.append(f'<GetDigits action="{gather_action_url or ""}" method="POST" timeout="10" numDigits="1">')
                xml_parts.append(f'<Speak>{speak_text}</Speak>')
                xml_parts.append('</GetDigits>')
            else:
                xml_parts.append(f'<Speak>{speak_text}</Speak>')
        
        if record_voicemail:
            xml_parts.append(f'<Record action="{self.webhook_base_url}/voice/voicemail" method="POST" maxLength="120" transcriptionType="auto" transcriptionUrl="{self.webhook_base_url}/voice/transcription"/>')
        
        xml_parts.append('</Response>')
        
        return '\n'.join(xml_parts)
    
    def generate_negotiation_xml(
        self,
        wine_name: str,
        quantity: int,
        target_price: float,
        provider_name: str,
    ) -> str:
        """
        Generate XML for AI-powered negotiation call
        
        Args:
            wine_name: Name of the wine
            quantity: Quantity to order
            target_price: Target price per bottle
            provider_name: Name of the provider
        
        Returns:
            Plivo XML for negotiation flow
        """
        greeting = (
            f"Hello, this is an automated call from WineOps AI. "
            f"I'm calling to inquire about ordering {quantity} bottles of {wine_name}. "
            f"We're looking for a price around ${target_price:.2f} per bottle. "
            f"Please press 1 if you can accommodate this order, "
            f"press 2 if you need to discuss pricing, "
            f"or press 3 to leave a voicemail."
        )
        
        return self.generate_answer_xml(
            speak_text=greeting,
            gather_input=True,
            gather_action_url=f"{self.webhook_base_url}/voice/negotiation/response",
        )
    
    def _normalize_phone(self, phone: str) -> str:
        """Normalize phone number to E.164 format"""
        cleaned = ''.join(c for c in phone if c.isdigit() or (c == '+' and phone.index(c) == 0))
        
        if not cleaned.startswith('+'):
            if len(cleaned) == 10:
                cleaned = '+1' + cleaned
            else:
                cleaned = '+' + cleaned
        
        return cleaned
    
    def _check_rate_limit(self, phone: str) -> bool:
        """Check if phone number has exceeded rate limit"""
        now = datetime.utcnow()
        hour_ago = now - timedelta(hours=1)
        
        timestamps = self.calls_made_timestamps.get(phone, [])
        recent_timestamps = [ts for ts in timestamps if ts > hour_ago]
        
        return len(recent_timestamps) < self.rate_limit_per_hour
    
    def _record_call_made(self, phone: str) -> None:
        """Record call made for rate limiting"""
        now = datetime.utcnow()
        
        if phone not in self.calls_made_timestamps:
            self.calls_made_timestamps[phone] = []
        
        self.calls_made_timestamps[phone].append(now)
        
        # Cleanup old timestamps
        two_hours_ago = now - timedelta(hours=2)
        self.calls_made_timestamps[phone] = [
            ts for ts in self.calls_made_timestamps[phone]
            if ts > two_hours_ago
        ]
    
    def get_stats(self) -> Dict[str, Any]:
        """Get voice call statistics"""
        return {
            "total_calls": self.total_calls,
            "total_duration_seconds": self.total_duration_seconds,
            "total_duration_minutes": round(self.total_duration_seconds / 60, 2),
            "total_cost": round(self.total_cost, 4),
            "cost_per_minute": self.cost_per_minute,
            "active_calls": len([c for c in self.active_calls.values() 
                               if c.get("status") in [CallStatus.INITIATED.value, 
                                                      CallStatus.RINGING.value, 
                                                      CallStatus.IN_PROGRESS.value]]),
            "rate_limit_per_hour": self.rate_limit_per_hour,
            "mock_mode": self.mock_mode
        }
    
    def get_active_calls(self) -> Dict[str, Dict[str, Any]]:
        """Get all active calls"""
        return {
            uuid: call for uuid, call in self.active_calls.items()
            if call.get("status") in [CallStatus.INITIATED.value, 
                                      CallStatus.RINGING.value, 
                                      CallStatus.IN_PROGRESS.value]
        }
