/**
 * Configuration settings for SolarScanner data-layers module
 */

const config = {
  /**
   * API Request Settings
   */
  api: {
    /**
     * Maximum number of retries for failed API requests
     */
    MAX_RETRIES: 3,

    /**
     * Base delay between retries in milliseconds (doubles with each retry)
     */
    RETRY_DELAY: 1000,

    /**
     * Request timeout in milliseconds
     */
    REQUEST_TIMEOUT: 30000,

    /**
     * Default radius for data layer requests in meters
     */
    DEFAULT_RADIUS: 50,

    /**
     * Default quality setting for Solar API requests
     * Options: "LOW", "MEDIUM", "HIGH"
     * Note: Using "LOW" ensures data is returned even if higher quality isn't available
     */
    DEFAULT_QUALITY: "LOW",
  },

  /**
   * Visualization Settings
   */
  visualization: {
    /**
     * Maximum image dimension for visualization outputs
     * Larger images will be scaled down while maintaining aspect ratio
     */
    MAX_DIMENSION: 400,

    /**
     * Default margin (in pixels) to add around building boundaries
     */
    BUILDING_MARGIN: 20,

    /**
     * Default PNG quality setting (0-1)
     */
    PNG_QUALITY: 0.92,

    /**
     * Default JPEG quality setting (0-1) if used
     */
    JPEG_QUALITY: 0.85,

    /**
     * Size of color palette for visualizations
     */
    PALETTE_SIZE: 256,
  },

  /**
   * Cache Settings
   */
  cache: {
    /**
     * Whether to use cache by default
     */
    USE_CACHE: false,

    /**
     * Cache directory path (relative to application root)
     */
    CACHE_DIR: "../cache",

    /**
     * Cache expiration time in milliseconds (1 hour)
     */
    CACHE_EXPIRATION: 3600000,

    /**
     * Prefix for cache files
     */
    CACHE_PREFIX: "solarscanner_",
  },

  /**
   * Data Processing Settings
   */
  processing: {
    /**
     * Value to use for no-data or invalid pixel values in TIFF files
     */
    NO_DATA_VALUE: -9999,

    /**
     * Default threshold for mask data
     */
    MASK_THRESHOLD: 0,
  },

  /**
   * Development and Debug Settings
   */
  debug: {
    /**
     * Whether to enable verbose logging
     */
    VERBOSE_LOGGING: false,

    /**
     * Whether to include timing information in logs
     */
    LOG_TIMING: false,

    /**
     * Whether to save intermediate outputs for debugging
     */
    SAVE_INTERMEDIATE: false,
  },

  /**
   * Get a layered configuration object with default values that can be overridden
   * @param {Object} overrides - Configuration values to override
   * @returns {Object} - Merged configuration object
   */
  get: function (overrides = {}) {
    // Create a deep copy of the default config
    const defaultConfig = JSON.parse(JSON.stringify(this));

    // Remove the get method from the copy
    delete defaultConfig.get;

    // Helper function to recursively merge objects
    const mergeDeep = (target, source) => {
      for (const key in source) {
        if (source[key] instanceof Object && key in target) {
          mergeDeep(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
      return target;
    };

    // Return merged configuration
    return mergeDeep(defaultConfig, overrides);
  },
};

module.exports = config;
