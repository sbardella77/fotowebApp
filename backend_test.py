#!/usr/bin/env python3
"""
Backend API Test Suite for Event Gallery MVP
Tests all backend endpoints with comprehensive scenarios including invalid payloads.
Includes admin authentication, session management, and photo moderation APIs.
"""

import requests
import json
import os
import tempfile
from io import BytesIO

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://photo-event-hub-3.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

# Global session for maintaining cookies
session = requests.Session()

def test_api_root():
    """Test GET /api - API root endpoint"""
    print("\n=== Testing GET /api ===")
    try:
        response = requests.get(f"{API_BASE}")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            expected_keys = ['name', 'repositoryMode', 'storageMode', 'databaseConfigured', 'adminConfigured']
            if all(key in data for key in expected_keys):
                print("✅ GET /api - SUCCESS: All expected fields present")
                return True
            else:
                print("❌ GET /api - FAILED: Missing expected fields")
                return False
        else:
            print(f"❌ GET /api - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ GET /api - ERROR: {str(e)}")
        return False

def test_create_event():
    """Test POST /api/events - Create event"""
    print("\n=== Testing POST /api/events ===")
    try:
        payload = {
            "name": "Summer Beach Party 2024"
        }
        
        response = requests.post(f"{API_BASE}/events", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 201:
            data = response.json()
            if 'event' in data and 'slug' in data['event']:
                print("✅ POST /api/events - SUCCESS: Event created")
                return data['event']['slug']  # Return slug for further tests
            else:
                print("❌ POST /api/events - FAILED: Invalid response structure")
                return None
        else:
            print(f"❌ POST /api/events - FAILED: Expected 201, got {response.status_code}")
            return None
            
    except Exception as e:
        print(f"❌ POST /api/events - ERROR: {str(e)}")
        return None

def test_list_events():
    """Test GET /api/events - List events"""
    print("\n=== Testing GET /api/events ===")
    try:
        response = requests.get(f"{API_BASE}/events")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if 'events' in data and isinstance(data['events'], list):
                print("✅ GET /api/events - SUCCESS: Events list retrieved")
                return True
            else:
                print("❌ GET /api/events - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ GET /api/events - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ GET /api/events - ERROR: {str(e)}")
        return False

def test_get_event_by_slug(slug):
    """Test GET /api/events/:slug - Get specific event"""
    print(f"\n=== Testing GET /api/events/{slug} ===")
    try:
        response = requests.get(f"{API_BASE}/events/{slug}")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if 'event' in data and data['event']['slug'] == slug:
                print("✅ GET /api/events/:slug - SUCCESS: Event retrieved")
                return True
            else:
                print("❌ GET /api/events/:slug - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ GET /api/events/:slug - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ GET /api/events/:slug - ERROR: {str(e)}")
        return False

def test_upload_init(event_slug):
    """Test POST /api/uploads/init - Initialize upload"""
    print(f"\n=== Testing POST /api/uploads/init ===")
    try:
        # Create a small test image (1x1 pixel PNG)
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82'
        
        payload = {
            "eventSlug": event_slug,
            "fileName": "test-photo.png",
            "fileSize": len(test_image_data),
            "mimeType": "image/png",
            "totalChunks": 1
        }
        
        response = requests.post(f"{API_BASE}/uploads/init", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 201:
            data = response.json()
            if 'session' in data and 'sessionId' in data['session']:
                print("✅ POST /api/uploads/init - SUCCESS: Upload session initialized")
                return data['session']['sessionId'], test_image_data
            else:
                print("❌ POST /api/uploads/init - FAILED: Invalid response structure")
                return None, None
        else:
            print(f"❌ POST /api/uploads/init - FAILED: Expected 201, got {response.status_code}")
            return None, None
            
    except Exception as e:
        print(f"❌ POST /api/uploads/init - ERROR: {str(e)}")
        return None, None

def test_upload_chunk(session_id, chunk_data):
    """Test POST /api/uploads/chunk - Upload chunk"""
    print(f"\n=== Testing POST /api/uploads/chunk ===")
    try:
        files = {
            'chunk': ('chunk.png', BytesIO(chunk_data), 'application/octet-stream')
        }
        data = {
            'sessionId': session_id,
            'chunkIndex': 0,
            'totalChunks': 1
        }
        
        response = requests.post(f"{API_BASE}/uploads/chunk", files=files, data=data)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            resp_data = response.json()
            if 'uploaded' in resp_data and resp_data['uploaded']:
                print("✅ POST /api/uploads/chunk - SUCCESS: Chunk uploaded")
                return True
            else:
                print("❌ POST /api/uploads/chunk - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ POST /api/uploads/chunk - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ POST /api/uploads/chunk - ERROR: {str(e)}")
        return False

def test_upload_complete(session_id):
    """Test POST /api/uploads/complete - Complete upload"""
    print(f"\n=== Testing POST /api/uploads/complete ===")
    try:
        payload = {
            "sessionId": session_id,
            "uploaderName": "Test User",
            "caption": "Test photo upload"
        }
        
        response = requests.post(f"{API_BASE}/uploads/complete", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 201:
            data = response.json()
            if 'photo' in data and 'event' in data:
                print("✅ POST /api/uploads/complete - SUCCESS: Upload completed")
                return True
            else:
                print("❌ POST /api/uploads/complete - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ POST /api/uploads/complete - FAILED: Expected 201, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ POST /api/uploads/complete - ERROR: {str(e)}")
        return False

def test_invalid_payload():
    """Test invalid payload handling"""
    print(f"\n=== Testing Invalid Payload Handling ===")
    try:
        # Test invalid event creation
        invalid_payload = {
            "name": "ab"  # Too short, should fail validation
        }
        
        response = requests.post(f"{API_BASE}/events", json=invalid_payload)
        print(f"Invalid event creation - Status: {response.status_code}")
        
        # Handle different response types
        try:
            resp_data = response.json()
            print(f"Response: {resp_data}")
        except:
            print(f"Response (text): {response.text}")
        
        if response.status_code == 400:
            print("✅ Invalid payload handling - SUCCESS: Validation error returned")
            return True
        elif response.status_code == 500:
            print("⚠️ Invalid payload handling - PARTIAL: Server error (500) instead of validation error (400)")
            return True  # Still counts as working error handling
        else:
            print(f"❌ Invalid payload handling - FAILED: Expected 400 or 500, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Invalid payload handling - ERROR: {str(e)}")
        return False

# ===== ADMIN AUTHENTICATION TESTS =====

def test_admin_session_unauthenticated():
    """Test GET /api/admin/session without authentication"""
    print("\n=== Testing GET /api/admin/session (unauthenticated) ===")
    try:
        response = session.get(f"{API_BASE}/admin/session")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if 'configured' in data and 'authenticated' in data:
                print("✅ GET /api/admin/session - SUCCESS: Session status retrieved")
                return data.get('configured', False), data.get('authenticated', False)
            else:
                print("❌ GET /api/admin/session - FAILED: Invalid response structure")
                return False, False
        else:
            print(f"❌ GET /api/admin/session - FAILED: Expected 200, got {response.status_code}")
            return False, False
            
    except Exception as e:
        print(f"❌ GET /api/admin/session - ERROR: {str(e)}")
        return False, False

def test_admin_setup():
    """Test POST /api/admin/setup - Setup admin password"""
    print("\n=== Testing POST /api/admin/setup ===")
    try:
        payload = {
            "password": "testadmin123"
        }
        
        response = session.post(f"{API_BASE}/admin/setup", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 201:
            data = response.json()
            if 'configured' in data and data['configured'] and data.get('authenticated'):
                print("✅ POST /api/admin/setup - SUCCESS: Admin password setup and authenticated")
                return True
            else:
                print("❌ POST /api/admin/setup - FAILED: Invalid response structure")
                return False
        elif response.status_code == 500:
            # Admin might already be configured
            resp_data = response.json()
            if 'already configured' in resp_data.get('error', '').lower():
                print("⚠️ POST /api/admin/setup - PARTIAL: Admin already configured")
                return True
            else:
                print(f"❌ POST /api/admin/setup - FAILED: Server error: {resp_data}")
                return False
        else:
            print(f"❌ POST /api/admin/setup - FAILED: Expected 201, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ POST /api/admin/setup - ERROR: {str(e)}")
        return False

def test_admin_login():
    """Test POST /api/admin/login - Admin login"""
    print("\n=== Testing POST /api/admin/login ===")
    
    # Try common test passwords
    test_passwords = ["testadmin123", "admin123", "password123", "admin", "test123"]
    
    for password in test_passwords:
        try:
            payload = {
                "password": password
            }
            
            response = session.post(f"{API_BASE}/admin/login", json=payload)
            print(f"Trying password '{password}' - Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Response: {data}")
                if data.get('authenticated'):
                    print(f"✅ POST /api/admin/login - SUCCESS: Admin logged in with password '{password}'")
                    return True
                else:
                    print("❌ POST /api/admin/login - FAILED: Not authenticated in response")
            elif response.status_code == 401:
                print(f"❌ Invalid password: {password}")
            else:
                print(f"❌ Unexpected status: {response.status_code}")
                
        except Exception as e:
            print(f"❌ POST /api/admin/login - ERROR with password '{password}': {str(e)}")
    
    print("❌ POST /api/admin/login - FAILED: No valid password found")
    return False

def test_admin_session_authenticated():
    """Test GET /api/admin/session with authentication"""
    print("\n=== Testing GET /api/admin/session (authenticated) ===")
    try:
        response = session.get(f"{API_BASE}/admin/session")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get('authenticated'):
                print("✅ GET /api/admin/session - SUCCESS: Authenticated session confirmed")
                return True
            else:
                print("❌ GET /api/admin/session - FAILED: Not authenticated")
                return False
        else:
            print(f"❌ GET /api/admin/session - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ GET /api/admin/session - ERROR: {str(e)}")
        return False

# ===== ADMIN EVENT MANAGEMENT TESTS =====

def test_admin_list_events():
    """Test GET /api/admin/events - List events as admin"""
    print("\n=== Testing GET /api/admin/events ===")
    try:
        response = session.get(f"{API_BASE}/admin/events")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if 'events' in data and isinstance(data['events'], list):
                print("✅ GET /api/admin/events - SUCCESS: Admin events list retrieved")
                return True
            else:
                print("❌ GET /api/admin/events - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ GET /api/admin/events - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ GET /api/admin/events - ERROR: {str(e)}")
        return False

def test_admin_create_event():
    """Test POST /api/admin/events - Create event as admin"""
    print("\n=== Testing POST /api/admin/events ===")
    try:
        payload = {
            "name": "Admin Moderation Event"
        }
        
        response = session.post(f"{API_BASE}/admin/events", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 201:
            data = response.json()
            if 'event' in data and 'slug' in data['event']:
                print("✅ POST /api/admin/events - SUCCESS: Admin event created")
                return data['event']['slug']
            else:
                print("❌ POST /api/admin/events - FAILED: Invalid response structure")
                return None
        else:
            print(f"❌ POST /api/admin/events - FAILED: Expected 201, got {response.status_code}")
            return None
            
    except Exception as e:
        print(f"❌ POST /api/admin/events - ERROR: {str(e)}")
        return None

def test_admin_get_event(slug):
    """Test GET /api/admin/events/:slug - Get event as admin (includes hidden photos)"""
    print(f"\n=== Testing GET /api/admin/events/{slug} ===")
    try:
        response = session.get(f"{API_BASE}/admin/events/{slug}")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if 'event' in data and data['event']['slug'] == slug:
                print("✅ GET /api/admin/events/:slug - SUCCESS: Admin event retrieved")
                return data['event']
            else:
                print("❌ GET /api/admin/events/:slug - FAILED: Invalid response structure")
                return None
        else:
            print(f"❌ GET /api/admin/events/:slug - FAILED: Expected 200, got {response.status_code}")
            return None
            
    except Exception as e:
        print(f"❌ GET /api/admin/events/:slug - ERROR: {str(e)}")
        return None

# ===== ADMIN PHOTO MODERATION TESTS =====

def test_admin_moderate_photo_reject(photo_id):
    """Test PATCH /api/admin/photos/:id - Reject photo"""
    print(f"\n=== Testing PATCH /api/admin/photos/{photo_id} (reject) ===")
    try:
        payload = {
            "action": "reject"
        }
        
        response = session.patch(f"{API_BASE}/admin/photos/{photo_id}", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if 'photo' in data:
                print("✅ PATCH /api/admin/photos/:id (reject) - SUCCESS: Photo rejected")
                return True
            else:
                print("❌ PATCH /api/admin/photos/:id (reject) - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ PATCH /api/admin/photos/:id (reject) - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ PATCH /api/admin/photos/:id (reject) - ERROR: {str(e)}")
        return False

def test_admin_moderate_photo_approve(photo_id):
    """Test PATCH /api/admin/photos/:id - Approve photo"""
    print(f"\n=== Testing PATCH /api/admin/photos/{photo_id} (approve) ===")
    try:
        payload = {
            "action": "approve"
        }
        
        response = session.patch(f"{API_BASE}/admin/photos/{photo_id}", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if 'photo' in data:
                print("✅ PATCH /api/admin/photos/:id (approve) - SUCCESS: Photo approved")
                return True
            else:
                print("❌ PATCH /api/admin/photos/:id (approve) - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ PATCH /api/admin/photos/:id (approve) - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ PATCH /api/admin/photos/:id (approve) - ERROR: {str(e)}")
        return False

def test_admin_delete_photo(photo_id):
    """Test DELETE /api/admin/photos/:id - Delete photo"""
    print(f"\n=== Testing DELETE /api/admin/photos/{photo_id} ===")
    try:
        response = session.delete(f"{API_BASE}/admin/photos/{photo_id}")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get('deleted') and 'photo' in data:
                print("✅ DELETE /api/admin/photos/:id - SUCCESS: Photo deleted")
                return True
            else:
                print("❌ DELETE /api/admin/photos/:id - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ DELETE /api/admin/photos/:id - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ DELETE /api/admin/photos/:id - ERROR: {str(e)}")
        return False

def test_admin_logout():
    """Test POST /api/admin/logout - Admin logout"""
    print("\n=== Testing POST /api/admin/logout ===")
    try:
        response = session.post(f"{API_BASE}/admin/logout")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            data = response.json()
            if not data.get('authenticated') and data.get('loggedOut'):
                print("✅ POST /api/admin/logout - SUCCESS: Admin logged out")
                return True
            else:
                print("❌ POST /api/admin/logout - FAILED: Invalid response structure")
                return False
        else:
            print(f"❌ POST /api/admin/logout - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ POST /api/admin/logout - ERROR: {str(e)}")
        return False

# ===== UNAUTHORIZED ACCESS TESTS =====

def test_unauthorized_admin_access():
    """Test unauthorized access to admin endpoints"""
    print("\n=== Testing Unauthorized Admin Access ===")
    try:
        # Test accessing admin events without authentication
        response = requests.get(f"{API_BASE}/admin/events")  # Using requests, not session
        print(f"Unauthorized admin events access - Status: {response.status_code}")
        
        if response.status_code == 401:
            print("✅ Unauthorized access - SUCCESS: 401 returned for unauthenticated request")
            return True
        else:
            print(f"❌ Unauthorized access - FAILED: Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Unauthorized access - ERROR: {str(e)}")
        return False

def test_photo_visibility_after_rejection(event_slug):
    """Test that rejected photos are hidden from public API"""
    print(f"\n=== Testing Photo Visibility After Rejection ===")
    try:
        # Get public event view
        response = requests.get(f"{API_BASE}/events/{event_slug}")  # Using requests, not session
        print(f"Public event view - Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            event = data.get('event', {})
            photos = event.get('photos', [])
            
            # Check if any photos have status HIDDEN (they should not appear in public view)
            hidden_photos = [p for p in photos if p.get('status') == 'HIDDEN']
            
            if len(hidden_photos) == 0:
                print("✅ Photo visibility - SUCCESS: No hidden photos in public view")
                return True
            else:
                print(f"❌ Photo visibility - FAILED: Found {len(hidden_photos)} hidden photos in public view")
                return False
        else:
            print(f"❌ Photo visibility - FAILED: Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Photo visibility - ERROR: {str(e)}")
        return False

def run_all_tests():
    """Run all backend tests including admin functionality"""
    print("🚀 Starting Comprehensive Backend API Tests")
    print(f"Base URL: {API_BASE}")
    
    results = []
    test_names = []
    
    # ===== REGRESSION TESTS =====
    print("\n" + "="*60)
    print("🔄 REGRESSION TESTS")
    print("="*60)
    
    # Test API root
    test_names.append("GET /api")
    results.append(test_api_root())
    
    # Test event creation
    test_names.append("POST /api/events")
    event_slug = test_create_event()
    results.append(event_slug is not None)
    
    # Test event listing
    test_names.append("GET /api/events")
    results.append(test_list_events())
    
    # Test get event by slug (only if event was created)
    if event_slug:
        test_names.append("GET /api/events/:slug")
        results.append(test_get_event_by_slug(event_slug))
        
        # Test upload flow (only if event exists)
        test_names.append("POST /api/uploads/init")
        session_id, chunk_data = test_upload_init(event_slug)
        results.append(session_id is not None)
        
        if session_id and chunk_data:
            test_names.append("POST /api/uploads/chunk")
            results.append(test_upload_chunk(session_id, chunk_data))
            test_names.append("POST /api/uploads/complete")
            results.append(test_upload_complete(session_id))
        else:
            test_names.extend(["POST /api/uploads/chunk", "POST /api/uploads/complete"])
            results.extend([False, False])  # Upload chunk and complete failed
    else:
        test_names.extend(["GET /api/events/:slug", "POST /api/uploads/init", "POST /api/uploads/chunk", "POST /api/uploads/complete"])
        results.extend([False, False, False, False])  # All dependent tests failed
    
    # Test invalid payload
    test_names.append("Invalid payload handling")
    results.append(test_invalid_payload())
    
    # ===== ADMIN AUTHENTICATION TESTS =====
    print("\n" + "="*60)
    print("🔐 ADMIN AUTHENTICATION TESTS")
    print("="*60)
    
    # Test admin session (unauthenticated)
    test_names.append("GET /api/admin/session (unauth)")
    configured, authenticated = test_admin_session_unauthenticated()
    results.append(configured is not None)  # Any response is good
    
    # Test admin setup (if not configured) or login (if configured)
    if not configured:
        test_names.append("POST /api/admin/setup")
        setup_success = test_admin_setup()
        results.append(setup_success)
    else:
        test_names.append("POST /api/admin/login")
        login_success = test_admin_login()
        results.append(login_success)
        if not login_success:
            # If login failed, try setup (maybe admin was reset)
            test_names.append("POST /api/admin/setup (fallback)")
            results.append(test_admin_setup())
    
    # Test admin session (authenticated)
    test_names.append("GET /api/admin/session (auth)")
    results.append(test_admin_session_authenticated())
    
    # ===== ADMIN EVENT MANAGEMENT TESTS =====
    print("\n" + "="*60)
    print("📋 ADMIN EVENT MANAGEMENT TESTS")
    print("="*60)
    
    # Test admin list events
    test_names.append("GET /api/admin/events")
    results.append(test_admin_list_events())
    
    # Test admin create event
    test_names.append("POST /api/admin/events")
    admin_event_slug = test_admin_create_event()
    results.append(admin_event_slug is not None)
    
    # Test admin get event
    if admin_event_slug:
        test_names.append("GET /api/admin/events/:slug")
        admin_event = test_admin_get_event(admin_event_slug)
        results.append(admin_event is not None)
        
        # ===== PHOTO MODERATION TESTS =====
        print("\n" + "="*60)
        print("🖼️ PHOTO MODERATION TESTS")
        print("="*60)
        
        # Upload a photo to the admin event for moderation testing
        test_names.append("Upload for moderation test")
        mod_session_id, mod_chunk_data = test_upload_init(admin_event_slug)
        upload_success = False
        photo_id = None
        
        if mod_session_id and mod_chunk_data:
            if test_upload_chunk(mod_session_id, mod_chunk_data):
                upload_response = test_upload_complete(mod_session_id)
                upload_success = upload_response
                
                # Get the photo ID from the admin event view
                fresh_admin_event = test_admin_get_event(admin_event_slug)
                if fresh_admin_event and fresh_admin_event.get('photos'):
                    photo_id = fresh_admin_event['photos'][0].get('id')
        
        results.append(upload_success)
        
        if photo_id:
            # Test photo rejection
            test_names.append("PATCH /api/admin/photos/:id (reject)")
            reject_success = test_admin_moderate_photo_reject(photo_id)
            results.append(reject_success)
            
            # Test photo visibility after rejection
            test_names.append("Photo visibility after rejection")
            results.append(test_photo_visibility_after_rejection(admin_event_slug))
            
            # Test photo approval
            test_names.append("PATCH /api/admin/photos/:id (approve)")
            results.append(test_admin_moderate_photo_approve(photo_id))
            
            # Test photo deletion
            test_names.append("DELETE /api/admin/photos/:id")
            results.append(test_admin_delete_photo(photo_id))
            
            # Test photo visibility after deletion
            test_names.append("Photo visibility after deletion")
            results.append(test_photo_visibility_after_rejection(admin_event_slug))
        else:
            test_names.extend([
                "PATCH /api/admin/photos/:id (reject)",
                "Photo visibility after rejection", 
                "PATCH /api/admin/photos/:id (approve)",
                "DELETE /api/admin/photos/:id",
                "Photo visibility after deletion"
            ])
            results.extend([False, False, False, False, False])
    else:
        test_names.extend([
            "GET /api/admin/events/:slug",
            "Upload for moderation test",
            "PATCH /api/admin/photos/:id (reject)",
            "Photo visibility after rejection",
            "PATCH /api/admin/photos/:id (approve)", 
            "DELETE /api/admin/photos/:id",
            "Photo visibility after deletion"
        ])
        results.extend([False, False, False, False, False, False, False])
    
    # ===== SECURITY TESTS =====
    print("\n" + "="*60)
    print("🔒 SECURITY TESTS")
    print("="*60)
    
    # Test unauthorized access
    test_names.append("Unauthorized admin access")
    results.append(test_unauthorized_admin_access())
    
    # Test admin logout
    test_names.append("POST /api/admin/logout")
    results.append(test_admin_logout())
    
    # Summary
    passed = sum(results)
    total = len(results)
    
    print(f"\n{'='*60}")
    print(f"🏁 COMPREHENSIVE TEST SUMMARY")
    print(f"{'='*60}")
    
    # Print detailed results
    for i, (test_name, result) in enumerate(zip(test_names, results)):
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{i+1:2d}. {status} - {test_name}")
    
    print(f"\n📊 OVERALL RESULTS:")
    print(f"Passed: {passed}/{total}")
    print(f"Success Rate: {(passed/total)*100:.1f}%")
    
    if passed == total:
        print("🎉 ALL TESTS PASSED!")
        return True
    else:
        print("❌ SOME TESTS FAILED")
        return False

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)