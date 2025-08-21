const axios = require('axios');
const ImageService = require('./imageService');

class WordPressService {
    constructor() {
        this.baseURL = process.env.WORDPRESS_URL;
        this.username = process.env.WORDPRESS_USERNAME;
        this.password = process.env.WORDPRESS_PASSWORD;

        if (!this.baseURL || !this.username || !this.password) {
            throw new Error('WordPress configuration missing. Please check WORDPRESS_URL, WORDPRESS_USERNAME, and WORDPRESS_PASSWORD in .env file');
        }

        // Initialize image service
        this.imageService = new ImageService({
            url: this.baseURL,
            username: this.username,
            password: this.password
        });

        this.apiClient = axios.create({
            baseURL: `${this.baseURL}/wp-json/wp/v2`,
            auth: {
                username: this.username,
                password: this.password
            },
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    async createStore(storeData) {
        try {
            // Process featured image if provided
            let featuredImageId = null;
            if (storeData.image) {
                console.log(`Processing featured image for store: ${storeData.name}`);
                featuredImageId = await this.imageService.processStoreImage(storeData.image, storeData.name);
                if (featuredImageId) {
                    console.log(`Featured image uploaded with ID: ${featuredImageId}`);
                }
            }

            const postData = {
                title: storeData.name,
                status: 'publish',
                acf: {
                    link: storeData.link || '',
                    name: storeData.name || '',
                    guilde: storeData.guide || '',
                    about: storeData.about || '',
                    q_and_a: storeData.qa || '',
                    star: 5, // Default rating
                    vote: 5, // Default vote count
                    title_page: storeData.name || ''
                }
            };

            // Set featured image if we have one
            if (featuredImageId) {
                postData.featured_media = featuredImageId;
            }
            const response = await this.apiClient.post('/store', postData);
            return {
                success: true,
                message: `Store "${storeData.name}" created successfully`,
                data: response.data,
                featuredImageId: featuredImageId
            };
        } catch (error) {
            if (error.response) {
                console.error('WordPress API Error:', error.response.data);
                throw new Error(`WordPress API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                console.error('Network Error:', error.message);
                throw new Error(`Network Error: ${error.message}`);
            }
        }
    }

    formatStoreContent(storeData) {
        let content = `<h2>About ${storeData.name}</h2>\n`;

        if (storeData.about) {
            content += `<p>${storeData.about}</p>\n\n`;
        }

        if (storeData.links) {
            content += `<h3>Links</h3>\n<p>${storeData.links}</p>\n\n`;
        }

        if (storeData.guide) {
            content += `<h3>Guide</h3>\n<div>${storeData.guide}</div>\n\n`;
        }

        if (storeData.qa) {
            content += `<h3>Q&A</h3>\n<div>${storeData.qa}</div>\n\n`;
        }

        return content;
    }

    async testConnection() {
        try {
            const response = await this.apiClient.get('/store');
            return { success: true, message: 'Connection successful' };
        } catch (error) {
            console.error('WordPress connection test failed:', error.message);
            throw new Error(`WordPress connection failed: ${error.message}`);
        }
    }

    async getStores(limit = 100) {
        try {
            const response = await this.apiClient.get(`/store?per_page=${limit}`);
            return {
                data: response.data,
                totalCount: parseInt(response.headers['x-wp-total']) || 0
            };
        } catch (error) {
            console.error('Error fetching stores:', error.message);
            throw new Error(`Failed to fetch stores: ${error.message}`);
        }
    }

    async getAllStores() {
        try {
            let allStores = [];
            let page = 1;
            let hasMore = true;

            while (hasMore) {
                try {
                    const response = await this.apiClient.get(`/store?per_page=100&page=${page}`);
                    const stores = response.data;

                    if (stores.length === 0) {
                        hasMore = false;
                    } else {
                        allStores = allStores.concat(stores);
                        page++;
                    }

                    // Safety break to avoid infinite loops
                    if (page > 50) {
                        console.warn('Stopped fetching after 50 pages (5000 stores)');
                        break;
                    }
                } catch (error) {
                    break;
                }
            }

            console.log(`Fetched ${allStores.length} existing stores from WordPress`);
            return allStores;
        } catch (error) {
            console.error('Error fetching all stores:', error.message);
            throw new Error(`Failed to fetch all stores: ${error.message}`);
        }
    }

    checkDuplicate(newStore, existingStores) {
        // Check for duplicates based on store name (case-insensitive)
        const normalizedNewName = newStore.name.toLowerCase().trim();

        for (const existingStore of existingStores) {
            const existingTitle = existingStore.title?.rendered || existingStore.title || '';
            const normalizedExistingName = existingTitle.toLowerCase().trim();
            if (normalizedNewName === normalizedExistingName) {
                return {
                    isDuplicate: true,
                    existingStore: existingStore,
                    reason: 'Same name'
                };
            }
        }

        return { isDuplicate: false };
    }

    async updateStore(storeId, storeData) {
        try {
            const postData = {
                title: storeData.name,
                content: this.formatStoreContent(storeData),
                acf: {
                    link: storeData.links || '',
                    name: storeData.name || '',
                    guilde: storeData.guide || '',
                    about: storeData.about || '',
                    q_and_a: storeData.qa || '',
                    star: 5, // Default rating
                    vote: 5, // Default vote count
                    title_page: storeData.name || ''
                }
            };

            const response = await this.apiClient.put(`/store/${storeId}`, postData);
            return response.data;
        } catch (error) {
            console.error('Error updating store:', error.message);
            throw new Error(`Failed to update store: ${error.message}`);
        }
    }

    async deleteStore(storeId) {
        try {
            const response = await this.apiClient.delete(`/store/${storeId}`);
            return response.data;
        } catch (error) {
            console.error('Error deleting store:', error.message);
            throw new Error(`Failed to delete store: ${error.message}`);
        }
    }

    async createCoupon(couponData, storePostId) {
        try {
            const postData = {
                title: couponData.coupon_name,
                status: 'publish',
                acf: {
                    coupon_code: couponData.coupon_code,
                    discount_value: couponData.discount_value,
                    store_link: storePostId, // Link to the store post
                    is_deal: couponData.is_deal,
                    link: couponData.link || '',
                    discount_bag: couponData.discount_bag,
                    is_verified: couponData.is_verified !== false, // Default to true
                    description: couponData.description || ''
                }
            };
            const response = await this.apiClient.post('/coupon', postData);
            return {
                success: true,
                message: `Coupon "${couponData.coupon_name}" created successfully`,
                data: response.data
            };
        } catch (error) {
            if (error.response) {
                console.error('WordPress API Error creating coupon:', error.response.data);
                throw new Error(`WordPress API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                console.error('Network Error creating coupon:', error.message);
                throw new Error(`Network Error: ${error.message}`);
            }
        }
    }

    async createStoreWithCoupons(storeData) {
        try {
            // First create the store
            const storeResult = await this.createStore(storeData);

            if (!storeResult.success) {
                throw new Error('Failed to create store');
            }

            const storePostId = storeResult.data?.id;
            const coupons = storeData.coupons || [];
            const couponResults = [];

            // Create coupons for this store
            for (const coupon of coupons) {
                try {
                    // Update store_link with the actual store post ID
                    const couponWithStoreLink = {
                        ...coupon,
                        store_link: storePostId
                    };

                    const couponResult = await this.createCoupon(couponWithStoreLink, storePostId);
                    couponResults.push({
                        name: coupon.coupon_name,
                        success: true,
                        id: couponResult.data?.id
                    });
                    console.log(`Created coupon: ${coupon.coupon_name} for store: ${storeData.name}`);
                } catch (error) {
                    console.error(`Failed to create coupon ${coupon.coupon_name}:`, error.message);
                    couponResults.push({
                        name: coupon.coupon_name,
                        success: false,
                        error: error.message
                    });
                }
            }

            return {
                success: true,
                message: `Store "${storeData.name}" created with ${couponResults.filter(c => c.success).length}/${coupons.length} coupons`,
                storeData: storeResult.data,
                coupons: couponResults,
                totalCoupons: coupons.length,
                successfulCoupons: couponResults.filter(c => c.success).length,
                featuredImageId: storeResult.featuredImageId
            };
        } catch (error) {
            console.error('Error creating store with coupons:', error);
            throw error;
        }
    }

    cleanupImageResources() {
        if (this.imageService) {
            this.imageService.cleanupTempDirectory();
        }
    }
}

module.exports = WordPressService;
