#!/usr/bin/env python3
"""
Test script for image generation feature.

This script sends a prompt to ChatGPT requesting image generation
and saves the generated image if one is returned.
"""

import base64
import json
from pathlib import Path

import requests


def test_image_generation():
    """Test the image generation feature by requesting ChatGPT to generate an image."""
    url = "http://localhost:8000/query"
    
    # Prompt that requests image generation
    payload = {
        "prompt": "Generiere ein Bild von einem Sonnenuntergang am Strand",
        "startNewChat": True,
        "useTemporaryChat": False  # Disable temp chat for image generation
    }
    
    print("Sending image generation request to ChatGPT...")
    print(f"Prompt: {payload['prompt']}")
    
    try:
        response = requests.post(url, json=payload, timeout=180)
        response.raise_for_status()
        
        data = response.json()
        print(f"\nStatus: {data['status']}")
        print(f"Request ID: {data['request_id']}")
        print(f"\nResponse text:\n{data['response']}")
        
        # Check if a generated image is included
        if 'generatedImage' in data and data['generatedImage']:
            image_data = data['generatedImage']
            print(f"\n✓ Generated image detected!")
            print(f"  - URL: {image_data['url']}")
            print(f"  - Alt: {image_data['alt']}")
            print(f"  - Base64 length: {len(image_data['base64'])} characters")
            
            # Save the image to a file
            output_path = Path("generated_image.png")
            image_bytes = base64.b64decode(image_data['base64'])
            output_path.write_bytes(image_bytes)
            
            print(f"  - Saved to: {output_path.absolute()}")
            print(f"  - File size: {len(image_bytes)} bytes")
        else:
            print("\n✗ No generated image in response")
            
    except requests.exceptions.RequestException as e:
        print(f"Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}")


if __name__ == "__main__":
    test_image_generation()
