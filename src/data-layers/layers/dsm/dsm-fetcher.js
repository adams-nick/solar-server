/**
 * DSM layer fetcher for SolarScanner data-layers module
 *
 * Handles fetching of DSM (Digital Surface Model) layer data from the Google Solar API.
 * DSM data represents the elevation/height information of the terrain and buildings.
 */

const Fetcher = require("../../core/fetcher");
const config = require("../../config");

/**
 * Fetcher implementation for DSM layer data
 * @extends Fetcher
 */
class DsmFetcher extends Fetcher {
  /**
   * Create a new DsmFetcher
   * @param {Object} apiClient - API client for making requests
   */
  constructor(apiClient) {
    super(apiClient);
    console.log("[DsmFetcher] Initialized");
  }

  /**
   * Check if this fetcher can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this fetcher can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "dsm";
  }

  /**
   * Fetch DSM data from the Google Solar API
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Fetch options
   * @param {number} [options.radius=50] - Radius around the location in meters
   * @param {string} [options.quality='LOW'] - Minimum quality level ('LOW', 'MEDIUM', 'HIGH')
   * @param {boolean} [options.fetchMask=true] - Whether to also fetch mask data for reference
   * @param {string} [options.layerUrl] - Direct URL to the DSM data (optional, bypasses API call)
   * @returns {Promise<Object>} - Raw DSM data and related information
   * @throws {Error} if fetching fails
   */
  async fetch(location, options = {}) {
    try {
      console.log(
        `[DsmFetcher] Fetching DSM data for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      // Set default options
      const radius = options.radius || config.api.DEFAULT_RADIUS;
      const quality = options.quality || config.api.DEFAULT_QUALITY;
      const fetchMask = options.fetchMask !== false;
      const apiKey = this.apiClient.apiKey;
      let dsmUrl = options.layerUrl; // Use provided URL if available
      let maskUrl = options.maskUrl;

      if (!apiKey) {
        throw new Error("API key is required for fetching DSM data");
      }

      // If a direct layer URL wasn't provided, fetch it from the API
      if (!dsmUrl) {
        // Format parameters for Google Solar API
        const params = new URLSearchParams({
          "location.latitude": location.latitude.toFixed(5),
          "location.longitude": location.longitude.toFixed(5),
          radius_meters: radius.toString(),
          required_quality: quality,
          key: apiKey,
        });

        // Log the request (with API key masked)
        console.log(
          `[DsmFetcher] Requesting data layers with params: ${params
            .toString()
            .replace(/key=[^&]+/, "key=*****")}`
        );

        // Make request to Google Solar API
        let response;
        try {
          response = await this.apiClient.get(
            `https://solar.googleapis.com/v1/dataLayers:get?${params}`
          );

          // Log response status and structure
          console.log(`[DsmFetcher] API response status: ${response.status}`);
          console.log(
            `[DsmFetcher] API response structure: ${JSON.stringify(
              Object.keys(response.data)
            )}`
          );
        } catch (error) {
          console.error(
            `[DsmFetcher] Error fetching data layers: ${error.message}`
          );
          throw new Error(`Failed to fetch data layers: ${error.message}`);
        }

        // Extract DSM URL and mask URL
        dsmUrl = response.data.dsmUrl;
        maskUrl = maskUrl || response.data.maskUrl;
        const imageryQuality = response.data.imageryQuality;

        // Validate URLs
        if (!dsmUrl) {
          console.error("[DsmFetcher] DSM URL not found in Solar API response");
          console.log(
            `[DsmFetcher] API response: ${JSON.stringify(response.data)}`
          );
          throw new Error("DSM URL not found in API response");
        }

        console.log(
          `[DsmFetcher] Successfully retrieved DSM URL from Solar API`
        );
        console.log(`[DsmFetcher] DSM URL: ${dsmUrl}`);
        console.log(`[DsmFetcher] Mask URL: ${maskUrl}`);
        console.log(
          `[DsmFetcher] Imagery quality: ${imageryQuality || "unknown"}`
        );
      } else {
        console.log(`[DsmFetcher] Using provided DSM URL: ${dsmUrl}`);
        if (maskUrl) {
          console.log(`[DsmFetcher] Using provided mask URL: ${maskUrl}`);
        }
      }

      // Download the DSM data
      let dsmData;
      try {
        // Ensure the URL includes the API key
        const fullDsmUrl = dsmUrl.includes("?")
          ? `${dsmUrl}&key=${apiKey}`
          : `${dsmUrl}?key=${apiKey}`;

        console.log(
          `[DsmFetcher] Downloading DSM data from: ${fullDsmUrl.replace(
            /key=[^&]+/,
            "key=*****"
          )}`
        );

        // Use direct axios call
        const dsmResponse = await this.apiClient.get(fullDsmUrl, {
          responseType: "arraybuffer",
        });

        dsmData = dsmResponse.data;
        console.log(
          `[DsmFetcher] Successfully downloaded DSM data: ${dsmData.byteLength} bytes`
        );
      } catch (dsmError) {
        console.error(
          `[DsmFetcher] Error downloading DSM data: ${dsmError.message}`
        );
        throw new Error(`Failed to download DSM data: ${dsmError.message}`);
      }

      // Download mask data if requested
      let maskData = null;
      if (fetchMask && maskUrl) {
        try {
          console.log("[DsmFetcher] Fetching associated mask data");

          // Ensure the URL includes the API key
          const fullMaskUrl = maskUrl.includes("?")
            ? `${maskUrl}&key=${apiKey}`
            : `${maskUrl}?key=${apiKey}`;

          console.log(
            `[DsmFetcher] Downloading mask data from: ${fullMaskUrl.replace(
              /key=[^&]+/,
              "key=*****"
            )}`
          );

          const maskResponse = await this.apiClient.get(fullMaskUrl, {
            responseType: "arraybuffer",
          });

          maskData = maskResponse.data;
          console.log(
            `[DsmFetcher] Successfully downloaded mask data: ${maskData.byteLength} bytes`
          );
        } catch (maskError) {
          console.warn(
            `[DsmFetcher] Failed to download mask data: ${maskError.message}`
          );
          // Continue without mask data
        }
      }

      // Return both the DSM data and additional information
      return {
        dsmData,
        maskData,
        metadata: {
          imageryQuality: options.imageryQuality || "MEDIUM",
          imageryDate: options.imageryDate,
          imageryProcessedDate: options.imageryProcessedDate,
          location,
        },
      };
    } catch (error) {
      console.error(`[DsmFetcher] Error in fetch operation: ${error.message}`);

      // Create a detailed error
      const enhancedError = new Error(`DSM fetcher error: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.location = location;
      enhancedError.options = { ...options, apiKey: "REDACTED" }; // Don't log the actual API key

      throw enhancedError;
    }
  }

  /**
   * Pre-check if DSM data is available for a location
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Check options
   * @returns {Promise<boolean>} - True if data is available
   * @throws {Error} if the check fails for any reason other than data unavailability
   */
  async isDataAvailable(location, options = {}) {
    try {
      console.log(
        `[DsmFetcher] Checking data availability for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      // Set default options
      const radius = options.radius || config.api.DEFAULT_RADIUS;
      const quality = options.quality || config.api.DEFAULT_QUALITY;
      const apiKey = this.apiClient.apiKey;

      if (!apiKey) {
        throw new Error("API key is required for checking data availability");
      }

      // Format parameters for Google Solar API
      const params = new URLSearchParams({
        "location.latitude": location.latitude.toFixed(5),
        "location.longitude": location.longitude.toFixed(5),
        radius_meters: radius.toString(),
        required_quality: quality,
        key: apiKey,
      });

      // Make request to Google Solar API
      try {
        const response = await this.apiClient.get(
          `https://solar.googleapis.com/v1/dataLayers:get?${params}`,
          {
            responseType: "json",
            timeout: 10000, // Shorter timeout for availability check
          }
        );

        // Check if DSM URL is available
        const isAvailable = !!response.data.dsmUrl;

        console.log(
          `[DsmFetcher] DSM data ${
            isAvailable ? "is" : "is not"
          } available for location`
        );

        if (!isAvailable) {
          throw new Error("DSM data is not available for this location");
        }

        return true;
      } catch (error) {
        console.log(
          `[DsmFetcher] Data appears to be unavailable: ${error.message}`
        );
        throw error;
      }
    } catch (error) {
      console.error(
        `[DsmFetcher] Error checking data availability: ${error.message}`
      );
      throw error;
    }
  }
}

module.exports = DsmFetcher;
