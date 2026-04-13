"""
Communication Templates API Endpoints

Provides REST API for managing provider communication templates
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from pydantic import BaseModel, Field

from services.template_engine import MessageTemplateManager
from core.database import get_db_connection

router = APIRouter(prefix="/api/templates", tags=["templates"])


# =============================================================================
# MODELS
# =============================================================================

class TemplateCreate(BaseModel):
    """Template creation model"""
    name: str = Field(..., description="Unique template name")
    category: str = Field(..., description="Category: order, inquiry, confirmation, follow_up")
    subject: Optional[str] = Field(None, description="Email subject (optional for SMS)")
    body: str = Field(..., description="Template body with {variables}")
    variables: List[str] = Field(..., description="List of required variable names")
    restaurant_id: Optional[str] = Field(None, description="Restaurant ID (null for global)")
    language: str = Field(default="en", description="Language code")
    is_active: bool = Field(default=True)


class TemplateUpdate(BaseModel):
    """Template update model"""
    name: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    variables: Optional[List[str]] = None
    is_active: Optional[bool] = None


class TemplateRender(BaseModel):
    """Template render request"""
    template_id: str
    variables: dict
    restaurant_id: Optional[str] = None


class TemplatePreview(BaseModel):
    """Template preview request"""
    body: str
    sample_variables: dict


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/", status_code=201)
async def create_template(template: TemplateCreate):
    """Create a new message template"""
    try:
        db = await get_db_connection()
        manager = MessageTemplateManager(db)
        
        result = await manager.create_template(
            name=template.name,
            category=template.category,
            subject=template.subject,
            body=template.body,
            variables=template.variables,
            restaurant_id=template.restaurant_id,
            language=template.language,
            is_active=template.is_active
        )
        
        return {"success": True, "template": result}
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create template: {str(e)}")


@router.get("/")
async def list_templates(
    category: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    include_global: bool = True
):
    """List all templates"""
    try:
        db = await get_db_connection()
        manager = MessageTemplateManager(db)
        
        templates = await manager.list_templates(
            category=category,
            restaurant_id=restaurant_id,
            include_global=include_global
        )
        
        return {"success": True, "templates": templates, "count": len(templates)}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list templates: {str(e)}")


@router.get("/{template_id}")
async def get_template(template_id: str):
    """Get template by ID"""
    try:
        db = await get_db_connection()
        manager = MessageTemplateManager(db)
        
        template = await manager.get_template(template_id=template_id)
        
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        
        return {"success": True, "template": template}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get template: {str(e)}")


@router.put("/{template_id}")
async def update_template(template_id: str, updates: TemplateUpdate):
    """Update template"""
    try:
        db = await get_db_connection()
        manager = MessageTemplateManager(db)
        
        # Convert to dict, excluding None values
        update_data = {k: v for k, v in updates.dict().items() if v is not None}
        
        result = await manager.update_template(template_id, update_data)
        
        return {"success": True, "template": result}
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update template: {str(e)}")


@router.delete("/{template_id}")
async def delete_template(template_id: str):
    """Delete template (soft delete)"""
    try:
        db = await get_db_connection()
        manager = MessageTemplateManager(db)
        
        success = await manager.delete_template(template_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Template not found")
        
        return {"success": True, "message": "Template deleted"}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete template: {str(e)}")


@router.post("/render")
async def render_template(request: TemplateRender):
    """Render template with variables"""
    try:
        db = await get_db_connection()
        manager = MessageTemplateManager(db)
        
        result = await manager.render_template(
            template_id=request.template_id,
            variables=request.variables,
            restaurant_id=request.restaurant_id
        )
        
        return {"success": True, "rendered": result}
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render template: {str(e)}")


@router.post("/preview")
async def preview_template(request: TemplatePreview):
    """Preview template with sample data"""
    try:
        db = await get_db_connection()
        manager = MessageTemplateManager(db)
        
        rendered = await manager.preview_template(
            template_body=request.body,
            sample_variables=request.sample_variables
        )
        
        return {"success": True, "preview": rendered}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview template: {str(e)}")


@router.get("/categories/list")
async def list_categories():
    """List available template categories"""
    categories = [
        {
            "id": "order",
            "name": "Order Request",
            "description": "Templates for placing orders with providers"
        },
        {
            "id": "inquiry",
            "name": "Product Inquiry",
            "description": "Templates for inquiring about products, availability, pricing"
        },
        {
            "id": "confirmation",
            "name": "Order Confirmation",
            "description": "Templates for confirming received orders"
        },
        {
            "id": "follow_up",
            "name": "Follow-up",
            "description": "Templates for following up on pending orders or inquiries"
        },
        {
            "id": "complaint",
            "name": "Complaint/Issue",
            "description": "Templates for reporting issues or complaints"
        },
        {
            "id": "thank_you",
            "name": "Thank You",
            "description": "Templates for expressing gratitude"
        }
    ]
    
    return {"success": True, "categories": categories}


@router.get("/variables/common")
async def list_common_variables():
    """List commonly used variables"""
    variables = [
        {"name": "provider_name", "description": "Provider/Company name", "example": "Premium Wines Co"},
        {"name": "contact_name", "description": "Contact person name", "example": "John Smith"},
        {"name": "restaurant_name", "description": "Your restaurant name", "example": "La Maison"},
        {"name": "manager_name", "description": "Manager name", "example": "Jane Doe"},
        {"name": "wine_name", "description": "Wine name", "example": "Château Lafite Rothschild 2018"},
        {"name": "quantity", "description": "Order quantity", "example": "12"},
        {"name": "price", "description": "Price per unit", "example": "450.00"},
        {"name": "total_cost", "description": "Total order cost", "example": "5400.00"},
        {"name": "delivery_date", "description": "Expected delivery date", "example": "January 15, 2026"},
        {"name": "order_number", "description": "Order reference number", "example": "ORD-12345"},
        {"name": "last_price", "description": "Last price paid", "example": "425.00"},
        {"name": "phone", "description": "Phone number", "example": "+1 (415) 555-1234"},
        {"name": "email", "description": "Email address", "example": "contact@provider.com"},
        {"name": "notes", "description": "Additional notes", "example": "Please deliver before 2pm"}
    ]
    
    return {"success": True, "variables": variables}

