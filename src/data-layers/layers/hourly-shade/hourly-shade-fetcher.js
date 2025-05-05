/**
 * Hourly shade layer fetcher for SolarScanner data-layers module
 *
 * Handles fetching of hourly shade layer data from the Google Solar API.
 * Hourly shade data provides information about shadow patterns for each hour of the day.
 */

const Fetcher = require("../../core/fetcher");
const config = require("../../config");

/**
 * Fetcher implementation for hourly shade layer data
 * @extends Fetcher
 */
class HourlyShadesFetcher extends Fetcher {
  /**
   * Create a new HourlyShadesFetcher
   * @param {Object} apiClient - API client for making requests
   */
  constructor(apiClient) {
    super(apiClient);
    console.log("[HourlyShadesFetcher] Initialized");
  }

  /**
   * Check if this fetcher can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this fetcher can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "hourlyShade";
  }

  /**
   * Fetch hourly shade data from the Google Solar API
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Fetch options
   * @param {number} [options.radius=50] - Radius around the location in meters
   * @param {string} [options.quality='LOW'] - Minimum quality level ('LOW', 'MEDIUM', 'HIGH')
   * @param {boolean} [options.fetchMask=true] - Whether to also fetch mask data for reference
   * @param {number} [options.month=0] - Month index (0-11) to fetch, defaults to January
   * @returns {Promise<Object>} - Raw hourly shade data and related information
   * @throws {Error} if fetching fails
   */
  async fetch(location, options = {}) {
    try {
      console.log(
        `[HourlyShadesFetcher] Fetching hourly shade data for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      // Set default options
      const radius = options.radius || config.api.DEFAULT_RADIUS;
      const quality = options.quality || config.api.DEFAULT_QUALITY;
      const fetchMask = options.fetchMask !== false;
      const monthIndex = options.month !== undefined ? options.month : 0;
      const apiKey = this.apiClient.apiKey;

      if (!apiKey) {
        throw new Error("API key is required for fetching hourly shade data");
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
        `[HourlyShadesFetcher] Requesting data layers with params: ${params
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
        console.log(
          `[HourlyShadesFetcher] API response status: ${response.status}`
        );
      } catch (error) {
        console.error(
          `[HourlyShadesFetcher] Error fetching data layers: ${error.message}`
        );
        throw new Error(`Failed to fetch data layers: ${error.message}`);
      }

      // Extract hourly shade URLs and mask URL
      const { hourlyShadeUrls, maskUrl, imageryQuality } = response.data;

      // Validate URLs
      if (!hourlyShadeUrls || hourlyShadeUrls.length === 0) {
        console.error(
          "[HourlyShadesFetcher] Hourly shade URLs not found in Solar API response"
        );
        throw new Error("Hourly shade URLs not found in API response");
      }

      if (monthIndex < 0 || monthIndex >= hourlyShadeUrls.length) {
        throw new Error(
          `Month index ${monthIndex} is out of range (0-${
            hourlyShadeUrls.length - 1
          })`
        );
      }

      console.log(
        `[HourlyShadesFetcher] Successfully retrieved ${hourlyShadeUrls.length} hourly shade URLs from Solar API`
      );
      console.log(`[HourlyShadesFetcher] Using month index: ${monthIndex}`);
      console.log(
        `[HourlyShadesFetcher] Hourly shade URL for selected month: ${hourlyShadeUrls[monthIndex]}`
      );
      console.log(`[HourlyShadesFetcher] Mask URL: ${maskUrl}`);
      console.log(
        `[HourlyShadesFetcher] Imagery quality: ${imageryQuality || "unknown"}`
      );

      // Download the hourly shade data for the selected month
      let hourlyShadeData;
      try {
        // Ensure the URL includes the API key
        const hourlyShadeUrl = hourlyShadeUrls[monthIndex];
        const fullUrl = hourlyShadeUrl.includes("?")
          ? `${hourlyShadeUrl}&key=${apiKey}`
          : `${hourlyShadeUrl}?key=${apiKey}`;

        console.log(
          `[HourlyShadesFetcher] Downloading hourly shade data from: ${fullUrl.replace(
            /key=[^&]+/,
            "key=*****"
          )}`
        );

        const hourlyShadeResponse = await this.apiClient.get(fullUrl, {
          responseType: "arraybuffer",
        });

        hourlyShadeData = hourlyShadeResponse.data;
        console.log(
          `[HourlyShadesFetcher] Successfully downloaded hourly shade data: ${hourlyShadeData.byteLength} bytes`
        );
      } catch (error) {
        console.error(
          `[HourlyShadesFetcher] Error downloading hourly shade data: ${error.message}`
        );
        throw new Error(
          `Failed to download hourly shade data: ${error.message}`
        );
      }

      // Download mask data if requested
      let maskData = null;
      if (fetchMask && maskUrl) {
        try {
          console.log("[HourlyShadesFetcher] Fetching associated mask data");

          // Ensure the URL includes the API key
          const fullMaskUrl = maskUrl.includes("?")
            ? `${maskUrl}&key=${apiKey}`
            : `${maskUrl}?key=${apiKey}`;

          console.log(
            `[HourlyShadesFetcher] Downloading mask data from: ${fullMaskUrl.replace(
              /key=[^&]+/,
              "key=*****"
            )}`
          );

          const maskResponse = await this.apiClient.get(fullMaskUrl, {
            responseType: "arraybuffer",
          });

          maskData = maskResponse.data;
          console.log(
            `[HourlyShadesFetcher] Successfully downloaded mask data: ${maskData.byteLength} bytes`
          );
        } catch (maskError) {
          console.warn(
            `[HourlyShadesFetcher] Failed to download mask data: ${maskError.message}`
          );
          // Continue without mask data
        }
      }

      // Return both the hourly shade data and additional information
      return {
        hourlyShadeData,
        maskData,
        metadata: {
          imageryQuality,
          imageryDate: response.data.imageryDate,
          imageryProcessedDate: response.data.imageryProcessedDate,
          location,
          monthIndex,
          allMonthsUrls: hourlyShadeUrls,
        },
      };
    } catch (error) {
      console.error(
        `[HourlyShadesFetcher] Error in fetch operation: ${error.message}`
      );

      // Create a detailed error
      const enhancedError = new Error(
        `Hourly shade fetcher error: ${error.message}`
      );
      enhancedError.originalError = error;
      enhancedError.location = location;
      enhancedError.options = { ...options, apiKey: "REDACTED" }; // Don't log the actual API key

      throw enhancedError;
    }
  }
}

module.exports = HourlyShadesFetcher;
