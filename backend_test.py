#!/usr/bin/env python3
"""
Backend regression test for Event Gallery MVP after DATA_ACCESS_DRIVER switch to Prisma.
Tests all backend APIs to ensure they work correctly in Prisma mode with PostgreSQL.
"""

import json
import os
import requests
import sys
from typing import Dict, Any, Optional

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
        self.test_results = []
        self.admin_authenticated = False
        
    def log_test(self, test_name: str, success: bool, details: str = ""):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        
        self.test_results.append({
            'test': test_name,
            'success': success,
            'details': details
        })
        
    def make_request(self, method: str, endpoint: str, data: Optional[Dict] = None, 
                    files: Optional[Dict] = None) -> requests.Response:
        """Make HTTP request with error handling"""
        url = f"{API_BASE}{endpoint}"
        try:
            if method.upper() == 'GET':
                response = self.session.get(url)
            elif method.upper() == 'POST':
                if files:
                    # For multipart uploads, don't set Content-Type header - let requests handle it
                    headers = {k: v for k, v in self.session.headers.items() if k.lower() != 'content-type'}
                    response = requests.post(url, data=data, files=files, headers=headers, cookies=self.session.cookies)
                else:
                    response = self.session.post(url, json=data)
            elif method.upper() == 'PATCH':
                response = self.session.patch(url, json=data)
            elif method.upper() == 'DELETE':
                response = self.session.delete(url)
            else:
                raise ValueError(f"Unsupported method: {method}")
                
            return response
        except Exception as e:
            print(f"Request failed: {e}")
            raise

    def test_root_metadata(self):
        """Test GET /api root metadata - verify databaseConfigured=true while drivers remain local"""
        try:
            response = self.make_request('GET', '')
            
            if response.status_code != 200:
                self.log_test("Root metadata endpoint", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            # Check required fields
            required_fields = ['name', 'repositoryMode', 'configuredDataAccessDriver', 
                             'configuredAdminAuthDriver', 'databaseConfigured']
            
            missing_fields = [field for field in required_fields if field not in data]
            if missing_fields:
                self.log_test("Root metadata fields", False, f"Missing fields: {missing_fields}")
                return False
            
            # Verify specific requirements after Prisma switch
            checks = [
                (data.get('databaseConfigured') == True, "databaseConfigured should be true"),
                (data.get('repositoryMode') == 'prisma', "repositoryMode should be prisma"),
                (data.get('configuredDataAccessDriver') == 'prisma', "configuredDataAccessDriver should be prisma"),
                (data.get('configuredAdminAuthDriver') == 'local', "configuredAdminAuthDriver should be local")
            ]
            
            for check, message in checks:
                if not check:
                    self.log_test("Root metadata validation", False, message)
                    return False
            
            self.log_test("Root metadata endpoint", True, 
                         f"databaseConfigured={data['databaseConfigured']}, "
                         f"repositoryMode={data['repositoryMode']}, "
                         f"configuredDataAccessDriver={data['configuredDataAccessDriver']}, "
                         f"configuredAdminAuthDriver={data['configuredAdminAuthDriver']}")
            return True
            
        except Exception as e:
            self.log_test("Root metadata endpoint", False, f"Exception: {str(e)}")
            return False

    def test_event_apis(self):
        """Test public event APIs in local mode"""
        try:
            # Test GET /api/events (list events)
            response = self.make_request('GET', '/events')
            if response.status_code != 200:
                self.log_test("List events API", False, f"Status: {response.status_code}")
                return False
            
            events_data = response.json()
            if 'events' not in events_data:
                self.log_test("List events API", False, "Missing 'events' field in response")
                return False
            
            self.log_test("List events API", True, f"Found {len(events_data['events'])} events")
            
            # Test POST /api/events (create event)
            test_event = {
                "name": "Backend Test Event",
                "slug": "backend-test-event"
            }
            
            response = self.make_request('POST', '/events', test_event)
            if response.status_code != 201:
                self.log_test("Create event API", False, f"Status: {response.status_code}")
                return False
            
            created_event = response.json().get('event')
            if not created_event or not created_event.get('id'):
                self.log_test("Create event API", False, "Invalid event response")
                return False
            
            self.log_test("Create event API", True, f"Created event: {created_event['slug']}")
            
            # Test GET /api/events/:slug (get specific event)
            response = self.make_request('GET', f"/events/{created_event['slug']}")
            if response.status_code != 200:
                self.log_test("Get event by slug API", False, f"Status: {response.status_code}")
                return False
            
            event_detail = response.json().get('event')
            if not event_detail or event_detail['id'] != created_event['id']:
                self.log_test("Get event by slug API", False, "Event mismatch")
                return False
            
            self.log_test("Get event by slug API", True, f"Retrieved event: {event_detail['name']}")
            
            # Store event for upload tests
            self.test_event = created_event
            return True
            
        except Exception as e:
            self.log_test("Event APIs", False, f"Exception: {str(e)}")
            return False

    def test_upload_pipeline(self):
        """Test chunked upload pipeline in local mode"""
        try:
            if not hasattr(self, 'test_event'):
                self.log_test("Upload pipeline", False, "No test event available")
                return False
            
            # Test POST /api/uploads/init
            init_payload = {
                "eventSlug": self.test_event['slug'],
                "fileName": "test-photo.jpg",
                "fileSize": 1024,
                "mimeType": "image/jpeg",
                "totalChunks": 1
            }
            
            response = self.make_request('POST', '/uploads/init', init_payload)
            if response.status_code != 201:
                self.log_test("Upload init API", False, f"Status: {response.status_code}")
                return False
            
            session_data = response.json().get('session')
            if not session_data or not session_data.get('sessionId'):
                self.log_test("Upload init API", False, "Invalid session response")
                return False
            
            self.log_test("Upload init API", True, f"Session ID: {session_data['sessionId']}")
            
            # Test POST /api/uploads/chunk
            # Create a small test file chunk
            test_chunk = b"fake image data for testing"
            
            chunk_data = {
                'sessionId': session_data['sessionId'],
                'chunkIndex': '0',
                'totalChunks': '1'
            }
            
            files = {'chunk': ('chunk0', test_chunk, 'application/octet-stream')}
            
            # Use the make_request method which handles multipart correctly
            response = self.make_request('POST', '/uploads/chunk', data=chunk_data, files=files)
            
            if response.status_code != 200:
                self.log_test("Upload chunk API", False, f"Status: {response.status_code}")
                return False
            
            chunk_response = response.json()
            if not chunk_response.get('uploaded'):
                self.log_test("Upload chunk API", False, "Chunk upload failed")
                return False
            
            self.log_test("Upload chunk API", True, "Chunk uploaded successfully")
            
            # Test POST /api/uploads/complete
            complete_payload = {
                "sessionId": session_data['sessionId'],
                "uploaderName": "Backend Tester",
                "caption": "Test photo from backend test"
            }
            
            response = self.make_request('POST', '/uploads/complete', complete_payload)
            if response.status_code != 201:
                self.log_test("Upload complete API", False, f"Status: {response.status_code}")
                return False
            
            complete_response = response.json()
            if not complete_response.get('photo') or not complete_response.get('event'):
                self.log_test("Upload complete API", False, "Invalid completion response")
                return False
            
            self.log_test("Upload complete API", True, "Upload completed successfully")
            
            # Verify photo appears in gallery metadata by checking event detail
            response = self.make_request('GET', f"/events/{self.test_event['slug']}")
            if response.status_code == 200:
                updated_event = response.json().get('event')
                if updated_event and updated_event.get('photos'):
                    photo_count = len(updated_event['photos'])
                    self.log_test("Photo in gallery metadata", True, f"Photo appears in event gallery ({photo_count} photos)")
                else:
                    self.log_test("Photo in gallery metadata", False, "Photo not found in event gallery")
            else:
                self.log_test("Photo in gallery metadata", False, "Could not verify gallery metadata")
            
            # Store photo for moderation tests
            self.test_photo = complete_response['photo']
            return True
            
        except Exception as e:
            self.log_test("Upload pipeline", False, f"Exception: {str(e)}")
            return False

    def test_admin_auth(self):
        """Test admin authentication and session APIs in local mode"""
        try:
            # Test GET /api/admin/session (check auth status)
            response = self.make_request('GET', '/admin/session')
            if response.status_code != 200:
                self.log_test("Admin session check", False, f"Status: {response.status_code}")
                return False
            
            session_data = response.json()
            if 'authenticated' not in session_data:
                self.log_test("Admin session check", False, "Missing authentication status")
                return False
            
            self.log_test("Admin session check", True, f"Auth status: {session_data['authenticated']}")
            
            # Test POST /api/admin/login (with known dev password)
            login_payload = {"password": "strongpass123"}
            
            response = self.make_request('POST', '/admin/login', login_payload)
            if response.status_code != 200:
                self.log_test("Admin login", False, f"Status: {response.status_code}")
                return False
            
            login_response = response.json()
            if not login_response.get('authenticated'):
                self.log_test("Admin login", False, "Login failed")
                return False
            
            self.log_test("Admin login", True, "Successfully authenticated")
            self.admin_authenticated = True
            
            # Test authenticated session check
            response = self.make_request('GET', '/admin/session')
            if response.status_code != 200:
                self.log_test("Authenticated session check", False, f"Status: {response.status_code}")
                return False
            
            auth_session = response.json()
            if not auth_session.get('authenticated'):
                self.log_test("Authenticated session check", False, "Session not authenticated")
                return False
            
            self.log_test("Authenticated session check", True, "Session authenticated")
            return True
            
        except Exception as e:
            self.log_test("Admin authentication", False, f"Exception: {str(e)}")
            return False

    def test_admin_protected_routes(self):
        """Test admin protected routes work correctly"""
        try:
            if not self.admin_authenticated:
                self.log_test("Admin protected routes", False, "Not authenticated")
                return False
            
            # Test GET /api/admin/events (admin event list)
            response = self.make_request('GET', '/admin/events')
            if response.status_code != 200:
                self.log_test("Admin events list", False, f"Status: {response.status_code}")
                return False
            
            admin_events = response.json()
            if 'events' not in admin_events:
                self.log_test("Admin events list", False, "Missing events field")
                return False
            
            self.log_test("Admin events list", True, f"Found {len(admin_events['events'])} events")
            
            # Test GET /api/admin/events/:slug (admin event detail)
            if hasattr(self, 'test_event'):
                response = self.make_request('GET', f"/admin/events/{self.test_event['slug']}")
                if response.status_code != 200:
                    self.log_test("Admin event detail", False, f"Status: {response.status_code}")
                    return False
                
                event_detail = response.json().get('event')
                if not event_detail:
                    self.log_test("Admin event detail", False, "Missing event data")
                    return False
                
                self.log_test("Admin event detail", True, f"Retrieved event: {event_detail['name']}")
            
            return True
            
        except Exception as e:
            self.log_test("Admin protected routes", False, f"Exception: {str(e)}")
            return False

    def test_photo_moderation(self):
        """Test admin photo moderation APIs"""
        try:
            if not self.admin_authenticated:
                self.log_test("Photo moderation", False, "Not authenticated")
                return False
            
            if not hasattr(self, 'test_photo'):
                self.log_test("Photo moderation", False, "No test photo available")
                return False
            
            # Test PATCH /api/admin/photos/:id (moderate photo)
            moderation_payload = {"action": "approve"}
            
            response = self.make_request('PATCH', f"/admin/photos/{self.test_photo['id']}", 
                                       moderation_payload)
            if response.status_code != 200:
                self.log_test("Photo moderation (approve)", False, f"Status: {response.status_code}")
                return False
            
            moderated_photo = response.json().get('photo')
            if not moderated_photo or moderated_photo['status'] != 'VISIBLE':
                self.log_test("Photo moderation (approve)", False, "Photo not approved correctly")
                return False
            
            self.log_test("Photo moderation (approve)", True, "Photo approved successfully")
            
            # Test reject action
            reject_payload = {"action": "reject"}
            
            response = self.make_request('PATCH', f"/admin/photos/{self.test_photo['id']}", 
                                       reject_payload)
            if response.status_code != 200:
                self.log_test("Photo moderation (reject)", False, f"Status: {response.status_code}")
                return False
            
            rejected_photo = response.json().get('photo')
            if not rejected_photo or rejected_photo['status'] != 'HIDDEN':
                self.log_test("Photo moderation (reject)", False, "Photo not rejected correctly")
                return False
            
            self.log_test("Photo moderation (reject)", True, "Photo rejected successfully")
            
            # Test DELETE /api/admin/photos/:id (delete photo)
            response = self.make_request('DELETE', f"/admin/photos/{self.test_photo['id']}")
            if response.status_code != 200:
                self.log_test("Photo deletion", False, f"Status: {response.status_code}")
                return False
            
            delete_response = response.json()
            if not delete_response.get('deleted') or not delete_response.get('photo'):
                self.log_test("Photo deletion", False, "Photo not deleted correctly")
                return False
            
            self.log_test("Photo deletion", True, "Photo deleted successfully")
            return True
            
        except Exception as e:
            self.log_test("Photo moderation", False, f"Exception: {str(e)}")
            return False

    def test_admin_logout(self):
        """Test admin logout functionality"""
        try:
            if not self.admin_authenticated:
                self.log_test("Admin logout", False, "Not authenticated")
                return False
            
            # Test POST /api/admin/logout
            response = self.make_request('POST', '/admin/logout')
            if response.status_code != 200:
                self.log_test("Admin logout", False, f"Status: {response.status_code}")
                return False
            
            logout_response = response.json()
            if logout_response.get('authenticated') != False:
                self.log_test("Admin logout", False, "Logout failed")
                return False
            
            self.log_test("Admin logout", True, "Successfully logged out")
            
            # Verify session is cleared
            response = self.make_request('GET', '/admin/session')
            if response.status_code != 200:
                self.log_test("Post-logout session check", False, f"Status: {response.status_code}")
                return False
            
            session_data = response.json()
            if session_data.get('authenticated') != False:
                self.log_test("Post-logout session check", False, "Session not cleared")
                return False
            
            self.log_test("Post-logout session check", True, "Session cleared")
            self.admin_authenticated = False
            return True
            
        except Exception as e:
            self.log_test("Admin logout", False, f"Exception: {str(e)}")
            return False

    def test_migration_script_not_executed(self):
        """Verify the system is now running in Prisma mode after driver switch"""
        try:
            # Check that we're now in Prisma mode by verifying root metadata
            response = self.make_request('GET', '')
            if response.status_code != 200:
                self.log_test("Prisma mode verification", False, "Cannot check root metadata")
                return False
            
            data = response.json()
            
            # Verify we're now in Prisma mode
            if (data.get('repositoryMode') != 'prisma' or 
                data.get('configuredDataAccessDriver') != 'prisma'):
                self.log_test("Prisma mode verification", False, 
                             "System is not in Prisma mode as expected")
                return False
            
            # Verify admin auth remains local
            if data.get('configuredAdminAuthDriver') != 'local':
                self.log_test("Prisma mode verification", False, 
                             "Admin auth should remain local")
                return False
            
            self.log_test("Prisma mode verification", True, 
                         "System correctly switched to Prisma mode with local admin auth")
            return True
            
        except Exception as e:
            self.log_test("Prisma mode verification", False, f"Exception: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all backend regression tests"""
        print("=== Backend Regression Test Suite ===")
        print(f"Testing against: {API_BASE}")
        print()
        
        tests = [
            ("Root Metadata", self.test_root_metadata),
            ("Event APIs", self.test_event_apis),
            ("Upload Pipeline", self.test_upload_pipeline),
            ("Admin Authentication", self.test_admin_auth),
            ("Admin Protected Routes", self.test_admin_protected_routes),
            ("Photo Moderation", self.test_photo_moderation),
            ("Admin Logout", self.test_admin_logout),
            ("Prisma Mode Verification", self.test_migration_script_not_executed)
        ]
        
        passed = 0
        total = len(tests)
        
        for test_name, test_func in tests:
            print(f"\n--- {test_name} ---")
            try:
                if test_func():
                    passed += 1
            except Exception as e:
                print(f"❌ FAIL: {test_name} - Unexpected error: {str(e)}")
        
        print(f"\n=== Test Summary ===")
        print(f"Passed: {passed}/{total}")
        print(f"Failed: {total - passed}/{total}")
        
        if passed == total:
            print("✅ All backend regression tests PASSED")
            return True
        else:
            print("❌ Some backend regression tests FAILED")
            return False

def main():
    """Main test runner"""
    tester = BackendTester()
    success = tester.run_all_tests()
    
    if not success:
        sys.exit(1)

if __name__ == "__main__":
    main()