/**
 * Annual flux layer processor for SolarScanner data-layers module
 *
 * Processes raw annual flux layer data from GeoTIFF format into a structured
 * representation, showing solar potential across the entire year.
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
   * @param {Buffer} rawData.fluxData - The raw annual flux data buffer
   * @param {Buffer} [rawData.maskData] - The raw mask data buffer (optional)
   * @param {Object} [rawData.metadata] - Additional metadata from the fetcher
   * @param {Object} options - Processing options
   * @param {boolean} [options.useMask=true] - Whether to use mask data if available
   * @param {number} [options.buildingMargin=20] - Margin to add around building boundaries
   * @param {boolean} [options.calculateStatistics=true] - Whether to calculate statistics
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
          (rawData.fluxData || rawData.annualFluxData);

        // Extract buffers from object or use raw buffer directly
        let fluxBuffer, maskBuffer, fetcherMetadata;

        if (isRawObject) {
          // Data is an object with embedded buffers and metadata
          fluxBuffer = rawData.fluxData || rawData.annualFluxData;
          maskBuffer = rawData.maskData;
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

        // Get the primary flux raster (should be the only one for annual flux)
        if (fluxRasters.length !== 1) {
          console.warn(
            `[AnnualFluxProcessor] Expected 1 band for annual flux data, but found ${fluxRasters.length}`
          );
        }

        const fluxRaster = fluxRasters[0];
        const width = fluxMetadata.width;
        const height = fluxMetadata.height;

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
              maskMetadata.width !== width ||
              maskMetadata.height !== height
            ) {
              console.warn(
                `[AnnualFluxProcessor] Mask and flux dimensions do not match. Mask: ${maskMetadata.width}x${maskMetadata.height}, Flux: ${width}x${height}. Attempting to resize.`
              );

              // Simple resizing - this is a basic approach that could be improved
              const resizedMask = this.resizeMask(
                maskRasters[0],
                maskMetadata.width,
                maskMetadata.height,
                width,
                height
              );

              maskRaster = resizedMask;
            } else {
              maskRaster = maskRasters[0];
            }

            // Output mask statistics for debugging
            const maskStats = this.calculateMaskStatistics(maskRaster);
            console.log("[AnnualFluxProcessor] Mask statistics:", maskStats);

            // Extract building boundaries
            try {
              buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
                maskRaster,
                width,
                height,
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
              // Continue without building boundaries
            }
          } catch (error) {
            console.warn(
              `[AnnualFluxProcessor] Failed to process mask data: ${error.message}`
            );
            // Continue without mask data
          }
        }

        // Apply mask to flux data if available
        let maskedFluxRaster = fluxRaster;

        if (maskRaster) {
          maskedFluxRaster = this.applyMask(
            fluxRaster,
            maskRaster,
            width,
            height
          );
          console.log("[AnnualFluxProcessor] Applied mask to annual flux data");

          // Debug: Check how many pixels were masked
          const maskedPixelCount = maskedFluxRaster.filter(
            (val) => val === config.processing.NO_DATA_VALUE
          ).length;

          console.log(
            `[AnnualFluxProcessor] Masked ${maskedPixelCount} pixels out of ${maskedFluxRaster.length}`
          );
        }

        // Calculate statistics if requested
        let statistics = null;
        if (calculateStatistics) {
          statistics = this.calculateStatistics(maskedFluxRaster);
          console.log(
            `[AnnualFluxProcessor] Calculated statistics: min=${statistics.min}, max=${statistics.max}, avg=${statistics.avg}`
          );
        }

        // Create the result object with clear property naming
        const result = {
          layerType: "annualFlux",
          metadata: {
            dimensions: {
              width,
              height,
            },
            ...fluxMetadata,
            ...fetcherMetadata,
          },
          // Explicitly name the key properties the visualizer will look for
          fluxRaster: maskedFluxRaster,
          maskRaster,
          buildingBoundaries,
          bounds,
          statistics,
          // Debug information
          debug: {
            hasMask: !!maskRaster,
            hasBuildingBoundaries: !!buildingBoundaries,
            originalWidth: width,
            originalHeight: height,
          },
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
   * Resize mask data to match flux dimensions
   * @private
   * @param {Array<number>} maskData - Original mask data
   * @param {number} srcWidth - Source width
   * @param {number} srcHeight - Source height
   * @param {number} destWidth - Destination width
   * @param {number} destHeight - Destination height
   * @returns {Array<number>} - Resized mask data
   */
  resizeMask(maskData, srcWidth, srcHeight, destWidth, destHeight) {
    const resizedMask = new Array(destWidth * destHeight);

    // Scaling factors
    const scaleX = srcWidth / destWidth;
    const scaleY = srcHeight / destHeight;

    for (let y = 0; y < destHeight; y++) {
      for (let x = 0; x < destWidth; x++) {
        // Find corresponding source pixel
        const srcX = Math.min(Math.floor(x * scaleX), srcWidth - 1);
        const srcY = Math.min(Math.floor(y * scaleY), srcHeight - 1);

        const srcIdx = srcY * srcWidth + srcX;
        const destIdx = y * destWidth + x;

        resizedMask[destIdx] = maskData[srcIdx];
      }
    }

    return resizedMask;
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
      if (!maskRaster || maskRaster.length !== fluxRaster.length) {
        console.warn(
          `[AnnualFluxProcessor] Mask dimensions do not match flux dimensions. Flux: ${
            fluxRaster.length
          }, Mask: ${maskRaster ? maskRaster.length : "undefined"}`
        );
        return fluxRaster;
      }

      const maskedRaster = new Array(fluxRaster.length);
      const noDataValue = config.processing.NO_DATA_VALUE;
      let maskedCount = 0;

      // Sample some values for debugging
      const sampleMask = maskRaster.slice(0, 20);
      const sampleFlux = fluxRaster.slice(0, 20);
      console.log("[AnnualFluxProcessor] Mask sample:", sampleMask);
      console.log("[AnnualFluxProcessor] Flux sample:", sampleFlux);

      for (let i = 0; i < fluxRaster.length; i++) {
        // Only keep flux values where mask is > 0 (building)
        if (maskRaster[i] > 0) {
          maskedRaster[i] = fluxRaster[i];
        } else {
          maskedRaster[i] = noDataValue;
          maskedCount++;
        }
      }

      console.log(
        `[AnnualFluxProcessor] Masked ${maskedCount} pixels (${(
          (maskedCount / fluxRaster.length) *
          100
        ).toFixed(2)}% of total)`
      );

      return maskedRaster;
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error applying mask: ${error.message}`
      );
      return fluxRaster; // Return original raster if masking fails
    }
  }

  /**
   * Calculate mask statistics for debugging
   * @private
   * @param {Array<number>} maskRaster - Mask raster data
   * @returns {Object} - Mask statistics
   */
  calculateMaskStatistics(maskRaster) {
    if (!maskRaster) return { available: false };

    let buildingPixels = 0;
    let nonBuildingPixels = 0;

    for (let i = 0; i < maskRaster.length; i++) {
      if (maskRaster[i] > 0) {
        buildingPixels++;
      } else {
        nonBuildingPixels++;
      }
    }

    return {
      available: true,
      total: maskRaster.length,
      buildingPixels,
      nonBuildingPixels,
      buildingPercentage:
        ((buildingPixels / maskRaster.length) * 100).toFixed(2) + "%",
    };
  }

  /**
   * Calculate statistics for annual flux data
   * @private
   * @param {Array<number>} fluxRaster - Flux raster data
   * @returns {Object} - Statistics
   */
  calculateStatistics(fluxRaster) {
    try {
      const noDataValue = config.processing.NO_DATA_VALUE;
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let validPixels = 0;
      let maxValue = -Infinity;
      let maxLocation = -1;
      let valueFrequency = new Map();

      // Calculate basic statistics
      for (let i = 0; i < fluxRaster.length; i++) {
        const value = fluxRaster[i];

        if (value !== noDataValue && !isNaN(value)) {
          // Track min/max
          min = Math.min(min, value);
          max = Math.max(max, value);

          // Track sum for average
          sum += value;
          validPixels++;

          // Track max value location
          if (value > maxValue) {
            maxValue = value;
            maxLocation = i;
          }

          // Track value frequencies for mode calculation
          const roundedValue = Math.round(value);
          valueFrequency.set(
            roundedValue,
            (valueFrequency.get(roundedValue) || 0) + 1
          );
        }
      }

      // Find mode (most common value)
      let mode = 0;
      let maxFrequency = 0;

      for (const [value, frequency] of valueFrequency.entries()) {
        if (frequency > maxFrequency) {
          maxFrequency = frequency;
          mode = value;
        }
      }

      // Calculate average
      const avg = validPixels > 0 ? sum / validPixels : 0;

      // Calculate variance and standard deviation
      let sumSquaredDiff = 0;

      for (let i = 0; i < fluxRaster.length; i++) {
        const value = fluxRaster[i];

        if (value !== noDataValue && !isNaN(value)) {
          const diff = value - avg;
          sumSquaredDiff += diff * diff;
        }
      }

      const variance = validPixels > 0 ? sumSquaredDiff / validPixels : 0;
      const stdDev = Math.sqrt(variance);

      // Calculate estimated yearly potential (simplified)
      // Annual energy (kWh) = Average flux (kWh/kW/year) * Valid area (m²) * System efficiency
      const estimatedYearlyPotential = sum; // Total flux sum

      return {
        min,
        max,
        avg,
        mode,
        stdDev,
        variance,
        validPixels,
        maxValue,
        maxLocation,
        totalValue: sum,
        estimatedYearlyPotential,
      };
    } catch (error) {
      console.error(
        `[AnnualFluxProcessor] Error calculating statistics: ${error.message}`
      );

      // Return minimal statistics
      return {
        min: 0,
        max: 100,
        avg: 50,
        error: error.message,
      };
    }
  }
}

module.exports = AnnualFluxProcessor;
