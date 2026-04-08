#!/usr/bin/env python3
"""
Backend regression test for Event Gallery MVP after Prisma migration preparation.
Tests all backend APIs to ensure they work correctly in local mode.
"""

import requests
import json
import os
import tempfile
from io import BytesIO

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://photo-event-hub-3.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

# Create a session to handle cookies properly
session = requests.Session()

def test_root_metadata():
    """Test GET /api - verify local mode configuration"""
    print("🔍 Testing root metadata endpoint...")
    
    try:
        response = session.get(f"{API_BASE}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        print(f"✅ Root metadata response: {json.dumps(data, indent=2)}")
        
        # Verify local mode configuration
        assert data.get('configuredDataAccessDriver') == 'local', f"Expected DATA_ACCESS_DRIVER=local, got {data.get('configuredDataAccessDriver')}"
        assert data.get('repositoryMode') == 'local', f"Expected repositoryMode=local, got {data.get('repositoryMode')}"
        assert data.get('databaseConfigured') == False, f"Expected databaseConfigured=false, got {data.get('databaseConfigured')}"
        assert data.get('configuredAdminAuthDriver') == 'local', f"Expected ADMIN_AUTH_DRIVER=local, got {data.get('configuredAdminAuthDriver')}"
        
        print("✅ Root metadata test passed - local mode correctly configured")
        return True
        
    except Exception as e:
        print(f"❌ Root metadata test failed: {str(e)}")
        return False

def test_event_creation():
    """Test POST /api/events - create a new event"""
    print("🔍 Testing event creation...")
    
    try:
        event_data = {
            "name": "Regression Test Event"
        }
        
        response = session.post(f"{API_BASE}/events", json=event_data)
        assert response.status_code == 201, f"Expected 201, got {response.status_code}"
        
        data = response.json()
        event = data.get('event')
        assert event is not None, "Event not returned in response"
        assert event.get('name') == event_data['name'], f"Event name mismatch"
        assert 'slug' in event, "Event slug not present"
        assert 'id' in event, "Event ID not present"
        assert 'createdAt' in event, "Event createdAt not present"
        
        print(f"✅ Event created successfully: {event['id']} with slug: {event['slug']}")
        return event
        
    except Exception as e:
        print(f"❌ Event creation test failed: {str(e)}")
        return None

def test_event_listing():
    """Test GET /api/events - list all events"""
    print("🔍 Testing event listing...")
    
    try:
        response = session.get(f"{API_BASE}/events")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        events = data.get('events', [])
        assert isinstance(events, list), "Events should be a list"
        
        print(f"✅ Event listing successful - found {len(events)} events")
        return events
        
    except Exception as e:
        print(f"❌ Event listing test failed: {str(e)}")
        return None

def test_event_detail(event_slug):
    """Test GET /api/events/:slug - get specific event"""
    print(f"🔍 Testing event detail for slug: {event_slug}")
    
    try:
        response = session.get(f"{API_BASE}/events/{event_slug}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        event = data.get('event')
        assert event is not None, "Event not returned in response"
        assert event.get('slug') == event_slug, f"Event slug mismatch"
        
        print(f"✅ Event detail test passed for {event_slug}")
        return event
        
    except Exception as e:
        print(f"❌ Event detail test failed: {str(e)}")
        return None

def test_upload_flow(event_slug):
    """Test complete upload flow: init -> chunk -> complete"""
    print(f"🔍 Testing upload flow for event: {event_slug}")
    
    try:
        # Step 1: Initialize upload
        init_data = {
            "eventSlug": event_slug,
            "fileName": "test-photo.jpg",
            "mimeType": "image/jpeg",
            "fileSize": 1024,
            "totalChunks": 1
        }
        
        response = session.post(f"{API_BASE}/uploads/init", json=init_data)
        assert response.status_code == 201, f"Upload init failed: {response.status_code}"
        
        session_data = response.json()
        upload_session = session_data.get('session')
        assert upload_session is not None, "Upload session not returned"
        session_id = upload_session.get('sessionId')
        assert session_id is not None, "Session ID not present"
        
        print(f"✅ Upload initialized with session: {session_id}")
        
        # Step 2: Upload chunk
        test_content = b"fake image content for testing"
        chunk_data = {
            'sessionId': session_id,
            'chunkIndex': '0',
            'totalChunks': '1'
        }
        files = {'chunk': ('test-photo.jpg', BytesIO(test_content), 'image/jpeg')}
        
        response = session.post(f"{API_BASE}/uploads/chunk", data=chunk_data, files=files)
        assert response.status_code == 200, f"Chunk upload failed: {response.status_code}"
        
        chunk_result = response.json()
        assert chunk_result.get('uploaded') == True, "Chunk upload not confirmed"
        
        print("✅ Chunk uploaded successfully")
        
        # Step 3: Complete upload
        complete_data = {
            "sessionId": session_id,
            "uploaderName": "Test User",
            "caption": "Test photo caption"
        }
        
        response = session.post(f"{API_BASE}/uploads/complete", json=complete_data)
        assert response.status_code == 201, f"Upload complete failed: {response.status_code}"
        
        complete_result = response.json()
        photo = complete_result.get('photo')
        event = complete_result.get('event')
        
        assert photo is not None, "Photo not returned in complete response"
        assert event is not None, "Event not returned in complete response"
        assert photo.get('uploaderName') == "Test User", "Uploader name mismatch"
        assert photo.get('caption') == "Test photo caption", "Caption mismatch"
        
        print(f"✅ Upload completed successfully - photo ID: {photo.get('id')}")
        return photo
        
    except Exception as e:
        print(f"❌ Upload flow test failed: {str(e)}")
        return None

def test_admin_session():
    """Test GET /api/admin/session - check admin session status"""
    print("🔍 Testing admin session status...")
    
    try:
        response = session.get(f"{API_BASE}/admin/session")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert 'configured' in data, "Admin configured status not present"
        assert 'authenticated' in data, "Admin authenticated status not present"
        assert data.get('source') == 'local', f"Expected admin source=local, got {data.get('source')}"
        
        print(f"✅ Admin session status: configured={data.get('configured')}, authenticated={data.get('authenticated')}")
        return data
        
    except Exception as e:
        print(f"❌ Admin session test failed: {str(e)}")
        return None

def test_admin_login():
    """Test POST /api/admin/login - admin authentication"""
    print("🔍 Testing admin login...")
    
    try:
        # Use the known dev password from the migration prep
        login_data = {"password": "strongpass123"}
        
        response = session.post(f"{API_BASE}/admin/login", json=login_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get('authenticated') == True, "Admin not authenticated after login"
        
        print("✅ Admin login successful")
        return True
        
    except Exception as e:
        print(f"❌ Admin login test failed: {str(e)}")
        return False

def test_admin_protected_routes():
    """Test admin-protected routes with authentication"""
    print("🔍 Testing admin protected routes...")
    
    try:
        # Test admin events listing
        response = session.get(f"{API_BASE}/admin/events")
        assert response.status_code == 200, f"Admin events listing failed: {response.status_code}"
        
        data = response.json()
        events = data.get('events', [])
        print(f"✅ Admin events listing successful - {len(events)} events")
        
        # Test admin event creation
        event_data = {
            "name": "Admin Created Event",
            "slug": "admin-created-event"
        }
        
        response = session.post(f"{API_BASE}/admin/events", json=event_data)
        assert response.status_code == 201, f"Admin event creation failed: {response.status_code}"
        
        created_event = response.json().get('event')
        assert created_event is not None, "Admin created event not returned"
        
        print(f"✅ Admin event creation successful: {created_event.get('id')}")
        
        # Test admin event detail
        response = session.get(f"{API_BASE}/admin/events/{created_event.get('slug')}")
        assert response.status_code == 200, f"Admin event detail failed: {response.status_code}"
        
        print("✅ Admin event detail access successful")
        
        return True
        
    except Exception as e:
        print(f"❌ Admin protected routes test failed: {str(e)}")
        return False

def test_admin_photo_moderation(photo_id):
    """Test admin photo moderation functionality"""
    print(f"🔍 Testing admin photo moderation for photo: {photo_id}")
    
    try:
        # Test photo approval
        moderation_data = {"action": "approve"}
        
        response = session.patch(f"{API_BASE}/admin/photos/{photo_id}", json=moderation_data)
        assert response.status_code == 200, f"Photo moderation failed: {response.status_code}"
        
        data = response.json()
        photo = data.get('photo')
        assert photo is not None, "Moderated photo not returned"
        assert photo.get('status') == 'VISIBLE', f"Photo status not updated to VISIBLE"
        
        print("✅ Photo moderation (approve) successful")
        
        # Test photo rejection
        moderation_data = {"action": "reject"}
        
        response = session.patch(f"{API_BASE}/admin/photos/{photo_id}", json=moderation_data)
        assert response.status_code == 200, f"Photo rejection failed: {response.status_code}"
        
        data = response.json()
        photo = data.get('photo')
        assert photo.get('status') == 'HIDDEN', f"Photo status not updated to HIDDEN"
        
        print("✅ Photo moderation (reject) successful")
        return True
        
    except Exception as e:
        print(f"❌ Admin photo moderation test failed: {str(e)}")
        return False

def test_admin_logout():
    """Test POST /api/admin/logout - admin logout"""
    print("🔍 Testing admin logout...")
    
    try:
        response = session.post(f"{API_BASE}/admin/logout")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get('authenticated') == False, "Admin still authenticated after logout"
        assert data.get('loggedOut') == True, "Logout not confirmed"
        
        print("✅ Admin logout successful")
        return True
        
    except Exception as e:
        print(f"❌ Admin logout test failed: {str(e)}")
        return False

def run_regression_tests():
    """Run complete backend regression test suite"""
    print("🚀 Starting backend regression tests after Prisma migration preparation...")
    print(f"🌐 Testing against: {API_BASE}")
    print("=" * 80)
    
    results = {
        'root_metadata': False,
        'event_creation': False,
        'event_listing': False,
        'event_detail': False,
        'upload_flow': False,
        'admin_session': False,
        'admin_login': False,
        'admin_protected_routes': False,
        'admin_photo_moderation': False,
        'admin_logout': False
    }
    
    # Test 1: Root metadata
    results['root_metadata'] = test_root_metadata()
    
    # Test 2: Event creation
    created_event = test_event_creation()
    results['event_creation'] = created_event is not None
    
    # Test 3: Event listing
    events = test_event_listing()
    results['event_listing'] = events is not None
    
    # Test 4: Event detail (use created event if available)
    if created_event:
        event_detail = test_event_detail(created_event.get('slug'))
        results['event_detail'] = event_detail is not None
    
    # Test 5: Upload flow (use created event if available)
    uploaded_photo = None
    if created_event:
        uploaded_photo = test_upload_flow(created_event.get('slug'))
        results['upload_flow'] = uploaded_photo is not None
    
    # Test 6: Admin session status
    results['admin_session'] = test_admin_session()
    
    # Test 7: Admin login
    admin_login_success = test_admin_login()
    results['admin_login'] = admin_login_success
    
    # Test 8: Admin protected routes
    if admin_login_success:
        results['admin_protected_routes'] = test_admin_protected_routes()
    
    # Test 9: Admin photo moderation
    if admin_login_success and uploaded_photo:
        results['admin_photo_moderation'] = test_admin_photo_moderation(uploaded_photo.get('id'))
    
    # Test 10: Admin logout
    if admin_login_success:
        results['admin_logout'] = test_admin_logout()
    
    # Summary
    print("=" * 80)
    print("📊 REGRESSION TEST RESULTS:")
    print("=" * 80)
    
    passed = 0
    total = len(results)
    
    for test_name, passed_test in results.items():
        status = "✅ PASS" if passed_test else "❌ FAIL"
        print(f"{test_name.replace('_', ' ').title()}: {status}")
        if passed_test:
            passed += 1
    
    print("=" * 80)
    print(f"📈 OVERALL RESULT: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 ALL REGRESSION TESTS PASSED!")
        print("✅ Backend APIs working correctly in local mode after Prisma migration preparation")
        print("✅ Migration script was intentionally NOT executed as requested")
        return True
    else:
        print("⚠️  SOME TESTS FAILED - Backend regression issues detected")
        return False

if __name__ == "__main__":
    success = run_regression_tests()
    exit(0 if success else 1)