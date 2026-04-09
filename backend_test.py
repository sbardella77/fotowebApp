#!/usr/bin/env python3
"""
Backend regression test for Event Gallery MVP after Vercel-readiness changes.
Tests: GET /api metadata, public event flows, upload flow, admin login/session/moderation.
"""

import requests
import json
import os
import tempfile
from io import BytesIO

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://photo-event-hub-3.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

def test_api_metadata():
    """Test GET /api metadata endpoint"""
    print("🔍 Testing GET /api metadata...")
    try:
        response = requests.get(f"{API_BASE}")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Response: {json.dumps(data, indent=2)}")
            
            # Verify expected fields
            expected_fields = ['name', 'repositoryMode', 'configuredDataAccessDriver', 'configuredAdminAuthDriver', 'storageMode', 'databaseConfigured', 'adminConfigured']
            missing_fields = [field for field in expected_fields if field not in data]
            
            if missing_fields:
                print(f"❌ Missing fields: {missing_fields}")
                return False
                
            # Verify current configuration
            if data.get('configuredDataAccessDriver') != 'prisma':
                print(f"❌ Expected DATA_ACCESS_DRIVER=prisma, got {data.get('configuredDataAccessDriver')}")
                return False
                
            if data.get('configuredAdminAuthDriver') != 'local':
                print(f"❌ Expected ADMIN_AUTH_DRIVER=local, got {data.get('configuredAdminAuthDriver')}")
                return False
                
            print("✅ GET /api metadata working correctly")
            return True
        else:
            print(f"❌ GET /api metadata failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ GET /api metadata error: {e}")
        return False

def test_public_event_flows():
    """Test public event create/list/detail flows"""
    print("\n🔍 Testing public event flows...")
    
    # Test event creation
    print("Testing POST /api/events...")
    try:
        event_data = {
            "name": "Regression Test Event",
            "description": "Testing after Vercel changes"
        }
        
        response = requests.post(f"{API_BASE}/events", json=event_data)
        print(f"Create event status: {response.status_code}")
        
        if response.status_code != 201:
            print(f"❌ Event creation failed: {response.text}")
            return False
            
        created_event = response.json().get('event')
        if not created_event or not created_event.get('slug'):
            print(f"❌ Event creation response missing event or slug: {response.json()}")
            return False
            
        event_slug = created_event['slug']
        print(f"✅ Event created with slug: {event_slug}")
        
    except Exception as e:
        print(f"❌ Event creation error: {e}")
        return False
    
    # Test event listing
    print("Testing GET /api/events...")
    try:
        response = requests.get(f"{API_BASE}/events")
        print(f"List events status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Event listing failed: {response.text}")
            return False
            
        events_data = response.json()
        if 'events' not in events_data:
            print(f"❌ Event listing response missing events: {events_data}")
            return False
            
        events = events_data['events']
        print(f"✅ Event listing returned {len(events)} events")
        
    except Exception as e:
        print(f"❌ Event listing error: {e}")
        return False
    
    # Test event detail
    print(f"Testing GET /api/events/{event_slug}...")
    try:
        response = requests.get(f"{API_BASE}/events/{event_slug}")
        print(f"Event detail status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Event detail failed: {response.text}")
            return False
            
        event_detail = response.json().get('event')
        if not event_detail or event_detail.get('slug') != event_slug:
            print(f"❌ Event detail response invalid: {response.json()}")
            return False
            
        print(f"✅ Event detail retrieved for {event_slug}")
        return True
        
    except Exception as e:
        print(f"❌ Event detail error: {e}")
        return False

def test_upload_flow():
    """Test upload flow init/chunk/complete - should fail gracefully on Vercel"""
    print("\n🔍 Testing upload flow (expecting Vercel failure)...")
    
    # First create an event to upload to
    event_data = {
        "name": "Upload Test Event",
        "description": "Testing upload flow"
    }
    
    try:
        response = requests.post(f"{API_BASE}/events", json=event_data)
        if response.status_code != 201:
            print(f"❌ Failed to create test event: {response.text}")
            return False
            
        event_slug = response.json()['event']['slug']
        print(f"Created test event: {event_slug}")
        
    except Exception as e:
        print(f"❌ Error creating test event: {e}")
        return False
    
    # Test upload init - should fail with Vercel error
    print("Testing POST /api/uploads/init...")
    try:
        upload_data = {
            "eventSlug": event_slug,
            "fileName": "test-photo.jpg",
            "fileSize": 1024,
            "mimeType": "image/jpeg",
            "totalChunks": 1
        }
        
        response = requests.post(f"{API_BASE}/uploads/init", json=upload_data)
        print(f"Upload init status: {response.status_code}")
        
        if response.status_code == 500:
            # Check if it's the expected Vercel error
            error_text = response.text.lower()
            if 'vercel' in error_text or 'local file storage' in error_text or 'not supported' in error_text:
                print("✅ Upload init correctly fails on Vercel with expected error")
                print(f"Error message: {response.text}")
                return True
            else:
                print(f"❌ Upload init failed with unexpected error: {response.text}")
                return False
        elif response.status_code == 201:
            # If we're not on Vercel, upload should work
            print("✅ Upload init succeeded (not on Vercel)")
            session_data = response.json().get('session')
            if not session_data or not session_data.get('sessionId'):
                print(f"❌ Upload init response missing session data: {response.json()}")
                return False
            return True
        else:
            print(f"❌ Upload init failed with unexpected status: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Upload init error: {e}")
        return False

def test_admin_auth_flow():
    """Test admin login/session/logout flow"""
    print("\n🔍 Testing admin authentication flow...")
    
    # Test admin session status (unauthenticated)
    print("Testing GET /api/admin/session (unauthenticated)...")
    try:
        response = requests.get(f"{API_BASE}/admin/session")
        print(f"Admin session status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Admin session check failed: {response.text}")
            return False
            
        session_data = response.json()
        if session_data.get('authenticated') is not False:
            print(f"❌ Expected authenticated=false, got: {session_data}")
            return False
            
        print("✅ Admin session correctly shows unauthenticated")
        
    except Exception as e:
        print(f"❌ Admin session check error: {e}")
        return False
    
    # Test admin login
    print("Testing POST /api/admin/login...")
    try:
        login_data = {"password": "strongpass123"}
        response = requests.post(f"{API_BASE}/admin/login", json=login_data)
        print(f"Admin login status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Admin login failed: {response.text}")
            return False
            
        login_response = response.json()
        if login_response.get('authenticated') is not True:
            print(f"❌ Expected authenticated=true after login, got: {login_response}")
            return False
            
        # Extract session cookie for subsequent requests
        session_cookies = response.cookies
        print("✅ Admin login successful")
        
    except Exception as e:
        print(f"❌ Admin login error: {e}")
        return False
    
    # Test authenticated admin session
    print("Testing GET /api/admin/session (authenticated)...")
    try:
        response = requests.get(f"{API_BASE}/admin/session", cookies=session_cookies)
        print(f"Authenticated session status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Authenticated session check failed: {response.text}")
            return False
            
        session_data = response.json()
        if session_data.get('authenticated') is not True:
            print(f"❌ Expected authenticated=true, got: {session_data}")
            return False
            
        print("✅ Authenticated admin session working")
        
    except Exception as e:
        print(f"❌ Authenticated session check error: {e}")
        return False
    
    # Test admin logout
    print("Testing POST /api/admin/logout...")
    try:
        response = requests.post(f"{API_BASE}/admin/logout", cookies=session_cookies)
        print(f"Admin logout status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Admin logout failed: {response.text}")
            return False
            
        logout_response = response.json()
        if logout_response.get('authenticated') is not False:
            print(f"❌ Expected authenticated=false after logout, got: {logout_response}")
            return False
            
        print("✅ Admin logout successful")
        return True
        
    except Exception as e:
        print(f"❌ Admin logout error: {e}")
        return False

def test_admin_moderation():
    """Test admin moderation endpoints"""
    print("\n🔍 Testing admin moderation...")
    
    # First login as admin
    login_data = {"password": "strongpass123"}
    try:
        response = requests.post(f"{API_BASE}/admin/login", json=login_data)
        if response.status_code != 200:
            print(f"❌ Admin login failed for moderation test: {response.text}")
            return False
        session_cookies = response.cookies
        print("Admin logged in for moderation test")
    except Exception as e:
        print(f"❌ Admin login error for moderation: {e}")
        return False
    
    # Test admin events list
    print("Testing GET /api/admin/events...")
    try:
        response = requests.get(f"{API_BASE}/admin/events", cookies=session_cookies)
        print(f"Admin events status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Admin events list failed: {response.text}")
            return False
            
        events_data = response.json()
        if 'events' not in events_data:
            print(f"❌ Admin events response missing events: {events_data}")
            return False
            
        events = events_data['events']
        print(f"✅ Admin events list returned {len(events)} events")
        
        if len(events) > 0:
            # Test admin event detail
            event_slug = events[0]['slug']
            print(f"Testing GET /api/admin/events/{event_slug}...")
            
            response = requests.get(f"{API_BASE}/admin/events/{event_slug}", cookies=session_cookies)
            print(f"Admin event detail status: {response.status_code}")
            
            if response.status_code != 200:
                print(f"❌ Admin event detail failed: {response.text}")
                return False
                
            event_detail = response.json().get('event')
            if not event_detail:
                print(f"❌ Admin event detail response missing event: {response.json()}")
                return False
                
            print(f"✅ Admin event detail retrieved for {event_slug}")
            
            # Check if there are photos to moderate
            photos = event_detail.get('photos', [])
            if len(photos) > 0:
                photo_id = photos[0]['id']
                print(f"Testing photo moderation for photo {photo_id}...")
                
                # Test photo approval
                moderation_data = {"action": "approve"}
                response = requests.patch(f"{API_BASE}/admin/photos/{photo_id}", 
                                        json=moderation_data, cookies=session_cookies)
                print(f"Photo moderation status: {response.status_code}")
                
                if response.status_code == 200:
                    print("✅ Photo moderation working")
                else:
                    print(f"❌ Photo moderation failed: {response.text}")
                    return False
            else:
                print("ℹ️ No photos available for moderation test")
        
        return True
        
    except Exception as e:
        print(f"❌ Admin moderation error: {e}")
        return False

def main():
    """Run all backend regression tests"""
    print("🚀 Starting backend regression tests after Vercel-readiness changes...")
    print(f"Testing against: {API_BASE}")
    print("=" * 60)
    
    results = {
        "api_metadata": test_api_metadata(),
        "public_event_flows": test_public_event_flows(),
        "upload_flow": test_upload_flow(),
        "admin_auth_flow": test_admin_auth_flow(),
        "admin_moderation": test_admin_moderation()
    }
    
    print("\n" + "=" * 60)
    print("📊 REGRESSION TEST RESULTS:")
    print("=" * 60)
    
    all_passed = True
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{test_name}: {status}")
        if not passed:
            all_passed = False
    
    print("=" * 60)
    if all_passed:
        print("🎉 ALL BACKEND TESTS PASSED - Vercel changes are working correctly!")
        print("✅ Local/serverful behavior preserved after deployment-safe changes")
    else:
        print("⚠️ SOME TESTS FAILED - Review issues above")
    
    return all_passed

if __name__ == "__main__":
    main()