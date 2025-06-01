/**
 * DSM layer processor for SolarScanner data-layers module
 *
 * Processes raw DSM (Digital Surface Model) layer data from GeoTIFF format into a structured
 * representation with elevation data.
 */

const Processor = require("../../core/processor");
const GeoTiffProcessor = require("../../utils/geotiff-processor");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Processor implementation for DSM layer data
 * @extends Processor
 */
class DsmProcessor extends Processor {
  /**
   * Create a new DsmProcessor
   */
  constructor() {
    super();
    this.geotiffProcessor = new GeoTiffProcessor();
    console.log("[DsmProcessor] Initialized with GeoTiffProcessor");
  }

  /**
   * Check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "dsm";
  }

  /**
   * Process raw DSM data
   * @param {Object|Buffer} rawData - The raw data from fetcher
   * @param {Object} options - Processing options
   * @param {Object} [options.targetLocation] - REQUIRED: Target location {latitude, longitude} for building detection
   * @param {boolean} [options.cropToBuilding=true] - Whether to crop to building boundaries
   * @param {Object} [options.targetDimensions] - Target dimensions to resample to
   * @returns {Promise<Object>} - Processed DSM data
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[DsmProcessor] Processing DSM data");

        // Validate target location for building detection
        if (!options.targetLocation) {
          throw new Error(
            "[DsmProcessor] targetLocation is required for building boundary detection. " +
              "This should be provided by the LayerManager."
          );
        }

        if (
          !options.targetLocation.latitude ||
          !options.targetLocation.longitude
        ) {
          throw new Error(
            "[DsmProcessor] targetLocation must have latitude and longitude properties. " +
              `Received: ${JSON.stringify(options.targetLocation)}`
          );
        }

        console.log(
          `[DsmProcessor] Using target location for building detection: ${options.targetLocation.latitude}, ${options.targetLocation.longitude}`
        );

        // Extract the DSM and mask buffers from input
        const { dsmBuffer, maskBuffer, metadata } =
          this.extractBuffers(rawData);

        // Process the DSM GeoTIFF
        const processedDsmGeoTiff = await this.processDsmGeoTiff(
          dsmBuffer,
          options
        );

        // Get dimensions and rasters
        const {
          rasters: dsmRasters,
          metadata: dsmMetadata,
          bounds,
        } = processedDsmGeoTiff;

        // Validate that we have geographic bounds for coordinate transformation
        if (!bounds) {
          throw new Error(
            "[DsmProcessor] No geographic bounds found in DSM GeoTIFF. " +
              "Cannot perform coordinate transformation for targeted building detection."
          );
        }

        console.log(
          `[DsmProcessor] DSM GeoTIFF bounds: ${JSON.stringify(bounds)}`
        );

        const width = dsmMetadata.width;
        const height = dsmMetadata.height;

        // Validate DSM raster data
        if (!dsmRasters || dsmRasters.length === 0) {
          throw new Error("No DSM raster data found in GeoTIFF");
        }

        // Get the DSM raster (first band)
        const dsmRaster = dsmRasters[0];

        // Store raw DSM data for reference
        let rawDsmRaster = [...dsmRaster]; // Clone to preserve

        // Process the mask if available - REQUIRED for target building detection
        let maskRaster = null;
        let buildingBoundaries = null;

        if (maskBuffer) {
          // Process mask data
          try {
            const processedMaskGeoTiff = await this.geotiffProcessor.process(
              maskBuffer,
              {
                convertToArray: true,
                page: 0,
              }
            );

            // Check mask dimensions
            const { metadata: maskMetadata, rasters: maskRasters } =
              processedMaskGeoTiff;

            if (
              maskMetadata.width !== width ||
              maskMetadata.height !== height
            ) {
              console.log(
                `[DsmProcessor] Mask dimensions (${maskMetadata.width}x${maskMetadata.height}) don't match DSM (${width}x${height}). Resampling...`
              );

              // Resample the mask to match DSM dimensions
              maskRaster = VisualizationUtils.resampleRaster(
                maskRasters[0],
                maskMetadata.width,
                maskMetadata.height,
                width,
                height,
                { method: "nearest" } // Use nearest for mask to preserve binary values
              );
            } else {
              maskRaster = maskRasters[0];
            }

            // Find building boundaries using targeted detection
            try {
              console.log(
                "[DsmProcessor] Finding target building boundaries..."
              );

              buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
                maskRaster,
                width,
                height,
                { margin: 0, threshold: 0 }, // No margin to get exact building bounds
                options.targetLocation, // Target location for building detection
                bounds // Geographic bounds from GeoTIFF for coordinate transformation
              );

              if (buildingBoundaries.hasBuilding) {
                console.log(
                  `[DsmProcessor] Found target building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
                );

                if (buildingBoundaries.targetBuilding) {
                  console.log(
                    `[DsmProcessor] Successfully detected target building with ${
                      buildingBoundaries.connectedPixelCount || "unknown"
                    } connected pixels`
                  );
                }
              } else {
                console.warn(
                  "[DsmProcessor] No target building found in mask data"
                );
              }
            } catch (error) {
              console.error(
                `[DsmProcessor] Error finding target building boundaries: ${error.message}`
              );

              // For the new approach, we want to fail rather than continue with defaults
              throw new Error(
                `Failed to find target building boundaries: ${error.message}`
              );
            }
          } catch (error) {
            console.error(
              `[DsmProcessor] Error processing mask: ${error.message}`
            );

            // For the new targeted approach, we should propagate the error
            throw new Error(
              `Failed to process mask data for target building detection: ${error.message}`
            );
          }
        } else {
          // No mask data available - this is a problem for the new approach
          throw new Error(
            "[DsmProcessor] Mask data is required for target building detection. " +
              "Cannot identify target building without mask data."
          );
        }

        // Apply the mask to the DSM data
        let maskedDsmRaster = VisualizationUtils.applyMaskToData(
          maskRaster,
          dsmRaster,
          width,
          height,
          {
            threshold: 0,
            nullValue: config.processing.NO_DATA_VALUE,
          }
        );

        // Check if we need to resample to target dimensions
        if (
          options.targetDimensions &&
          (options.targetDimensions.width !== width ||
            options.targetDimensions.height !== height)
        ) {
          console.log(
            `[DsmProcessor] Resampling to target dimensions: ${options.targetDimensions.width}x${options.targetDimensions.height}`
          );

          // Resample DSM data
          maskedDsmRaster = VisualizationUtils.resampleRaster(
            maskedDsmRaster,
            width,
            height,
            options.targetDimensions.width,
            options.targetDimensions.height,
            {
              noDataValue: config.processing.NO_DATA_VALUE,
              method: "bilinear",
            }
          );

          // Also resample raw data
          rawDsmRaster = VisualizationUtils.resampleRaster(
            rawDsmRaster,
            width,
            height,
            options.targetDimensions.width,
            options.targetDimensions.height,
            {
              noDataValue: config.processing.NO_DATA_VALUE,
              method: "bilinear",
            }
          );

          // Resample mask
          maskRaster = VisualizationUtils.resampleRaster(
            maskRaster,
            width,
            height,
            options.targetDimensions.width,
            options.targetDimensions.height,
            { method: "nearest" } // Use nearest for mask
          );

          // Update dimensions
          const oldWidth = width;
          const oldHeight = height;
          const newWidth = options.targetDimensions.width;
          const newHeight = options.targetDimensions.height;

          // Scale building boundaries
          if (buildingBoundaries) {
            const scaleX = newWidth / oldWidth;
            const scaleY = newHeight / oldHeight;

            buildingBoundaries = {
              minX: Math.floor(buildingBoundaries.minX * scaleX),
              minY: Math.floor(buildingBoundaries.minY * scaleY),
              maxX: Math.ceil(buildingBoundaries.maxX * scaleX),
              maxY: Math.ceil(buildingBoundaries.maxY * scaleY),
              width: Math.ceil(buildingBoundaries.width * scaleX),
              height: Math.ceil(buildingBoundaries.height * scaleY),
              hasBuilding: buildingBoundaries.hasBuilding,
              targetBuilding: buildingBoundaries.targetBuilding,
              connectedPixelCount: buildingBoundaries.connectedPixelCount,
            };
          }

          // Update current dimensions
          const currentWidth = newWidth;
          const currentHeight = newHeight;
        }

        // Find valid data range with percentile filtering
        const dataRange = this.calculateDataRange(maskedDsmRaster);

        // Calculate statistics
        const statistics = this.calculateStatistics(maskedDsmRaster, dataRange);

        // Determine current dimensions (after potential resampling)
        let currentWidth = options.targetDimensions
          ? options.targetDimensions.width
          : width;
        let currentHeight = options.targetDimensions
          ? options.targetDimensions.height
          : height;

        // Crop data to building boundaries if requested
        const cropEnabled = options.cropToBuilding !== false;
        let croppedDsmRaster = maskedDsmRaster;
        let croppedMaskRaster = maskRaster;
        let croppedOriginalRaster = rawDsmRaster;
        let croppedWidth = currentWidth;
        let croppedHeight = currentHeight;
        let croppedBounds = bounds;

        if (
          cropEnabled &&
          buildingBoundaries &&
          buildingBoundaries.hasBuilding
        ) {
          console.log(
            "[DsmProcessor] Cropping data to target building boundaries"
          );

          // Use the centralized utility for cropping
          const cropResult = VisualizationUtils.cropRastersToBuilding(
            maskedDsmRaster,
            maskRaster,
            currentWidth,
            currentHeight,
            buildingBoundaries,
            {
              originalRaster: rawDsmRaster,
              noDataValue: config.processing.NO_DATA_VALUE,
            }
          );

          croppedDsmRaster = cropResult.croppedRaster;
          croppedMaskRaster = cropResult.croppedMaskRaster;
          croppedOriginalRaster = cropResult.croppedOriginalRaster;
          croppedWidth = buildingBoundaries.width;
          croppedHeight = buildingBoundaries.height;

          console.log(
            `[DsmProcessor] Data cropped from ${currentWidth}x${currentHeight} to ${croppedWidth}x${croppedHeight}`
          );

          // Update bounds to reflect the cropped area
          croppedBounds = VisualizationUtils.adjustBoundsToBuilding(
            bounds,
            currentWidth,
            currentHeight,
            buildingBoundaries
          );

          // Update building boundaries to be relative to the cropped image
          buildingBoundaries =
            VisualizationUtils.normalizeBuilding(buildingBoundaries);
        } else {
          console.log("[DsmProcessor] Data not cropped - using full raster");
        }

        // Create the result object
        const result = {
          layerType: "dsm",
          metadata: {
            dimensions: {
              width: croppedWidth,
              height: croppedHeight,
              originalWidth: width,
              originalHeight: height,
            },
            ...dsmMetadata,
            ...metadata,
            dataRange,
            targetLocation: options.targetLocation,
            targetBuildingDetected: buildingBoundaries?.targetBuilding || false,
            buildingBoundaries: buildingBoundaries
              ? {
                  exists: buildingBoundaries.hasBuilding,
                  width: buildingBoundaries.width,
                  height: buildingBoundaries.height,
                }
              : null,
          },
          raster: croppedDsmRaster, // Using cropped masked version as primary raster
          originalRaster: croppedOriginalRaster, // Keep the cropped original for reference
          maskRaster: croppedMaskRaster,
          buildingBoundaries,
          bounds: croppedBounds,
          statistics,
        };

        console.log("[DsmProcessor] DSM processing complete");
        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "dsm",
        options: {
          ...options,
          targetLocation: options.targetLocation
            ? "[LOCATION PROVIDED]"
            : "[NO LOCATION]",
        },
      });
    }
  }

  /**
   * Extract DSM and mask buffers from raw data
   * @private
   * @param {Object|Buffer} rawData - Raw data from fetcher
   * @returns {Object} - Object with extracted buffers and metadata
   */
  extractBuffers(rawData) {
    // Check for object with embedded buffers
    const isObject =
      rawData &&
      typeof rawData === "object" &&
      (rawData.dsmData || rawData.dsmBuffer);

    let dsmBuffer, maskBuffer, metadata;

    if (isObject) {
      // Data is an object with embedded buffers
      dsmBuffer = rawData.dsmData || rawData.dsmBuffer;
      maskBuffer = rawData.maskData || rawData.maskBuffer;
      metadata = rawData.metadata || {};

      console.log(
        `[DsmProcessor] Received data object with DSM buffer (${
          dsmBuffer ? "present" : "missing"
        }) and mask buffer (${maskBuffer ? "present" : "missing"})`
      );
    } else {
      // Direct buffer
      dsmBuffer = rawData;
      maskBuffer = null;
      metadata = {};

      console.log("[DsmProcessor] Received direct buffer data");
    }

    // Validate DSM buffer
    if (!dsmBuffer) {
      throw new Error("DSM data buffer is required");
    }

    return { dsmBuffer, maskBuffer, metadata };
  }

  /**
   * Process DSM GeoTIFF data
   * @private
   * @param {Buffer} dsmBuffer - DSM data buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed GeoTIFF data
   */
  async processDsmGeoTiff(dsmBuffer, options = {}) {
    try {
      // Process with optimized options for DSM data
      const processOptions = {
        convertToArray: true,
        noAutoScale: true,
        ...options,
      };

      const result = await this.geotiffProcessor.process(
        dsmBuffer,
        processOptions
      );

      console.log(
        `[DsmProcessor] DSM GeoTIFF processed: ${result.metadata.width}x${result.metadata.height} pixels, ${result.rasters.length} bands`
      );

      return result;
    } catch (error) {
      console.error(
        `[DsmProcessor] Error processing DSM GeoTIFF: ${error.message}`
      );
      throw new Error(`Failed to process DSM GeoTIFF: ${error.message}`);
    }
  }

  /**
   * Calculate data range with percentile filtering for better visualization
   * @private
   * @param {Array} raster - Raster data
   * @returns {Object} - Data range information
   */
  calculateDataRange(raster) {
    try {
      const noDataValue = config.processing.NO_DATA_VALUE || -9999;

      // Collect and sort all valid values
      const validValues = [];
      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value) && isFinite(value)) {
          validValues.push(value);
        }
      }

      if (validValues.length === 0) {
        console.warn("[DsmProcessor] No valid values found");
        return {
          min: 0,
          max: 100,
          effectiveMin: 0,
          effectiveMax: 100,
          validCount: 0,
        };
      }

      // Sort values to find true min/max (like in Google demo)
      validValues.sort((a, b) => a - b);

      // Get actual min/max (like in the demo code)
      const absMin = validValues[0];
      const absMax = validValues[validValues.length - 1];

      // For DSM, use actual min/max values (not percentiles)
      return {
        min: absMin,
        max: absMax,
        absMin,
        absMax,
        // For visualization, use the actual min/max values
        effectiveMin: absMin,
        effectiveMax: absMax,
        validCount: validValues.length,
      };
    } catch (error) {
      console.error(
        `[DsmProcessor] Error calculating data range: ${error.message}`
      );

      // Default range for DSM
      return {
        min: 0,
        max: 100,
        effectiveMin: 0,
        effectiveMax: 100,
        validCount: 0,
        error: error.message,
      };
    }
  }

  /**
   * Calculate statistics for the DSM data
   * @private
   * @param {Array} raster - DSM raster
   * @param {Object} dataRange - Data range information
   * @returns {Object} - Statistics
   */
  calculateStatistics(raster, dataRange) {
    try {
      const noDataValue = config.processing.NO_DATA_VALUE || -9999;
      let sum = 0;
      let validPixels = 0;
      let maxValue = -Infinity;
      let maxLocation = -1;
      let elevationProfile = {};

      // Calculate stats
      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value) && isFinite(value)) {
          sum += value;
          validPixels++;

          if (value > maxValue) {
            maxValue = value;
            maxLocation = i;
          }

          // Create simplified elevation profile (rounded to nearest meter)
          const roundedElevation = Math.round(value);
          elevationProfile[roundedElevation] =
            (elevationProfile[roundedElevation] || 0) + 1;
        }
      }

      // Calculate average
      const avg = validPixels > 0 ? sum / validPixels : 0;

      return {
        min: dataRange.min,
        max: dataRange.max,
        avg,
        validPixels,
        maxValue,
        maxLocation,
        totalValue: sum,
        dataRange,
        elevationProfile,
      };
    } catch (error) {
      console.error(
        `[DsmProcessor] Error calculating statistics: ${error.message}`
      );

      // Return default statistics
      return {
        min: dataRange.min,
        max: dataRange.max,
        avg: 0,
        validPixels: 0,
        error: error.message,
      };
    }
  }
}

module.exports = DsmProcessor;
