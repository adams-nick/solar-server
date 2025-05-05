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

        // DIAGNOSTIC MODE OPTIONS
        const DIAGNOSTIC_MODE = options.diagnosticMode || {
          enabled: true,
          skipMasking: false, // Skip mask application
          skipBoundaries: false, // Skip boundary detection
          sampleRows: true, // Sample row distribution
          outputStages: true, // Output intermediate stages
        };

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

        // DIAGNOSTIC: Analyze raw flux data
        if (DIAGNOSTIC_MODE.enabled && DIAGNOSTIC_MODE.sampleRows) {
          this.analyzeRowDistribution(
            fluxRaster,
            width,
            height,
            "Raw Flux Data"
          );
        }

        // Store raw flux data for diagnostic visualization
        let rawFluxRaster = null;
        if (DIAGNOSTIC_MODE.enabled && DIAGNOSTIC_MODE.outputStages) {
          rawFluxRaster = [...fluxRaster]; // Clone to preserve
        }

        // Process the mask if available
        let maskRaster = null;
        let buildingBoundaries = null;

        if (maskBuffer && !DIAGNOSTIC_MODE.skipMasking) {
          const processingResult = await this.processMask(
            maskBuffer,
            width,
            height,
            options
          );

          maskRaster = processingResult.maskRaster;

          if (!DIAGNOSTIC_MODE.skipBoundaries) {
            buildingBoundaries = processingResult.buildingBoundaries;
          } else {
            // Create default boundaries if skipping
            buildingBoundaries = this.createDefaultBuildingBoundaries(
              width,
              height
            );
          }
        } else {
          // Create default mask and boundaries if no mask provided or skipping
          console.log(
            "[AnnualFluxProcessor] Using default mask and boundaries"
          );
          maskRaster = this.createDefaultMask(width, height);
          buildingBoundaries = this.createDefaultBuildingBoundaries(
            width,
            height
          );
        }

        // DIAGNOSTIC: Analyze mask data
        if (
          DIAGNOSTIC_MODE.enabled &&
          DIAGNOSTIC_MODE.sampleRows &&
          maskRaster
        ) {
          this.analyzeRowDistribution(maskRaster, width, height, "Mask Data");
        }

        // Apply the mask to the flux data or skip masking in diagnostic mode
        let maskedFluxRaster;
        if (DIAGNOSTIC_MODE.skipMasking) {
          console.log(
            "[AnnualFluxProcessor] DIAGNOSTIC: Skipping mask application"
          );
          maskedFluxRaster = fluxRaster;
        } else {
          maskedFluxRaster = this.applyMask(
            fluxRaster,
            maskRaster,
            width,
            height
          );
        }

        // DIAGNOSTIC: Analyze masked flux data
        if (DIAGNOSTIC_MODE.enabled && DIAGNOSTIC_MODE.sampleRows) {
          this.analyzeRowDistribution(
            maskedFluxRaster,
            width,
            height,
            "Masked Flux Data"
          );
        }

        // Find valid data range
        const dataRange = this.calculateDataRange(maskedFluxRaster);

        // Calculate statistics
        const statistics = this.calculateStatistics(
          maskedFluxRaster,
          dataRange
        );

        // Create the result object with diagnostic data
        const result = {
          layerType: "annualFlux",
          metadata: {
            dimensions: { width, height },
            ...fluxMetadata,
            ...metadata,
            dataRange,
          },
          fluxRaster: maskedFluxRaster,
          originalFluxRaster: fluxRaster,
          maskRaster,
          buildingBoundaries,
          bounds,
          statistics,
          // Add diagnostic data
          diagnosticData: DIAGNOSTIC_MODE.enabled
            ? {
                rawFluxRaster,
                skipMasking: DIAGNOSTIC_MODE.skipMasking,
                skipBoundaries: DIAGNOSTIC_MODE.skipBoundaries,
              }
            : null,
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

      // Log sample values
      this.logRasterSamples(
        result.rasters[0],
        result.metadata.width,
        result.metadata.height
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

        maskRaster = this.resizeMask(
          maskRaster,
          maskMetadata.width,
          maskMetadata.height,
          fluxWidth,
          fluxHeight
        );
      }

      // Log mask sample values
      this.logRasterSamples(maskRaster, fluxWidth, fluxHeight, "Mask");

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
      const buildingMargin =
        options.buildingMargin || config.visualization.BUILDING_MARGIN || 20;

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
   * Apply mask to flux data
   * @private
   * @param {Array} fluxRaster - Flux raster data
   * @param {Array} maskRaster - Mask raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Array} - Masked flux data
   */
  applyMask(fluxRaster, maskRaster, width, height) {
    try {
      const maskedRaster = new Array(fluxRaster.length);
      const noDataValue = config.processing.NO_DATA_VALUE || -9999;
      let maskedCount = 0;
      let validCount = 0;

      // Apply mask by row then column - for debugging
      for (let y = 0; y < height; y++) {
        let rowValid = 0;
        let rowMasked = 0;

        for (let x = 0; x < width; x++) {
          const idx = y * width + x;

          // Check if this pixel is inside mask and has valid flux data
          if (
            maskRaster[idx] > 0 &&
            fluxRaster[idx] !== noDataValue &&
            !isNaN(fluxRaster[idx]) &&
            isFinite(fluxRaster[idx])
          ) {
            maskedRaster[idx] = fluxRaster[idx];
            validCount++;
            rowValid++;
          } else {
            maskedRaster[idx] = noDataValue;
            maskedCount++;
            rowMasked++;
          }
        }

        // Log row statistics every 50 rows
        if (y % 50 === 0 || y === height - 1) {
          console.log(
            `[AnnualFluxProcessor] Row ${y}: ${rowValid} valid pixels, ${rowMasked} masked pixels`
          );
        }
      }

      console.log(
        `[AnnualFluxProcessor] Masked ${maskedCount} pixels, kept ${validCount} valid pixels (${(
          (validCount / fluxRaster.length) *
          100
        ).toFixed(2)}% of total)`
      );

      // Handle case with no valid data
      if (validCount === 0) {
        console.warn(
          "[AnnualFluxProcessor] No valid pixels after masking, using default pattern"
        );
        return this.createDefaultPattern(width, height);
      }

      return maskedRaster;
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error applying mask: ${error.message}`
      );
      return fluxRaster; // Return original on error
    }
  }

  /**
   * Create a default pattern for empty data
   * @private
   * @param {number} width - Width of pattern
   * @param {number} height - Height of pattern
   * @returns {Array} - Data with gradient pattern
   */
  createDefaultPattern(width, height) {
    const pattern = new Array(width * height);
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

    // Create a radial gradient pattern
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        // Distance from center
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Normalized distance (0-1)
        const normDist = dist / maxDist;

        // Invert and scale to reasonable annual flux range (900-1500)
        pattern[idx] = 1500 - normDist * 600;
      }
    }

    return pattern;
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

      console.log(`[AnnualFluxProcessor] Data range:
        All values: min=${absMin}, max=${absMax}
        Filtered (5%-95%): min=${percentileMin}, max=${percentileMax}
        Valid pixels: ${validValues.length}
      `);

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
   * Resize mask data to match flux dimensions
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
      `[AnnualFluxProcessor] Resizing mask from ${srcWidth}x${srcHeight} to ${destWidth}x${destHeight}`
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
      `[AnnualFluxProcessor] Mask resize: source had ${srcNonZero} non-zero pixels, destination has ${destNonZero} non-zero pixels`
    );

    return resizedMask;
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

  /**
   * Log sample values from a raster for debugging
   * @private
   * @param {Array} raster - Raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {string} label - Label for logging
   */
  logRasterSamples(raster, width, height, label = "Flux") {
    if (!raster || !width || !height) return;

    try {
      const sample = {
        topLeft: [],
        topCenter: [],
        center: [],
        random: [],
      };

      // Sample positions
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);

      // Get top-left 3x3 sample
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          const idx = y * width + x;
          if (idx < raster.length) sample.topLeft.push(raster[idx]);
        }
      }

      // Get top-center 3x3 sample
      for (let y = 0; y < 3; y++) {
        for (let x = centerX - 1; x <= centerX + 1; x++) {
          const idx = y * width + x;
          if (idx < raster.length) sample.topCenter.push(raster[idx]);
        }
      }

      // Get center 3x3 sample
      for (let y = centerY - 1; y <= centerY + 1; y++) {
        for (let x = centerX - 1; x <= centerX + 1; x++) {
          const idx = y * width + x;
          if (idx < raster.length) sample.center.push(raster[idx]);
        }
      }

      // Get 5 random samples
      for (let i = 0; i < 5; i++) {
        const randomIdx = Math.floor(Math.random() * raster.length);
        sample.random.push({
          idx: randomIdx,
          row: Math.floor(randomIdx / width),
          col: randomIdx % width,
          value: raster[randomIdx],
        });
      }

      console.log(`[AnnualFluxProcessor] ${label} raster samples:
        Top-left 3x3: ${JSON.stringify(sample.topLeft)}
        Top-center 3x3: ${JSON.stringify(sample.topCenter)}
        Center 3x3: ${JSON.stringify(sample.center)}
        Random samples: ${JSON.stringify(sample.random)}
      `);
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error logging raster samples: ${error.message}`
      );
    }
  }

  /**
   * Diagnostic function: Analyze row distribution
   * @param {Array} data - Data array
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {string} label - Label for logging
   */
  analyzeRowDistribution(data, width, height, label) {
    const rowStats = [];
    const noDataValue = config.processing.NO_DATA_VALUE || -9999;

    // Sample rows at regular intervals
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 20))) {
      const row = Math.floor(y);
      let validCount = 0,
        sum = 0;
      let minVal = Infinity,
        maxVal = -Infinity;

      // Analyze entire row
      for (let x = 0; x < width; x++) {
        const val = data[row * width + x];
        if (val !== noDataValue && !isNaN(val)) {
          validCount++;
          sum += val;
          minVal = Math.min(minVal, val);
          maxVal = Math.max(maxVal, val);
        }
      }

      const avgVal = validCount > 0 ? (sum / validCount).toFixed(2) : "N/A";
      const validPercent = ((validCount / width) * 100).toFixed(1);
      const valRange =
        validCount > 0 ? `${minVal.toFixed(1)}-${maxVal.toFixed(1)}` : "N/A";

      rowStats.push(
        `Row ${row}: ${validCount}/${width} valid pixels (${validPercent}%), Avg: ${avgVal}, Range: ${valRange}`
      );
    }

    console.log(`[DEBUG] ${label} Distribution:\n${rowStats.join("\n")}`);
  }
}

module.exports = AnnualFluxProcessor;
