#!/usr/bin/env python3
"""
Extended backend test for chunked upload pipeline with local fallback.
"""

import requests
import json
import os
import io
from PIL import Image

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://photo-event-hub-3.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

def create_test_image():
    """Create a small test image in memory"""
    img = Image.new('RGB', (100, 100), color='red')
    img_bytes = io.BytesIO()
    img.save(img_bytes, format='JPEG')
    img_bytes.seek(0)
    return img_bytes.getvalue()

def test_chunked_upload_pipeline():
    """Test the complete chunked upload pipeline with local fallback"""
    session = requests.Session()
    
    print("🧪 Testing Chunked Upload Pipeline (Local Fallback)")
    print("=" * 50)
    
    try:
        # Step 1: Create a test event
        print("1. Creating test event...")
        event_data = {"name": "Upload Test Event"}
        response = session.post(f"{API_BASE}/events", json=event_data)
        response.raise_for_status()
        event = response.json()['event']
        event_slug = event['slug']
        print(f"   ✅ Created event: {event['name']} (slug: {event_slug})")
        
        # Step 2: Initialize upload session
        print("2. Initializing upload session...")
        test_image_data = create_test_image()
        upload_init_data = {
            "eventSlug": event_slug,
            "fileName": "test-upload.jpg",
            "fileSize": len(test_image_data),
            "mimeType": "image/jpeg",
            "totalChunks": 1
        }
        
        response = session.post(f"{API_BASE}/uploads/init", json=upload_init_data)
        response.raise_for_status()
        session_data = response.json()['session']
        session_id = session_data['sessionId']
        
        if session_data['storageMode'] != 'local':
            raise Exception(f"Expected local storage mode, got: {session_data['storageMode']}")
        
        print(f"   ✅ Upload session created: {session_id} (mode: {session_data['storageMode']})")
        
        # Step 3: Upload chunk
        print("3. Uploading chunk...")
        files = {
            'chunk': ('test-upload.jpg', test_image_data, 'image/jpeg')
        }
        data = {
            'sessionId': session_id,
            'chunkIndex': 0,
            'totalChunks': 1
        }
        
        response = session.post(f"{API_BASE}/uploads/chunk", files=files, data=data)
        response.raise_for_status()
        chunk_result = response.json()
        
        if not chunk_result.get('uploaded'):
            raise Exception("Chunk upload failed")
        
        print(f"   ✅ Chunk uploaded: {chunk_result['chunkIndex']}/{chunk_result['totalChunks']}")
        
        # Step 4: Complete upload
        print("4. Completing upload...")
        complete_data = {
            "sessionId": session_id,
            "uploaderName": "Test User",
            "caption": "Test upload via chunked pipeline"
        }
        
        response = session.post(f"{API_BASE}/uploads/complete", json=complete_data)
        response.raise_for_status()
        complete_result = response.json()
        
        if 'photo' not in complete_result or 'event' not in complete_result:
            raise Exception("Upload completion failed - missing photo or event data")
        
        photo = complete_result['photo']
        updated_event = complete_result['event']
        
        print(f"   ✅ Upload completed: photo ID {photo['id']}")
        print(f"   📸 Photo URL: {photo['url']}")
        print(f"   📁 Stored as: {photo['storedName']}")
        
        # Step 5: Verify photo appears in event gallery
        print("5. Verifying photo in event gallery...")
        response = session.get(f"{API_BASE}/events/{event_slug}")
        response.raise_for_status()
        event_detail = response.json()['event']
        
        photos = event_detail.get('photos', [])
        if len(photos) == 0:
            raise Exception("No photos found in event gallery")
        
        uploaded_photo = next((p for p in photos if p['id'] == photo['id']), None)
        if not uploaded_photo:
            raise Exception("Uploaded photo not found in event gallery")
        
        print(f"   ✅ Photo found in gallery: {uploaded_photo['originalName']}")
        
        # Step 6: Test admin can see the photo
        print("6. Testing admin access to uploaded photo...")
        
        # Login as admin
        login_data = {"password": "strongpass123"}
        response = session.post(f"{API_BASE}/admin/login", json=login_data)
        response.raise_for_status()
        
        # Get admin event detail
        response = session.get(f"{API_BASE}/admin/events/{event_slug}")
        response.raise_for_status()
        admin_event = response.json()['event']
        
        admin_photos = admin_event.get('photos', [])
        admin_photo = next((p for p in admin_photos if p['id'] == photo['id']), None)
        if not admin_photo:
            raise Exception("Uploaded photo not found in admin view")
        
        print(f"   ✅ Admin can access photo: {admin_photo['originalName']}")
        
        print("=" * 50)
        print("✅ CHUNKED UPLOAD PIPELINE TEST PASSED")
        print("🔄 Complete local fallback flow working correctly")
        print("📸 Photo successfully uploaded, stored, and accessible")
        
    except Exception as e:
        print("=" * 50)
        print(f"❌ CHUNKED UPLOAD PIPELINE TEST FAILED: {str(e)}")
        raise

if __name__ == "__main__":
    test_chunked_upload_pipeline()