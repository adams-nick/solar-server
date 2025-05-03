/**
 * Base Fetcher class for SolarScanner data-layers module
 *
 * This abstract base class provides the foundation for layer-specific fetchers.
 * It includes retry logic and common error handling for API requests.
 */

const config = require("../config");

/**
 * Abstract base class for all data layer fetchers
 */
class Fetcher {
  /**
   * Constructor for the fetcher
   * @param {Object} apiClient - API client for making requests
   * @throws {Error} if apiClient is not provided
   */
  constructor(apiClient) {
    if (!apiClient) {
      const error = new Error("APIClient is required for Fetcher");
      console.error("[Fetcher] Constructor error:", error.message);
      throw error;
    }

    this.apiClient = apiClient;
    this.maxRetries = config.api.MAX_RETRIES;
    this.retryDelay = config.api.RETRY_DELAY;
    this.timeout = config.api.REQUEST_TIMEOUT;

    // Ensure abstract methods are implemented in subclasses
    if (this.constructor === Fetcher) {
      const error = new Error(
        "Cannot instantiate abstract Fetcher class directly"
      );
      console.error("[Fetcher] Instantiation error:", error.message);
      throw error;
    }

    if (this.fetch === Fetcher.prototype.fetch) {
      const error = new Error("Subclasses must implement fetch() method");
      console.error("[Fetcher] Implementation error:", error.message);
      throw error;
    }

    if (this.canHandle === Fetcher.prototype.canHandle) {
      const error = new Error("Subclasses must implement canHandle() method");
      console.error("[Fetcher] Implementation error:", error.message);
      throw error;
    }

    console.log(`[Fetcher] Created ${this.constructor.name}`);
  }

  /**
   * Abstract method to fetch data from the API
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Fetch options
   * @returns {Promise<Buffer>} - Raw data buffer
   * @throws {Error} when not implemented in subclass
   */
  async fetch(location, options = {}) {
    throw new Error("Method not implemented: fetch()");
  }

  /**
   * Abstract method to check if this fetcher can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this fetcher can handle the layer type
   * @throws {Error} when not implemented in subclass
   */
  canHandle(layerType) {
    throw new Error("Method not implemented: canHandle()");
  }

  /**
   * Fetch data with automatic retry on failure
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {number} [options.retries=this.maxRetries] - Maximum number of retries
   * @param {number} [options.initialDelay=this.retryDelay] - Initial delay between retries
   * @param {string} [options.responseType='arraybuffer'] - Response type
   * @param {number} [options.timeout=this.timeout] - Request timeout
   * @returns {Promise<Object>} - Response data
   * @throws {Error} if all retries fail
   */
  async fetchWithRetry(url, options = {}) {
    const retries = options.retries ?? this.maxRetries;
    const initialDelay = options.initialDelay ?? this.retryDelay;
    const responseType = options.responseType ?? "arraybuffer";
    const timeout = options.timeout ?? this.timeout;

    let lastError;
    let attempt = 0;

    while (attempt <= retries) {
      try {
        // Log attempt information
        if (attempt > 0) {
          console.log(
            `[Fetcher] Retry attempt ${attempt}/${retries} for URL: ${this.maskSensitiveUrl(
              url
            )}`
          );
        } else {
          console.log(`[Fetcher] Fetching URL: ${this.maskSensitiveUrl(url)}`);
        }

        // Make the request - use the client's get method directly
        const response = await this.apiClient.get(url, {
          responseType,
          timeout,
          ...options,
        });

        // Check response
        if (!response || !response.status) {
          throw new Error(`Invalid response received`);
        }

        if (response.status !== 200) {
          throw new Error(`Request failed with status: ${response.status}`);
        }

        // Log success
        console.log(
          `[Fetcher] Successfully fetched URL: ${this.maskSensitiveUrl(url)}`
        );

        // Ensure the data property exists
        if (!response.data && response.status === 200) {
          console.warn(`[Fetcher] Response has status 200 but no data`);
          // Create a default response with the status but empty data
          return {
            status: response.status,
            headers: response.headers,
            data: Buffer.alloc(0), // Empty buffer
          };
        }

        return response;
      } catch (error) {
        attempt++;
        lastError = error;

        // Log error information
        console.error(
          `[Fetcher] Error fetching URL (attempt ${attempt}/${retries + 1}):`,
          this.maskSensitiveUrl(url)
        );
        console.error(`[Fetcher] Error details: ${error.message}`);

        // Check if we should retry
        if (attempt > retries) {
          console.error(
            `[Fetcher] Maximum retries (${retries}) exceeded. Giving up.`
          );
          break;
        }

        // Calculate backoff delay
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.log(`[Fetcher] Retrying in ${delay}ms...`);

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // If we get here, all retries failed
    const error = new Error(
      `Failed to fetch URL after ${retries + 1} attempts: ${
        lastError?.message || "Unknown error"
      }`
    );
    console.error("[Fetcher] Fatal error:", error.message);
    throw error;
  }

  /**
   * Download raw data from a URL, adding API key if needed
   * @param {string} url - URL to download from
   * @param {string} apiKey - API key to use
   * @param {Object} options - Download options
   * @returns {Promise<Buffer>} - Raw data buffer
   * @throws {Error} if download fails
   */
  async downloadRawData(url, apiKey, options = {}) {
    try {
      console.log(
        `[Fetcher] Downloading data from: ${this.maskSensitiveUrl(url)}`
      );

      // Add API key to URL if it's a Solar API URL
      const fullUrl = url.includes("solar.googleapis.com")
        ? url.includes("?")
          ? `${url}&key=${apiKey}`
          : `${url}?key=${apiKey}`
        : url;

      // Use the retry logic to download with explicit responseType
      const fetchOptions = {
        ...options,
        responseType: options.responseType || "arraybuffer",
      };

      // Make the request with retry logic
      const response = await this.fetchWithRetry(fullUrl, fetchOptions);

      // Detailed logging of what we received
      console.log(`[Fetcher] Response status: ${response.status}`);
      if (response.headers) {
        console.log(
          `[Fetcher] Response headers: ${JSON.stringify(response.headers)}`
        );
      }

      // Safety check for data
      if (!response.data) {
        console.warn(`[Fetcher] Response has no data property`);
        throw new Error("Received empty response from URL");
      }

      const dataSize =
        response.data instanceof Buffer || response.data instanceof ArrayBuffer
          ? response.data.byteLength
          : typeof response.data === "string"
          ? response.data.length
          : "unknown";
      console.log(`[Fetcher] Response data size: ${dataSize} bytes`);

      // If data is empty but status is 200, this might be a valid empty response
      if (
        (response.data instanceof Buffer ||
          response.data instanceof ArrayBuffer) &&
        response.data.byteLength === 0
      ) {
        console.warn(
          `[Fetcher] Received zero-length data with status ${response.status}`
        );
        throw new Error(
          `Google Solar API returned empty data for this location`
        );
      }

      // Convert to Buffer if not already
      let buffer;
      if (response.data instanceof Buffer) {
        buffer = response.data;
      } else if (response.data instanceof ArrayBuffer) {
        buffer = Buffer.from(response.data);
      } else if (
        typeof response.data === "object" &&
        response.data.type === "Buffer" &&
        Array.isArray(response.data.data)
      ) {
        buffer = Buffer.from(response.data.data);
      } else {
        buffer = Buffer.from(response.data);
      }

      console.log(
        `[Fetcher] Successfully downloaded ${
          buffer.byteLength
        } bytes, Buffer: ${buffer instanceof Buffer}`
      );
      return buffer;
    } catch (error) {
      console.error(`[Fetcher] Error downloading data: ${error.message}`);

      // Enhance error message to indicate data might not be available
      if (
        error.message.includes("empty") ||
        error.message.includes("zero-length")
      ) {
        throw new Error(
          `Data not available for this location: ${error.message}`
        );
      }

      throw new Error(`Failed to download data: ${error.message}`);
    }
  }

  /**
   * Utility to mask API keys in URLs for logging
   * @private
   * @param {string} url - URL that may contain an API key
   * @returns {string} - URL with API key masked
   */
  maskSensitiveUrl(url) {
    if (!url) return "undefined";

    try {
      const parsedUrl = new URL(url);

      // Check for key parameter
      if (parsedUrl.searchParams.has("key")) {
        // Replace key value with asterisks
        const apiKey = parsedUrl.searchParams.get("key");
        const maskedKey =
          apiKey.substring(0, 4) + "..." + apiKey.substring(apiKey.length - 4);
        parsedUrl.searchParams.set("key", maskedKey);
        return parsedUrl.toString();
      }

      return url;
    } catch (error) {
      // If URL parsing fails, return the original URL
      return url;
    }
  }

  /**
   * Validate location object
   * @protected
   * @param {Object} location - Location to validate
   * @throws {Error} if location is invalid
   */
  validateLocation(location) {
    if (!location) {
      throw new Error("Location is required");
    }

    if (
      typeof location.latitude !== "number" ||
      typeof location.longitude !== "number"
    ) {
      throw new Error("Location must have numeric latitude and longitude");
    }

    if (location.latitude < -90 || location.latitude > 90) {
      throw new Error("Latitude must be between -90 and 90");
    }

    if (location.longitude < -180 || location.longitude > 180) {
      throw new Error("Longitude must be between -180 and 180");
    }
  }

  /**
   * Format URL parameters for Google Solar API
   * @protected
   * @param {Object} location - Location coordinates
   * @param {number} radius - Radius in meters
   * @param {string} quality - Required quality level
   * @param {string} apiKey - API key
   * @returns {URLSearchParams} - Formatted parameters
   */
  formatSolarApiParams(location, radius, quality, apiKey) {
    return new URLSearchParams({
      "location.latitude": location.latitude.toFixed(5),
      "location.longitude": location.longitude.toFixed(5),
      radius_meters: radius.toString(),
      required_quality: quality,
      key: apiKey,
    });
  }
}

module.exports = Fetcher;
