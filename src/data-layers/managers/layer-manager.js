/**
 * Layer Manager for SolarScanner data-layers module
 *
 * Coordinates the fetching, processing, and visualization of data layers.
 * Provides a high-level interface for layer operations.
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");

/**
 * Manages the fetching, processing, and visualization of data layers
 */
class LayerManager {
  /**
   * Create a new LayerManager
   * @param {Object} factory - DataLayerFactory instance
   * @param {Object} apiClient - API client for making requests
   */
  constructor(factory, apiClient) {
    if (!factory) {
      const error = new Error("DataLayerFactory is required");
      console.error("[LayerManager] Constructor error:", error.message);
      throw error;
    }

    if (!apiClient) {
      const error = new Error("API client is required");
      console.error("[LayerManager] Constructor error:", error.message);
      throw error;
    }

    this.factory = factory;
    this.apiClient = apiClient;
    this.cacheDir = config.cache.CACHE_DIR;
    this.useCache = config.cache.USE_CACHE;

    // Create cache directory if it doesn't exist and caching is enabled
    if (this.useCache) {
      this.initializeCache();
    }

    console.log(
      `[LayerManager] Initialized with ${
        this.factory.getFullyImplementedLayerTypes().length
      } layer types`
    );
    console.log(
      `[LayerManager] Caching ${this.useCache ? "enabled" : "disabled"}`
    );
  }

  /**
   * Process a data layer request
   * @param {string} layerType - The layer type (mask, monthlyFlux, etc.)
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - The processed result with visualization
   * @throws {Error} if processing fails
   */
  async processLayer(layerType, location, options = {}) {
    const operationStart = Date.now();
    const operationId = this.generateOperationId();
    let cachedResult = null;

    try {
      console.log(
        `[LayerManager] [${operationId}] Processing layer '${layerType}' for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate inputs
      this.validateLayerType(layerType);
      this.validateLocation(location);

      // Check cache if enabled
      if (this.useCache) {
        try {
          cachedResult = await this.checkCache(layerType, location, options);

          if (cachedResult) {
            console.log(
              `[LayerManager] [${operationId}] Using cached result for layer '${layerType}'`
            );
            return cachedResult;
          }
        } catch (cacheError) {
          console.warn(
            `[LayerManager] [${operationId}] Cache check failed: ${cacheError.message}`
          );
          // Continue without cache
        }
      }

      // Get the appropriate components for this layer type
      const fetcher = this.factory.getFetcher(layerType);
      const processor = this.factory.getProcessor(layerType);
      const visualizer = this.factory.getVisualizer(layerType);

      // Fetch the raw data
      console.log(`[LayerManager] [${operationId}] Fetching raw data...`);
      const fetchStart = Date.now();
      let rawData;

      try {
        rawData = await fetcher.fetch(location, options);
        console.log(
          `[LayerManager] [${operationId}] Raw data fetched in ${
            Date.now() - fetchStart
          }ms`
        );
      } catch (fetchError) {
        console.error(
          `[LayerManager] [${operationId}] Error fetching data: ${fetchError.message}`
        );

        if (options.fallbackToSynthetic !== false) {
          console.log(
            `[LayerManager] [${operationId}] Using synthetic visualization as fallback`
          );
          return this.createSyntheticResult(layerType, location, options);
        }

        throw fetchError;
      }

      // Process the data
      console.log(`[LayerManager] [${operationId}] Processing data...`);
      const processStart = Date.now();
      let processedData;

      try {
        processedData = await processor.process(rawData, options);
        console.log(
          `[LayerManager] [${operationId}] Data processed in ${
            Date.now() - processStart
          }ms`
        );
      } catch (processError) {
        console.error(
          `[LayerManager] [${operationId}] Error processing data: ${processError.message}`
        );

        if (options.fallbackToSynthetic !== false) {
          console.log(
            `[LayerManager] [${operationId}] Using synthetic visualization as fallback`
          );
          return this.createSyntheticResult(layerType, location, options);
        }

        throw processError;
      }

      // Create visualization
      console.log(`[LayerManager] [${operationId}] Creating visualization...`);
      const visualizeStart = Date.now();
      let visualization;

      try {
        visualization = await visualizer.visualize(processedData, options);
        console.log(
          `[LayerManager] [${operationId}] Visualization created in ${
            Date.now() - visualizeStart
          }ms`
        );
      } catch (visualizeError) {
        console.error(
          `[LayerManager] [${operationId}] Error creating visualization: ${visualizeError.message}`
        );

        if (options.fallbackToSynthetic !== false) {
          console.log(
            `[LayerManager] [${operationId}] Using synthetic visualization as fallback`
          );
          return this.createSyntheticResult(layerType, location, options);
        }

        throw visualizeError;
      }

      // Create the result object
      const result = {
        layerType,
        location,
        processedData,
        visualization,
        metadata: {
          generatedAt: new Date().toISOString(),
          processingTime: Date.now() - operationStart,
          operationId,
        },
      };

      // Store result in cache if enabled
      if (this.useCache) {
        try {
          await this.storeInCache(layerType, location, options, result);
        } catch (cacheError) {
          console.warn(
            `[LayerManager] [${operationId}] Failed to store in cache: ${cacheError.message}`
          );
          // Continue without caching
        }
      }

      console.log(
        `[LayerManager] [${operationId}] Layer processing completed in ${
          Date.now() - operationStart
        }ms`
      );

      return result;
    } catch (error) {
      const processingTime = Date.now() - operationStart;
      console.error(
        `[LayerManager] [${operationId}] Error processing layer '${layerType}': ${error.message} (after ${processingTime}ms)`
      );

      // Create an enhanced error
      const enhancedError = new Error(
        `Failed to process layer '${layerType}': ${error.message}`
      );
      enhancedError.originalError = error;
      enhancedError.layerType = layerType;
      enhancedError.location = location;
      enhancedError.options = { ...options };
      enhancedError.operationId = operationId;

      throw enhancedError;
    }
  }

  /**
   * Process multiple data layers for the same location
   * @param {Array<string>} layerTypes - Array of layer types
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Object with results for each layer type
   * @throws {Error} if processing fails for all layers
   */
  async processMultipleLayers(layerTypes, location, options = {}) {
    const operationStart = Date.now();
    const operationId = this.generateOperationId();

    try {
      console.log(
        `[LayerManager] [${operationId}] Processing multiple layers for location: ${location.latitude}, ${location.longitude}`
      );

      // Validate location
      this.validateLocation(location);

      if (!Array.isArray(layerTypes) || layerTypes.length === 0) {
        throw new Error("At least one layer type is required");
      }

      // Filter out unsupported layer types
      const supportedLayerTypes = layerTypes.filter((type) =>
        this.factory.supportsLayerType(type)
      );

      if (supportedLayerTypes.length === 0) {
        throw new Error(
          `None of the requested layer types are supported. Supported types are: ${this.factory
            .getSupportedLayerTypes()
            .join(", ")}`
        );
      }

      if (supportedLayerTypes.length < layerTypes.length) {
        console.warn(
          `[LayerManager] [${operationId}] Some requested layer types are not supported and will be skipped`
        );
      }

      const results = {};
      const errors = [];
      const parallelProcessing = options.parallel !== false;

      if (parallelProcessing) {
        // Process layers in parallel
        console.log(
          `[LayerManager] [${operationId}] Processing ${supportedLayerTypes.length} layers in parallel`
        );

        const promises = supportedLayerTypes.map((layerType) =>
          this.processLayer(layerType, location, {
            ...options,
            layerType,
          }).catch((error) => {
            console.error(
              `[LayerManager] [${operationId}] Error processing layer '${layerType}': ${error.message}`
            );
            errors.push({ layerType, error });
            return null;
          })
        );

        const layerResults = await Promise.all(promises);

        // Combine results
        supportedLayerTypes.forEach((layerType, index) => {
          if (layerResults[index]) {
            results[layerType] = layerResults[index];
          }
        });
      } else {
        // Process layers sequentially
        console.log(
          `[LayerManager] [${operationId}] Processing ${supportedLayerTypes.length} layers sequentially`
        );

        for (const layerType of supportedLayerTypes) {
          try {
            const result = await this.processLayer(layerType, location, {
              ...options,
              layerType,
            });

            results[layerType] = result;
          } catch (error) {
            console.error(
              `[LayerManager] [${operationId}] Error processing layer '${layerType}': ${error.message}`
            );
            errors.push({ layerType, error });
          }
        }
      }

      // Check if we have any successful results
      const successCount = Object.keys(results).length;

      if (successCount === 0) {
        // All layers failed
        const errorMessage = `All ${
          supportedLayerTypes.length
        } layer types failed processing: ${errors
          .map((e) => e.layerType)
          .join(", ")}`;
        console.error(`[LayerManager] [${operationId}] ${errorMessage}`);

        // Create synthetic fallback if enabled
        if (options.fallbackToSynthetic !== false) {
          console.log(
            `[LayerManager] [${operationId}] Using synthetic visualizations as fallback`
          );

          const fallbackResults = {};

          for (const layerType of supportedLayerTypes) {
            fallbackResults[layerType] = await this.createSyntheticResult(
              layerType,
              location,
              options
            );
          }

          return {
            results: fallbackResults,
            metadata: {
              allSynthetic: true,
              originalErrors: errors,
              generatedAt: new Date().toISOString(),
              processingTime: Date.now() - operationStart,
              operationId,
            },
          };
        }

        const combinedError = new Error(errorMessage);
        combinedError.errors = errors;
        throw combinedError;
      }

      // Return combined results
      console.log(
        `[LayerManager] [${operationId}] Completed processing ${successCount}/${
          supportedLayerTypes.length
        } layers in ${Date.now() - operationStart}ms`
      );

      return {
        results,
        errors: errors.length > 0 ? errors : null,
        metadata: {
          successCount,
          totalCount: supportedLayerTypes.length,
          failedCount: errors.length,
          generatedAt: new Date().toISOString(),
          processingTime: Date.now() - operationStart,
          operationId,
        },
      };
    } catch (error) {
      const processingTime = Date.now() - operationStart;
      console.error(
        `[LayerManager] [${operationId}] Error processing multiple layers: ${error.message} (after ${processingTime}ms)`
      );

      // Create an enhanced error
      const enhancedError = new Error(
        `Failed to process multiple layers: ${error.message}`
      );
      enhancedError.originalError = error;
      enhancedError.layerTypes = layerTypes;
      enhancedError.location = location;
      enhancedError.options = { ...options };
      enhancedError.operationId = operationId;

      throw enhancedError;
    }
  }

  /**
   * Create a synthetic visualization result when real data is unavailable
   * @param {string} layerType - The layer type
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Visualization options
   * @returns {Promise<Object>} - Synthetic result object
   */
  async createSyntheticResult(layerType, location, options = {}) {
    try {
      console.log(
        `[LayerManager] Creating synthetic result for layer '${layerType}'`
      );

      // Get the visualizer for this layer type
      const visualizer = this.factory.getVisualizer(layerType);

      // Create synthetic visualization
      const visualization = await visualizer.visualize(null, {
        ...options,
        synthetic: true,
        location,
      });

      // Create the result object
      return {
        layerType,
        location,
        visualization,
        synthetic: true,
        metadata: {
          generatedAt: new Date().toISOString(),
          synthetic: true,
        },
      };
    } catch (error) {
      console.error(
        `[LayerManager] Error creating synthetic result: ${error.message}`
      );

      // Create a minimal fallback
      return {
        layerType,
        location,
        error: `Failed to create synthetic visualization: ${error.message}`,
        synthetic: true,
        visualization: null,
      };
    }
  }

  /**
   * Check if result is available in cache
   * @private
   * @param {string} layerType - The layer type
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Processing options
   * @returns {Promise<Object|null>} - Cached result or null if not found
   */
  async checkCache(layerType, location, options = {}) {
    if (!this.useCache) {
      return null;
    }

    try {
      // Generate cache key
      const cacheKey = this.generateCacheKey(layerType, location, options);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

      // Check if cache file exists
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      // Read cache file
      const cacheData = JSON.parse(fs.readFileSync(cachePath, "utf8"));

      // Check expiration
      const cacheTime = new Date(cacheData.metadata.timestamp).getTime();
      const currentTime = Date.now();
      const cacheAge = currentTime - cacheTime;

      if (cacheAge > config.cache.CACHE_EXPIRATION) {
        console.log(
          `[LayerManager] Cache expired for key '${cacheKey}', age: ${cacheAge}ms`
        );
        return null;
      }

      console.log(
        `[LayerManager] Cache hit for key '${cacheKey}', age: ${cacheAge}ms`
      );

      return cacheData;
    } catch (error) {
      console.error(`[LayerManager] Error checking cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Store result in cache
   * @private
   * @param {string} layerType - The layer type
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Processing options
   * @param {Object} result - Result to cache
   * @returns {Promise<void>}
   */
  async storeInCache(layerType, location, options, result) {
    if (!this.useCache) {
      return;
    }

    try {
      // Generate cache key
      const cacheKey = this.generateCacheKey(layerType, location, options);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

      // Add cache metadata to result
      const cacheData = {
        ...result,
        metadata: {
          ...(result.metadata || {}),
          timestamp: new Date().toISOString(),
          cacheKey,
        },
      };

      // Optimize data for storage
      // For example, we might want to strip out large intermediate data
      if (cacheData.processedData && options.cacheProcessedData === false) {
        delete cacheData.processedData;
      }

      // Write to cache file
      fs.writeFileSync(cachePath, JSON.stringify(cacheData));

      console.log(`[LayerManager] Stored in cache with key '${cacheKey}'`);
    } catch (error) {
      console.error(`[LayerManager] Error storing in cache: ${error.message}`);
      throw new Error(`Failed to store in cache: ${error.message}`);
    }
  }

  /**
   * Initialize cache directory
   * @private
   */
  initializeCache() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        console.log(`[LayerManager] Created cache directory: ${this.cacheDir}`);
      }
    } catch (error) {
      console.error(
        `[LayerManager] Error initializing cache: ${error.message}`
      );
      this.useCache = false;
    }
  }

  /**
   * Generate a cache key based on layer type, location, and options
   * @private
   * @param {string} layerType - The layer type
   * @param {Object} location - The location {latitude, longitude}
   * @param {Object} options - Processing options
   * @returns {string} - Cache key
   */
  generateCacheKey(layerType, location, options = {}) {
    // Create a simplified options object with only the keys that affect caching
    const relevantOptions = {};

    if (options.radius) relevantOptions.radius = options.radius;
    if (options.quality) relevantOptions.quality = options.quality;
    if (options.month !== undefined) relevantOptions.month = options.month;
    if (options.buildingFocus !== undefined)
      relevantOptions.buildingFocus = options.buildingFocus;

    // Generate a hash of the options
    const optionsHash = this.hashCode(JSON.stringify(relevantOptions));

    // Format location with fixed precision
    const lat = location.latitude.toFixed(5);
    const lng = location.longitude.toFixed(5);

    // Combine into a key
    return `${config.cache.CACHE_PREFIX}${layerType}_${lat}_${lng}_${optionsHash}`;
  }

  /**
   * Generate a unique operation ID
   * @private
   * @returns {string} - Operation ID
   */
  generateOperationId() {
    return `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .substr(2, 5)}`;
  }

  /**
   * Generate a simple hash code for a string
   * @private
   * @param {string} str - String to hash
   * @returns {string} - Hash code
   */
  hashCode(str) {
    let hash = 0;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    // Convert to positive hex string
    return (hash >>> 0).toString(16);
  }

  /**
   * Validate a layer type
   * @private
   * @param {string} layerType - The layer type to validate
   * @throws {Error} if layer type is invalid
   */
  validateLayerType(layerType) {
    if (!layerType) {
      throw new Error("Layer type must be provided");
    }

    if (typeof layerType !== "string") {
      throw new Error("Layer type must be a string");
    }

    if (!this.factory.supportsLayerType(layerType)) {
      throw new Error(
        `Unsupported layer type: ${layerType}. Supported types are: ${this.factory
          .getSupportedLayerTypes()
          .join(", ")}`
      );
    }
  }

  /**
   * Validate a location object
   * @private
   * @param {Object} location - The location to validate
   * @throws {Error} if location is invalid
   */
  validateLocation(location) {
    if (!location) {
      throw new Error("Location must be provided");
    }

    if (typeof location !== "object") {
      throw new Error("Location must be an object");
    }

    if (typeof location.latitude !== "number") {
      throw new Error("Location must have a numeric latitude");
    }

    if (typeof location.longitude !== "number") {
      throw new Error("Location must have a numeric longitude");
    }

    if (location.latitude < -90 || location.latitude > 90) {
      throw new Error("Latitude must be between -90 and 90");
    }

    if (location.longitude < -180 || location.longitude > 180) {
      throw new Error("Longitude must be between -180 and 180");
    }
  }
}

module.exports = LayerManager;
