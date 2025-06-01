/**
 * Monthly flux layer processor for SolarScanner data-layers module
 *
 * Processes raw monthly flux layer data from GeoTIFF format into a structured
 * representation, extracting data for all 12 months.
 */

const Processor = require("../../core/processor");
const GeoTiffProcessor = require("../../utils/geotiff-processor");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Processor implementation for monthly flux layer data
 * @extends Processor
 */
class MonthlyFluxProcessor extends Processor {
  /**
   * Create a new MonthlyFluxProcessor
   */
  constructor() {
    super();
    this.geotiffProcessor = new GeoTiffProcessor();
    console.log("[MonthlyFluxProcessor] Initialized with GeoTiffProcessor");
  }

  /**
   * Check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "monthlyFlux";
  }

  /**
   * Process raw monthly flux data
   * @param {Object} rawData - The raw data object containing monthly flux data and optional mask data
   * @param {Buffer} rawData.monthlyFluxData - The raw monthly flux data buffer
   * @param {Buffer} [rawData.maskData] - The raw mask data buffer (optional)
   * @param {Object} [rawData.metadata] - Additional metadata from the fetcher
   * @param {Object} options - Processing options
   * @param {Object} [options.targetLocation] - REQUIRED: Target location {latitude, longitude} for building detection
   * @param {boolean} [options.processAllMonths=true] - Whether to process all 12 months
   * @param {number} [options.buildingMargin=20] - Margin to add around building boundaries
   * @param {boolean} [options.calculateStatistics=true] - Whether to calculate statistics for each month
   * @returns {Promise<Object>} - Processed monthly flux data
   * @throws {Error} if processing fails
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[MonthlyFluxProcessor] Processing monthly flux data");

        // Validate target location for building detection
        if (!options.targetLocation) {
          throw new Error(
            "[MonthlyFluxProcessor] targetLocation is required for building boundary detection. " +
              "This should be provided by the LayerManager."
          );
        }

        if (
          !options.targetLocation.latitude ||
          !options.targetLocation.longitude
        ) {
          throw new Error(
            "[MonthlyFluxProcessor] targetLocation must have latitude and longitude properties. " +
              `Received: ${JSON.stringify(options.targetLocation)}`
          );
        }

        console.log(
          `[MonthlyFluxProcessor] Using target location for building detection: ${options.targetLocation.latitude}, ${options.targetLocation.longitude}`
        );

        // Check if we have a combined object with both monthly flux and mask data
        const isRawObject =
          rawData &&
          typeof rawData === "object" &&
          (rawData.monthlyFluxData || rawData.fluxBuffer);

        // Extract buffers from object or use raw buffer directly
        let fluxBuffer, maskBuffer, fetcherMetadata;

        if (isRawObject) {
          // Data is an object with embedded buffers and metadata
          fluxBuffer = rawData.monthlyFluxData || rawData.fluxBuffer;
          maskBuffer = rawData.maskData || rawData.maskBuffer;
          fetcherMetadata = rawData.metadata || {};

          console.log(
            `[MonthlyFluxProcessor] Received data object with flux buffer (${
              fluxBuffer ? "present" : "missing"
            }) and mask buffer (${maskBuffer ? "present" : "missing"})`
          );
        } else {
          // Direct buffer (although this case may not handle mask data)
          fluxBuffer = rawData;
          maskBuffer = null;
          fetcherMetadata = {};

          console.log(`[MonthlyFluxProcessor] Received direct buffer data`);
        }

        // Validate flux buffer
        if (!fluxBuffer) {
          throw new Error("Monthly flux data buffer is required");
        }

        // Log buffer details
        console.log(
          `[MonthlyFluxProcessor] Flux buffer type: ${typeof fluxBuffer}, length: ${
            fluxBuffer.byteLength || fluxBuffer.length || "unknown"
          }`
        );

        // Ensure buffer is in the correct format
        this.validateRawData(fluxBuffer);

        // Set default options
        const processAllMonths = options.processAllMonths !== false;
        const buildingMargin =
          options.buildingMargin || config.visualization.BUILDING_MARGIN;
        const calculateStatistics = options.calculateStatistics !== false;

        // Process the monthly flux GeoTIFF data
        let processedFluxGeoTiff;
        try {
          processedFluxGeoTiff = await this.geotiffProcessor.process(
            fluxBuffer,
            {
              convertToArray: true,
              // Don't specify samples as we want all bands
            }
          );

          console.log(
            `[MonthlyFluxProcessor] Monthly flux GeoTIFF processed: ${processedFluxGeoTiff.metadata.width}x${processedFluxGeoTiff.metadata.height} pixels, ${processedFluxGeoTiff.rasters.length} bands`
          );
        } catch (error) {
          throw new Error(
            `Failed to process monthly flux GeoTIFF: ${error.message}`
          );
        }

        // Extract metadata and rasters from the flux data
        const {
          metadata: fluxMetadata,
          rasters: fluxRasters,
          bounds,
        } = processedFluxGeoTiff;

        // Validate that we have geographic bounds for coordinate transformation
        if (!bounds) {
          throw new Error(
            "[MonthlyFluxProcessor] No geographic bounds found in monthly flux GeoTIFF. " +
              "Cannot perform coordinate transformation for targeted building detection."
          );
        }

        console.log(
          `[MonthlyFluxProcessor] Monthly flux GeoTIFF bounds: ${JSON.stringify(
            bounds
          )}`
        );

        // Check for expected 12 bands for monthly data
        if (fluxRasters.length !== 12) {
          console.warn(
            `[MonthlyFluxProcessor] Expected 12 bands for monthly flux data, but found ${fluxRasters.length}`
          );
        }

        // Process mask data if available - REQUIRED for target building detection
        let maskRaster = null;
        let buildingBoundaries = null;

        if (maskBuffer) {
          try {
            console.log("[MonthlyFluxProcessor] Processing mask data");

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
              console.log(
                `[MonthlyFluxProcessor] Mask dimensions (${maskMetadata.width}x${maskMetadata.height}) don't match flux (${fluxMetadata.width}x${fluxMetadata.height}). Resampling...`
              );

              // Resample the mask to match flux dimensions
              maskRaster = VisualizationUtils.resampleRaster(
                maskRasters[0],
                maskMetadata.width,
                maskMetadata.height,
                fluxMetadata.width,
                fluxMetadata.height,
                { method: "nearest" } // Use nearest neighbor for masks to preserve binary values
              );
            } else {
              maskRaster = maskRasters[0];
            }

            // Extract building boundaries using targeted detection
            try {
              console.log(
                "[MonthlyFluxProcessor] Finding target building boundaries..."
              );

              buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
                maskRaster,
                fluxMetadata.width,
                fluxMetadata.height,
                { margin: buildingMargin, threshold: 0 },
                options.targetLocation, // Target location for building detection
                bounds // Geographic bounds from GeoTIFF for coordinate transformation
              );

              if (buildingBoundaries.hasBuilding) {
                console.log(
                  `[MonthlyFluxProcessor] Found target building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
                );

                if (buildingBoundaries.targetBuilding) {
                  console.log(
                    `[MonthlyFluxProcessor] Successfully detected target building with ${
                      buildingBoundaries.connectedPixelCount || "unknown"
                    } connected pixels`
                  );
                }
              } else {
                console.warn(
                  "[MonthlyFluxProcessor] No target building found in mask data"
                );
              }
            } catch (error) {
              console.error(
                `[MonthlyFluxProcessor] Error finding target building boundaries: ${error.message}`
              );

              // For the new approach, we want to fail rather than continue with defaults
              throw new Error(
                `Failed to find target building boundaries: ${error.message}`
              );
            }
          } catch (error) {
            console.error(
              `[MonthlyFluxProcessor] Error processing mask: ${error.message}`
            );

            // For the new targeted approach, we should propagate the error
            throw new Error(
              `Failed to process mask data for target building detection: ${error.message}`
            );
          }
        } else {
          // No mask data available - this is a problem for the new approach
          throw new Error(
            "[MonthlyFluxProcessor] Mask data is required for target building detection. " +
              "Cannot identify target building without mask data."
          );
        }

        // Check for no-data values and find valid data range
        const noDataValue = config.processing.NO_DATA_VALUE;
        const dataRanges = [];

        for (let month = 0; month < fluxRasters.length; month++) {
          if (calculateStatistics) {
            dataRanges.push(
              this.findDataRange(fluxRasters[month], noDataValue)
            );
          }
        }

        // Process each month's data
        const monthlyData = [];

        // Process all months or specified months only
        const monthsToProcess = processAllMonths
          ? Array.from({ length: fluxRasters.length }, (_, i) => i)
          : [options.month || 0];

        for (const month of monthsToProcess) {
          // Skip if month is out of range
          if (month < 0 || month >= fluxRasters.length) {
            console.warn(
              `[MonthlyFluxProcessor] Month ${month} is out of range (0-${
                fluxRasters.length - 1
              })`
            );
            continue;
          }

          const raster = fluxRasters[month];

          // Apply mask if available
          let maskedRaster = raster;
          if (maskRaster) {
            maskedRaster = this.applyMask(
              raster,
              maskRaster,
              fluxMetadata.width,
              fluxMetadata.height
            );
          }

          // Calculate statistics if requested
          let statistics = null;
          if (calculateStatistics) {
            statistics = this.calculateStatistics(
              maskedRaster,
              month,
              dataRanges[month]
            );
          }

          // Create the month data
          monthlyData.push({
            month,
            monthName: this.getMonthName(month),
            raster: maskedRaster,
            originalRaster: raster,
            statistics,
            dataRange: dataRanges[month] || null,
            seasonalFactor: VisualizationUtils.getSeasonalFactor(month),
          });
        }

        // Create the result object
        const result = {
          layerType: "monthlyFlux",
          metadata: {
            ...fluxMetadata,
            ...fetcherMetadata,
            dimensions: {
              width: fluxMetadata.width,
              height: fluxMetadata.height,
            },
            months: fluxRasters.length,
            hasMask: !!maskRaster,
            noDataValue,
            targetLocation: options.targetLocation,
            targetBuildingDetected: buildingBoundaries?.targetBuilding || false,
          },
          monthlyData,
          bounds,
          buildingBoundaries,
          maskRaster,
        };

        console.log("[MonthlyFluxProcessor] Monthly flux processing complete");

        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "monthlyFlux",
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
   * Find valid data range in a raster
   * @private
   * @param {Array<number>} raster - Raster data
   * @param {number} noDataValue - Value to ignore as no-data
   * @returns {Object} - Min and max values {min, max}
   */
  findDataRange(raster, noDataValue) {
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
        console.warn("[MonthlyFluxProcessor] No valid data found in raster");
        return { min: 0, max: 1, avg: 0, validCount: 0 };
      }

      return {
        min,
        max,
        avg: sum / validCount,
        validCount,
      };
    } catch (error) {
      console.error(
        `[MonthlyFluxProcessor] Error finding data range: ${error.message}`
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
        `[MonthlyFluxProcessor] Error applying mask: ${error.message}`
      );
      return fluxRaster; // Return original raster if masking fails
    }
  }

  /**
   * Calculate statistics for a monthly raster
   * @private
   * @param {Array<number>} raster - Masked flux raster data
   * @param {number} month - Month index (0-11)
   * @param {Object} dataRange - Data range {min, max}
   * @returns {Object} - Statistics for the month
   */
  calculateStatistics(raster, month, dataRange) {
    try {
      const noDataValue = config.processing.NO_DATA_VALUE;
      let sum = 0;
      let count = 0;
      let maxValue = -Infinity;
      let maxLocation = -1;

      // Calculate sum and find maximum
      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value)) {
          sum += value;
          count++;

          if (value > maxValue) {
            maxValue = value;
            maxLocation = i;
          }
        }
      }

      // Calculate average
      const avg = count > 0 ? sum / count : 0;

      // Get seasonal adjustment factor
      const seasonalFactor = VisualizationUtils.getSeasonalFactor(month);

      return {
        month,
        monthName: this.getMonthName(month),
        average: avg,
        max: maxValue,
        maxLocation,
        validPixels: count,
        seasonalFactor,
        seasonalAdjustedAvg: avg * seasonalFactor,
        min: dataRange ? dataRange.min : 0,
        dataPoints: count,
      };
    } catch (error) {
      console.error(
        `[MonthlyFluxProcessor] Error calculating statistics: ${error.message}`
      );
      return {
        month,
        monthName: this.getMonthName(month),
        error: error.message,
      };
    }
  }

  /**
   * Get month name from index
   * @private
   * @param {number} month - Month index (0-11)
   * @returns {string} - Month name
   */
  getMonthName(month) {
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    // Handle invalid month index
    if (month < 0 || month >= monthNames.length) {
      console.warn(`[MonthlyFluxProcessor] Invalid month index: ${month}`);
      return `Month ${month}`;
    }

    return monthNames[month];
  }
}

module.exports = MonthlyFluxProcessor;
