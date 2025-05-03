/**
 * Monthly flux layer fetcher for SolarScanner data-layers module
 *
 * Handles fetching of monthly flux layer data from the Google Solar API.
 * Monthly flux data represents solar irradiance broken down by month.
 */

const Fetcher = require("../../core/fetcher");
const config = require("../../config");

/**
 * Fetcher implementation for monthly flux layer data
 * @extends Fetcher
 */
class MonthlyFluxFetcher extends Fetcher {
  /**
   * Create a new MonthlyFluxFetcher
   * @param {Object} apiClient - API client for making requests
   */
  constructor(apiClient) {
    super(apiClient);
    console.log("[MonthlyFluxFetcher] Initialized");
  }

  /**
   * Check if this fetcher can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this fetcher can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "monthlyFlux";
  }

  /**
   * Fetch monthly flux data from the Google Solar API
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Fetch options
   * @param {number} [options.radius=50] - Radius around the location in meters
   * @param {string} [options.quality='LOW'] - Minimum quality level ('LOW', 'MEDIUM', 'HIGH')
   * @param {boolean} [options.fetchMask=true] - Whether to also fetch mask data for reference
   * @returns {Promise<Object>} - Raw monthly flux data and related information
   * @throws {Error} if fetching fails
   */
  async fetch(location, options = {}) {
    try {
      console.log(
        `[MonthlyFluxFetcher] Fetching monthly flux data for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      // Set default options
      const radius = options.radius || config.api.DEFAULT_RADIUS;
      const quality = options.quality || config.api.DEFAULT_QUALITY;
      const fetchMask = options.fetchMask !== false;
      const apiKey = this.apiClient.apiKey;

      if (!apiKey) {
        throw new Error("API key is required for fetching monthly flux data");
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
        `[MonthlyFluxFetcher] Requesting data layers with params: ${params
          .toString()
          .replace(/key=[^&]+/, "key=*****")}`
      );

      // Make request to Google Solar API - using direct axios call
      let response;
      try {
        response = await this.apiClient.get(
          `https://solar.googleapis.com/v1/dataLayers:get?${params}`
        );

        // Log response status and structure
        console.log(
          `[MonthlyFluxFetcher] API response status: ${response.status}`
        );
        console.log(
          `[MonthlyFluxFetcher] API response structure: ${JSON.stringify(
            Object.keys(response.data)
          )}`
        );
      } catch (error) {
        console.error(
          `[MonthlyFluxFetcher] Error fetching data layers: ${error.message}`
        );
        throw new Error(`Failed to fetch data layers: ${error.message}`);
      }

      // Extract monthly flux URL and mask URL
      const { monthlyFluxUrl, maskUrl, imageryQuality } = response.data;

      // Validate URLs
      if (!monthlyFluxUrl) {
        console.error(
          "[MonthlyFluxFetcher] Monthly flux URL not found in Solar API response"
        );
        console.log(
          `[MonthlyFluxFetcher] API response: ${JSON.stringify(response.data)}`
        );
        throw new Error("Monthly flux URL not found in API response");
      }

      console.log(
        `[MonthlyFluxFetcher] Successfully retrieved monthly flux URL from Solar API`
      );
      console.log(`[MonthlyFluxFetcher] Monthly Flux URL: ${monthlyFluxUrl}`);
      console.log(`[MonthlyFluxFetcher] Mask URL: ${maskUrl}`);
      console.log(
        `[MonthlyFluxFetcher] Imagery quality: ${imageryQuality || "unknown"}`
      );

      // Download the monthly flux data
      let monthlyFluxData;
      try {
        // Ensure the URL includes the API key
        const fluxUrl = monthlyFluxUrl.includes("?")
          ? `${monthlyFluxUrl}&key=${apiKey}`
          : `${monthlyFluxUrl}?key=${apiKey}`;

        console.log(
          `[MonthlyFluxFetcher] Downloading monthly flux data from: ${fluxUrl.replace(
            /key=[^&]+/,
            "key=*****"
          )}`
        );

        // Use direct axios call
        const fluxResponse = await this.apiClient.get(fluxUrl, {
          responseType: "arraybuffer",
        });

        monthlyFluxData = fluxResponse.data;
        console.log(
          `[MonthlyFluxFetcher] Successfully downloaded monthly flux data: ${monthlyFluxData.byteLength} bytes`
        );
      } catch (fluxError) {
        console.error(
          `[MonthlyFluxFetcher] Error downloading monthly flux data: ${fluxError.message}`
        );
        throw new Error(
          `Failed to download monthly flux data: ${fluxError.message}`
        );
      }

      // Download mask data if requested
      let maskData = null;
      if (fetchMask && maskUrl) {
        try {
          console.log("[MonthlyFluxFetcher] Fetching associated mask data");

          // Ensure the URL includes the API key
          const maskUrlWithKey = maskUrl.includes("?")
            ? `${maskUrl}&key=${apiKey}`
            : `${maskUrl}?key=${apiKey}`;

          console.log(
            `[MonthlyFluxFetcher] Downloading mask data from: ${maskUrlWithKey.replace(
              /key=[^&]+/,
              "key=*****"
            )}`
          );

          const maskResponse = await this.apiClient.get(maskUrlWithKey, {
            responseType: "arraybuffer",
          });

          maskData = maskResponse.data;
          console.log(
            `[MonthlyFluxFetcher] Successfully downloaded mask data: ${maskData.byteLength} bytes`
          );
        } catch (maskError) {
          console.warn(
            `[MonthlyFluxFetcher] Failed to download mask data: ${maskError.message}`
          );
          // Continue without mask data
        }
      }

      // Return both the monthly flux data and additional information
      return {
        monthlyFluxData,
        maskData,
        metadata: {
          imageryQuality,
          imageryDate: response.data.imageryDate,
          imageryProcessedDate: response.data.imageryProcessedDate,
          location,
        },
      };
    } catch (error) {
      console.error(
        `[MonthlyFluxFetcher] Error in fetch operation: ${error.message}`
      );

      // Create a detailed error
      const enhancedError = new Error(
        `Monthly flux fetcher error: ${error.message}`
      );
      enhancedError.originalError = error;
      enhancedError.location = location;
      enhancedError.options = { ...options, apiKey: "REDACTED" }; // Don't log the actual API key

      throw enhancedError;
    }
  }

  /**
   * Pre-check if monthly flux data is available for a location
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Check options
   * @returns {Promise<boolean>} - True if data is available
   */
  async isDataAvailable(location, options = {}) {
    try {
      console.log(
        `[MonthlyFluxFetcher] Checking data availability for location: ${location.latitude}, ${location.longitude}`
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
      const params = this.formatSolarApiParams(
        location,
        radius,
        quality,
        apiKey
      );

      // Make request to Google Solar API
      try {
        const response = await this.fetchWithRetry(
          `https://solar.googleapis.com/v1/dataLayers:get?${params}`,
          {
            responseType: "json",
            timeout: 10000, // Shorter timeout for availability check
          }
        );

        // Check if monthly flux URL is available
        const isAvailable = !!response.monthlyFluxUrl;

        console.log(
          `[MonthlyFluxFetcher] Monthly flux data ${
            isAvailable ? "is" : "is not"
          } available for location`
        );
        return isAvailable;
      } catch (error) {
        console.log(
          `[MonthlyFluxFetcher] Data appears to be unavailable: ${error.message}`
        );
        return false;
      }
    } catch (error) {
      console.error(
        `[MonthlyFluxFetcher] Error checking data availability: ${error.message}`
      );
      return false;
    }
  }
}

module.exports = MonthlyFluxFetcher;
