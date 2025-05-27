/**
 * Annual flux layer processor for SolarScanner data-layers module
 */

const Processor = require("../../core/processor");
const GeoTiffProcessor = require("../../utils/geotiff-processor");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

class AnnualFluxProcessor extends Processor {
  /**
   * Create a new AnnualFluxProcessor
   */
  constructor() {
    super();
    this.geotiffProcessor = new GeoTiffProcessor();
    console.log("[AnnualFluxProcessor] Initialized with GeoTiffProcessor");
  }

  /**
   * Check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "annualFlux";
  }

  /**
   * Process raw annual flux data
   * @param {Object|Buffer} rawData - The raw data from fetcher
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed annual flux data
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[AnnualFluxProcessor] Processing annual flux data");

        // Extract the flux and mask buffers from input
        const { fluxBuffer, maskBuffer, metadata } =
          this.extractBuffers(rawData);

        // Process the flux GeoTIFF
        const processedFluxGeoTiff = await this.processFluxGeoTiff(
          fluxBuffer,
          options
        );

        // Get dimensions and rasters
        const {
          rasters: fluxRasters,
          metadata: fluxMetadata,
          bounds,
        } = processedFluxGeoTiff;

        const width = fluxMetadata.width;
        const height = fluxMetadata.height;

        // Validate flux raster data
        if (!fluxRasters || fluxRasters.length === 0) {
          throw new Error("No flux raster data found in GeoTIFF");
        }

        // Get the flux raster (first band for annual flux)
        const fluxRaster = fluxRasters[0];

        // Store raw flux data for visualization
        const rawFluxRaster = [...fluxRaster]; // Clone to preserve

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
          console.log(
            "[AnnualFluxProcessor] Using default mask and boundaries"
          );
          maskRaster = this.createDefaultMask(width, height);
          buildingBoundaries = this.createDefaultBuildingBoundaries(
            width,
            height
          );
        }

        // IMPORTANT: Apply the mask to the flux data FIRST
        console.log("[AnnualFluxProcessor] Applying mask to flux data");
        let maskedFluxRaster = VisualizationUtils.applyMaskToData(
          maskRaster,
          fluxRaster,
          width,
          height,
          {
            threshold: 0,
            nullValue: config.processing.NO_DATA_VALUE,
          }
        );

        // Find valid data range
        const dataRange = this.calculateDataRange(maskedFluxRaster);

        // Calculate statistics
        const statistics = this.calculateStatistics(
          maskedFluxRaster,
          dataRange
        );

        // Crop to building boundaries if requested
        const cropEnabled = options.cropToBuilding !== false;
        let croppedFluxRaster = maskedFluxRaster;
        let croppedMaskRaster = maskRaster;
        let croppedRawFluxRaster = rawFluxRaster;
        let croppedWidth = width;
        let croppedHeight = height;
        let croppedBounds = bounds;

        if (
          cropEnabled &&
          buildingBoundaries &&
          buildingBoundaries.hasBuilding
        ) {
          console.log(
            "[AnnualFluxProcessor] Cropping data to building boundaries"
          );

          // Use the centralized utility for cropping
          const cropResult = VisualizationUtils.cropRastersToBuilding(
            maskedFluxRaster,
            maskRaster,
            width,
            height,
            buildingBoundaries,
            {
              originalRaster: rawFluxRaster,
              noDataValue: config.processing.NO_DATA_VALUE,
            }
          );

          croppedFluxRaster = cropResult.croppedRaster;
          croppedMaskRaster = cropResult.croppedMaskRaster;
          croppedRawFluxRaster = cropResult.croppedOriginalRaster;
          croppedWidth = buildingBoundaries.width;
          croppedHeight = buildingBoundaries.height;

          console.log(
            `[AnnualFluxProcessor] Data cropped from ${width}x${height} to ${croppedWidth}x${croppedHeight}`
          );

          // Update bounds to reflect the cropped area
          croppedBounds = VisualizationUtils.adjustBoundsToBuilding(
            bounds,
            width,
            height,
            buildingBoundaries
          );

          // Update building boundaries to be relative to the cropped image
          buildingBoundaries =
            VisualizationUtils.normalizeBuilding(buildingBoundaries);
        } else {
          console.log(
            "[AnnualFluxProcessor] Data not cropped - using full raster"
          );
        }

        // Create the result object
        const result = {
          layerType: "annualFlux",
          metadata: {
            dimensions: {
              width: croppedWidth,
              height: croppedHeight,
              originalWidth: width,
              originalHeight: height,
            },
            ...fluxMetadata,
            ...metadata,
            dataRange,
          },
          // IMPORTANT: Store both cropped and uncropped versions
          raster: croppedFluxRaster, // Masked and cropped for building focus
          originalRaster: croppedRawFluxRaster, // Original but cropped to building
          maskRaster: croppedMaskRaster, // Mask cropped to building

          // IMPORTANT: Add the full uncropped versions
          fullRaster: maskedFluxRaster, // Masked but not cropped
          fullOriginalRaster: rawFluxRaster, // Original full image without masking or cropping
          fullMaskRaster: maskRaster, // Full mask without cropping
          fullWidth: width, // Original width
          fullHeight: height, // Original height

          buildingBoundaries,
          bounds: croppedBounds,
          fullBounds: bounds, // Original bounds
          statistics,
        };

        console.log("[AnnualFluxProcessor] Annual flux processing complete");
        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "annualFlux",
        options,
      });
    }
  }

  /**
   * Extract flux and mask buffers from raw data
   * @private
   * @param {Object|Buffer} rawData - Raw data from fetcher
   * @returns {Object} - Object with extracted buffers and metadata
   */
  extractBuffers(rawData) {
    // Check for object with embedded buffers
    const isObject =
      rawData &&
      typeof rawData === "object" &&
      (rawData.fluxData || rawData.annualFluxData || rawData.monthlyFluxData);

    let fluxBuffer, maskBuffer, metadata;

    if (isObject) {
      // Data is an object with embedded buffers
      fluxBuffer =
        rawData.fluxData ||
        rawData.annualFluxData ||
        rawData.monthlyFluxData ||
        rawData.annualFluxBuffer;
      maskBuffer = rawData.maskData || rawData.maskBuffer;
      metadata = rawData.metadata || {};

      console.log(
        `[AnnualFluxProcessor] Received data object with flux buffer (${
          fluxBuffer ? "present" : "missing"
        }) and mask buffer (${maskBuffer ? "present" : "missing"})`
      );
    } else {
      // Direct buffer
      fluxBuffer = rawData;
      maskBuffer = null;
      metadata = {};

      console.log("[AnnualFluxProcessor] Received direct buffer data");
    }

    // Validate flux buffer
    if (!fluxBuffer) {
      throw new Error("Annual flux data buffer is required");
    }

    return { fluxBuffer, maskBuffer, metadata };
  }

  /**
   * Process flux GeoTIFF data
   * @private
   * @param {Buffer} fluxBuffer - Flux data buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed GeoTIFF data
   */
  async processFluxGeoTiff(fluxBuffer, options = {}) {
    try {
      // Process with optimized options for flux data
      const processOptions = {
        convertToArray: true,
        noAutoScale: true,
        ...options,
      };

      const result = await this.geotiffProcessor.process(
        fluxBuffer,
        processOptions
      );

      console.log(
        `[AnnualFluxProcessor] Annual flux GeoTIFF processed: ${result.metadata.width}x${result.metadata.height} pixels, ${result.rasters.length} bands`
      );

      return result;
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error processing flux GeoTIFF: ${error.message}`
      );
      throw new Error(
        `Failed to process annual flux GeoTIFF: ${error.message}`
      );
    }
  }

  /**
   * Process mask data
   * @private
   * @param {Buffer} maskBuffer - Mask data buffer
   * @param {number} fluxWidth - Width of flux data
   * @param {number} fluxHeight - Height of flux data
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed mask and building boundaries
   */
  async processMask(maskBuffer, fluxWidth, fluxHeight, options = {}) {
    try {
      console.log("[AnnualFluxProcessor] Processing mask data");

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
        maskMetadata.width !== fluxWidth ||
        maskMetadata.height !== fluxHeight
      ) {
        console.log(
          `[AnnualFluxProcessor] Mask dimensions (${maskMetadata.width}x${maskMetadata.height}) don't match flux (${fluxWidth}x${fluxHeight}). Resizing...`
        );

        maskRaster = VisualizationUtils.resampleRaster(
          maskRaster,
          maskMetadata.width,
          maskMetadata.height,
          fluxWidth,
          fluxHeight,
          { method: "nearest" }
        );
      }

      // Count non-zero values in mask
      const nonZeroCount = this.countNonZeroValues(maskRaster);
      console.log(
        `[AnnualFluxProcessor] Mask has ${nonZeroCount} non-zero values out of ${
          maskRaster.length
        } (${((nonZeroCount / maskRaster.length) * 100).toFixed(2)}%)`
      );

      // Handle empty mask
      if (nonZeroCount === 0) {
        console.warn(
          "[AnnualFluxProcessor] Mask has no non-zero values, creating default mask"
        );
        maskRaster = this.createDefaultMask(fluxWidth, fluxHeight);
      }

      // Find building boundaries
      const buildingMargin = 0;

      let buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
        maskRaster,
        fluxWidth,
        fluxHeight,
        { margin: buildingMargin }
      );

      // Create default boundaries if none found
      if (!buildingBoundaries.hasBuilding) {
        console.warn(
          "[AnnualFluxProcessor] No building found in mask, using default boundaries"
        );
        buildingBoundaries = this.createDefaultBuildingBoundaries(
          fluxWidth,
          fluxHeight
        );
      }

      return { maskRaster, buildingBoundaries };
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error processing mask: ${error.message}`
      );

      // Return defaults on error
      const maskRaster = this.createDefaultMask(fluxWidth, fluxHeight);
      const buildingBoundaries = this.createDefaultBuildingBoundaries(
        fluxWidth,
        fluxHeight
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
      `[AnnualFluxProcessor] Created default mask with building region (${startX},${startY}) to (${endX},${endY})`
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
   * Count non-zero values in an array
   * @private
   * @param {Array} array - Array to check
   * @returns {number} - Count of non-zero values
   */
  countNonZeroValues(array) {
    if (!array || !array.length) return 0;
    return array.filter((v) => v > 0).length;
  }

  /**
   * Calculate data range with percentile filtering
   * @private
   * @param {Array} raster - Raster data
   * @returns {Object} - Data range information
   */
  calculateDataRange(raster) {
    try {
      const noDataValue = config.processing.NO_DATA_VALUE || -9999;

      // Collect all valid values
      const validValues = [];
      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value) && isFinite(value)) {
          validValues.push(value);
        }
      }

      if (validValues.length === 0) {
        console.warn("[AnnualFluxProcessor] No valid values found");
        return {
          min: 0,
          max: 1800,
          effectiveMin: 0,
          effectiveMax: 1800,
          validCount: 0,
        };
      }

      // Sort for percentile calculation
      validValues.sort((a, b) => a - b);

      // Calculate min/max from all values
      const absMin = validValues[0];
      const absMax = validValues[validValues.length - 1];

      // Calculate 5th and 95th percentiles to filter outliers
      const lowIndex = Math.floor(validValues.length * 0.05);
      const highIndex = Math.floor(validValues.length * 0.95);

      const percentileMin = validValues[lowIndex];
      const percentileMax = validValues[highIndex];

      // For annual flux, establish standard range (0-1800)
      return {
        min: percentileMin,
        max: percentileMax,
        absMin,
        absMax,
        effectiveMin: 0, // Always use 0 as minimum
        effectiveMax: 1800, // Standard maximum for annual flux
        validCount: validValues.length,
      };
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error calculating data range: ${error.message}`
      );

      // Default range for annual flux
      return {
        min: 0,
        max: 1800,
        effectiveMin: 0,
        effectiveMax: 1800,
        validCount: 0,
        error: error.message,
      };
    }
  }

  /**
   * Calculate statistics for the masked flux data
   * @private
   * @param {Array} raster - Masked flux raster
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
      };
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error calculating statistics: ${error.message}`
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

module.exports = AnnualFluxProcessor;
