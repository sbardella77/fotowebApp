#!/usr/bin/env python3
"""
Test admin moderation functionality after Vercel Blob migration.
"""

import requests
import json
import os

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'http://localhost:3000')
API_BASE = f"{BASE_URL}/api"

def test_admin_moderation():
    """Test admin photo moderation functionality"""
    session = requests.Session()
    
    print("🧪 Testing Admin Moderation Functionality")
    print("=" * 45)
    
    try:
        # Step 1: Login as admin
        print("1. Logging in as admin...")
        login_data = {"password": "strongpass123"}
        response = session.post(f"{API_BASE}/admin/login", json=login_data)
        response.raise_for_status()
        print("   ✅ Admin login successful")
        
        # Step 2: Get admin events list
        print("2. Getting admin events list...")
        response = session.get(f"{API_BASE}/admin/events")
        response.raise_for_status()
        events = response.json()['events']
        
        if len(events) == 0:
            raise Exception("No events found for admin testing")
        
        # Find an event with photos
        test_event = None
        for event in events:
            response = session.get(f"{API_BASE}/admin/events/{event['slug']}")
            response.raise_for_status()
            event_detail = response.json()['event']
            if event_detail.get('photos') and len(event_detail['photos']) > 0:
                test_event = event_detail
                break
        
        if not test_event:
            raise Exception("No events with photos found for moderation testing")
        
        print(f"   ✅ Found event with photos: {test_event['name']} ({len(test_event['photos'])} photos)")
        
        # Step 3: Test photo moderation - reject a photo
        print("3. Testing photo rejection...")
        test_photo = test_event['photos'][0]
        photo_id = test_photo['id']
        
        moderate_data = {"action": "reject"}
        response = session.patch(f"{API_BASE}/admin/photos/{photo_id}", json=moderate_data)
        response.raise_for_status()
        moderated_photo = response.json()['photo']
        
        if moderated_photo['status'] != 'HIDDEN':
            raise Exception(f"Expected photo status HIDDEN, got: {moderated_photo['status']}")
        
        print(f"   ✅ Photo rejected: {moderated_photo['originalName']} (status: {moderated_photo['status']})")
        
        # Step 4: Verify photo is hidden from public view
        print("4. Verifying photo hidden from public view...")
        response = session.get(f"{API_BASE}/events/{test_event['slug']}")
        response.raise_for_status()
        public_event = response.json()['event']
        
        public_photos = public_event.get('photos', [])
        hidden_photo_in_public = any(p['id'] == photo_id for p in public_photos)
        
        if hidden_photo_in_public:
            raise Exception("Rejected photo still visible in public view")
        
        print("   ✅ Rejected photo correctly hidden from public view")
        
        # Step 5: Test photo moderation - approve the photo
        print("5. Testing photo approval...")
        moderate_data = {"action": "approve"}
        response = session.patch(f"{API_BASE}/admin/photos/{photo_id}", json=moderate_data)
        response.raise_for_status()
        moderated_photo = response.json()['photo']
        
        if moderated_photo['status'] != 'VISIBLE':
            raise Exception(f"Expected photo status VISIBLE, got: {moderated_photo['status']}")
        
        print(f"   ✅ Photo approved: {moderated_photo['originalName']} (status: {moderated_photo['status']})")
        
        # Step 6: Verify photo is visible in public view
        print("6. Verifying photo visible in public view...")
        response = session.get(f"{API_BASE}/events/{test_event['slug']}")
        response.raise_for_status()
        public_event = response.json()['event']
        
        public_photos = public_event.get('photos', [])
        visible_photo_in_public = any(p['id'] == photo_id for p in public_photos)
        
        if not visible_photo_in_public:
            raise Exception("Approved photo not visible in public view")
        
        print("   ✅ Approved photo correctly visible in public view")
        
        # Step 7: Test photo deletion (if there are multiple photos)
        if len(test_event['photos']) > 1:
            print("7. Testing photo deletion...")
            delete_photo = test_event['photos'][1]
            delete_photo_id = delete_photo['id']
            
            response = session.delete(f"{API_BASE}/admin/photos/{delete_photo_id}")
            response.raise_for_status()
            delete_result = response.json()
            
            if not delete_result.get('deleted'):
                raise Exception("Photo deletion not confirmed")
            
            print(f"   ✅ Photo deleted: {delete_result['photo']['originalName']}")
            
            # Verify photo is gone from admin view
            response = session.get(f"{API_BASE}/admin/events/{test_event['slug']}")
            response.raise_for_status()
            updated_event = response.json()['event']
            
            deleted_photo_exists = any(p['id'] == delete_photo_id for p in updated_event.get('photos', []))
            if deleted_photo_exists:
                raise Exception("Deleted photo still exists in admin view")
            
            print("   ✅ Deleted photo correctly removed from admin view")
        else:
            print("7. Skipping photo deletion test (only one photo available)")
        
        print("=" * 45)
        print("✅ ADMIN MODERATION TEST PASSED")
        print("🔧 Photo approve/reject/delete functionality working correctly")
        print("👁️ Public visibility controls functioning properly")
        
    except Exception as e:
        print("=" * 45)
        print(f"❌ ADMIN MODERATION TEST FAILED: {str(e)}")
        raise

if __name__ == "__main__":
    test_admin_moderation()