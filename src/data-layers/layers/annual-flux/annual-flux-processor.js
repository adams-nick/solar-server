/**
 * Annual flux layer processor for SolarScanner data-layers module
 *
 * Processes raw annual flux layer data from GeoTIFF format into a structured
 * representation of the yearly solar potential.
 */

const Processor = require("../../core/processor");
const GeoTiffProcessor = require("../../utils/geotiff-processor");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Processor implementation for annual flux layer data
 * @extends Processor
 */
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
   * @param {Object} rawData - The raw data object containing annual flux data and optional mask data
   * @param {Buffer} rawData.annualFluxData - The raw annual flux data buffer
   * @param {Buffer} [rawData.maskData] - The raw mask data buffer (optional)
   * @param {Object} [rawData.metadata] - Additional metadata from the fetcher
   * @param {Object} options - Processing options
   * @param {boolean} [options.useMask=true] - Whether to use mask data if available
   * @param {number} [options.buildingMargin=20] - Margin to add around building boundaries
   * @param {boolean} [options.calculateStatistics=true] - Whether to calculate statistics for the data
   * @returns {Promise<Object>} - Processed annual flux data
   * @throws {Error} if processing fails
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[AnnualFluxProcessor] Processing annual flux data");

        // Check if we have a combined object with both annual flux and mask data
        const isRawObject =
          rawData &&
          typeof rawData === "object" &&
          (rawData.annualFluxData || rawData.fluxBuffer);

        // Extract buffers from object or use raw buffer directly
        let fluxBuffer, maskBuffer, fetcherMetadata;

        if (isRawObject) {
          // Data is an object with embedded buffers and metadata
          fluxBuffer = rawData.annualFluxData || rawData.fluxBuffer;
          maskBuffer = rawData.maskData || rawData.maskBuffer;
          fetcherMetadata = rawData.metadata || {};

          console.log(
            `[AnnualFluxProcessor] Received data object with flux buffer (${
              fluxBuffer ? "present" : "missing"
            }) and mask buffer (${maskBuffer ? "present" : "missing"})`
          );
        } else {
          // Direct buffer (although this case may not handle mask data)
          fluxBuffer = rawData;
          maskBuffer = null;
          fetcherMetadata = {};

          console.log(`[AnnualFluxProcessor] Received direct buffer data`);
        }

        // Validate flux buffer
        if (!fluxBuffer) {
          throw new Error("Annual flux data buffer is required");
        }

        // Log buffer details
        console.log(
          `[AnnualFluxProcessor] Flux buffer type: ${typeof fluxBuffer}, length: ${
            fluxBuffer.byteLength || fluxBuffer.length || "unknown"
          }`
        );

        // Ensure buffer is in the correct format
        this.validateRawData(fluxBuffer);

        // Set default options
        const useMask = options.useMask !== false && maskBuffer;
        const buildingMargin =
          options.buildingMargin || config.visualization.BUILDING_MARGIN;
        const calculateStatistics = options.calculateStatistics !== false;

        // Process the annual flux GeoTIFF data
        let processedFluxGeoTiff;
        try {
          processedFluxGeoTiff = await this.geotiffProcessor.process(
            fluxBuffer,
            {
              convertToArray: true,
              // Annual flux is typically a single band
            }
          );

          console.log(
            `[AnnualFluxProcessor] Annual flux GeoTIFF processed: ${processedFluxGeoTiff.metadata.width}x${processedFluxGeoTiff.metadata.height} pixels, ${processedFluxGeoTiff.rasters.length} bands`
          );
        } catch (error) {
          throw new Error(
            `Failed to process annual flux GeoTIFF: ${error.message}`
          );
        }

        // Extract metadata and rasters from the flux data
        const {
          metadata: fluxMetadata,
          rasters: fluxRasters,
          bounds,
        } = processedFluxGeoTiff;

        // Annual flux data typically has a single band
        if (fluxRasters.length === 0) {
          throw new Error("No raster data found in annual flux GeoTIFF");
        }

        // Use the first raster as the annual flux data
        const annualFluxRaster = fluxRasters[0];

        // Process mask data if available
        let maskRaster = null;
        let buildingBoundaries = null;

        if (useMask && maskBuffer) {
          try {
            console.log("[AnnualFluxProcessor] Processing mask data");

            const processedMaskGeoTiff = await this.geotiffProcessor.process(
              maskBuffer,
              {
                convertToArray: true,
                page: 0,
              }
            );

            // Check if mask dimensions match flux dimensions
            const { metadata: maskMetadata, rasters: maskRasters } =
              processedMaskGeoTiff;

            if (
              maskMetadata.width !== fluxMetadata.width ||
              maskMetadata.height !== fluxMetadata.height
            ) {
              console.warn(
                "[AnnualFluxProcessor] Mask and flux dimensions do not match. Mask will not be applied."
              );
            } else {
              maskRaster = maskRasters[0];

              // Extract building boundaries
              try {
                buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
                  maskRaster,
                  maskMetadata.width,
                  maskMetadata.height,
                  { margin: buildingMargin }
                );

                if (buildingBoundaries.hasBuilding) {
                  console.log(
                    `[AnnualFluxProcessor] Found building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
                  );
                } else {
                  console.warn(
                    "[AnnualFluxProcessor] No building found in mask data"
                  );
                }
              } catch (error) {
                console.error(
                  `[AnnualFluxProcessor] Error finding building boundaries: ${error.message}`
                );
              }
            }
          } catch (error) {
            console.warn(
              `[AnnualFluxProcessor] Failed to process mask data: ${error.message}`
            );
            // Continue without mask data
          }
        }

        // Apply mask if available
        let maskedFluxRaster = annualFluxRaster;
        if (maskRaster) {
          try {
            maskedFluxRaster = this.applyMask(
              annualFluxRaster,
              maskRaster,
              fluxMetadata.width,
              fluxMetadata.height
            );
            console.log(
              "[AnnualFluxProcessor] Applied mask to annual flux data"
            );
          } catch (error) {
            console.warn(
              `[AnnualFluxProcessor] Failed to apply mask: ${error.message}`
            );
            // Continue with unmasked data
          }
        }

        // Calculate statistics if requested
        let statistics = null;
        const noDataValue = config.processing.NO_DATA_VALUE;

        if (calculateStatistics) {
          try {
            // Find data range
            const dataRange = this.findDataRange(maskedFluxRaster, noDataValue);

            // Calculate additional statistics
            statistics = this.calculateStatistics(maskedFluxRaster, dataRange);

            console.log(
              `[AnnualFluxProcessor] Calculated statistics: min=${
                statistics.min
              }, max=${statistics.max}, avg=${statistics.avg.toFixed(2)}`
            );
          } catch (error) {
            console.warn(
              `[AnnualFluxProcessor] Failed to calculate statistics: ${error.message}`
            );
            // Continue without statistics
          }
        }

        // Create the result object
        const result = {
          layerType: "annualFlux",
          metadata: {
            ...fluxMetadata,
            ...fetcherMetadata,
            dimensions: {
              width: fluxMetadata.width,
              height: fluxMetadata.height,
            },
            hasMask: !!maskRaster,
            noDataValue,
            statistics,
          },
          fluxRaster: maskedFluxRaster,
          originalFluxRaster: annualFluxRaster,
          bounds,
          buildingBoundaries,
          maskRaster,
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
   * Find valid data range in a raster
   * @private
   * @param {Array<number>} raster - Raster data
   * @param {number} noDataValue - Value to ignore as no-data
   * @returns {Object} - Min and max values {min, max}
   */
  findDataRange(raster, noDataValue = -9999) {
    try {
      let min = Infinity;
      let max = -Infinity;
      let validCount = 0;
      let sum = 0;

      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
          sum += value;
          validCount++;
        }
      }

      // Check if we found any valid values
      if (validCount === 0) {
        console.warn("[AnnualFluxProcessor] No valid data found in raster");
        return { min: 0, max: 1, avg: 0, validCount: 0 };
      }

      return {
        min,
        max,
        avg: sum / validCount,
        validCount,
        sum,
      };
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error finding data range: ${error.message}`
      );
      return { min: 0, max: 1, avg: 0, validCount: 0, error: error.message };
    }
  }

  /**
   * Apply mask to flux data
   * @private
   * @param {Array<number>} fluxRaster - Flux raster data
   * @param {Array<number>} maskRaster - Mask raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Array<number>} - Masked flux data
   */
  applyMask(fluxRaster, maskRaster, width, height) {
    try {
      const maskedRaster = new Array(fluxRaster.length);
      const noDataValue = config.processing.NO_DATA_VALUE;

      for (let i = 0; i < fluxRaster.length; i++) {
        // If mask is 0, set flux to no data value
        maskedRaster[i] = maskRaster[i] > 0 ? fluxRaster[i] : noDataValue;
      }

      return maskedRaster;
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error applying mask: ${error.message}`
      );
      return fluxRaster; // Return original raster if masking fails
    }
  }

  /**
   * Calculate statistics for the annual flux data
   * @private
   * @param {Array<number>} raster - Flux raster data
   * @param {Object} dataRange - Data range from findDataRange
   * @returns {Object} - Statistics object
   */
  calculateStatistics(raster, dataRange) {
    try {
      const noDataValue = config.processing.NO_DATA_VALUE;
      let count = 0;
      let maxLocation = -1;
      let histogram = {};

      // Calculate sum and find maximum location
      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value)) {
          count++;

          // Find location of maximum value
          if (value === dataRange.max) {
            maxLocation = i;
          }

          // Build histogram (rounded to nearest integer)
          const roundedValue = Math.round(value);
          histogram[roundedValue] = (histogram[roundedValue] || 0) + 1;
        }
      }

      // Find most common value (mode)
      let mode = null;
      let modeCount = 0;
      for (const [value, valueCount] of Object.entries(histogram)) {
        if (valueCount > modeCount) {
          modeCount = valueCount;
          mode = parseFloat(value);
        }
      }

      // Calculate standard deviation
      let sumSquaredDiff = 0;
      const mean = dataRange.avg;

      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value)) {
          sumSquaredDiff += Math.pow(value - mean, 2);
        }
      }

      const variance = sumSquaredDiff / count;
      const stdDev = Math.sqrt(variance);

      return {
        min: dataRange.min,
        max: dataRange.max,
        avg: dataRange.avg,
        mode: mode,
        stdDev: stdDev,
        variance: variance,
        validPixels: count,
        maxLocation: maxLocation,
        // Estimated solar potential based on average values
        // This is a simplified calculation and might need adjustment
        estimatedYearlyPotential: dataRange.avg * (count / 1000), // Simplified metric
        totalValue: dataRange.sum,
      };
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error calculating statistics: ${error.message}`
      );
      return {
        error: error.message,
        min: dataRange?.min || 0,
        max: dataRange?.max || 1,
        avg: dataRange?.avg || 0,
      };
    }
  }
}

module.exports = AnnualFluxProcessor;
