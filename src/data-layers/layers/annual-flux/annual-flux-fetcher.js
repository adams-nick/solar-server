/**
 * Annual flux layer fetcher for SolarScanner data-layers module
 *
 * Handles fetching of annual flux layer data from the Google Solar API.
 * Annual flux represents yearly solar irradiance potential.
 */

const Fetcher = require("../../core/fetcher");
const config = require("../../config");

/**
 * Fetcher implementation for annual flux layer data
 * @extends Fetcher
 */
class AnnualFluxFetcher extends Fetcher {
  /**
   * Create a new AnnualFluxFetcher
   * @param {Object} apiClient - API client for making requests
   */
  constructor(apiClient) {
    super(apiClient);
    console.log("[AnnualFluxFetcher] Initialized");
  }

  /**
   * Check if this fetcher can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this fetcher can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "annualFlux";
  }

  /**
   * Fetch annual flux data from the Google Solar API
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Fetch options
   * @param {number} [options.radius=50] - Radius around the location in meters
   * @param {string} [options.quality='LOW'] - Minimum quality level ('LOW', 'MEDIUM', 'HIGH')
   * @param {boolean} [options.fetchMask=true] - Whether to also fetch mask data for reference
   * @returns {Promise<Object>} - Raw annual flux data and related information
   * @throws {Error} if fetching fails
   */
  async fetch(location, options = {}) {
    try {
      console.log(
        `[AnnualFluxFetcher] Fetching annual flux data for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      // Set default options
      const radius = options.radius || config.api.DEFAULT_RADIUS;
      const quality = options.quality || config.api.DEFAULT_QUALITY;
      const fetchMask = options.fetchMask !== false;
      const apiKey = this.apiClient.apiKey;

      if (!apiKey) {
        throw new Error("API key is required for fetching annual flux data");
      }

      // Format parameters for Google Solar API
      const params = this.formatSolarApiParams(
        location,
        radius,
        quality,
        apiKey
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
          `[AnnualFluxFetcher] Error fetching data layers: ${error.message}`
        );
        throw new Error(`Failed to fetch data layers: ${error.message}`);
      }

      // Extract annual flux URL and mask URL
      const { annualFluxUrl, maskUrl, imageryQuality } = response.data;

      // Validate URLs
      if (!annualFluxUrl) {
        console.error(
          "[AnnualFluxFetcher] Annual flux URL not found in Solar API response"
        );
        throw new Error("Annual flux URL not found in API response");
      }

      console.log(
        `[AnnualFluxFetcher] Successfully retrieved annual flux URL from Solar API`
      );

      // Download the annual flux data
      let fluxData;
      try {
        fluxData = await this.downloadRawData(annualFluxUrl, apiKey);
        console.log(
          `[AnnualFluxFetcher] Successfully downloaded annual flux data: ${fluxData.byteLength} bytes`
        );
      } catch (error) {
        console.error(
          `[AnnualFluxFetcher] Error downloading annual flux data: ${error.message}`
        );
        throw new Error(
          `Failed to download annual flux data: ${error.message}`
        );
      }

      // Download mask data if requested
      let maskData = null;
      if (fetchMask && maskUrl) {
        try {
          console.log("[AnnualFluxFetcher] Fetching associated mask data");
          maskData = await this.downloadRawData(maskUrl, apiKey);
          console.log(
            `[AnnualFluxFetcher] Successfully downloaded mask data: ${maskData.byteLength} bytes`
          );
        } catch (error) {
          console.warn(
            `[AnnualFluxFetcher] Failed to download mask data: ${error.message}`
          );
          // Continue without mask data
        }
      }

      // Return both the annual flux data and additional information
      return {
        fluxData,
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
        `[AnnualFluxFetcher] Error in fetch operation: ${error.message}`
      );

      // Create a detailed error
      const enhancedError = new Error(
        `Annual flux fetcher error: ${error.message}`
      );
      enhancedError.originalError = error;
      enhancedError.location = location;
      enhancedError.options = { ...options, apiKey: "REDACTED" }; // Don't log the actual API key

      throw enhancedError;
    }
  }

  /**
   * Pre-check if annual flux data is available for a location
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Check options
   * @returns {Promise<boolean>} - True if data is available
   */
  async isDataAvailable(location, options = {}) {
    try {
      console.log(
        `[AnnualFluxFetcher] Checking data availability for location: ${location.latitude}, ${location.longitude}`
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

        // Check if annual flux URL is available
        const isAvailable = !!response.data.annualFluxUrl;

        console.log(
          `[AnnualFluxFetcher] Annual flux data ${
            isAvailable ? "is" : "is not"
          } available for location`
        );
        return isAvailable;
      } catch (error) {
        console.log(
          `[AnnualFluxFetcher] Data appears to be unavailable: ${error.message}`
        );
        return false;
      }
    } catch (error) {
      console.error(
        `[AnnualFluxFetcher] Error checking data availability: ${error.message}`
      );
      return false;
    }
  }
}

module.exports = AnnualFluxFetcher;
