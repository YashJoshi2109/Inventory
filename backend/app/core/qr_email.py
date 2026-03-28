"""
QR Code generation and email delivery for items and locations.
"""
import base64
import io
import logging
from typing import Any

from app.core.notifications import _send_email_with_detail
from app.services.barcode_service import render_qr_png

log = logging.getLogger(__name__)


async def send_qr_code_email(
    to_email: str,
    item_name: str,
    sku: str,
    qr_value: str,
    recipient_name: str = "User",
) -> tuple[bool, str]:
    """
    Send QR code image via email as an attachment.
    
    Args:
        to_email: Recipient email address
        item_name: Name of the item
        sku: SKU of the item
        qr_value: Value to encode in QR (usually barcode/SKU)
        recipient_name: Name of the recipient
    
    Returns:
        Tuple of (success, message)
    """
    if not to_email:
        return False, "No recipient email provided"

    try:
        # Generate QR code PNG
        qr_png = render_qr_png(qr_value)
        qr_base64 = base64.b64encode(qr_png).decode("utf-8")

        subject = f"[SEAR Lab Inventory] QR Code for {item_name}"

        # Premium HTML with embedded QR code
        html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0891b2 0%, #06b6d4 100%); border-radius: 12px 12px 0 0; padding: 40px 20px; text-align: center;">
                <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">SEAR Lab Inventory</h1>
                <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">QR Code</p>
            </div>
            <div style="background: #f8f9fa; border-radius: 0 0 12px 12px; padding: 40px 20px; text-align: center;">
                <p style="margin: 0 0 20px 0; color: #1f2937; font-size: 16px;">
                    Hi <b>{recipient_name}</b>,
                </p>
                <p style="margin: 0 0 30px 0; color: #4b5563; font-size: 14px;">
                    Here's the QR code for your item:
                </p>
                
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 24px; margin: 0 0 20px 0; display: inline-block;">
                    <img src="data:image/png;base64,{qr_base64}" alt="QR Code" style="width: 300px; height: 300px; display: block;" />
                </div>
                
                <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 0 0 20px 0; text-align: left;">
                    <p style="margin: 0 0 8px 0; color: #4b5563; font-size: 13px;"><b>Item Details:</b></p>
                    <p style="margin: 0; color: #6b7280; font-size: 12px;">
                        <b>Name:</b> {item_name}<br/>
                        <b>SKU:</b> {sku}
                    </p>
                </div>
                
                <p style="margin: 0 0 10px 0; color: #9ca3af; font-size: 12px;">
                    Use this QR code to scan items in the inventory system.
                </p>
                
                <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
                    <p style="margin: 0; color: #6b7280; font-size: 12px;">
                        Questions? Contact your lab administrator.
                    </p>
                </div>
            </div>
        </div>
        """

        text = f"QR Code for {item_name} (SKU: {sku}). Scan this QR code to manage inventory."

        # Prepare attachment (Resend format)
        attachments_resend = [
            {
                "filename": f"{sku}-qr.png",
                "content": qr_base64,
            }
        ]

        ok, detail = await _send_email_with_detail(
            to_emails=[to_email],
            subject=subject,
            html=html,
            text=text,
            attachments_resend=attachments_resend,
            prefer_resend=True,
        )

        if ok:
            log.info(f"QR code email sent for SKU: {sku} to {to_email}")
            return True, "QR code email sent successfully"
        else:
            log.warning(f"QR code email failed for SKU: {sku}: {detail}")
            return False, detail

    except Exception as e:
        log.error(f"Error sending QR code email: {e}")
        return False, f"Failed to send QR code: {str(e)}"
