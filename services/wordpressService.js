const axios = require("axios");
const ImageService = require("./imageService");
const { JSDOM } = require("jsdom");
class WordPressService {
  constructor() {
    this.baseURL = process.env.WORDPRESS_URL;
    this.username = process.env.WORDPRESS_USERNAME;
    this.password = process.env.WORDPRESS_PASSWORD;

    if (!this.baseURL || !this.username || !this.password) {
      throw new Error(
        "WordPress configuration missing. Please check WORDPRESS_URL, WORDPRESS_USERNAME, and WORDPRESS_PASSWORD in .env file"
      );
    }

    // Initialize image service
    this.imageService = new ImageService({
      url: this.baseURL,
      username: this.username,
      password: this.password,
    });

    this.apiClient = axios.create({
      baseURL: `${this.baseURL}/wp-json/wp/v2`,
      auth: {
        username: this.username,
        password: this.password,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async createStore(storeData) {
    try {
      // Process featured image if provided
      let featuredImageId = null;
      if (storeData.image) {
        console.log(`Processing featured image for store: ${storeData.name}`);
        featuredImageId = await this.imageService.processStoreImage(
          storeData.image,
          storeData.name
        );
        if (featuredImageId) {
          console.log(`Featured image uploaded with ID: ${featuredImageId}`);
        }
      }

      const postData = {
        title: storeData.name,
        status: "publish",
        acf: {
          link: storeData.link || "",
          name: storeData.name || "",
          guilde: storeData.guide || "",
          about: storeData.about || "",
          q_and_a: storeData.qa || "",
          star: 5, // Default rating
          vote: 5, // Default vote count
          title_page: storeData.name || "",
          description: storeData.description || "",
        },
      };

      // Set featured image if we have one
      if (featuredImageId) {
        postData.featured_media = featuredImageId;
      }
      const response = await this.apiClient.post("/store", postData);
      return {
        success: true,
        message: `Store "${storeData.name}" created successfully`,
        data: response.data,
        featuredImageId: featuredImageId,
      };
    } catch (error) {
      if (error.response) {
        console.error("WordPress API Error:", error.response.data);
        throw new Error(
          `WordPress API Error: ${error.response.status} - ${JSON.stringify(
            error.response.data
          )}`
        );
      } else {
        console.error("Network Error:", error.message);
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
      const response = await this.apiClient.get("/store");
      return { success: true, message: "Connection successful" };
    } catch (error) {
      console.error("WordPress connection test failed:", error.message);
      throw new Error(`WordPress connection failed: ${error.message}`);
    }
  }

  async getStores(limit = 100) {
    try {
      const response = await this.apiClient.get(`/store?per_page=${limit}`);
      return {
        data: response.data,
        totalCount: parseInt(response.headers["x-wp-total"]) || 0,
      };
    } catch (error) {
      console.error("Error fetching stores:", error.message);
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
          const response = await this.apiClient.get(
            `/store?per_page=100&page=${page}&_embed=1`
          );
          const stores = response.data;

          if (stores.length === 0) {
            hasMore = false;
          } else {
            // Add featured image URL to each store
            for (const store of stores) {
              if (store.featured_media && store.featured_media > 0) {
                try {
                  // Try to get from _embedded first
                  if (
                    store._embedded &&
                    store._embedded["wp:featuredmedia"] &&
                    store._embedded["wp:featuredmedia"][0]
                  ) {
                    store.featured_media_url =
                      store._embedded["wp:featuredmedia"][0].source_url;
                  } else {
                    // Fallback to separate API call
                    const mediaResponse = await this.apiClient.get(
                      `/media/${store.featured_media}`
                    );
                    store.featured_media_url = mediaResponse.data.source_url;
                  }
                } catch (error) {
                  console.error(
                    `Failed to fetch featured image for store ${store.id}:`,
                    error.message
                  );
                  store.featured_media_url = "";
                }
              } else {
                store.featured_media_url = "";
              }
            }

            allStores = allStores.concat(stores);
            page++;
          }

          // Safety break to avoid infinite loops
          if (page > 50) {
            console.warn("Stopped fetching after 50 pages (5000 stores)");
            break;
          }
        } catch (error) {
          break;
        }
      }

      console.log(`Fetched ${allStores.length} existing stores from WordPress`);
      return allStores;
    } catch (error) {
      console.error("Error fetching all stores:", error.message);
      throw new Error(`Failed to fetch all stores: ${error.message}`);
    }
  }

  checkDuplicate(newStore, existingStores) {
    // Check for duplicates based on store name (case-insensitive)
    const normalizedNewName = newStore.name.toLowerCase().trim();

    for (const existingStore of existingStores) {
      const existingTitle = existingStore?.acf?.name ||
        existingStore.title?.rendered || existingStore.title || "";
      const normalizedExistingName = existingTitle.toLowerCase().trim();
      if (normalizedNewName === normalizedExistingName) {
        return {
          isDuplicate: true,
          existingStore: existingStore,
          reason: "Same name",
        };
      }
    }

    return { isDuplicate: false };
  }

  async updateStore(storeId, storeData) {
    try {
      // // Process featured image if provided
      let featuredImageId = null;
      // if (storeData.image) {
      //   console.log(
      //     `Processing featured image for store update: ${storeData.name}`
      //   );
      //   featuredImageId = await this.imageService.processStoreImage(
      //     storeData.image,
      //     storeData.name
      //   );
      //   if (featuredImageId) {
      //     console.log(`Featured image uploaded with ID: ${featuredImageId}`);
      //   }
      // }

      const postData = {
        title: storeData.name,
        content: this.formatStoreContent(storeData),
        acf: {
          link: storeData.links || "",
          name: storeData.name || "",
          guilde: storeData.guide || "",
          about: storeData.about || "",
          q_and_a: storeData.qa || "",
          star: 5, // Default rating
          vote: 5, // Default vote count
          title_page: storeData.name || "",
          description: storeData.description || "",
        },
      };

      // Set featured image if we have one
      if (featuredImageId) {
        postData.featured_media = featuredImageId;
      }

      const response = await this.apiClient.put(`/store/${storeId}`, postData);
      return {
        success: true,
        message: `Store "${storeData.name}" updated successfully`,
        data: response.data,
        featuredImageId: featuredImageId,
      };
    } catch (error) {
      console.error("Error updating store:", error.message);
      throw new Error(`Failed to update store: ${error.message}`);
    }
  }

  async deleteStore(storeId) {
    try {
      const response = await this.apiClient.delete(`/store/${storeId}`);
      return response.data;
    } catch (error) {
      console.error("Error deleting store:", error.message);
      throw new Error(`Failed to delete store: ${error.message}`);
    }
  }

  async createCoupon(couponData, storePostId) {
    try {
      const postData = {
        title: couponData.coupon_name,
        status: "publish",
        acf: {
          coupon_code: couponData.coupon_code,
          discount_value: couponData.discount_value,
          store_link: storePostId, // Link to the store post
          is_deal: couponData.is_deal,
          link: couponData.link || "",
          discount_bag: couponData.discount_bag,
          is_verified: couponData.is_verified !== false, // Default to true
          description: couponData.description || "",
          priority: couponData.priority || 0,
        },
      };
      const response = await this.apiClient.post("/coupon", postData);
      return {
        success: true,
        message: `Coupon "${couponData.coupon_name}" created successfully`,
        data: response.data,
      };
    } catch (error) {
      if (error.response) {
        console.error(
          "WordPress API Error creating coupon:",
          error.response.data
        );
        throw new Error(
          `WordPress API Error: ${error.response.status} - ${JSON.stringify(
            error.response.data
          )}`
        );
      } else {
        console.error("Network Error creating coupon:", error.message);
        throw new Error(`Network Error: ${error.message}`);
      }
    }
  }

  async createStoreWithCoupons(storeData) {
    try {
      // First create the store
      const storeResult = await this.createStore(storeData);

      if (!storeResult.success) {
        throw new Error("Failed to create store");
      }

      const storePostId = storeResult.data?.id;
      const coupons = storeData.coupons || [];
      const couponResults = [];

      // Remove duplicate coupons before creating them
      const uniqueCoupons = [];
      const seenKeys = new Set();

      for (const coupon of coupons) {
        const key = this.normalizeCouponKey(coupon.coupon_code, coupon.coupon_name);
        console.log(`Processing coupon key: ${key}`);

        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueCoupons.push(coupon);
        } else {
          console.log(
            `Skipped duplicate coupon in sheet: ${coupon.coupon_name} for store: ${storeData.name}`
          );
          couponResults.push({
            name: coupon.coupon_name,
            success: false,
            error: "Duplicate coupon in data",
            action: "skipped",
          });
        }
      }

      // Create coupons for this store
      for (const coupon of uniqueCoupons) {
        try {
          // Update store_link with the actual store post ID
          const couponWithStoreLink = {
            ...coupon,
            store_link: storePostId,
          };

          const couponResult = await this.createCoupon(
            couponWithStoreLink,
            storePostId
          );
          couponResults.push({
            name: coupon.coupon_name,
            success: true,
            id: couponResult.data?.id,
            action: "created",
          });
          console.log(
            `Created coupon: ${coupon.coupon_name} for store: ${storeData.name}`
          );
        } catch (error) {
          console.error(
            `Failed to create coupon ${coupon.coupon_name}:`,
            error.message
          );
          couponResults.push({
            name: coupon.coupon_name,
            success: false,
            error: error.message,
            action: "failed",
          });
        }
      }

      return {
        success: true,
        message: `Store "${storeData.name}" created with ${couponResults.filter((c) => c.success).length
          }/${coupons.length} coupons`,
        storeData: storeResult.data,
        coupons: couponResults,
        totalCoupons: coupons.length,
        successfulCoupons: couponResults.filter((c) => c.success).length,
        featuredImageId: storeResult.featuredImageId,
      };
    } catch (error) {
      console.error("Error creating store with coupons:", error);
      throw error;
    }
  }

  async getCouponsForStore(storePostId) {
    try {
      const response = await this.apiClient.get('/coupon?store_link=' + storePostId);
      return response.data;
    } catch (error) {
      console.error("Error fetching coupons for store:", error.message);
      return []; // Return empty array if error, don't throw
    }
  }

  async updateCoupon(couponId, couponData, storePostId) {
    try {
      const postData = {
        title: couponData.coupon_name,
        status: "publish",
        acf: {
          coupon_code: couponData.coupon_code,
          discount_value: couponData.discount_value,
          store_link: storePostId,
          is_deal: couponData.is_deal,
          link: couponData.link || "",
          discount_bag: couponData.discount_bag,
          is_verified: couponData.is_verified !== false,
          description: couponData.description || "",
        },
      };

      const response = await this.apiClient.put(
        `/coupon/${couponId}`,
        postData
      );
      return {
        success: true,
        message: `Coupon "${couponData.coupon_name}" updated successfully`,
        data: response.data,
      };
    } catch (error) {
      console.error("Error updating coupon:", error.message);
      throw new Error(`Failed to update coupon: ${error.message}`);
    }
  }

  async deleteCoupon(couponId) {
    try {
      const response = await this.apiClient.delete(`/coupon/${couponId}`);
      return response.data;
    } catch (error) {
      console.error("Error deleting coupon:", error.message);
      throw new Error(`Failed to delete coupon: ${error.message}`);
    }
  }

  normalizeCouponKey(code, name) {
    const decodeHtml = (html) => {
      const doc = new JSDOM(html || "");
      return doc.window.document.documentElement.textContent || "";
    };
    const formatKey = (key) =>
      decodeHtml(key ?? "")
        .trim()
        .replace(/([^\w_])+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase();
    return `${formatKey(code)}_${formatKey(name)}`;
  }

  async updateStoreWithCoupons(storeData, existingStoreId) {
    try {
      // First update the store
      const storeResult = await this.updateStore(existingStoreId, storeData);

      if (!storeResult.success) {
        throw new Error("Failed to update store");
      }

      // Get existing coupons for this store
      const existingCoupons = await this.getCouponsForStore(existingStoreId);
      const newCoupons = storeData.coupons || [];
      const couponResults = [];

      // Create a map of existing coupons by name+code for quick lookup
      const existingCouponMap = new Map();
      existingCoupons.forEach((coupon) => {
        const key = this.normalizeCouponKey(
          coupon.acf?.coupon_code,
          coupon.title?.rendered
        );
        existingCouponMap.set(key, coupon);
      });

      const uniqueCoupons = [];
      const seenKeys = new Set();

      for (const c of newCoupons) {
        const key = this.normalizeCouponKey(c.coupon_code, c.coupon_name);
        console.log(`Processing coupon key: ${key}`);

        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueCoupons.push(c);
        } else {
          console.log(
            `Skipped duplicate coupon in sheet: ${c.coupon_name} for store: ${storeData.name}`
          );
        }
      }
      // Process new coupons
      for (const newCoupon of uniqueCoupons) {
        const couponKey = this.normalizeCouponKey(
          newCoupon.coupon_code,
          newCoupon.coupon_name
        );
        const existingCoupon = existingCouponMap.get(couponKey);

        try {
          if (existingCoupon) {
            // Update existing coupon
            await this.updateCoupon(
              existingCoupon.id,
              newCoupon,
              existingStoreId
            );
            couponResults.push({
              name: newCoupon.coupon_name,
              success: true,
              id: existingCoupon.id,
              action: "updated",
            });
            console.log(
              `Updated coupon: ${newCoupon.coupon_name} for store: ${storeData.name}`
            );
          } else {
            console.log(
              `Creating new coupon: ${newCoupon.coupon_name} for store: ${storeData.name}`
            );

            // Create new coupon
            const newCouponData = {
              ...newCoupon,
              store_link: existingStoreId,
            };

            const createdCoupon = await this.createCoupon(
              newCouponData,
              existingStoreId
            );
            couponResults.push({
              name: newCoupon.coupon_name,
              success: true,
              id: createdCoupon.data?.id,
              action: "created",
            });
            console.log(
              `Created new coupon: ${newCoupon.coupon_name} for store: ${storeData.name}`
            );
          }
        } catch (error) {
          console.error(
            `Failed to process coupon ${newCoupon.coupon_name}:`,
            error.message
          );
          couponResults.push({
            name: newCoupon.coupon_name,
            success: false,
            error: error.message,
            action: "failed",
          });
        }
      }
      return {
        success: true,
        message: `Store "${storeData.name}" updated with ${couponResults.filter((c) => c.success).length
          }/${newCoupons.length} coupons`,
        storeData: storeResult.data,
        coupons: couponResults,
        totalCoupons: newCoupons.length,
        successfulCoupons: couponResults.filter((c) => c.success).length,
        featuredImageId: storeResult.featuredImageId,
        action: "updated",
      };
    } catch (error) {
      console.error("Error updating store with coupons:", error);
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
