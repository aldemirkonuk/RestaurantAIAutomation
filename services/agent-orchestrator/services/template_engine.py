"""
Template Engine - Variable Substitution and Template Rendering

Provides powerful template rendering for provider communications with:
- Variable substitution
- Conditional rendering
- Template inheritance
- Multi-language support (future)
- Template versioning
"""

from typing import Dict, Any, Optional, List
import re
from datetime import datetime
from jinja2 import Environment, BaseLoader, select_autoescape

from utils.logger import setup_logger

logger = setup_logger(__name__)


class TemplateEngine:
    """
    Production-ready template engine for provider communications

    Features:
    - Variable substitution with {variable} syntax
    - Jinja2 templates for complex logic
    - Template validation
    - Error handling
    - Default value support
    """

    def __init__(self):
        # Jinja2 environment for complex templates
        self.jinja_env = Environment(
            loader=BaseLoader(),
            autoescape=select_autoescape(["html", "xml"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )

        # Register custom filters
        self.jinja_env.filters["currency"] = self._filter_currency
        self.jinja_env.filters["date"] = self._filter_date
        self.jinja_env.filters["phone"] = self._filter_phone

    def render(
        self,
        template: str,
        variables: Dict[str, Any],
        use_jinja: bool = False,
        strict: bool = False,
    ) -> str:
        """
        Render template with variables

        Args:
            template: Template string
            variables: Dictionary of variables to substitute
            use_jinja: If True, use Jinja2 for complex logic
            strict: If True, raise error on missing variables

        Returns:
            Rendered template string
        """
        try:
            if use_jinja:
                return self._render_jinja(template, variables)
            else:
                return self._render_simple(template, variables, strict)
        except Exception as e:
            logger.error(f"Template rendering error: {e}")
            if strict:
                raise
            return template  # Return original if not strict

    def _render_simple(
        self, template: str, variables: Dict[str, Any], strict: bool = False
    ) -> str:
        """
        Simple template rendering with {variable} syntax

        Supports:
        - {variable} - Simple substitution
        - {variable|default_value} - With default
        - {variable|filter:arg} - With filter (future)
        """
        rendered = template

        # Find all variables in template
        variable_pattern = r"\{([^}]+)\}"
        matches = re.finditer(variable_pattern, template)

        for match in matches:
            full_match = match.group(0)  # {variable} or {variable|default}
            content = match.group(1)  # variable or variable|default

            # Check for default value
            if "|" in content:
                var_name, default = content.split("|", 1)
                var_name = var_name.strip()
                default = default.strip()
            else:
                var_name = content.strip()
                default = None

            # Get value
            value = variables.get(var_name)

            if value is None:
                if default is not None:
                    value = default
                elif strict:
                    raise ValueError(f"Missing required variable: {var_name}")
                else:
                    value = f"{{MISSING: {var_name}}}"

            # Convert value to string
            rendered = rendered.replace(full_match, str(value))

        return rendered

    def _render_jinja(self, template: str, variables: Dict[str, Any]) -> str:
        """Render Jinja2 template with complex logic"""
        try:
            jinja_template = self.jinja_env.from_string(template)
            return jinja_template.render(**variables)
        except Exception as e:
            logger.error(f"Jinja2 rendering error: {e}")
            raise

    def validate_template(
        self, template: str, required_variables: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Validate template syntax and check for required variables

        Args:
            template: Template string to validate
            required_variables: List of required variable names

        Returns:
            Validation result with status and errors
        """
        result = {"valid": True, "errors": [], "warnings": [], "variables": []}

        # Extract all variables from template
        variable_pattern = r"\{([^}]+)\}"
        matches = re.finditer(variable_pattern, template)

        found_variables = set()
        for match in matches:
            content = match.group(1)
            var_name = content.split("|")[0].strip()
            found_variables.add(var_name)

        result["variables"] = list(found_variables)

        # Check for required variables
        if required_variables:
            missing = set(required_variables) - found_variables
            if missing:
                result["valid"] = False
                result["errors"].append(
                    f"Missing required variables: {', '.join(missing)}"
                )

        # Check for syntax errors (unmatched braces)
        open_count = template.count("{")
        close_count = template.count("}")
        if open_count != close_count:
            result["valid"] = False
            result["errors"].append(
                f"Unmatched braces: {open_count} open, {close_count} close"
            )

        return result

    def extract_variables(self, template: str) -> List[str]:
        """Extract all variable names from template"""
        variable_pattern = r"\{([^}]+)\}"
        matches = re.finditer(variable_pattern, template)

        variables = []
        for match in matches:
            content = match.group(1)
            var_name = content.split("|")[0].strip()
            variables.append(var_name)

        return list(set(variables))

    # =========================================================================
    # CUSTOM FILTERS
    # =========================================================================

    def _filter_currency(self, value: Any, currency: str = "USD") -> str:
        """Format value as currency"""
        try:
            amount = float(value)
            if currency == "USD":
                return f"${amount:,.2f}"
            else:
                return f"{amount:,.2f} {currency}"
        except (ValueError, TypeError):
            return str(value)

    def _filter_date(self, value: Any, format: str = "%B %d, %Y") -> str:
        """Format datetime value"""
        try:
            if isinstance(value, str):
                # Parse ISO format
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            elif isinstance(value, datetime):
                dt = value
            else:
                return str(value)

            return dt.strftime(format)
        except (ValueError, TypeError):
            return str(value)

    def _filter_phone(self, value: Any) -> str:
        """Format phone number"""
        try:
            # Remove all non-digit characters
            digits = "".join(c for c in str(value) if c.isdigit())

            # Format as (XXX) XXX-XXXX if US number
            if len(digits) == 10:
                return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
            elif len(digits) == 11 and digits[0] == "1":
                return f"+1 ({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
            else:
                return str(value)
        except (ValueError, TypeError):
            return str(value)


class MessageTemplateManager:
    """
    Manager for communication message templates

    Handles:
    - Template CRUD operations
    - Database persistence
    - Template categories
    - Version control
    - Global vs restaurant-specific templates
    """

    def __init__(self, database):
        self.database = database
        self.template_engine = TemplateEngine()

    async def create_template(
        self,
        name: str,
        category: str,
        subject: Optional[str],
        body: str,
        variables: List[str],
        restaurant_id: Optional[str] = None,
        language: str = "en",
        is_active: bool = True,
    ) -> Dict[str, Any]:
        """
        Create a new message template

        Args:
            name: Template name (unique identifier)
            category: Category (order, inquiry, confirmation, follow_up)
            subject: Email subject line (can include variables)
            body: Message body with {variables}
            variables: List of required variable names
            restaurant_id: If None, it's a global template
            language: Language code (en, es, fr, etc.)
            is_active: Whether template is active

        Returns:
            Created template data
        """
        try:
            # Validate template
            validation = self.template_engine.validate_template(body, variables)
            if not validation["valid"]:
                raise ValueError(f"Invalid template: {validation['errors']}")

            # Insert into database
            template_data = {
                "name": name,
                "category": category,
                "subject": subject,
                "body": body,
                "variables": variables,
                "restaurant_id": restaurant_id,
                "language": language,
                "is_active": is_active,
                "version": 1,
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            }

            response = (
                await self.database.supabase.table("message_templates")
                .insert(template_data)
                .execute()
            )

            logger.info(f"Created template: {name} (category: {category})")
            return response.data[0] if response.data else template_data

        except Exception as e:
            logger.error(f"Failed to create template: {e}")
            raise

    async def get_template(
        self,
        template_id: Optional[str] = None,
        name: Optional[str] = None,
        category: Optional[str] = None,
        restaurant_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Get template by ID, name, or category

        Priority:
        1. Restaurant-specific template
        2. Global template
        """
        try:
            query = self.database.supabase.table("message_templates").select("*")

            if template_id:
                query = query.eq("id", template_id)
            elif name:
                query = query.eq("name", name)
                if restaurant_id:
                    # Try restaurant-specific first
                    query = query.eq("restaurant_id", restaurant_id)
            elif category:
                query = query.eq("category", category)
                if restaurant_id:
                    query = query.eq("restaurant_id", restaurant_id)

            query = query.eq("is_active", True).order("created_at", desc=True)

            response = await query.execute()

            if response.data:
                return response.data[0]

            # If restaurant-specific not found, try global
            if restaurant_id and (name or category):
                query = self.database.supabase.table("message_templates").select("*")
                if name:
                    query = query.eq("name", name)
                elif category:
                    query = query.eq("category", category)
                query = query.is_("restaurant_id", "null").eq("is_active", True)

                response = await query.execute()
                if response.data:
                    return response.data[0]

            return None

        except Exception as e:
            logger.error(f"Failed to get template: {e}")
            return None

    async def update_template(
        self, template_id: str, updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update template (creates new version)"""
        try:
            # Get current template
            current = await self.get_template(template_id=template_id)
            if not current:
                raise ValueError(f"Template not found: {template_id}")

            # Increment version
            updates["version"] = current.get("version", 1) + 1
            updates["updated_at"] = datetime.utcnow().isoformat()

            # Validate if body changed
            if "body" in updates:
                validation = self.template_engine.validate_template(
                    updates["body"], updates.get("variables", current.get("variables"))
                )
                if not validation["valid"]:
                    raise ValueError(f"Invalid template: {validation['errors']}")

            response = (
                await self.database.supabase.table("message_templates")
                .update(updates)
                .eq("id", template_id)
                .execute()
            )

            logger.info(
                f"Updated template: {template_id} (version {updates['version']})"
            )
            return response.data[0] if response.data else {}

        except Exception as e:
            logger.error(f"Failed to update template: {e}")
            raise

    async def delete_template(self, template_id: str) -> bool:
        """Soft delete template (set is_active = false)"""
        try:
            await self.database.supabase.table("message_templates").update(
                {"is_active": False, "deleted_at": datetime.utcnow().isoformat()}
            ).eq("id", template_id).execute()

            logger.info(f"Deleted template: {template_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete template: {e}")
            return False

    async def list_templates(
        self,
        category: Optional[str] = None,
        restaurant_id: Optional[str] = None,
        include_global: bool = True,
    ) -> List[Dict[str, Any]]:
        """List all templates"""
        try:
            query = self.database.supabase.table("message_templates").select("*")

            if category:
                query = query.eq("category", category)

            if restaurant_id:
                if include_global:
                    # Get both restaurant-specific and global
                    query = query.or_(
                        f"restaurant_id.eq.{restaurant_id},restaurant_id.is.null"
                    )
                else:
                    query = query.eq("restaurant_id", restaurant_id)
            elif not include_global:
                query = query.is_("restaurant_id", "null")

            query = query.eq("is_active", True).order("created_at", desc=True)

            response = await query.execute()
            return response.data or []

        except Exception as e:
            logger.error(f"Failed to list templates: {e}")
            return []

    async def render_template(
        self,
        template_id: str,
        variables: Dict[str, Any],
        restaurant_id: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Render template with variables

        Returns:
            Dict with rendered 'subject' and 'body'
        """
        try:
            # Get template
            template = await self.get_template(
                template_id=template_id, restaurant_id=restaurant_id
            )
            if not template:
                raise ValueError(f"Template not found: {template_id}")

            # Render subject
            rendered_subject = None
            if template.get("subject"):
                rendered_subject = self.template_engine.render(
                    template["subject"], variables, strict=False
                )

            # Render body
            rendered_body = self.template_engine.render(
                template["body"], variables, strict=False
            )

            return {
                "subject": rendered_subject,
                "body": rendered_body,
                "template_id": template_id,
                "template_name": template.get("name"),
                "category": template.get("category"),
            }

        except Exception as e:
            logger.error(f"Failed to render template: {e}")
            raise

    async def preview_template(
        self, template_body: str, sample_variables: Dict[str, Any]
    ) -> str:
        """Preview template with sample data"""
        return self.template_engine.render(
            template_body, sample_variables, strict=False
        )
