/**
 * RGB layer fetcher for SolarScanner data-layers module
 *
 * Handles fetching of RGB layer data from the Google Solar API.
 * RGB data represents aerial imagery of the region.
 */

const Fetcher = require("../../core/fetcher");
const config = require("../../config");

/**
 * Fetcher implementation for RGB layer data
 * @extends Fetcher
 */
class RgbFetcher extends Fetcher {
  /**
   * Create a new RgbFetcher
   * @param {Object} apiClient - API client for making requests
   */
  constructor(apiClient) {
    super(apiClient);
    console.log("[RgbFetcher] Initialized");
  }

  /**
   * Check if this fetcher can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this fetcher can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "rgb";
  }

  /**
   * Fetch RGB data from the Google Solar API
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Fetch options
   * @param {number} [options.radius=50] - Radius around the location in meters
   * @param {string} [options.quality='LOW'] - Minimum quality level ('LOW', 'MEDIUM', 'HIGH')
   * @param {boolean} [options.fetchMask=true] - Whether to also fetch mask data for reference
   * @returns {Promise<Object>} - Raw RGB data and related information
   * @throws {Error} if fetching fails
   */
  async fetch(location, options = {}) {
    try {
      console.log(
        `[RgbFetcher] Fetching RGB data for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      // Set default options
      const radius = options.radius || config.api.DEFAULT_RADIUS;
      const quality = options.quality || config.api.DEFAULT_QUALITY;
      const fetchMask = options.fetchMask !== false;
      const apiKey = this.apiClient.apiKey;

      if (!apiKey) {
        throw new Error("API key is required for fetching RGB data");
      }

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
        `[RgbFetcher] Requesting data layers with params: ${params
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
        console.log(`[RgbFetcher] API response status: ${response.status}`);
        console.log(
          `[RgbFetcher] API response structure: ${JSON.stringify(
            Object.keys(response.data)
          )}`
        );
      } catch (error) {
        console.error(
          `[RgbFetcher] Error fetching data layers: ${error.message}`
        );
        throw new Error(`Failed to fetch data layers: ${error.message}`);
      }

      // Extract RGB URL and mask URL
      const { rgbUrl, maskUrl, imageryQuality } = response.data;

      // Validate URLs
      if (!rgbUrl) {
        console.error("[RgbFetcher] RGB URL not found in Solar API response");
        console.log(
          `[RgbFetcher] API response: ${JSON.stringify(response.data)}`
        );
        throw new Error("RGB URL not found in API response");
      }

      console.log(`[RgbFetcher] Successfully retrieved RGB URL from Solar API`);
      console.log(`[RgbFetcher] RGB URL: ${rgbUrl}`);
      console.log(`[RgbFetcher] Mask URL: ${maskUrl}`);
      console.log(
        `[RgbFetcher] Imagery quality: ${imageryQuality || "unknown"}`
      );

      // Download the RGB data
      let rgbData;
      try {
        // Ensure the URL includes the API key
        const fullRgbUrl = rgbUrl.includes("?")
          ? `${rgbUrl}&key=${apiKey}`
          : `${rgbUrl}?key=${apiKey}`;

        console.log(
          `[RgbFetcher] Downloading RGB data from: ${fullRgbUrl.replace(
            /key=[^&]+/,
            "key=*****"
          )}`
        );

        // Use direct axios call
        const rgbResponse = await this.apiClient.get(fullRgbUrl, {
          responseType: "arraybuffer",
        });

        rgbData = rgbResponse.data;
        console.log(
          `[RgbFetcher] Successfully downloaded RGB data: ${rgbData.byteLength} bytes`
        );
      } catch (rgbError) {
        console.error(
          `[RgbFetcher] Error downloading RGB data: ${rgbError.message}`
        );
        throw new Error(`Failed to download RGB data: ${rgbError.message}`);
      }

      // Download mask data if requested
      let maskData = null;
      if (fetchMask && maskUrl) {
        try {
          console.log("[RgbFetcher] Fetching associated mask data");

          // Ensure the URL includes the API key
          const fullMaskUrl = maskUrl.includes("?")
            ? `${maskUrl}&key=${apiKey}`
            : `${maskUrl}?key=${apiKey}`;

          console.log(
            `[RgbFetcher] Downloading mask data from: ${fullMaskUrl.replace(
              /key=[^&]+/,
              "key=*****"
            )}`
          );

          const maskResponse = await this.apiClient.get(fullMaskUrl, {
            responseType: "arraybuffer",
          });

          maskData = maskResponse.data;
          console.log(
            `[RgbFetcher] Successfully downloaded mask data: ${maskData.byteLength} bytes`
          );
        } catch (maskError) {
          console.warn(
            `[RgbFetcher] Failed to download mask data: ${maskError.message}`
          );
          // Continue without mask data
        }
      }

      // Return both the RGB data and additional information
      return {
        rgbData,
        maskData,
        metadata: {
          imageryQuality,
          imageryDate: response.data.imageryDate,
          imageryProcessedDate: response.data.imageryProcessedDate,
          location,
        },
      };
    } catch (error) {
      console.error(`[RgbFetcher] Error in fetch operation: ${error.message}`);

      // Create a detailed error
      const enhancedError = new Error(`RGB fetcher error: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.location = location;
      enhancedError.options = { ...options, apiKey: "REDACTED" }; // Don't log the actual API key

      throw enhancedError;
    }
  }

  /**
   * Pre-check if RGB data is available for a location
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Check options
   * @returns {Promise<boolean>} - True if data is available
   * @throws {Error} if the check fails for any reason other than data unavailability
   */
  async isDataAvailable(location, options = {}) {
    try {
      console.log(
        `[RgbFetcher] Checking data availability for location: ${location.latitude}, ${location.longitude}`
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

        // Check if RGB URL is available
        const isAvailable = !!response.data.rgbUrl;

        console.log(
          `[RgbFetcher] RGB data ${
            isAvailable ? "is" : "is not"
          } available for location`
        );

        if (!isAvailable) {
          throw new Error("RGB data is not available for this location");
        }

        return true;
      } catch (error) {
        console.log(
          `[RgbFetcher] Data appears to be unavailable: ${error.message}`
        );
        throw error;
      }
    } catch (error) {
      console.error(
        `[RgbFetcher] Error checking data availability: ${error.message}`
      );
      throw error;
    }
  }
}

module.exports = RgbFetcher;
