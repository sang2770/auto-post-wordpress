const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');

const streamPipeline = promisify(pipeline);

class ImageService {
    constructor(wpAuth) {
        this.wpAuth = wpAuth;
        this.tempDir = path.join(__dirname, '../temp');
        
        // Create temp directory if it doesn't exist
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    isValidImageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
        const lowerUrl = url.toLowerCase();
        
        return imageExtensions.some(ext => lowerUrl.includes(ext)) || 
               lowerUrl.includes('image') ||
               url.startsWith('data:image/');
    }

    async downloadImage(imageUrl, filename) {
        try {
            const response = await axios({
                method: 'GET',
                url: imageUrl,
                responseType: 'stream',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const filePath = path.join(this.tempDir, filename);
            await streamPipeline(response.data, createWriteStream(filePath));
            
            return filePath;
        } catch (error) {
            console.error(`Failed to download image ${imageUrl}:`, error.message);
            throw new Error(`Failed to download image: ${error.message}`);
        }
    }

    async uploadToWordPress(filePath, filename, alt = '') {
        try {
            const fileBuffer = fs.readFileSync(filePath);
            const mimeType = this.getMimeType(filename);

            console.log(`Uploading ${filename} (${mimeType}) to WordPress...`);

            const response = await axios.post(
                `${this.wpAuth.url}/wp-json/wp/v2/media`,
                fileBuffer,
                {
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${this.wpAuth.username}:${this.wpAuth.password}`).toString('base64')}`,
                        'Content-Type': mimeType,
                        'Content-Disposition': `attachment; filename="${filename}"`,
                    },
                    timeout: 60000
                }
            );

            // Set alt text if provided
            if (alt && response.data.id) {
                await axios.post(
                    `${this.wpAuth.url}/wp-json/wp/v2/media/${response.data.id}`,
                    { alt_text: alt },
                    {
                        headers: {
                            'Authorization': `Basic ${Buffer.from(`${this.wpAuth.username}:${this.wpAuth.password}`).toString('base64')}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
            }

            return response.data;
        } catch (error) {
            console.error(`Failed to upload image to WordPress:`, error.response?.data || error.message);
            
            // More specific error handling
            if (error.response?.data?.code === 'rest_upload_sideload_error') {
                console.error(`File type not allowed. Filename: ${filename}, MIME type: ${this.getMimeType(filename)}`);
            }
            
            throw new Error(`WordPress upload failed: ${error.response?.data?.message || error.message}`);
        }
    }

    getMimeType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
        };
        return mimeTypes[ext] || 'image/jpeg';
    }

    async processStoreImage(imageUrl, storeName) {
        if (!this.isValidImageUrl(imageUrl)) {
            console.log(`Skipping invalid image URL for store ${storeName}: ${imageUrl}`);
            return null;
        }

        try {
            // Create a safe filename
            const urlParts = imageUrl.split('?')[0].split('/'); // Remove query parameters first
            let filename = urlParts[urlParts.length - 1];
            
            // If no extension found, try to get it from URL or default to jpg
            if (!path.extname(filename)) {
                const ext = this.guessExtensionFromUrl(imageUrl) || '.jpg';
                filename = `${storeName.replace(/[^a-zA-Z0-9]/g, '_')}_image${ext}`;
            }
            
            // Ensure filename is safe and has proper extension
            const baseName = path.parse(filename).name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const ext = path.extname(filename) || this.guessExtensionFromUrl(imageUrl) || '.jpg';
            filename = `${baseName}${ext}`;

            console.log(`Processing image for store ${storeName}: ${imageUrl}`);

            // Download image
            const filePath = await this.downloadImage(imageUrl, filename);

            // Upload to WordPress
            const mediaData = await this.uploadToWordPress(filePath, filename, `${storeName} logo`);

            // Clean up temp file
            this.cleanupTempFile(filePath);

            console.log(`Successfully uploaded image for store ${storeName}, media ID: ${mediaData.id}`);
            return mediaData.id;

        } catch (error) {
            console.error(`Failed to process image for store ${storeName}:`, error.message);
            return null;
        }
    }

    guessExtensionFromUrl(url) {
        const lowerUrl = url.toLowerCase();
        
        // First try to extract extension from URL path (before query parameters)
        const urlPath = url.split('?')[0];
        const pathExt = path.extname(urlPath).toLowerCase();
        if (pathExt && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(pathExt)) {
            return pathExt === '.jpeg' ? '.jpg' : pathExt;
        }
        
        // Fallback to searching in the full URL
        if (lowerUrl.includes('.jpg') || lowerUrl.includes('jpeg')) return '.jpg';
        if (lowerUrl.includes('.png')) return '.png';
        if (lowerUrl.includes('.gif')) return '.gif';
        if (lowerUrl.includes('.webp')) return '.webp';
        if (lowerUrl.includes('.svg')) return '.svg';
        return null;
    }

    cleanupTempFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            console.error(`Failed to cleanup temp file ${filePath}:`, error.message);
        }
    }

    cleanupTempDirectory() {
        try {
            const files = fs.readdirSync(this.tempDir);
            files.forEach(file => {
                const filePath = path.join(this.tempDir, file);
                fs.unlinkSync(filePath);
            });
            console.log('Cleaned up temporary image files');
        } catch (error) {
            console.error('Failed to cleanup temp directory:', error.message);
        }
    }
}

module.exports = ImageService;
