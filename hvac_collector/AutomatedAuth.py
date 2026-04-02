#!/usr/bin/env python3
"""
Automated Enphase OAuth Token Manager
Handles the entire OAuth flow automatically without manual code entry
- Starts local HTTP server to capture callback
- Opens browser for user authorization
- Exchanges code for tokens automatically
- Stores refresh token for future use
"""

import webbrowser
import requests
import base64
import json
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime
import threading

# ============================================================================
# CONFIGURATION
# ============================================================================

CLIENT_ID = os.getenv("SOLAR_CLIENT_ID")
CLIENT_SECRET = os.getenv("SOLAR_CLIENT_SECRET")
CALLBACK_PORT = int(os.getenv("SOLAR_CALLBACK_PORT", "8090"))
REDIRECT_URI = f"http://localhost:{CALLBACK_PORT}/callback"
TOKEN_FILE = "enphase_tokens.json"

# Global variables for callback handling
authorization_code = None
server_ready = False

# ============================================================================
# HTTP CALLBACK HANDLER
# ============================================================================

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global authorization_code
        
        # Parse the query string
        parsed_url = urlparse(self.path)
        query_params = parse_qs(parsed_url.query)
        
        # Extract authorization code
        if 'code' in query_params:
            authorization_code = query_params['code'][0]
            
            # Send success response
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            
            html = """
            <html>
                <head><title>Authorization Successful</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>✓ Authorization Successful!</h1>
                    <p>Your Enphase system has been authorized.</p>
                    <p>You can close this window and return to the terminal.</p>
                </body>
            </html>
            """
            self.wfile.write(html.encode())
            
            print("\n✓ Authorization code received successfully!")
            
        elif 'error' in query_params:
            error = query_params['error'][0]
            error_description = query_params.get('error_description', [''])[0]
            
            # Send error response
            self.send_response(400)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            
            html = f"""
            <html>
                <head><title>Authorization Failed</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px; color: red;">
                    <h1>✗ Authorization Failed</h1>
                    <p><strong>Error:</strong> {error}</p>
                    <p><strong>Description:</strong> {error_description}</p>
                </body>
            </html>
            """
            self.wfile.write(html.encode())
            
            print(f"\n✗ Authorization error: {error}")
            print(f"  Description: {error_description}")
        
        else:
            self.send_response(400)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"Invalid callback")
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass

# ============================================================================
# OAUTH FUNCTIONS
# ============================================================================

def start_callback_server():
    """Start local HTTP server to listen for OAuth callback"""
    global server_ready
    
    print(f"[SERVER] Starting local HTTP server on localhost:{CALLBACK_PORT}...")
    
    server = HTTPServer(("localhost", CALLBACK_PORT), OAuthCallbackHandler)
    server_ready = True
    
    # Run server in background thread
    def run_server():
        server.handle_request()  # Handle one request then stop
        server.server_close()
    
    thread = threading.Thread(target=run_server, daemon=True)
    thread.start()
    
    return thread

def get_authorization_url():
    """Generate OAuth authorization URL"""
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "read write"
    }
    
    from urllib.parse import urlencode
    auth_url = f"https://api.enphaseenergy.com/oauth/authorize?{urlencode(params)}"
    return auth_url

def open_browser_for_auth(auth_url):
    """Open default browser for user authorization"""
    print("[BROWSER] Opening authorization page...")
    print(f"[URL] {auth_url}\n")
    
    try:
        webbrowser.open(auth_url)
        print("✓ Browser opened. Please authorize in the window that appeared.")
    except Exception as e:
        print(f"⚠ Could not open browser automatically: {e}")
        print(f"Please manually visit: {auth_url}")

def exchange_code_for_tokens(code):
    """Exchange authorization code for access and refresh tokens"""
    print("\n[TOKEN] Exchanging authorization code for tokens...")
    
    credentials = f"{CLIENT_ID}:{CLIENT_SECRET}"
    encoded_credentials = base64.b64encode(credentials.encode()).decode()
    
    headers = {
        'Authorization': f'Basic {encoded_credentials}',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': REDIRECT_URI
    }
    
    try:
        response = requests.post(
            "https://api.enphaseenergy.com/oauth/token",
            headers=headers,
            data=data,
            timeout=10
        )
        
        if response.status_code == 200:
            tokens = response.json()
            print("✓ Tokens obtained successfully!")
            return tokens
        else:
            print(f"✗ Error: {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
    except Exception as e:
        print(f"✗ Error: {e}")
        return None

def save_tokens(tokens):
    """Save tokens to file for future use"""
    token_data = {
        'access_token': tokens.get('access_token'),
        'refresh_token': tokens.get('refresh_token'),
        'expires_in': tokens.get('expires_in'),
        'token_type': tokens.get('token_type'),
        'saved_at': datetime.now().isoformat()
    }
    
    with open(TOKEN_FILE, 'w') as f:
        json.dump(token_data, f, indent=2)
    
    print(f"✓ Tokens saved to {TOKEN_FILE}")
    return token_data

def load_tokens():
    """Load tokens from file if they exist"""
    if os.path.isfile(TOKEN_FILE):
        try:
            with open(TOKEN_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠ Error loading tokens: {e}")
    return None

def is_token_valid(token_data):
    """Check if token is still valid (simple check based on saved time)"""
    if not token_data or 'saved_at' not in token_data:
        return False
    
    from datetime import datetime, timedelta
    saved_time = datetime.fromisoformat(token_data['saved_at'])
    expires_in = token_data.get('expires_in', 0)
    expiry_time = saved_time + timedelta(seconds=expires_in)
    
    return datetime.now() < expiry_time

# ============================================================================
# MAIN AUTOMATION FLOW
# ============================================================================

def automated_auth():
    """Automated OAuth authentication flow"""
    
    print("=" * 70)
    print("AUTOMATED ENPHASE OAUTH AUTHENTICATION")
    print("=" * 70)
    print()
    
    # Step 1: Check if valid tokens already exist
    print("[STEP 1] Checking for existing tokens...")
    existing_tokens = load_tokens()
    
    if existing_tokens and is_token_valid(existing_tokens):
        print("✓ Valid token found!")
        print(f"  Refresh Token: {existing_tokens['refresh_token'][:50]}...")
        print(f"  Valid until: {existing_tokens['saved_at']}")
        return existing_tokens
    
    if existing_tokens:
        print("⚠ Token found but expired")
    else:
        print("No existing tokens found")
    
    # Step 2: Start local server to capture callback
    print("\n[STEP 2] Starting authorization server...")
    server_thread = start_callback_server()
    
    # Wait for server to be ready
    import time
    time.sleep(1)
    
    # Step 3: Get authorization URL
    print("[STEP 3] Generating authorization URL...")
    auth_url = get_authorization_url()
    
    # Step 4: Open browser for user to authorize
    print("[STEP 4] Opening browser for authorization...")
    open_browser_for_auth(auth_url)
    
    # Step 5: Wait for callback
    print("\n[STEP 5] Waiting for authorization...")
    print("         (This may take up to 60 seconds...)")
    
    server_thread.join(timeout=120)
    
    global authorization_code
    
    if not authorization_code:
        print("\n✗ Authorization timed out or failed")
        return None
    
    # Step 6: Exchange code for tokens
    print(f"\n[STEP 6] Authorization code received: {authorization_code[:20]}...")
    tokens = exchange_code_for_tokens(authorization_code)
    
    if not tokens:
        print("✗ Failed to obtain tokens")
        return None
    
    # Step 7: Save tokens
    print("\n[STEP 7] Saving tokens...")
    token_data = save_tokens(tokens)
    
    # Step 8: Display summary
    print("\n" + "=" * 70)
    print("✓ AUTHENTICATION COMPLETE")
    print("=" * 70)
    print(f"\nRefresh Token (valid for ~1 year):")
    print(f"  {token_data['refresh_token'][:50]}...")
    print(f"\nAccess Token (valid for ~24 hours):")
    print(f"  {token_data['access_token'][:50]}...")
    print(f"\nTokens saved to: {TOKEN_FILE}")
    print("\nYou can now run EnergyDataCollector.py to start collecting data!")
    print("=" * 70)
    
    return token_data

# ============================================================================
# CLI INTERFACE
# ============================================================================

def main():
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "refresh":
            print("Force refreshing tokens...")
            if os.path.isfile(TOKEN_FILE):
                os.remove(TOKEN_FILE)
            automated_auth()
        elif sys.argv[1] == "show":
            print("Current tokens:")
            tokens = load_tokens()
            if tokens:
                print(json.dumps(tokens, indent=2))
            else:
                print("No tokens found")
        else:
            print("Usage: python AutomatedAuth.py [refresh|show]")
    else:
        automated_auth()

if __name__ == "__main__":
    main()
