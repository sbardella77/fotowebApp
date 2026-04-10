#!/usr/bin/env python3
"""
Backend regression test for Vercel Blob migration changes.
Tests local fallback behavior when BLOB_READ_WRITE_TOKEN is not configured.
"""

import requests
import json
import os
import tempfile
import time
from pathlib import Path

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://photo-event-hub-3.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'Backend-Test/1.0'
        })
        self.test_event_slug = None
        self.test_photo_id = None
        self.admin_authenticated = False

    def log_test(self, test_name, success, details=""):
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"    {details}")
        if not success:
            raise Exception(f"Test failed: {test_name} - {details}")

    def test_api_metadata(self):
        """Test GET /api metadata endpoint"""
        try:
            response = self.session.get(f"{API_BASE}")
            response.raise_for_status()
            
            data = response.json()
            
            # Verify expected fields
            required_fields = ['name', 'repositoryMode', 'configuredDataAccessDriver', 
                             'configuredAdminAuthDriver', 'storageMode', 'databaseConfigured']
            
            for field in required_fields:
                if field not in data:
                    self.log_test("API Metadata", False, f"Missing field: {field}")
                    return
            
            # Verify expected values based on current configuration
            expected_values = {
                'configuredDataAccessDriver': 'prisma',
                'configuredAdminAuthDriver': 'local',
                'repositoryMode': 'prisma',
                'databaseConfigured': True,
                'storageMode': 'local'  # Should be local since BLOB_READ_WRITE_TOKEN not configured
            }
            
            for field, expected in expected_values.items():
                if data.get(field) != expected:
                    self.log_test("API Metadata", False, 
                                f"Field {field}: expected {expected}, got {data.get(field)}")
                    return
            
            self.log_test("API Metadata", True, 
                         f"Repository: {data['repositoryMode']}, Storage: {data['storageMode']}, DB: {data['databaseConfigured']}")
            
        except Exception as e:
            self.log_test("API Metadata", False, str(e))

    def test_event_creation(self):
        """Test POST /api/events - public event creation"""
        try:
            event_data = {
                "name": "Backend Test Event"
            }
            
            response = self.session.post(f"{API_BASE}/events", json=event_data)
            response.raise_for_status()
            
            data = response.json()
            
            if 'event' not in data:
                self.log_test("Event Creation", False, "No event in response")
                return
            
            event = data['event']
            required_fields = ['id', 'name', 'slug', 'createdAt']
            
            for field in required_fields:
                if field not in event:
                    self.log_test("Event Creation", False, f"Missing field: {field}")
                    return
            
            # Store for later tests
            self.test_event_slug = event['slug']
            
            self.log_test("Event Creation", True, 
                         f"Created event: {event['name']} (slug: {event['slug']})")
            
        except Exception as e:
            self.log_test("Event Creation", False, str(e))

    def test_event_listing(self):
        """Test GET /api/events - public event listing"""
        try:
            response = self.session.get(f"{API_BASE}/events")
            response.raise_for_status()
            
            data = response.json()
            
            if 'events' not in data:
                self.log_test("Event Listing", False, "No events in response")
                return
            
            events = data['events']
            
            if not isinstance(events, list):
                self.log_test("Event Listing", False, "Events is not a list")
                return
            
            # Should have at least our test event
            if len(events) == 0:
                self.log_test("Event Listing", False, "No events returned")
                return
            
            # Check if our test event is in the list
            test_event_found = any(event.get('slug') == self.test_event_slug for event in events)
            
            if not test_event_found and self.test_event_slug:
                self.log_test("Event Listing", False, f"Test event {self.test_event_slug} not found in list")
                return
            
            self.log_test("Event Listing", True, f"Found {len(events)} events")
            
        except Exception as e:
            self.log_test("Event Listing", False, str(e))

    def test_event_detail(self):
        """Test GET /api/events/:slug - public event detail"""
        if not self.test_event_slug:
            self.log_test("Event Detail", False, "No test event slug available")
            return
        
        try:
            response = self.session.get(f"{API_BASE}/events/{self.test_event_slug}")
            response.raise_for_status()
            
            data = response.json()
            
            if 'event' not in data:
                self.log_test("Event Detail", False, "No event in response")
                return
            
            event = data['event']
            required_fields = ['id', 'name', 'slug', 'createdAt']
            
            for field in required_fields:
                if field not in event:
                    self.log_test("Event Detail", False, f"Missing field: {field}")
                    return
            
            if event['slug'] != self.test_event_slug:
                self.log_test("Event Detail", False, f"Wrong event returned: {event['slug']}")
                return
            
            self.log_test("Event Detail", True, f"Retrieved event: {event['name']}")
            
        except Exception as e:
            self.log_test("Event Detail", False, str(e))

    def test_upload_init_local_fallback(self):
        """Test POST /api/uploads/init - should use local fallback"""
        if not self.test_event_slug:
            self.log_test("Upload Init Local Fallback", False, "No test event slug available")
            return
        
        try:
            upload_data = {
                "eventSlug": self.test_event_slug,
                "fileName": "test-image.jpg",
                "fileSize": 1024000,  # 1MB
                "mimeType": "image/jpeg",
                "totalChunks": 1
            }
            
            response = self.session.post(f"{API_BASE}/uploads/init", json=upload_data)
            response.raise_for_status()
            
            data = response.json()
            
            if 'session' not in data:
                self.log_test("Upload Init Local Fallback", False, "No session in response")
                return
            
            session = data['session']
            required_fields = ['sessionId', 'storageMode']
            
            for field in required_fields:
                if field not in session:
                    self.log_test("Upload Init Local Fallback", False, f"Missing field: {field}")
                    return
            
            # Should be local storage mode since BLOB_READ_WRITE_TOKEN not configured
            if session['storageMode'] != 'local':
                self.log_test("Upload Init Local Fallback", False, 
                             f"Expected local storage mode, got: {session['storageMode']}")
                return
            
            self.log_test("Upload Init Local Fallback", True, 
                         f"Session created with local storage mode: {session['sessionId']}")
            
        except Exception as e:
            self.log_test("Upload Init Local Fallback", False, str(e))

    def test_blob_upload_token_endpoint(self):
        """Test POST /api/uploads/blob - should fail gracefully without BLOB_READ_WRITE_TOKEN"""
        try:
            blob_data = {
                "pathname": "test-path.jpg",
                "type": "image/jpeg",
                "clientPayload": json.dumps({
                    "eventSlug": self.test_event_slug or "test-event",
                    "fileName": "test-image.jpg",
                    "fileSize": 1024000,
                    "mimeType": "image/jpeg"
                })
            }
            
            response = self.session.post(f"{API_BASE}/uploads/blob", json=blob_data)
            
            # Should return 500 error since BLOB_READ_WRITE_TOKEN is not configured
            if response.status_code != 500:
                self.log_test("Blob Upload Token Endpoint", False, 
                             f"Expected 500 error, got: {response.status_code}")
                return
            
            data = response.json()
            if 'error' not in data:
                self.log_test("Blob Upload Token Endpoint", False, "No error message in response")
                return
            
            # Should contain message about Vercel Blob not being configured
            error_msg = data['error'].lower()
            if 'vercel blob' not in error_msg and 'not configured' not in error_msg:
                self.log_test("Blob Upload Token Endpoint", False, 
                             f"Unexpected error message: {data['error']}")
                return
            
            self.log_test("Blob Upload Token Endpoint", True, 
                         "Correctly returns error when BLOB_READ_WRITE_TOKEN not configured")
            
        except Exception as e:
            self.log_test("Blob Upload Token Endpoint", False, str(e))

    def test_admin_login(self):
        """Test POST /api/admin/login"""
        try:
            login_data = {
                "password": "strongpass123"  # Known dev password from test_result.md
            }
            
            response = self.session.post(f"{API_BASE}/admin/login", json=login_data)
            response.raise_for_status()
            
            data = response.json()
            
            if not data.get('authenticated'):
                self.log_test("Admin Login", False, "Authentication failed")
                return
            
            # Store authentication state
            self.admin_authenticated = True
            
            self.log_test("Admin Login", True, "Admin authentication successful")
            
        except Exception as e:
            self.log_test("Admin Login", False, str(e))

    def test_admin_session(self):
        """Test GET /api/admin/session"""
        try:
            response = self.session.get(f"{API_BASE}/admin/session")
            response.raise_for_status()
            
            data = response.json()
            
            # Should show authenticated if we logged in successfully
            expected_auth = self.admin_authenticated
            actual_auth = data.get('authenticated', False)
            
            if actual_auth != expected_auth:
                self.log_test("Admin Session", False, 
                             f"Expected authenticated: {expected_auth}, got: {actual_auth}")
                return
            
            self.log_test("Admin Session", True, f"Session status: authenticated={actual_auth}")
            
        except Exception as e:
            self.log_test("Admin Session", False, str(e))

    def test_admin_protected_routes(self):
        """Test admin protected routes require authentication"""
        if not self.admin_authenticated:
            self.log_test("Admin Protected Routes", False, "Admin not authenticated")
            return
        
        try:
            # Test admin events list
            response = self.session.get(f"{API_BASE}/admin/events")
            response.raise_for_status()
            
            data = response.json()
            
            if 'events' not in data:
                self.log_test("Admin Protected Routes", False, "No events in admin response")
                return
            
            self.log_test("Admin Protected Routes", True, "Admin routes accessible when authenticated")
            
        except Exception as e:
            self.log_test("Admin Protected Routes", False, str(e))

    def test_admin_logout(self):
        """Test POST /api/admin/logout"""
        try:
            response = self.session.post(f"{API_BASE}/admin/logout")
            response.raise_for_status()
            
            data = response.json()
            
            if not data.get('loggedOut'):
                self.log_test("Admin Logout", False, "Logout not confirmed")
                return
            
            # Update authentication state
            self.admin_authenticated = False
            
            self.log_test("Admin Logout", True, "Admin logout successful")
            
        except Exception as e:
            self.log_test("Admin Logout", False, str(e))

    def run_all_tests(self):
        """Run all backend regression tests"""
        print("🧪 Starting Backend Regression Tests for Vercel Blob Migration")
        print("=" * 60)
        
        try:
            # Core API tests
            self.test_api_metadata()
            
            # Public event tests
            self.test_event_creation()
            self.test_event_listing()
            self.test_event_detail()
            
            # Upload tests (local fallback)
            self.test_upload_init_local_fallback()
            self.test_blob_upload_token_endpoint()
            
            # Admin auth tests
            self.test_admin_login()
            self.test_admin_session()
            self.test_admin_protected_routes()
            self.test_admin_logout()
            
            print("=" * 60)
            print("✅ ALL BACKEND REGRESSION TESTS PASSED")
            print("🔄 Local fallback behavior working correctly")
            print("🚫 Vercel Blob correctly disabled without BLOB_READ_WRITE_TOKEN")
            
        except Exception as e:
            print("=" * 60)
            print(f"❌ BACKEND REGRESSION TESTS FAILED: {str(e)}")
            raise

if __name__ == "__main__":
    tester = BackendTester()
    tester.run_all_tests()