"""
Visual Verification Agent
=========================
AI-powered delivery verification with:
- YOLOv8 wine label detection
- OCR invoice scanning (EasyOCR/Tesseract)
- Price comparison (invoice vs negotiated)
- Quantity verification
- Vintage mismatch detection
- Barcode-invoice cross-reference
"""

from typing import Dict, List, Any, Optional
from datetime import datetime
import asyncio
import base64
import io
import json

from core.base_agent import BaseAgent
from core.database import OrderInteraction

# Lazy imports to avoid loading heavy dependencies at startup
PIL_AVAILABLE = False
EASYOCR_AVAILABLE = False
YOLO_AVAILABLE = False
Image = None  # bound by _check_pil() when Pillow is installed


def _check_pil():
    global PIL_AVAILABLE, Image
    try:
        from PIL import Image as PILImage

        Image = PILImage
        PIL_AVAILABLE = True
        return True
    except ImportError:
        return False


def _check_easyocr():
    global EASYOCR_AVAILABLE
    try:
        EASYOCR_AVAILABLE = True
        return True
    except Exception:  # Catch all errors including dependency conflicts
        return False


def _check_yolo():
    global YOLO_AVAILABLE
    try:
        YOLO_AVAILABLE = True
        return True
    except Exception:  # Catch all errors including dependency conflicts
        return False


class VisualVerificationAgent(BaseAgent):
    """
    Visual Verification Agent - AI-powered delivery verification

    Core Philosophy: "Invoice-Only Verification"
    - Scan invoice → extract wine name, quantity, vintage, price
    - Compare against negotiated order
    - Flag mismatches for manager review
    - Only update inventory after manager approval

    Features:
    ✅ YOLOv8 wine label detection
    ✅ OCR invoice scanning
    ✅ Price comparison (invoice vs negotiated)
    ✅ Quantity verification
    ✅ Vintage mismatch detection (Vintage Interceptor)
    ✅ Barcode-invoice cross-reference
    """

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # Configuration
        self.yolo_model_path = config.get("yolo_model_path", "yolov8n.pt")
        self.confidence_threshold = config.get("confidence_threshold", 0.5)
        self.mock_mode = config.get("mock_mode", True)

        # OCR configuration
        self.ocr_languages = config.get("ocr_languages", ["en"])

        # Models (initialized in initialize())
        self.yolo_model = None
        self.ocr_reader = None

        # Price tolerance for flagging
        self.price_tolerance_percent = config.get("price_tolerance_percent", 5.0)

    async def initialize(self) -> None:
        """Initialize vision models"""
        self.logger.info("Initializing Visual Verification Agent")

        if self.mock_mode:
            self.logger.warning("⚠️ Running in MOCK mode (no real vision processing)")
        else:
            # Check YOLO availability (lazy load)
            if _check_yolo():
                try:
                    from ultralytics import YOLO

                    self.yolo_model = YOLO(self.yolo_model_path)
                    self.logger.info("✓ YOLOv8 model loaded")
                except Exception as e:
                    self.logger.warning(f"⚠️ YOLO disabled: {e}")
            else:
                self.logger.warning(
                    "⚠️ ultralytics not available, YOLO detection disabled"
                )

            # Check EasyOCR availability (lazy load)
            if _check_easyocr():
                try:
                    import easyocr

                    self.ocr_reader = easyocr.Reader(self.ocr_languages)
                    self.logger.info("✓ EasyOCR initialized")
                except Exception as e:
                    self.logger.warning(f"⚠️ EasyOCR disabled: {e}")
            else:
                self.logger.warning("⚠️ easyocr not available, OCR disabled")

        self.logger.info("✓ Visual Verification Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("delivery.events", "delivery.photo_received"),
            ("delivery.events", "delivery.invoice_received"),
            ("delivery.events", "delivery.barcode_scanned"),
            ("procurement.events", "procurement.order.delivered"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")

        if routing_key == "delivery.photo_received":
            await self._process_delivery_photo(message)
        elif routing_key == "delivery.invoice_received":
            await self._process_invoice(message)
        elif routing_key == "delivery.barcode_scanned":
            await self._process_barcode_scan(message)
        elif routing_key == "procurement.order.delivered":
            await self._verify_delivery(message)

    async def _process_delivery_photo(self, message: Dict[str, Any]) -> None:
        """Process delivery photo for wine label detection"""
        payload = message.get("payload", {})

        order_id = payload.get("order_id")
        image_data = payload.get("image_data")  # Base64 encoded
        image_url = payload.get("image_url")

        self.logger.info(f"Processing delivery photo for order {order_id}")

        try:
            # Detect wine labels
            detections = await self._detect_wine_labels(image_data or image_url)

            # Store interaction
            await self.database.order_interactions.create_voice_interaction(
                order_id=order_id,
                call_uuid=f"photo-{datetime.utcnow().timestamp()}",
                direction="INBOUND",
                ai_summary=f"Detected {len(detections)} wine labels",
            )

            # Publish detection results
            await self.publish(
                exchange_name="verification.events",
                routing_key="verification.labels_detected",
                message_body={
                    "event_type": "WineLabelsDetected",
                    "payload": {
                        "order_id": order_id,
                        "detections": detections,
                        "detection_count": len(detections),
                    },
                },
                priority=5,
            )

        except Exception as e:
            self.logger.error(f"Error processing delivery photo: {e}", exc_info=True)

    async def _process_invoice(self, message: Dict[str, Any]) -> None:
        """Process invoice image for OCR extraction"""
        payload = message.get("payload", {})

        order_id = payload.get("order_id")
        image_data = payload.get("image_data")
        image_url = payload.get("image_url")

        self.logger.info(f"Processing invoice for order {order_id}")

        try:
            # Extract invoice data via OCR
            invoice_data = await self._scan_invoice(image_data or image_url)

            # Get order details for comparison
            order = await self.database.procurement.get_by_id(order_id)

            if order:
                # Compare invoice vs order
                comparison = self._compare_invoice_to_order(invoice_data, order)

                # Check for price mismatch
                if comparison.get("price_mismatch"):
                    await self._flag_price_mismatch(order_id, comparison)

                # Check for quantity mismatch
                if comparison.get("quantity_mismatch"):
                    await self._flag_quantity_mismatch(order_id, comparison)

                # Check for vintage mismatch
                if comparison.get("vintage_mismatch"):
                    await self._flag_vintage_mismatch(order_id, comparison)

                # Store verification result
                await self._store_verification_result(
                    order_id, invoice_data, comparison
                )

            # Publish extraction results
            await self.publish(
                exchange_name="verification.events",
                routing_key="verification.invoice_extracted",
                message_body={
                    "event_type": "InvoiceExtracted",
                    "payload": {
                        "order_id": order_id,
                        "invoice_data": invoice_data,
                        "comparison": comparison if order else None,
                    },
                },
                priority=6,
            )

        except Exception as e:
            self.logger.error(f"Error processing invoice: {e}", exc_info=True)

    async def _process_barcode_scan(self, message: Dict[str, Any]) -> None:
        """
        Process barcode scan - Vintage Interceptor

        Core Logic:
        1. Scan barcode → lookup in master_wine_library
        2. Check if barcode has vintage mapping
        3. Compare barcode vintage vs invoice vintage
        4. Flag mismatch if different
        """
        payload = message.get("payload", {})

        order_id = payload.get("order_id")
        barcode = payload.get("barcode")
        invoice_vintage = payload.get("invoice_vintage")

        self.logger.info(f"Processing barcode scan for order {order_id}: {barcode}")

        try:
            # Lookup barcode in wine library
            wine = await self.database.wine_library.get_by_barcode(barcode)

            vintage_mismatch = False
            mismatch_details = None

            if wine and wine.barcode_vintage_mapping:
                mapping = wine.barcode_vintage_mapping
                barcode_vintage = mapping.get("current_vintage")

                if (
                    barcode_vintage
                    and invoice_vintage
                    and barcode_vintage != invoice_vintage
                ):
                    vintage_mismatch = True
                    mismatch_details = {
                        "barcode_vintage": barcode_vintage,
                        "invoice_vintage": invoice_vintage,
                        "wine_name": wine.name,
                        "known_vintages": mapping.get("vintages", []),
                    }

                    self.logger.warning(
                        f"⚠️ Vintage mismatch detected for {wine.name}: "
                        f"Barcode shows {barcode_vintage}, Invoice shows {invoice_vintage}"
                    )

            # Create interaction record
            interaction = OrderInteraction(
                order_id=order_id,
                interaction_type="BARCODE_SCAN",
                interaction_direction="INBOUND",
                barcode_scanned=barcode,
                vintage_mismatch_detected=vintage_mismatch,
                vintage_mismatch_details=mismatch_details,
                ai_summary=f"Barcode {barcode} scanned"
                + (" - VINTAGE MISMATCH" if vintage_mismatch else " - OK"),
            )
            await self.database.order_interactions.create(interaction)

            # Publish result
            await self.publish(
                exchange_name="verification.events",
                routing_key="verification.barcode_processed",
                message_body={
                    "event_type": "BarcodeProcessed",
                    "payload": {
                        "order_id": order_id,
                        "barcode": barcode,
                        "wine_found": wine is not None,
                        "wine_name": wine.name if wine else None,
                        "vintage_mismatch": vintage_mismatch,
                        "mismatch_details": mismatch_details,
                    },
                },
                priority=7 if vintage_mismatch else 5,
            )

            # If mismatch, notify manager
            if vintage_mismatch:
                await self._notify_vintage_mismatch(order_id, mismatch_details)

        except Exception as e:
            self.logger.error(f"Error processing barcode: {e}", exc_info=True)

    async def _verify_delivery(self, message: Dict[str, Any]) -> None:
        """
        Full delivery verification workflow

        Steps:
        1. Get order details
        2. Get all interactions (photos, invoices, barcodes)
        3. Aggregate verification status
        4. Determine if ready for inventory update
        5. Request manager approval if needed
        """
        payload = message.get("payload", {})
        order_id = payload.get("order_id")

        self.logger.info(f"Verifying delivery for order {order_id}")

        try:
            # Get order
            order = await self.database.procurement.get_by_id(order_id)
            if not order:
                self.logger.error(f"Order not found: {order_id}")
                return

            # Get all interactions
            interactions = await self.database.order_interactions.get_by_order(order_id)

            # Aggregate verification status
            verification_status = self._aggregate_verification_status(interactions)

            # Determine action
            if (
                verification_status["all_verified"]
                and not verification_status["has_mismatches"]
            ):
                # Auto-approve: Update inventory
                await self._auto_approve_delivery(order_id, order)
            else:
                # Request manager approval
                await self._request_manager_approval(
                    order_id, order, verification_status
                )

        except Exception as e:
            self.logger.error(f"Error verifying delivery: {e}", exc_info=True)

    async def _detect_wine_labels(
        self,
        image_source: str,
    ) -> List[Dict[str, Any]]:
        """
        Detect wine labels in image using YOLOv8

        Args:
            image_source: Base64 encoded image or URL

        Returns:
            List of detected labels with bounding boxes
        """
        if self.mock_mode:
            # Return mock detections
            return [
                {
                    "label": "wine_bottle",
                    "confidence": 0.95,
                    "bbox": [100, 100, 300, 500],
                    "wine_name_detected": "Chateau Margaux 2018",
                },
                {
                    "label": "wine_bottle",
                    "confidence": 0.88,
                    "bbox": [350, 100, 550, 500],
                    "wine_name_detected": "Opus One 2019",
                },
            ]

        if not self.yolo_model or not PIL_AVAILABLE:
            self.logger.warning("YOLO model or PIL not available")
            return []

        try:
            # Load image
            if image_source.startswith("http"):
                import httpx

                async with httpx.AsyncClient() as client:
                    response = await client.get(image_source)
                    image = Image.open(io.BytesIO(response.content))
            else:
                # Base64 encoded
                image_data = base64.b64decode(image_source)
                image = Image.open(io.BytesIO(image_data))

            # Run YOLO detection
            results = self.yolo_model(image, conf=self.confidence_threshold)

            detections = []
            for result in results:
                for box in result.boxes:
                    detections.append(
                        {
                            "label": result.names[int(box.cls)],
                            "confidence": float(box.conf),
                            "bbox": box.xyxy[0].tolist(),
                        }
                    )

            return detections

        except Exception as e:
            self.logger.error(f"YOLO detection error: {e}")
            return []

    async def _scan_invoice(
        self,
        image_source: str,
    ) -> Dict[str, Any]:
        """
        Scan invoice using OCR

        Args:
            image_source: Base64 encoded image or URL

        Returns:
            Extracted invoice data
        """
        if self.mock_mode:
            # Return mock invoice data
            return {
                "vendor_name": "Premium Wine Distributors",
                "invoice_number": "INV-2026-001234",
                "invoice_date": "2026-01-15",
                "line_items": [
                    {
                        "wine_name": "Chateau Margaux",
                        "vintage": 2018,
                        "quantity": 6,
                        "unit_price": 450.00,
                        "total": 2700.00,
                    }
                ],
                "subtotal": 2700.00,
                "tax": 243.00,
                "total": 2943.00,
                "raw_text": "Mock OCR text...",
            }

        if not self.ocr_reader or not PIL_AVAILABLE:
            self.logger.warning("OCR reader or PIL not available")
            return {"error": "OCR not available"}

        try:
            # Load image
            if image_source.startswith("http"):
                import httpx

                async with httpx.AsyncClient() as client:
                    response = await client.get(image_source)
                    image_bytes = response.content
            else:
                image_bytes = base64.b64decode(image_source)

            # Run OCR
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None, lambda: self.ocr_reader.readtext(image_bytes)
            )

            # Extract text
            raw_text = " ".join([result[1] for result in results])

            # Parse invoice data
            invoice_data = self._parse_invoice_text(raw_text)
            invoice_data["raw_text"] = raw_text

            return invoice_data

        except Exception as e:
            self.logger.error(f"OCR scanning error: {e}")
            return {"error": str(e)}

    def _parse_invoice_text(self, raw_text: str) -> Dict[str, Any]:
        """
        Parse raw OCR text to extract structured invoice data

        Uses regex patterns to extract:
        - Wine names
        - Quantities
        - Prices
        - Vintages
        - Invoice number
        """
        import re

        invoice_data = {
            "vendor_name": None,
            "invoice_number": None,
            "invoice_date": None,
            "line_items": [],
            "subtotal": None,
            "tax": None,
            "total": None,
        }

        # Extract invoice number
        inv_match = re.search(r"INV[#\-]?\s*(\d+)", raw_text, re.IGNORECASE)
        if inv_match:
            invoice_data["invoice_number"] = inv_match.group(0)

        # Extract date (various formats)
        date_match = re.search(r"\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}", raw_text)
        if date_match:
            invoice_data["invoice_date"] = date_match.group(0)

        # Extract prices (look for $ amounts)
        price_matches = re.findall(r"\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)", raw_text)
        if price_matches:
            # Last large amount is likely total
            amounts = [float(p.replace(",", "")) for p in price_matches]
            if amounts:
                invoice_data["total"] = max(amounts)

        # Extract quantities (look for "x 6" or "qty: 6" patterns)
        re.findall(r"(?:qty|quantity|x)\s*[:=]?\s*(\d+)", raw_text, re.IGNORECASE)

        # Extract vintages (4-digit years between 1900-2030)
        re.findall(r"\b(19\d{2}|20[0-3]\d)\b", raw_text)

        return invoice_data

    async def _extract_invoice_from_email_text(self, email_body: str) -> dict:
        """
        Phase 32 D-32-15 Scenario B: Extract structured invoice data from email body text.
        Uses Haiku for semantic extraction; falls back to _parse_invoice_text() regex on failure.
        Called by ProviderCommunicationAgent when email is classified OPERATIONAL + invoice signals.

        Returns:
            {
                "vendor_name": str,
                "invoice_number": str,
                "invoice_date": "YYYY-MM-DD",
                "line_items": [{"wine_name": str, "vintage": int, "quantity": int, "unit_price": float}],
                "total": float
            }
        """
        from services.model_clients import get_haiku_client as _get_haiku
        from services.spend_logger import get_spend_logger as _get_spend_logger

        _HAIKU_MODEL = "claude-haiku-4-5-20251001"
        prompt = (
            "Extract invoice fields from this email. Return ONLY valid JSON with no extra text:\n"
            '{"vendor_name": "...", "invoice_number": "...", "invoice_date": "YYYY-MM-DD",\n'
            ' "line_items": [{"wine_name": "...", "vintage": 2019, "quantity": 6, "unit_price": 45.00}],\n'
            ' "total": 270.00}\n\n'
            f"Email body:\n{email_body[:4000]}"
        )

        try:
            haiku = _get_haiku()
            response = await haiku.messages.create(
                model=_HAIKU_MODEL,
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:
            self.logger.warning(
                f"Haiku invoice extraction call failed, using regex fallback: {exc}"
            )
            try:
                return self._parse_invoice_text(email_body)
            except Exception:
                return {}

        # P1 defect fix: tokens were spent the moment the call returned, so the
        # spend log must NOT sit behind json.loads — previously a parse failure
        # jumped to the except and the row was never written (under-counting
        # failure paths in api_spend).
        raw = response.content[0].text if response.content else "{}"
        raw = raw.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else "{}"
            if raw.startswith("json"):
                raw = raw[4:]

        result: Optional[dict] = None
        parse_failed = False
        try:
            result = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as exc:
            parse_failed = True
            self.logger.warning(
                f"Haiku invoice extraction parse failed, using regex fallback: {exc}"
            )

        # SpendLogger (TOKENBDGT-03) — dual-writes NF (P1); emits on BOTH outcomes
        try:
            input_tokens = (
                response.usage.input_tokens
                if hasattr(response, "usage")
                else len(prompt) // 4
            )
            output_tokens = (
                response.usage.output_tokens if hasattr(response, "usage") else 100
            )
            cost_usd = (input_tokens * 0.00000025) + (output_tokens * 0.00000125)
            _get_spend_logger().log(
                provider="anthropic",
                model=_HAIKU_MODEL,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
                restaurant_id=None,
                agent=self.agent_name,
                task_type="invoice_extraction",
                choice="invoice:parse_failed" if parse_failed else "invoice:parsed",
                outcome="partial" if parse_failed else "success",
                correlation_id=getattr(self, "_current_correlation_id", None),
            )
        except Exception:
            pass

        if parse_failed:
            try:
                return self._parse_invoice_text(email_body)
            except Exception:
                return {}
        return result

    def _compare_invoice_to_order(
        self,
        invoice_data: Dict[str, Any],
        order,
    ) -> Dict[str, Any]:
        """
        Compare invoice data to order details

        Returns comparison with mismatch flags
        """
        comparison = {
            "price_mismatch": False,
            "quantity_mismatch": False,
            "vintage_mismatch": False,
            "wine_name_mismatch": False,
            "details": {},
        }

        # Price comparison
        invoice_total = invoice_data.get("total")
        if invoice_total and order.final_price_per_bottle:
            expected_total = order.final_price_per_bottle * order.quantity
            price_diff_percent = (
                abs(invoice_total - expected_total) / expected_total * 100
            )

            if price_diff_percent > self.price_tolerance_percent:
                comparison["price_mismatch"] = True
                comparison["details"]["price"] = {
                    "invoice": invoice_total,
                    "expected": expected_total,
                    "difference_percent": price_diff_percent,
                }

        # Quantity comparison
        for item in invoice_data.get("line_items", []):
            if item.get("quantity") != order.quantity:
                comparison["quantity_mismatch"] = True
                comparison["details"]["quantity"] = {
                    "invoice": item.get("quantity"),
                    "expected": order.quantity,
                }

        return comparison

    async def _flag_price_mismatch(
        self,
        order_id: str,
        comparison: Dict[str, Any],
    ) -> None:
        """Flag price mismatch for manager review"""
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.alert",
            message_body={
                "event_type": "PriceMismatchAlert",
                "payload": {
                    "type": "price_mismatch",
                    "priority": "high",
                    "order_id": order_id,
                    "details": comparison["details"].get("price"),
                    "notification_channels": {"push": True, "sms": True},
                },
            },
            priority=8,
        )

    async def _flag_quantity_mismatch(
        self,
        order_id: str,
        comparison: Dict[str, Any],
    ) -> None:
        """Flag quantity mismatch for manager review"""
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.alert",
            message_body={
                "event_type": "QuantityMismatchAlert",
                "payload": {
                    "type": "quantity_mismatch",
                    "priority": "high",
                    "order_id": order_id,
                    "details": comparison["details"].get("quantity"),
                    "notification_channels": {"push": True, "sms": True},
                },
            },
            priority=8,
        )

    async def _flag_vintage_mismatch(
        self,
        order_id: str,
        comparison: Dict[str, Any],
    ) -> None:
        """Flag vintage mismatch for manager review"""
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.alert",
            message_body={
                "event_type": "VintageMismatchAlert",
                "payload": {
                    "type": "vintage_mismatch",
                    "priority": "high",
                    "order_id": order_id,
                    "details": comparison["details"].get("vintage"),
                    "notification_channels": {"push": True, "sms": True},
                },
            },
            priority=8,
        )

    async def _notify_vintage_mismatch(
        self,
        order_id: str,
        mismatch_details: Dict[str, Any],
    ) -> None:
        """Notify manager of vintage mismatch from barcode scan"""
        wine_name = mismatch_details.get("wine_name", "Unknown Wine")
        barcode_vintage = mismatch_details.get("barcode_vintage")
        invoice_vintage = mismatch_details.get("invoice_vintage")

        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.alert",
            message_body={
                "event_type": "VintageInterceptorAlert",
                "payload": {
                    "type": "vintage_interceptor",
                    "priority": "high",
                    "order_id": order_id,
                    "wine_name": wine_name,
                    "barcode_vintage": barcode_vintage,
                    "invoice_vintage": invoice_vintage,
                    "message": (
                        f"⚠️ Vintage Mismatch: {wine_name}\n"
                        f"Barcode shows: {barcode_vintage}\n"
                        f"Invoice shows: {invoice_vintage}\n"
                        f"Please confirm which vintage was received."
                    ),
                    "actions": [
                        {"id": "accept_barcode", "label": f"Accept {barcode_vintage}"},
                        {"id": "accept_invoice", "label": f"Accept {invoice_vintage}"},
                        {"id": "reject", "label": "Reject Delivery"},
                    ],
                    "notification_channels": {"push": True, "sms": True},
                },
            },
            priority=9,
        )

    async def _store_verification_result(
        self,
        order_id: str,
        invoice_data: Dict[str, Any],
        comparison: Dict[str, Any],
    ) -> None:
        """Store verification result as order interaction"""
        interaction = OrderInteraction(
            order_id=order_id,
            interaction_type="INVOICE_VERIFICATION",
            interaction_direction="INBOUND",
            ai_summary=self._generate_verification_summary(comparison),
            detected_intent="delivery_verification",
            detected_sentiment=(
                "neutral" if not comparison.get("price_mismatch") else "negative"
            ),
        )
        await self.database.order_interactions.create(interaction)

    def _generate_verification_summary(self, comparison: Dict[str, Any]) -> str:
        """Generate human-readable verification summary"""
        issues = []

        if comparison.get("price_mismatch"):
            details = comparison["details"].get("price", {})
            issues.append(
                f"Price mismatch: Invoice ${details.get('invoice', 0):.2f} "
                f"vs Expected ${details.get('expected', 0):.2f}"
            )

        if comparison.get("quantity_mismatch"):
            details = comparison["details"].get("quantity", {})
            issues.append(
                f"Quantity mismatch: Invoice {details.get('invoice')} "
                f"vs Expected {details.get('expected')}"
            )

        if comparison.get("vintage_mismatch"):
            issues.append("Vintage mismatch detected")

        if not issues:
            return "✅ Invoice verification passed - all values match"

        return "⚠️ Issues detected: " + "; ".join(issues)

    def _aggregate_verification_status(
        self,
        interactions: List[OrderInteraction],
    ) -> Dict[str, Any]:
        """Aggregate verification status from all interactions"""
        status = {
            "all_verified": True,
            "has_mismatches": False,
            "photo_verified": False,
            "invoice_verified": False,
            "barcode_verified": False,
            "vintage_mismatches": [],
            "price_mismatches": [],
            "quantity_mismatches": [],
        }

        for interaction in interactions:
            if interaction.interaction_type == "PHOTO_VERIFICATION":
                status["photo_verified"] = True
            elif interaction.interaction_type == "INVOICE_VERIFICATION":
                status["invoice_verified"] = True
            elif interaction.interaction_type == "BARCODE_SCAN":
                status["barcode_verified"] = True

                if interaction.vintage_mismatch_detected:
                    status["has_mismatches"] = True
                    status["vintage_mismatches"].append(
                        interaction.vintage_mismatch_details
                    )

        return status

    async def _auto_approve_delivery(
        self,
        order_id: str,
        order,
    ) -> None:
        """Auto-approve delivery and update inventory"""
        self.logger.info(f"✅ Auto-approving delivery for order {order_id}")

        # Update order status
        await self.database.procurement.update(
            order_id,
            {
                "status": "DELIVERED",
                "state_machine_state": "COMPLETED",
            },
        )

        # Update inventory
        await self.publish(
            exchange_name="inventory.events",
            routing_key="inventory.restock",
            message_body={
                "event_type": "InventoryRestock",
                "payload": {
                    "inventory_id": order.inventory_id,
                    "quantity": order.quantity,
                    "order_id": order_id,
                    "reason": "delivery_verified",
                },
            },
            priority=7,
        )

    async def _request_manager_approval(
        self,
        order_id: str,
        order,
        verification_status: Dict[str, Any],
    ) -> None:
        """Request manager approval for delivery with issues"""
        self.logger.info(f"📋 Requesting manager approval for order {order_id}")

        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.approval_request",
            message_body={
                "event_type": "DeliveryApprovalRequest",
                "payload": {
                    "type": "delivery_approval",
                    "priority": "high",
                    "order_id": order_id,
                    "wine_name": order.wine_name,
                    "quantity": order.quantity,
                    "verification_status": verification_status,
                    "actions": [
                        {"id": "approve", "label": "Approve & Update Inventory"},
                        {"id": "reject", "label": "Reject Delivery"},
                        {"id": "partial", "label": "Partial Accept"},
                    ],
                    "notification_channels": {"push": True, "onetap": True},
                },
            },
            priority=8,
        )

    # =========================================================================
    # DEMO/TEST METHODS - For Realtime Week Demo
    # =========================================================================

    async def detect_vintage_mismatch(
        self,
        order_id: str,
        expected_vintage: int,
        received_vintage: int,
        wine_name: str = "Unknown Wine",
    ) -> Dict[str, Any]:
        """
        Detect and notify vintage mismatch (for demo/testing)

        Args:
            order_id: Procurement order ID
            expected_vintage: What was ordered (e.g., 2019)
            received_vintage: What was delivered (e.g., 2020)
            wine_name: Name of the wine

        Returns:
            Mismatch details and notification status
        """
        mismatch_detected = expected_vintage != received_vintage

        result = {
            "order_id": order_id,
            "wine_name": wine_name,
            "expected_vintage": expected_vintage,
            "received_vintage": received_vintage,
            "mismatch_detected": mismatch_detected,
            "notification_sent": False,
        }

        if mismatch_detected:
            self.logger.warning(
                f"⚠️ VINTAGE MISMATCH: {wine_name} - "
                f"Ordered {expected_vintage}, Received {received_vintage}"
            )

            # Send notification to manager
            await self._notify_manager_vintage_mismatch(
                order_id=order_id,
                wine_name=wine_name,
                expected_vintage=expected_vintage,
                received_vintage=received_vintage,
            )
            result["notification_sent"] = True

        return result

    async def _notify_manager_vintage_mismatch(
        self,
        order_id: str,
        wine_name: str,
        expected_vintage: int,
        received_vintage: int,
    ) -> None:
        """
        Send push notification for vintage mismatch

        Message: "SKU is 2019 but they sent 2020. Update?"
        """
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.vintage_mismatch",
            message_body={
                "event_type": "VintageMismatchAlert",
                "payload": {
                    "type": "vintage_mismatch",
                    "priority": "high",
                    "order_id": order_id,
                    "wine_name": wine_name,
                    "expected_vintage": expected_vintage,
                    "received_vintage": received_vintage,
                    "title": "⚠️ Vintage Mismatch Detected",
                    "message": (
                        f"SKU is {expected_vintage} but they sent {received_vintage}.\n"
                        f"Wine: {wine_name}\n"
                        f"Do you want to update the inventory to {received_vintage}?"
                    ),
                    "action_buttons": [
                        {
                            "id": "approve_change",
                            "label": f"Accept {received_vintage}",
                            "action": "update_vintage",
                        },
                        {
                            "id": "reject_delivery",
                            "label": "Reject Delivery",
                            "action": "reject",
                        },
                        {
                            "id": "contact_vendor",
                            "label": "Contact Vendor",
                            "action": "contact",
                        },
                    ],
                    "notification_channels": {
                        "push": True,
                        "sms": True,
                        "email": False,
                    },
                },
            },
            priority=9,
        )

        self.logger.info(f"📱 Vintage mismatch notification sent for order {order_id}")

    async def detect_wine_type_mismatch(
        self,
        order_id: str,
        expected_type: str,
        received_type: str,
        vintage: int,
        wine_name: str = "Unknown Wine",
    ) -> Dict[str, Any]:
        """
        Detect wine type mismatch (e.g., ordered red, got white)

        Args:
            order_id: Procurement order ID
            expected_type: What was ordered (e.g., "red")
            received_type: What was delivered (e.g., "white")
            vintage: Wine vintage
            wine_name: Name of the wine

        Returns:
            Mismatch details and notification status
        """
        mismatch_detected = expected_type.lower() != received_type.lower()

        result = {
            "order_id": order_id,
            "wine_name": wine_name,
            "vintage": vintage,
            "expected_type": expected_type,
            "received_type": received_type,
            "mismatch_detected": mismatch_detected,
            "notification_sent": False,
        }

        if mismatch_detected:
            self.logger.warning(
                f"⚠️ WINE TYPE MISMATCH: {wine_name} {vintage} - "
                f"Ordered {expected_type}, Received {received_type}"
            )

            # Send notification to manager
            await self._notify_manager_wine_type_mismatch(
                order_id=order_id,
                wine_name=wine_name,
                vintage=vintage,
                expected_type=expected_type,
                received_type=received_type,
            )
            result["notification_sent"] = True

        return result

    async def _notify_manager_wine_type_mismatch(
        self,
        order_id: str,
        wine_name: str,
        vintage: int,
        expected_type: str,
        received_type: str,
    ) -> None:
        """
        Send push notification for wine type mismatch

        Message: "Ordered 2021 red, got 2021 white"
        """
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.wine_type_mismatch",
            message_body={
                "event_type": "WineTypeMismatchAlert",
                "payload": {
                    "type": "wine_type_mismatch",
                    "priority": "critical",
                    "order_id": order_id,
                    "wine_name": wine_name,
                    "vintage": vintage,
                    "expected_type": expected_type,
                    "received_type": received_type,
                    "title": "🚨 Wrong Wine Delivered",
                    "message": (
                        f"An order has been delivered wrong!\n"
                        f"Ordered: {vintage} {expected_type}\n"
                        f"Received: {vintage} {received_type}\n"
                        f"Wine: {wine_name}"
                    ),
                    "action_buttons": [
                        {
                            "id": "accept_anyway",
                            "label": f"Accept {received_type}",
                            "action": "accept_substitute",
                        },
                        {
                            "id": "reject_delivery",
                            "label": "Reject & Return",
                            "action": "reject",
                        },
                        {
                            "id": "contact_vendor",
                            "label": "Call Vendor",
                            "action": "contact",
                        },
                    ],
                    "notification_channels": {
                        "push": True,
                        "sms": True,
                        "email": True,
                    },
                },
            },
            priority=10,
        )

        self.logger.info(
            f"📱 Wine type mismatch notification sent for order {order_id}"
        )

    async def cleanup(self) -> None:
        """Cleanup vision models"""
        self.yolo_model = None
        self.ocr_reader = None
        self.logger.info("✓ Visual Verification Agent cleaned up")
