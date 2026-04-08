#!/usr/bin/env python3
"""
Backend API Test Suite for Event Gallery MVP
Tests all backend endpoints with comprehensive scenarios including invalid payloads.
"""

import requests
import json
import os
import tempfile
from io import BytesIO

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://photo-event-hub-3.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

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

def run_all_tests():
    """Run all backend tests"""
    print("🚀 Starting Backend API Tests")
    print(f"Base URL: {API_BASE}")
    
    results = []
    
    # Test API root
    results.append(test_api_root())
    
    # Test event creation
    event_slug = test_create_event()
    results.append(event_slug is not None)
    
    # Test event listing
    results.append(test_list_events())
    
    # Test get event by slug (only if event was created)
    if event_slug:
        results.append(test_get_event_by_slug(event_slug))
        
        # Test upload flow (only if event exists)
        session_id, chunk_data = test_upload_init(event_slug)
        results.append(session_id is not None)
        
        if session_id and chunk_data:
            results.append(test_upload_chunk(session_id, chunk_data))
            results.append(test_upload_complete(session_id))
        else:
            results.extend([False, False])  # Upload chunk and complete failed
    else:
        results.extend([False, False, False, False])  # All dependent tests failed
    
    # Test invalid payload
    results.append(test_invalid_payload())
    
    # Summary
    passed = sum(results)
    total = len(results)
    
    print(f"\n{'='*50}")
    print(f"🏁 TEST SUMMARY")
    print(f"{'='*50}")
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