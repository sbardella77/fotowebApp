#!/usr/bin/env python3
"""
Backend regression test suite for Event Gallery MVP after Prisma migration preparation.
Tests all backend APIs to ensure local fallback works correctly when DATABASE_URL is absent.
"""

import requests
import json
import os
import time
from typing import Dict, Any, Optional

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://photo-event-hub-3.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.admin_authenticated = False
        self.test_event_slug = None
        self.test_photo_id = None
        
    def log_test(self, test_name: str, success: bool, details: str = ""):
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        if not success:
            print(f"   This is a CRITICAL failure that blocks functionality")
        print()

    def test_api_root_metadata(self) -> bool:
        """Test GET /api root metadata reports driver info correctly"""
        try:
            response = self.session.get(f"{API_BASE}")
            
            if response.status_code != 200:
                self.log_test("API Root Metadata", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            # Verify expected fields are present
            required_fields = [
                'name', 'repositoryMode', 'configuredDataAccessDriver', 
                'configuredAdminAuthDriver', 'storageMode', 'databaseConfigured', 
                'adminConfigured', 'adminSource'
            ]
            
            missing_fields = [field for field in required_fields if field not in data]
            if missing_fields:
                self.log_test("API Root Metadata", False, f"Missing fields: {missing_fields}")
                return False
            
            # Verify driver defaults
            if data['configuredDataAccessDriver'] != 'local':
                self.log_test("API Root Metadata", False, f"Expected DATA_ACCESS_DRIVER=local, got {data['configuredDataAccessDriver']}")
                return False
                
            if data['repositoryMode'] != 'local':
                self.log_test("API Root Metadata", False, f"Expected repositoryMode=local, got {data['repositoryMode']}")
                return False
                
            if data['databaseConfigured'] != False:
                self.log_test("API Root Metadata", False, f"Expected databaseConfigured=false (no DATABASE_URL), got {data['databaseConfigured']}")
                return False
            
            self.log_test("API Root Metadata", True, f"Driver: {data['configuredDataAccessDriver']}, Mode: {data['repositoryMode']}, DB: {data['databaseConfigured']}")
            return True
            
        except Exception as e:
            self.log_test("API Root Metadata", False, f"Exception: {str(e)}")
            return False

    def test_create_event(self) -> bool:
        """Test POST /api/events"""
        try:
            event_data = {
                "name": "Test Event for Regression",
                "description": "Testing event creation after Prisma migration prep",
                "location": "Test Location"
            }
            
            response = self.session.post(f"{API_BASE}/events", json=event_data)
            
            if response.status_code != 201:
                self.log_test("Create Event", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
            data = response.json()
            
            if 'event' not in data:
                self.log_test("Create Event", False, "Missing 'event' in response")
                return False
                
            event = data['event']
            required_fields = ['id', 'name', 'slug', 'createdAt']
            missing_fields = [field for field in required_fields if field not in event]
            
            if missing_fields:
                self.log_test("Create Event", False, f"Missing event fields: {missing_fields}")
                return False
            
            # Store for later tests
            self.test_event_slug = event['slug']
            
            self.log_test("Create Event", True, f"Created event with slug: {event['slug']}")
            return True
            
        except Exception as e:
            self.log_test("Create Event", False, f"Exception: {str(e)}")
            return False

    def test_list_events(self) -> bool:
        """Test GET /api/events"""
        try:
            response = self.session.get(f"{API_BASE}/events")
            
            if response.status_code != 200:
                self.log_test("List Events", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            if 'events' not in data:
                self.log_test("List Events", False, "Missing 'events' in response")
                return False
                
            events = data['events']
            if not isinstance(events, list):
                self.log_test("List Events", False, "Events should be a list")
                return False
            
            # Should have at least the event we created
            if len(events) == 0:
                self.log_test("List Events", False, "No events found, expected at least one")
                return False
            
            self.log_test("List Events", True, f"Found {len(events)} events")
            return True
            
        except Exception as e:
            self.log_test("List Events", False, f"Exception: {str(e)}")
            return False

    def test_get_event_by_slug(self) -> bool:
        """Test GET /api/events/:slug"""
        if not self.test_event_slug:
            self.log_test("Get Event by Slug", False, "No test event slug available")
            return False
            
        try:
            response = self.session.get(f"{API_BASE}/events/{self.test_event_slug}")
            
            if response.status_code != 200:
                self.log_test("Get Event by Slug", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            if 'event' not in data:
                self.log_test("Get Event by Slug", False, "Missing 'event' in response")
                return False
                
            event = data['event']
            if event['slug'] != self.test_event_slug:
                self.log_test("Get Event by Slug", False, f"Wrong slug returned: {event['slug']}")
                return False
            
            self.log_test("Get Event by Slug", True, f"Retrieved event: {event['name']}")
            return True
            
        except Exception as e:
            self.log_test("Get Event by Slug", False, f"Exception: {str(e)}")
            return False

    def test_upload_init(self) -> bool:
        """Test POST /api/uploads/init"""
        if not self.test_event_slug:
            self.log_test("Upload Init", False, "No test event slug available")
            return False
            
        try:
            upload_data = {
                "eventSlug": self.test_event_slug,
                "fileName": "test-photo.jpg",
                "fileSize": 1024000,
                "mimeType": "image/jpeg",
                "totalChunks": 1
            }
            
            response = self.session.post(f"{API_BASE}/uploads/init", json=upload_data)
            
            if response.status_code != 201:
                self.log_test("Upload Init", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
            data = response.json()
            
            if 'session' not in data:
                self.log_test("Upload Init", False, "Missing 'session' in response")
                return False
                
            session = data['session']
            required_fields = ['sessionId']
            missing_fields = [field for field in required_fields if field not in session]
            
            if missing_fields:
                self.log_test("Upload Init", False, f"Missing session fields: {missing_fields}")
                return False
            
            self.log_test("Upload Init", True, f"Created upload session: {session['sessionId']}")
            return True
            
        except Exception as e:
            self.log_test("Upload Init", False, f"Exception: {str(e)}")
            return False

    def test_upload_chunk(self) -> bool:
        """Test POST /api/uploads/chunk"""
        # First init an upload session
        if not self.test_event_slug:
            self.log_test("Upload Chunk", False, "No test event slug available")
            return False
            
        try:
            # Init upload
            upload_data = {
                "eventSlug": self.test_event_slug,
                "fileName": "test-chunk.jpg",
                "fileSize": 1024,
                "mimeType": "image/jpeg",
                "totalChunks": 1
            }
            
            init_response = self.session.post(f"{API_BASE}/uploads/init", json=upload_data)
            if init_response.status_code != 201:
                self.log_test("Upload Chunk", False, f"Init failed: {init_response.status_code}")
                return False
                
            session_id = init_response.json()['session']['sessionId']
            
            # Create a small test chunk
            test_chunk_data = b"fake image data for testing"
            
            # Upload chunk
            files = {'chunk': ('chunk.jpg', test_chunk_data, 'image/jpeg')}
            data = {
                'sessionId': session_id,
                'chunkIndex': 0,
                'totalChunks': 1
            }
            
            response = self.session.post(f"{API_BASE}/uploads/chunk", files=files, data=data)
            
            if response.status_code != 200:
                self.log_test("Upload Chunk", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
            result = response.json()
            
            if not result.get('uploaded'):
                self.log_test("Upload Chunk", False, "Upload not confirmed")
                return False
            
            self.log_test("Upload Chunk", True, f"Uploaded chunk {result['chunkIndex']}/{result['totalChunks']}")
            return True
            
        except Exception as e:
            self.log_test("Upload Chunk", False, f"Exception: {str(e)}")
            return False

    def test_upload_complete(self) -> bool:
        """Test POST /api/uploads/complete"""
        if not self.test_event_slug:
            self.log_test("Upload Complete", False, "No test event slug available")
            return False
            
        try:
            # Init upload
            upload_data = {
                "eventSlug": self.test_event_slug,
                "fileName": "test-complete.jpg",
                "fileSize": 1024,
                "mimeType": "image/jpeg",
                "totalChunks": 1
            }
            
            init_response = self.session.post(f"{API_BASE}/uploads/init", json=upload_data)
            if init_response.status_code != 201:
                self.log_test("Upload Complete", False, f"Init failed: {init_response.status_code}")
                return False
                
            session_id = init_response.json()['session']['sessionId']
            
            # Upload chunk
            test_chunk_data = b"fake image data for testing complete"
            files = {'chunk': ('chunk.jpg', test_chunk_data, 'image/jpeg')}
            chunk_data = {
                'sessionId': session_id,
                'chunkIndex': 0,
                'totalChunks': 1
            }
            
            chunk_response = self.session.post(f"{API_BASE}/uploads/chunk", files=files, data=chunk_data)
            if chunk_response.status_code != 200:
                self.log_test("Upload Complete", False, f"Chunk upload failed: {chunk_response.status_code}")
                return False
            
            # Complete upload
            complete_data = {
                "sessionId": session_id,
                "uploaderName": "Test User",
                "caption": "Test photo caption"
            }
            
            response = self.session.post(f"{API_BASE}/uploads/complete", json=complete_data)
            
            if response.status_code != 201:
                self.log_test("Upload Complete", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
            result = response.json()
            
            if 'photo' not in result or 'event' not in result:
                self.log_test("Upload Complete", False, "Missing 'photo' or 'event' in response")
                return False
            
            photo = result['photo']
            required_fields = ['id', 'originalName', 'uploaderName', 'caption', 'status']
            missing_fields = [field for field in required_fields if field not in photo]
            
            if missing_fields:
                self.log_test("Upload Complete", False, f"Missing photo fields: {missing_fields}")
                return False
            
            # Store photo ID for moderation tests
            self.test_photo_id = photo['id']
            
            self.log_test("Upload Complete", True, f"Completed upload, photo ID: {photo['id']}")
            return True
            
        except Exception as e:
            self.log_test("Upload Complete", False, f"Exception: {str(e)}")
            return False

    def test_admin_session_unauthenticated(self) -> bool:
        """Test GET /api/admin/session without authentication"""
        try:
            response = self.session.get(f"{API_BASE}/admin/session")
            
            if response.status_code != 200:
                self.log_test("Admin Session (Unauth)", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            if data.get('authenticated') != False:
                self.log_test("Admin Session (Unauth)", False, f"Expected authenticated=false, got {data.get('authenticated')}")
                return False
            
            self.log_test("Admin Session (Unauth)", True, "Correctly shows unauthenticated")
            return True
            
        except Exception as e:
            self.log_test("Admin Session (Unauth)", False, f"Exception: {str(e)}")
            return False

    def test_admin_login(self) -> bool:
        """Test POST /api/admin/login with password: strongpass123"""
        try:
            login_data = {
                "password": "strongpass123"
            }
            
            response = self.session.post(f"{API_BASE}/admin/login", json=login_data)
            
            if response.status_code != 200:
                self.log_test("Admin Login", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
            data = response.json()
            
            if data.get('authenticated') != True:
                self.log_test("Admin Login", False, f"Expected authenticated=true, got {data.get('authenticated')}")
                return False
            
            # Check if session cookie was set
            cookies = response.cookies
            if not any('admin' in cookie.name.lower() for cookie in cookies):
                self.log_test("Admin Login", False, "No admin session cookie set")
                return False
            
            self.admin_authenticated = True
            self.log_test("Admin Login", True, "Successfully authenticated admin")
            return True
            
        except Exception as e:
            self.log_test("Admin Login", False, f"Exception: {str(e)}")
            return False

    def test_admin_session_authenticated(self) -> bool:
        """Test GET /api/admin/session with authentication"""
        if not self.admin_authenticated:
            self.log_test("Admin Session (Auth)", False, "Admin not authenticated")
            return False
            
        try:
            response = self.session.get(f"{API_BASE}/admin/session")
            
            if response.status_code != 200:
                self.log_test("Admin Session (Auth)", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            if data.get('authenticated') != True:
                self.log_test("Admin Session (Auth)", False, f"Expected authenticated=true, got {data.get('authenticated')}")
                return False
            
            self.log_test("Admin Session (Auth)", True, "Correctly shows authenticated")
            return True
            
        except Exception as e:
            self.log_test("Admin Session (Auth)", False, f"Exception: {str(e)}")
            return False

    def test_admin_protected_route(self) -> bool:
        """Test that admin routes require authentication"""
        # First test without auth (create new session)
        unauth_session = requests.Session()
        
        try:
            response = unauth_session.get(f"{API_BASE}/admin/events")
            
            if response.status_code != 401:
                self.log_test("Admin Protected Route", False, f"Expected 401 for unauthenticated request, got {response.status_code}")
                return False
            
            # Now test with auth
            if not self.admin_authenticated:
                self.log_test("Admin Protected Route", False, "Admin not authenticated for second test")
                return False
                
            auth_response = self.session.get(f"{API_BASE}/admin/events")
            
            if auth_response.status_code != 200:
                self.log_test("Admin Protected Route", False, f"Expected 200 for authenticated request, got {auth_response.status_code}")
                return False
            
            self.log_test("Admin Protected Route", True, "Correctly protects admin routes")
            return True
            
        except Exception as e:
            self.log_test("Admin Protected Route", False, f"Exception: {str(e)}")
            return False

    def test_admin_events_list(self) -> bool:
        """Test GET /api/admin/events"""
        if not self.admin_authenticated:
            self.log_test("Admin Events List", False, "Admin not authenticated")
            return False
            
        try:
            response = self.session.get(f"{API_BASE}/admin/events")
            
            if response.status_code != 200:
                self.log_test("Admin Events List", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            if 'events' not in data:
                self.log_test("Admin Events List", False, "Missing 'events' in response")
                return False
            
            self.log_test("Admin Events List", True, f"Retrieved {len(data['events'])} events")
            return True
            
        except Exception as e:
            self.log_test("Admin Events List", False, f"Exception: {str(e)}")
            return False

    def test_admin_event_detail(self) -> bool:
        """Test GET /api/admin/events/:slug"""
        if not self.admin_authenticated:
            self.log_test("Admin Event Detail", False, "Admin not authenticated")
            return False
            
        if not self.test_event_slug:
            self.log_test("Admin Event Detail", False, "No test event slug available")
            return False
            
        try:
            response = self.session.get(f"{API_BASE}/admin/events/{self.test_event_slug}")
            
            if response.status_code != 200:
                self.log_test("Admin Event Detail", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            if 'event' not in data:
                self.log_test("Admin Event Detail", False, "Missing 'event' in response")
                return False
            
            event = data['event']
            # Admin view should include hidden photos
            if 'photos' in event:
                self.log_test("Admin Event Detail", True, f"Retrieved event with {len(event['photos'])} photos")
            else:
                self.log_test("Admin Event Detail", True, "Retrieved event detail (no photos yet)")
            return True
            
        except Exception as e:
            self.log_test("Admin Event Detail", False, f"Exception: {str(e)}")
            return False

    def test_admin_photo_moderation(self) -> bool:
        """Test PATCH /api/admin/photos/:id for moderation"""
        if not self.admin_authenticated:
            self.log_test("Admin Photo Moderation", False, "Admin not authenticated")
            return False
            
        if not self.test_photo_id:
            self.log_test("Admin Photo Moderation", False, "No test photo ID available")
            return False
            
        try:
            # Test approve action
            moderate_data = {
                "action": "approve"
            }
            
            response = self.session.patch(f"{API_BASE}/admin/photos/{self.test_photo_id}", json=moderate_data)
            
            if response.status_code != 200:
                self.log_test("Admin Photo Moderation", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
                
            data = response.json()
            
            if 'photo' not in data:
                self.log_test("Admin Photo Moderation", False, "Missing 'photo' in response")
                return False
            
            photo = data['photo']
            if photo.get('status') != 'VISIBLE':
                self.log_test("Admin Photo Moderation", False, f"Expected status=VISIBLE, got {photo.get('status')}")
                return False
            
            self.log_test("Admin Photo Moderation", True, f"Successfully moderated photo to {photo['status']}")
            return True
            
        except Exception as e:
            self.log_test("Admin Photo Moderation", False, f"Exception: {str(e)}")
            return False

    def test_admin_logout(self) -> bool:
        """Test POST /api/admin/logout"""
        if not self.admin_authenticated:
            self.log_test("Admin Logout", False, "Admin not authenticated")
            return False
            
        try:
            response = self.session.post(f"{API_BASE}/admin/logout")
            
            if response.status_code != 200:
                self.log_test("Admin Logout", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            if data.get('authenticated') != False:
                self.log_test("Admin Logout", False, f"Expected authenticated=false, got {data.get('authenticated')}")
                return False
            
            if not data.get('loggedOut'):
                self.log_test("Admin Logout", False, "Expected loggedOut=true")
                return False
            
            self.admin_authenticated = False
            self.log_test("Admin Logout", True, "Successfully logged out")
            return True
            
        except Exception as e:
            self.log_test("Admin Logout", False, f"Exception: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all backend regression tests"""
        print("🧪 Starting Backend Regression Tests after Prisma Migration Preparation")
        print(f"🌐 Testing against: {API_BASE}")
        print("=" * 80)
        
        tests = [
            # Core API metadata
            ("API Root Metadata", self.test_api_root_metadata),
            
            # Public event APIs
            ("Create Event", self.test_create_event),
            ("List Events", self.test_list_events),
            ("Get Event by Slug", self.test_get_event_by_slug),
            
            # Upload pipeline
            ("Upload Init", self.test_upload_init),
            ("Upload Chunk", self.test_upload_chunk),
            ("Upload Complete", self.test_upload_complete),
            
            # Admin authentication
            ("Admin Session (Unauth)", self.test_admin_session_unauthenticated),
            ("Admin Login", self.test_admin_login),
            ("Admin Session (Auth)", self.test_admin_session_authenticated),
            ("Admin Protected Route", self.test_admin_protected_route),
            
            # Admin functionality
            ("Admin Events List", self.test_admin_events_list),
            ("Admin Event Detail", self.test_admin_event_detail),
            ("Admin Photo Moderation", self.test_admin_photo_moderation),
            ("Admin Logout", self.test_admin_logout),
        ]
        
        passed = 0
        failed = 0
        
        for test_name, test_func in tests:
            try:
                if test_func():
                    passed += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"❌ FAIL: {test_name} - Exception: {str(e)}")
                failed += 1
        
        print("=" * 80)
        print(f"📊 Test Results: {passed} passed, {failed} failed")
        
        if failed == 0:
            print("🎉 All backend regression tests PASSED!")
            return True
        else:
            print(f"⚠️  {failed} critical backend issues found that need attention")
            return False

if __name__ == "__main__":
    tester = BackendTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)