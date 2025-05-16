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
   * @returns {Promise<Object>} - Processed DSM data
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[DsmProcessor] Processing DSM data");

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

        const width = dsmMetadata.width;
        const height = dsmMetadata.height;

        // Validate DSM raster data
        if (!dsmRasters || dsmRasters.length === 0) {
          throw new Error("No DSM raster data found in GeoTIFF");
        }

        // Get the DSM raster (first band)
        const dsmRaster = dsmRasters[0];

        // Store raw DSM data for reference
        const rawDsmRaster = [...dsmRaster]; // Clone to preserve

        // Process the mask if available
        let maskRaster = null;
        let buildingBoundaries = null;

        if (maskBuffer) {
          const processingResult = await this.processMask(
            maskBuffer,
            width,
            height,
            options
          );

          maskRaster = processingResult.maskRaster;
          buildingBoundaries = processingResult.buildingBoundaries;
        } else {
          // Create default mask and boundaries if no mask provided
          console.log("[DsmProcessor] Using default mask and boundaries");
          maskRaster = this.createDefaultMask(width, height);
          buildingBoundaries = this.createDefaultBuildingBoundaries(
            width,
            height
          );
        }

        // Apply the mask to the DSM data
        let maskedDsmRaster = this.applyMask(
          dsmRaster,
          maskRaster,
          width,
          height
        );

        // Find valid data range with percentile filtering
        const dataRange = this.calculateDataRange(maskedDsmRaster);

        // Calculate statistics
        const statistics = this.calculateStatistics(maskedDsmRaster, dataRange);

        // Create the result object
        const result = {
          layerType: "dsm",
          metadata: {
            dimensions: { width, height },
            ...dsmMetadata,
            ...metadata,
            dataRange,
          },
          raster: maskedDsmRaster, // Using masked version as primary raster
          originalRaster: rawDsmRaster, // Keep the original for reference
          maskRaster,
          buildingBoundaries,
          bounds,
          statistics,
        };

        console.log("[DsmProcessor] DSM processing complete");
        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "dsm",
        options,
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
   * Process mask data
   * @private
   * @param {Buffer} maskBuffer - Mask data buffer
   * @param {number} dsmWidth - Width of DSM data
   * @param {number} dsmHeight - Height of DSM data
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed mask and building boundaries
   */
  async processMask(maskBuffer, dsmWidth, dsmHeight, options = {}) {
    try {
      console.log("[DsmProcessor] Processing mask data");

      // Process the mask GeoTIFF
      const processedMaskGeoTiff = await this.geotiffProcessor.process(
        maskBuffer,
        {
          convertToArray: true,
          noAutoScale: true,
          ...options,
        }
      );

      const { metadata: maskMetadata, rasters: maskRasters } =
        processedMaskGeoTiff;

      // Check dimensions match
      let maskRaster = maskRasters[0];
      if (
        maskMetadata.width !== dsmWidth ||
        maskMetadata.height !== dsmHeight
      ) {
        console.log(
          `[DsmProcessor] Mask dimensions (${maskMetadata.width}x${maskMetadata.height}) don't match DSM (${dsmWidth}x${dsmHeight}). Resizing...`
        );

        maskRaster = this.resizeMask(
          maskRaster,
          maskMetadata.width,
          maskMetadata.height,
          dsmWidth,
          dsmHeight
        );
      }

      // Count non-zero values in mask
      const nonZeroCount = maskRaster.filter((v) => v > 0).length;
      console.log(
        `[DsmProcessor] Mask has ${nonZeroCount} non-zero values out of ${
          maskRaster.length
        } (${((nonZeroCount / maskRaster.length) * 100).toFixed(2)}%)`
      );

      // Handle empty mask
      if (nonZeroCount === 0) {
        console.warn(
          "[DsmProcessor] Mask has no non-zero values, creating default mask"
        );
        maskRaster = this.createDefaultMask(dsmWidth, dsmHeight);
      }

      // Find building boundaries
      const buildingMargin =
        options.buildingMargin || config.visualization.BUILDING_MARGIN || 20;

      let buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
        maskRaster,
        dsmWidth,
        dsmHeight,
        { margin: buildingMargin }
      );

      // Create default boundaries if none found
      if (!buildingBoundaries.hasBuilding) {
        console.warn(
          "[DsmProcessor] No building found in mask, using default boundaries"
        );
        buildingBoundaries = this.createDefaultBuildingBoundaries(
          dsmWidth,
          dsmHeight
        );
      }

      return { maskRaster, buildingBoundaries };
    } catch (error) {
      console.error(`[DsmProcessor] Error processing mask: ${error.message}`);

      // Return defaults on error
      const maskRaster = this.createDefaultMask(dsmWidth, dsmHeight);
      const buildingBoundaries = this.createDefaultBuildingBoundaries(
        dsmWidth,
        dsmHeight
      );

      return { maskRaster, buildingBoundaries };
    }
  }

  /**
   * Create a default mask with a building region in the center
   * @private
   * @param {number} width - Width of mask
   * @param {number} height - Height of mask
   * @returns {Array} - Default mask data
   */
  createDefaultMask(width, height) {
    const mask = new Array(width * height).fill(0);

    // Create a building region in the center (30-70% of dimensions)
    const startX = Math.floor(width * 0.3);
    const endX = Math.floor(width * 0.7);
    const startY = Math.floor(height * 0.3);
    const endY = Math.floor(height * 0.7);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = y * width + x;
        mask[idx] = 1; // Mark as building
      }
    }

    console.log(
      `[DsmProcessor] Created default mask with building region (${startX},${startY}) to (${endX},${endY})`
    );

    return mask;
  }

  /**
   * Create default building boundaries for center region
   * @private
   * @param {number} width - Width of image
   * @param {number} height - Height of image
   * @returns {Object} - Building boundaries object
   */
  createDefaultBuildingBoundaries(width, height) {
    const minX = Math.floor(width * 0.3);
    const maxX = Math.floor(width * 0.7);
    const minY = Math.floor(height * 0.3);
    const maxY = Math.floor(height * 0.7);

    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      hasBuilding: true,
    };
  }

  /**
   * Apply mask to DSM data
   * @private
   * @param {Array} dsmRaster - DSM raster data
   * @param {Array} maskRaster - Mask raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Array} - Masked DSM data
   */
  applyMask(dsmRaster, maskRaster, width, height) {
    try {
      const maskedRaster = new Array(dsmRaster.length);
      const noDataValue = config.processing.NO_DATA_VALUE || -9999;
      let maskedCount = 0;
      let validCount = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;

          // Check if this pixel is inside mask and has valid DSM data
          if (
            maskRaster[idx] > 0 &&
            dsmRaster[idx] !== noDataValue &&
            !isNaN(dsmRaster[idx]) &&
            isFinite(dsmRaster[idx])
          ) {
            maskedRaster[idx] = dsmRaster[idx];
            validCount++;
          } else {
            maskedRaster[idx] = noDataValue;
            maskedCount++;
          }
        }
      }

      console.log(
        `[DsmProcessor] Masked ${maskedCount} pixels, kept ${validCount} valid pixels (${(
          (validCount / dsmRaster.length) *
          100
        ).toFixed(2)}% of total)`
      );

      // Handle case with no valid data
      if (validCount === 0) {
        console.warn(
          "[DsmProcessor] No valid pixels after masking, using original DSM data"
        );
        return dsmRaster; // Use original as fallback
      }

      return maskedRaster;
    } catch (error) {
      console.error(`[DsmProcessor] Error applying mask: ${error.message}`);
      return dsmRaster; // Return original on error
    }
  }

  /**
   * Resize mask data to match DSM dimensions
   * @private
   * @param {Array} maskData - Original mask data
   * @param {number} srcWidth - Source width
   * @param {number} srcHeight - Source height
   * @param {number} destWidth - Destination width
   * @param {number} destHeight - Destination height
   * @returns {Array} - Resized mask data
   */
  resizeMask(maskData, srcWidth, srcHeight, destWidth, destHeight) {
    console.log(
      `[DsmProcessor] Resizing mask from ${srcWidth}x${srcHeight} to ${destWidth}x${destHeight}`
    );

    const resizedMask = new Array(destWidth * destHeight).fill(0);

    // Scaling factors
    const scaleX = srcWidth / destWidth;
    const scaleY = srcHeight / destHeight;

    // Count non-zero values before and after
    let srcNonZero = 0;
    let destNonZero = 0;

    // Count source non-zero values
    for (let i = 0; i < maskData.length; i++) {
      if (maskData[i] > 0) srcNonZero++;
    }

    // Perform resizing
    for (let y = 0; y < destHeight; y++) {
      for (let x = 0; x < destWidth; x++) {
        // Find corresponding source position
        const srcX = Math.min(Math.floor(x * scaleX), srcWidth - 1);
        const srcY = Math.min(Math.floor(y * scaleY), srcHeight - 1);

        const srcIdx = srcY * srcWidth + srcX;
        const destIdx = y * destWidth + x;

        // Copy value if source index is valid
        if (srcIdx >= 0 && srcIdx < maskData.length) {
          resizedMask[destIdx] = maskData[srcIdx];

          if (maskData[srcIdx] > 0) destNonZero++;
        }
      }
    }

    console.log(
      `[DsmProcessor] Mask resize: source had ${srcNonZero} non-zero pixels, destination has ${destNonZero} non-zero pixels`
    );

    return resizedMask;
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
