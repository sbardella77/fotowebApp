#!/usr/bin/env python3
"""
Backend API Regression Test Suite
Tests all backend APIs after Vercel-readiness adjustments
"""

import requests
import json
import os
import time
from io import BytesIO

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://photo-event-hub-3.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

# Test data
TEST_EVENT_DATA = {
    "name": "Summer Beach Party 2024",
    "description": "A fun beach party with friends and family"
}

TEST_ADMIN_PASSWORD = "strongpass123"  # Known dev password from test_result.md

# Session storage for admin auth
admin_session_cookies = None

def print_test_result(test_name, success, details=""):
    """Print formatted test results"""
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {test_name}")
    if details:
        print(f"    {details}")
    print()

def make_request(method, endpoint, data=None, files=None, cookies=None, headers=None):
    """Make HTTP request with error handling"""
    url = f"{API_BASE}{endpoint}"
    
    try:
        if method.upper() == 'GET':
            response = requests.get(url, cookies=cookies, headers=headers, timeout=30)
        elif method.upper() == 'POST':
            if files:
                response = requests.post(url, data=data, files=files, cookies=cookies, headers=headers, timeout=30)
            else:
                response = requests.post(url, json=data, cookies=cookies, headers=headers, timeout=30)
        elif method.upper() == 'PATCH':
            response = requests.patch(url, json=data, cookies=cookies, headers=headers, timeout=30)
        elif method.upper() == 'DELETE':
            response = requests.delete(url, cookies=cookies, headers=headers, timeout=30)
        else:
            raise ValueError(f"Unsupported method: {method}")
            
        return response
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return None

def test_api_metadata():
    """Test GET /api metadata endpoint"""
    print("🔍 Testing API Metadata...")
    
    try:
        response = make_request('GET', '')
        
        if not response:
            print_test_result("API Metadata", False, "Request failed")
            return False
            
        if response.status_code != 200:
            print_test_result("API Metadata", False, f"Status: {response.status_code}")
            return False
            
        data = response.json()
        
        # Verify expected fields
        expected_fields = ['name', 'repositoryMode', 'configuredDataAccessDriver', 'configuredAdminAuthDriver', 'databaseConfigured']
        missing_fields = [field for field in expected_fields if field not in data]
        
        if missing_fields:
            print_test_result("API Metadata", False, f"Missing fields: {missing_fields}")
            return False
            
        # Verify configuration matches environment
        if data.get('configuredDataAccessDriver') != 'prisma':
            print_test_result("API Metadata", False, f"Expected DATA_ACCESS_DRIVER=prisma, got {data.get('configuredDataAccessDriver')}")
            return False
            
        if data.get('configuredAdminAuthDriver') != 'local':
            print_test_result("API Metadata", False, f"Expected ADMIN_AUTH_DRIVER=local, got {data.get('configuredAdminAuthDriver')}")
            return False
            
        if not data.get('databaseConfigured'):
            print_test_result("API Metadata", False, "Database should be configured")
            return False
            
        print_test_result("API Metadata", True, f"Repository: {data.get('repositoryMode')}, DB: {data.get('databaseConfigured')}")
        return True
        
    except Exception as e:
        print_test_result("API Metadata", False, f"Exception: {str(e)}")
        return False

def test_event_creation():
    """Test POST /api/events"""
    print("🔍 Testing Event Creation...")
    
    try:
        response = make_request('POST', '/events', TEST_EVENT_DATA)
        
        if not response:
            print_test_result("Event Creation", False, "Request failed")
            return None
            
        if response.status_code != 201:
            print_test_result("Event Creation", False, f"Status: {response.status_code}, Response: {response.text}")
            return None
            
        data = response.json()
        
        if 'event' not in data:
            print_test_result("Event Creation", False, "No event in response")
            return None
            
        event = data['event']
        required_fields = ['id', 'name', 'slug', 'createdAt']
        missing_fields = [field for field in required_fields if field not in event]
        
        if missing_fields:
            print_test_result("Event Creation", False, f"Missing event fields: {missing_fields}")
            return None
            
        print_test_result("Event Creation", True, f"Created event: {event['name']} (slug: {event['slug']})")
        return event
        
    except Exception as e:
        print_test_result("Event Creation", False, f"Exception: {str(e)}")
        return None

def test_event_listing():
    """Test GET /api/events"""
    print("🔍 Testing Event Listing...")
    
    try:
        response = make_request('GET', '/events')
        
        if not response:
            print_test_result("Event Listing", False, "Request failed")
            return False
            
        if response.status_code != 200:
            print_test_result("Event Listing", False, f"Status: {response.status_code}")
            return False
            
        data = response.json()
        
        if 'events' not in data:
            print_test_result("Event Listing", False, "No events array in response")
            return False
            
        events = data['events']
        print_test_result("Event Listing", True, f"Retrieved {len(events)} events")
        return True
        
    except Exception as e:
        print_test_result("Event Listing", False, f"Exception: {str(e)}")
        return False

def test_event_detail(event_slug):
    """Test GET /api/events/:slug"""
    print("🔍 Testing Event Detail...")
    
    try:
        response = make_request('GET', f'/events/{event_slug}')
        
        if not response:
            print_test_result("Event Detail", False, "Request failed")
            return False
            
        if response.status_code != 200:
            print_test_result("Event Detail", False, f"Status: {response.status_code}")
            return False
            
        data = response.json()
        
        if 'event' not in data:
            print_test_result("Event Detail", False, "No event in response")
            return False
            
        event = data['event']
        if event['slug'] != event_slug:
            print_test_result("Event Detail", False, f"Slug mismatch: expected {event_slug}, got {event['slug']}")
            return False
            
        print_test_result("Event Detail", True, f"Retrieved event: {event['name']}")
        return True
        
    except Exception as e:
        print_test_result("Event Detail", False, f"Exception: {str(e)}")
        return False

def test_upload_init(event_slug):
    """Test POST /api/uploads/init"""
    print("🔍 Testing Upload Init...")
    
    upload_data = {
        "eventSlug": event_slug,
        "fileName": "test-photo.jpg",
        "mimeType": "image/jpeg",
        "fileSize": 1024000,
        "totalChunks": 1
    }
    
    try:
        response = make_request('POST', '/uploads/init', upload_data)
        
        if not response:
            print_test_result("Upload Init", False, "Request failed")
            return None
            
        if response.status_code != 201:
            print_test_result("Upload Init", False, f"Status: {response.status_code}, Response: {response.text}")
            return None
            
        data = response.json()
        
        if 'session' not in data:
            print_test_result("Upload Init", False, "No session in response")
            return None
            
        session = data['session']
        if 'sessionId' not in session:
            print_test_result("Upload Init", False, "No sessionId in session")
            return None
            
        print_test_result("Upload Init", True, f"Created upload session: {session['sessionId']}")
        return session
        
    except Exception as e:
        print_test_result("Upload Init", False, f"Exception: {str(e)}")
        return None

def test_upload_chunk(session_id):
    """Test POST /api/uploads/chunk"""
    print("🔍 Testing Upload Chunk...")
    
    # Create a small test file chunk
    test_chunk = b"fake image data for testing" * 100  # Small chunk
    
    try:
        files = {
            'chunk': ('chunk.bin', BytesIO(test_chunk), 'application/octet-stream')
        }
        
        data = {
            'sessionId': session_id,
            'chunkIndex': '0',
            'totalChunks': '1'
        }
        
        response = make_request('POST', '/uploads/chunk', data=data, files=files)
        
        if not response:
            print_test_result("Upload Chunk", False, "Request failed")
            return False
            
        if response.status_code != 200:
            print_test_result("Upload Chunk", False, f"Status: {response.status_code}, Response: {response.text}")
            return False
            
        data = response.json()
        
        if not data.get('uploaded'):
            print_test_result("Upload Chunk", False, "Upload not confirmed")
            return False
            
        print_test_result("Upload Chunk", True, f"Uploaded chunk {data.get('chunkIndex')}/{data.get('totalChunks')}")
        return True
        
    except Exception as e:
        print_test_result("Upload Chunk", False, f"Exception: {str(e)}")
        return False

def test_upload_complete(session_id):
    """Test POST /api/uploads/complete"""
    print("🔍 Testing Upload Complete...")
    
    complete_data = {
        "sessionId": session_id,
        "uploaderName": "Test User",
        "caption": "Test photo upload"
    }
    
    try:
        response = make_request('POST', '/uploads/complete', complete_data)
        
        if not response:
            print_test_result("Upload Complete", False, "Request failed")
            return None
            
        if response.status_code != 201:
            print_test_result("Upload Complete", False, f"Status: {response.status_code}, Response: {response.text}")
            return None
            
        data = response.json()
        
        if 'photo' not in data or 'event' not in data:
            print_test_result("Upload Complete", False, "Missing photo or event in response")
            return None
            
        photo = data['photo']
        if 'id' not in photo:
            print_test_result("Upload Complete", False, "No photo ID in response")
            return None
            
        print_test_result("Upload Complete", True, f"Created photo: {photo['id']}")
        return photo
        
    except Exception as e:
        print_test_result("Upload Complete", False, f"Exception: {str(e)}")
        return None

def test_admin_session():
    """Test GET /api/admin/session"""
    print("🔍 Testing Admin Session Status...")
    
    try:
        response = make_request('GET', '/admin/session')
        
        if not response:
            print_test_result("Admin Session Status", False, "Request failed")
            return False
            
        if response.status_code != 200:
            print_test_result("Admin Session Status", False, f"Status: {response.status_code}")
            return False
            
        data = response.json()
        
        # Should have configured and authenticated fields
        if 'configured' not in data or 'authenticated' not in data:
            print_test_result("Admin Session Status", False, "Missing configured or authenticated fields")
            return False
            
        print_test_result("Admin Session Status", True, f"Configured: {data['configured']}, Authenticated: {data['authenticated']}")
        return True
        
    except Exception as e:
        print_test_result("Admin Session Status", False, f"Exception: {str(e)}")
        return False

def test_admin_login():
    """Test POST /api/admin/login"""
    global admin_session_cookies
    print("🔍 Testing Admin Login...")
    
    login_data = {
        "password": TEST_ADMIN_PASSWORD
    }
    
    try:
        response = make_request('POST', '/admin/login', login_data)
        
        if not response:
            print_test_result("Admin Login", False, "Request failed")
            return False
            
        if response.status_code != 200:
            print_test_result("Admin Login", False, f"Status: {response.status_code}, Response: {response.text}")
            return False
            
        data = response.json()
        
        if not data.get('authenticated'):
            print_test_result("Admin Login", False, "Authentication failed")
            return False
            
        # Store session cookies for subsequent requests
        admin_session_cookies = response.cookies
        
        print_test_result("Admin Login", True, "Successfully authenticated")
        return True
        
    except Exception as e:
        print_test_result("Admin Login", False, f"Exception: {str(e)}")
        return False

def test_admin_events():
    """Test GET /api/admin/events"""
    print("🔍 Testing Admin Events List...")
    
    try:
        response = make_request('GET', '/admin/events', cookies=admin_session_cookies)
        
        if not response:
            print_test_result("Admin Events List", False, "Request failed")
            return False
            
        if response.status_code == 401:
            print_test_result("Admin Events List", False, "Authentication required (401)")
            return False
            
        if response.status_code != 200:
            print_test_result("Admin Events List", False, f"Status: {response.status_code}")
            return False
            
        data = response.json()
        
        if 'events' not in data:
            print_test_result("Admin Events List", False, "No events array in response")
            return False
            
        events = data['events']
        print_test_result("Admin Events List", True, f"Retrieved {len(events)} events for admin")
        return True
        
    except Exception as e:
        print_test_result("Admin Events List", False, f"Exception: {str(e)}")
        return False

def test_admin_event_detail(event_slug):
    """Test GET /api/admin/events/:slug"""
    print("🔍 Testing Admin Event Detail...")
    
    try:
        response = make_request('GET', f'/admin/events/{event_slug}', cookies=admin_session_cookies)
        
        if not response:
            print_test_result("Admin Event Detail", False, "Request failed")
            return False
            
        if response.status_code == 401:
            print_test_result("Admin Event Detail", False, "Authentication required (401)")
            return False
            
        if response.status_code != 200:
            print_test_result("Admin Event Detail", False, f"Status: {response.status_code}")
            return False
            
        data = response.json()
        
        if 'event' not in data:
            print_test_result("Admin Event Detail", False, "No event in response")
            return False
            
        event = data['event']
        print_test_result("Admin Event Detail", True, f"Retrieved admin event: {event['name']}")
        return True
        
    except Exception as e:
        print_test_result("Admin Event Detail", False, f"Exception: {str(e)}")
        return False

def test_photo_moderation(photo_id):
    """Test PATCH /api/admin/photos/:id"""
    print("🔍 Testing Photo Moderation...")
    
    moderation_data = {
        "action": "approve"
    }
    
    try:
        response = make_request('PATCH', f'/admin/photos/{photo_id}', moderation_data, cookies=admin_session_cookies)
        
        if not response:
            print_test_result("Photo Moderation", False, "Request failed")
            return False
            
        if response.status_code == 401:
            print_test_result("Photo Moderation", False, "Authentication required (401)")
            return False
            
        if response.status_code != 200:
            print_test_result("Photo Moderation", False, f"Status: {response.status_code}, Response: {response.text}")
            return False
            
        data = response.json()
        
        if 'photo' not in data:
            print_test_result("Photo Moderation", False, "No photo in response")
            return False
            
        photo = data['photo']
        print_test_result("Photo Moderation", True, f"Moderated photo: {photo['id']} -> {photo.get('status', 'unknown')}")
        return True
        
    except Exception as e:
        print_test_result("Photo Moderation", False, f"Exception: {str(e)}")
        return False

def test_admin_logout():
    """Test POST /api/admin/logout"""
    print("🔍 Testing Admin Logout...")
    
    try:
        response = make_request('POST', '/admin/logout', cookies=admin_session_cookies)
        
        if not response:
            print_test_result("Admin Logout", False, "Request failed")
            return False
            
        if response.status_code != 200:
            print_test_result("Admin Logout", False, f"Status: {response.status_code}")
            return False
            
        data = response.json()
        
        if not data.get('loggedOut'):
            print_test_result("Admin Logout", False, "Logout not confirmed")
            return False
            
        print_test_result("Admin Logout", True, "Successfully logged out")
        return True
        
    except Exception as e:
        print_test_result("Admin Logout", False, f"Exception: {str(e)}")
        return False

def main():
    """Run all backend tests"""
    print("🚀 Starting Backend API Regression Tests")
    print(f"Testing against: {API_BASE}")
    print("=" * 60)
    
    # Track test results
    results = {}
    
    # 1. Test API metadata
    results['metadata'] = test_api_metadata()
    
    # 2. Test public event APIs
    results['event_listing'] = test_event_listing()
    
    created_event = test_event_creation()
    results['event_creation'] = created_event is not None
    
    if created_event:
        event_slug = created_event['slug']
        results['event_detail'] = test_event_detail(event_slug)
        
        # 3. Test upload flow
        upload_session = test_upload_init(event_slug)
        results['upload_init'] = upload_session is not None
        
        if upload_session:
            session_id = upload_session['sessionId']
            results['upload_chunk'] = test_upload_chunk(session_id)
            
            if results['upload_chunk']:
                uploaded_photo = test_upload_complete(session_id)
                results['upload_complete'] = uploaded_photo is not None
                
                # 4. Test admin authentication and moderation
                results['admin_session'] = test_admin_session()
                results['admin_login'] = test_admin_login()
                
                if results['admin_login']:
                    results['admin_events'] = test_admin_events()
                    results['admin_event_detail'] = test_admin_event_detail(event_slug)
                    
                    if uploaded_photo:
                        photo_id = uploaded_photo['id']
                        results['photo_moderation'] = test_photo_moderation(photo_id)
                    
                    results['admin_logout'] = test_admin_logout()
    
    # Print summary
    print("=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for result in results.values() if result)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All backend tests PASSED! No rollback needed.")
        return True
    else:
        print("⚠️  Some tests FAILED. Review results above.")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)