/**
 * Mask layer fetcher for SolarScanner data-layers module
 *
 * Handles fetching of mask layer data from the Google Solar API.
 * Mask data represents which pixels are part of a building rooftop.
 */

const Fetcher = require("../../core/fetcher");
const config = require("../../config");

/**
 * Fetcher implementation for mask layer data
 * @extends Fetcher
 */
class MaskFetcher extends Fetcher {
  /**
   * Create a new MaskFetcher
   * @param {Object} apiClient - API client for making requests
   */
  constructor(apiClient) {
    super(apiClient);
    console.log("[MaskFetcher] Initialized");
  }

  /**
   * Check if this fetcher can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this fetcher can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "mask";
  }

  /**
   * Fetch mask data from the Google Solar API
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Fetch options
   * @param {number} [options.radius=50] - Radius around the location in meters
   * @param {string} [options.quality='LOW'] - Minimum quality level ('LOW', 'MEDIUM', 'HIGH')
   * @returns {Promise<Buffer>} - Raw mask data buffer
   * @throws {Error} if fetching fails
   */
  async fetch(location, options = {}) {
    try {
      console.log(
        `[MaskFetcher] Fetching mask data for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      // Set default options
      const radius = options.radius || config.api.DEFAULT_RADIUS;
      const quality = options.quality || config.api.DEFAULT_QUALITY;
      const apiKey = this.apiClient.apiKey;

      if (!apiKey) {
        throw new Error("API key is required for fetching mask data");
      }

      // Format parameters for Google Solar API
      const params = this.formatSolarApiParams(
        location,
        radius,
        quality,
        apiKey
      );

      // Log the request (with API key masked)
      console.log(
        `[MaskFetcher] Requesting data layers with params: ${params
          .toString()
          .replace(/key=[^&]+/, "key=*****")}`
      );

      // Make request to Google Solar API
      let response;
      try {
        response = await this.fetchWithRetry(
          `https://solar.googleapis.com/v1/dataLayers:get?${params}`,
          { responseType: "json" }
        );
      } catch (error) {
        console.error(
          `[MaskFetcher] Error fetching data layers: ${error.message}`
        );
        throw new Error(`Failed to fetch data layers: ${error.message}`);
      }

      // Extract mask URL
      const { maskUrl } = response;

      if (!maskUrl) {
        console.error("[MaskFetcher] Mask URL not found in Solar API response");
        throw new Error("Mask URL not found in API response");
      }

      console.log(
        `[MaskFetcher] Successfully retrieved mask URL from Solar API`
      );

      // Download the mask data
      try {
        const maskData = await this.downloadRawData(maskUrl, apiKey);

        console.log(
          `[MaskFetcher] Successfully downloaded mask data: ${maskData.byteLength} bytes`
        );
        return maskData;
      } catch (error) {
        console.error(
          `[MaskFetcher] Error downloading mask data: ${error.message}`
        );
        throw new Error(`Failed to download mask data: ${error.message}`);
      }
    } catch (error) {
      console.error(`[MaskFetcher] Error in fetch operation: ${error.message}`);

      // Create a detailed error
      const enhancedError = new Error(`Mask fetcher error: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.location = location;
      enhancedError.options = { ...options, apiKey: "REDACTED" }; // Don't log the actual API key

      throw enhancedError;
    }
  }

  /**
   * Get all available data layer URLs for a location
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} - Object with all data layer URLs
   * @throws {Error} if fetching fails
   */
  async getAllDataLayerUrls(location, options = {}) {
    try {
      console.log(
        `[MaskFetcher] Getting all data layer URLs for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      // Set default options
      const radius = options.radius || config.api.DEFAULT_RADIUS;
      const quality = options.quality || config.api.DEFAULT_QUALITY;
      const apiKey = this.apiClient.apiKey;

      if (!apiKey) {
        throw new Error("API key is required for fetching data layer URLs");
      }

      // Format parameters for Google Solar API
      const params = this.formatSolarApiParams(
        location,
        radius,
        quality,
        apiKey
      );

      // Make request to Google Solar API
      const response = await this.fetchWithRetry(
        `https://solar.googleapis.com/v1/dataLayers:get?${params}`,
        { responseType: "json" }
      );

      console.log(
        `[MaskFetcher] Successfully retrieved all data layer URLs from Solar API`
      );

      return {
        maskUrl: response.maskUrl,
        dsmUrl: response.dsmUrl,
        rgbUrl: response.rgbUrl,
        annualFluxUrl: response.annualFluxUrl,
        monthlyFluxUrl: response.monthlyFluxUrl,
        hourlyShadeUrls: response.hourlyShadeUrls,
        imageryDate: response.imageryDate,
        imageryProcessedDate: response.imageryProcessedDate,
        imageryQuality: response.imageryQuality,
      };
    } catch (error) {
      console.error(
        `[MaskFetcher] Error getting all data layer URLs: ${error.message}`
      );
      throw new Error(`Failed to get all data layer URLs: ${error.message}`);
    }
  }
}

module.exports = MaskFetcher;
